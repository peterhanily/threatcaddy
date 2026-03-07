import { nanoid } from 'nanoid';
import { eq, sql } from 'drizzle-orm';
import { db } from '../db/index.js';
import * as schema from '../db/schema.js';
import { logActivity } from '../services/audit-service.js';
import { createNotification } from '../services/notification-service.js';
import { logger } from '../lib/logger.js';
import { botEventBus, botEventDepth, botEventOrigins } from './event-bus.js';
import { botRateLimiter } from './rate-limiter.js';
import { decryptConfigSecrets } from './secret-store.js';
import type { Bot, BotConfig, BotContext, BotEvent, BotEventType, BotRunStatus, BotTriggerType, BotCapability } from './types.js';
import { createBotImplementation } from './implementations/index.js';

const BOT_EXECUTION_TIMEOUT_MS = parseInt(process.env.BOT_EXECUTION_TIMEOUT_MS || '', 10) || 5 * 60 * 1000;
const MAX_CONCURRENT_RUNS = parseInt(process.env.BOT_MAX_CONCURRENT_RUNS || '', 10) || 10;
const MAX_QUEUE_SIZE = 50;

/**
 * BotManager: lifecycle management, event routing, scheduling, and execution.
 * Runs in-process on the Hono server — no external infrastructure needed.
 */
export class BotManager {
  private bots = new Map<string, Bot>();
  private configs = new Map<string, BotConfig>();
  private decryptedConfigs = new Map<string, Record<string, unknown>>();
  private cronIntervals = new Map<string, ReturnType<typeof setInterval>>();
  private activeRuns = 0;
  private initialized = false;
  private initializing = false;

  /** Reverse index: event type → set of bot IDs that subscribe to that event */
  private eventTypeIndex = new Map<BotEventType, Set<string>>();

  /** Active AbortControllers per bot, so we can abort in-flight executions on disable */
  private activeAbortControllers = new Map<string, Set<AbortController>>();

  /** Wildcard listener reference for cleanup on shutdown */
  private wildcardListener: ((event: BotEvent) => void) | null = null;

  /** Simple FIFO execution queue for when concurrency limit is hit */
  private executionQueue: Array<() => void> = [];

  /** In-memory consecutive error counter for circuit breaker (avoids DB query on every error) */
  private consecutiveErrors = new Map<string, number>();

  /** Counters for observability */
  private stats = { queued: 0, dropped: 0, rateLimited: 0 };

  /** Load all enabled bot configs from DB and start them */
  async init(): Promise<void> {
    if (this.initialized || this.initializing) return;
    this.initializing = true;

    try {
      const rows = await db.select().from(schema.botConfigs).where(eq(schema.botConfigs.enabled, true));
      await Promise.allSettled(
        rows.map(row => this.loadBot(row as unknown as BotConfig).catch(err => {
          logger.error(`Failed to load bot ${row.name}`, { botId: row.id, error: String(err) });
        }))
      );

      // Clean up stale 'running' bot_runs from previous crash
      try {
        const stale = await db.update(schema.botRuns)
          .set({ status: 'error', error: 'Server restarted during execution', durationMs: 0 })
          .where(eq(schema.botRuns.status, 'running'))
          .returning({ id: schema.botRuns.id });
        if (stale.length > 0) {
          logger.info(`Cleaned up ${stale.length} stale bot run(s) from previous crash`);
        }
      } catch (err) {
        logger.error('Failed to clean up stale bot runs', { error: String(err) });
      }

      // Listen for all events and route to bots
      this.wildcardListener = (event: BotEvent) => {
        this.routeEvent(event).catch(err => {
          logger.error('Error routing bot event', { type: event.type, error: String(err) });
        });
      };
      botEventBus.onBotEvent('*', this.wildcardListener);

      this.initialized = true;
      logger.info(`BotManager initialized with ${this.bots.size} bot(s)`);
    } finally {
      this.initializing = false;
    }
  }

  /** Shut down all bots and clean up */
  async shutdown(): Promise<void> {
    // Remove wildcard event listener
    if (this.wildcardListener) {
      botEventBus.offBotEvent('*', this.wildcardListener);
      this.wildcardListener = null;
    }

    // Abort all in-flight executions
    for (const controllers of this.activeAbortControllers.values()) {
      for (const controller of controllers) {
        controller.abort();
      }
    }
    this.activeAbortControllers.clear();

    for (const [id, bot] of this.bots) {
      try {
        await bot.onDestroy();
      } catch (err) {
        logger.error(`Error destroying bot ${id}`, { error: String(err) });
      }
    }

    for (const interval of this.cronIntervals.values()) {
      clearInterval(interval);
    }

    this.bots.clear();
    this.configs.clear();
    this.decryptedConfigs.clear();
    this.cronIntervals.clear();
    this.eventTypeIndex.clear();
    this.consecutiveErrors.clear();
    this.executionQueue.length = 0;
    this.activeRuns = 0;
    this.initialized = false;
  }

  /** Load and start a single bot from its config */
  async loadBot(config: BotConfig): Promise<void> {
    // Clean up prior state to prevent interval leaks on reload
    const priorInterval = this.cronIntervals.get(config.id);
    if (priorInterval) {
      clearInterval(priorInterval);
      this.cronIntervals.delete(config.id);
    }
    const priorConfig = this.configs.get(config.id);
    if (priorConfig?.triggers.events) {
      for (const et of priorConfig.triggers.events) {
        this.eventTypeIndex.get(et)?.delete(config.id);
      }
    }

    // Store config
    this.configs.set(config.id, config);

    // Update event type reverse index
    if (config.triggers.events) {
      for (const eventType of config.triggers.events) {
        let botIds = this.eventTypeIndex.get(eventType);
        if (!botIds) {
          botIds = new Set();
          this.eventTypeIndex.set(eventType, botIds);
        }
        botIds.add(config.id);
      }
    }

    // Register rate limit buckets
    botRateLimiter.register(`bot:${config.id}:hour`, config.rateLimitPerHour, 60 * 60 * 1000);
    botRateLimiter.register(`bot:${config.id}:day`, config.rateLimitPerDay, 24 * 60 * 60 * 1000);

    // Create and initialize bot implementation
    const bot = createBotImplementation(config);
    await bot.onInit(config);
    this.bots.set(config.id, bot);
    this.decryptedConfigs.set(config.id, decryptConfigSecrets(config.config));

    // Set up cron schedule if configured
    if (config.triggers.schedule) {
      this.setupSchedule(config);
    }

    logger.info(`Bot loaded: ${config.name} (${config.type})`, { botId: config.id });
  }

  /** Unload a bot */
  async unloadBot(botId: string): Promise<void> {
    // Abort any in-flight executions for this bot
    const controllers = this.activeAbortControllers.get(botId);
    if (controllers) {
      for (const controller of controllers) {
        controller.abort();
      }
      this.activeAbortControllers.delete(botId);
    }

    const bot = this.bots.get(botId);
    if (bot) {
      await bot.onDestroy();
      this.bots.delete(botId);
    }

    const interval = this.cronIntervals.get(botId);
    if (interval) {
      clearInterval(interval);
      this.cronIntervals.delete(botId);
    }

    // Remove from event type reverse index
    const config = this.configs.get(botId);
    if (config?.triggers.events) {
      for (const eventType of config.triggers.events) {
        const botIds = this.eventTypeIndex.get(eventType);
        if (botIds) {
          botIds.delete(botId);
          if (botIds.size === 0) {
            this.eventTypeIndex.delete(eventType);
          }
        }
      }
    }

    botRateLimiter.removeBuckets(botId);
    this.configs.delete(botId);
    this.decryptedConfigs.delete(botId);
  }

  /** Reload a bot (disable then re-enable with updated config) */
  async reloadBot(botId: string): Promise<void> {
    await this.unloadBot(botId);

    const rows = await db.select().from(schema.botConfigs).where(eq(schema.botConfigs.id, botId));
    if (rows.length > 0 && rows[0].enabled) {
      await this.loadBot(rows[0] as unknown as BotConfig);
    }
  }

  /** Route an event to all bots that subscribe to it */
  private async routeEvent(event: BotEvent): Promise<void> {
    const eventDepth = event.depth || 0;
    if (eventDepth >= 5) {
      logger.warn('Bot event chain depth limit reached, dropping event', {
        type: event.type,
        depth: eventDepth,
      });
      return;
    }

    // O(1) lookup: only iterate bots that subscribe to this event type
    const subscribedBotIds = this.eventTypeIndex.get(event.type);
    if (!subscribedBotIds || subscribedBotIds.size === 0) return;

    for (const botId of subscribedBotIds) {
      const config = this.configs.get(botId);
      if (!config || !config.enabled) continue;

      // Check event filters
      const filters = config.triggers.eventFilters;
      if (filters) {
        if (filters.tables && (!event.table || !filters.tables.includes(event.table))) continue;
        // If folder filter is set, reject events that don't match — including events without a folderId
        if (filters.folderIds && (!event.folderId || !filters.folderIds.includes(event.folderId))) continue;
        if (filters.iocTypes && event.table === 'standaloneIOCs' && event.data) {
          const iocType = event.data.type as string;
          if (!filters.iocTypes.includes(iocType)) continue;
        }
      }

      // Check scope
      if (!this.isInScope(config, event.folderId)) continue;

      // Don't let bots trigger themselves or re-enter a chain they're already in
      if (event.userId === config.userId) continue;
      if (event.originBotIds?.includes(config.userId)) continue;

      this.executeBot(botId, 'event', event).catch(err => {
        logger.error(`Error executing bot ${botId} for event`, { error: String(err) });
      });
    }
  }

  /** Execute a bot with timeout, rate limiting, and audit trail */
  async executeBot(
    botId: string,
    trigger: BotTriggerType,
    event?: BotEvent,
    webhookPayload?: Record<string, unknown>,
  ): Promise<void> {
    const config = this.configs.get(botId);
    if (!config || !config.enabled) return;

    // Concurrency limit — queue if at capacity, drop if queue is full
    if (this.activeRuns >= MAX_CONCURRENT_RUNS) {
      if (this.executionQueue.length >= MAX_QUEUE_SIZE) {
        this.stats.dropped++;
        logger.warn('Bot execution queue full, dropping', { botId, queueSize: this.executionQueue.length });
        return;
      }
      this.stats.queued++;
      return new Promise<void>((resolve) => {
        this.executionQueue.push(() => {
          // Rate-limit when dequeued so tokens aren't wasted on queued items that may never run
          if (!this.consumeRateTokens(botId)) {
            resolve();
            this.drainQueue();
            return;
          }
          this.activeRuns++;
          this.executeBotInner(botId, trigger, event, webhookPayload).then(resolve, resolve);
        });
      });
    }

    // Rate limiting for immediate execution
    if (!this.consumeRateTokens(botId)) return;

    this.activeRuns++;
    await this.executeBotInner(botId, trigger, event, webhookPayload);
  }

  /** Check and consume rate limit tokens. Returns false if rate-limited. */
  private consumeRateTokens(botId: string): boolean {
    const hourlyKey = `bot:${botId}:hour`;
    const dailyKey = `bot:${botId}:day`;
    if (!botRateLimiter.canConsume(hourlyKey) || !botRateLimiter.canConsume(dailyKey)) {
      this.stats.rateLimited++;
      logger.warn('Bot rate limited', { botId });
      return false;
    }
    botRateLimiter.tryConsume(hourlyKey);
    botRateLimiter.tryConsume(dailyKey);
    return true;
  }

  /** Inner execution logic — called after rate limiting and concurrency checks */
  private async executeBotInner(
    botId: string,
    trigger: BotTriggerType,
    event?: BotEvent,
    webhookPayload?: Record<string, unknown>,
  ): Promise<void> {
    const config = this.configs.get(botId);
    if (!config) {
      this.activeRuns--;
      this.drainQueue();
      return;
    }

    const runId = nanoid();
    const startTime = Date.now();
    const abortController = new AbortController();

    // Track this AbortController for in-flight abort on disable
    let botControllers = this.activeAbortControllers.get(botId);
    if (!botControllers) {
      botControllers = new Set();
      this.activeAbortControllers.set(botId, botControllers);
    }
    botControllers.add(abortController);

    let status: BotRunStatus = 'success';
    let error: string | null = null;
    let timeout: ReturnType<typeof setTimeout> | undefined;
    let runInserted = false;
    let ctx: BotContext | undefined;

    try {
      // Create run record
      await db.insert(schema.botRuns).values({
        id: runId,
        botConfigId: botId,
        status: 'running',
        trigger,
        inputSummary: event ? `${event.type} on ${event.table || 'unknown'}` : trigger,
        createdAt: new Date(),
      });
      runInserted = true;

      ctx = {
        botConfig: { ...config, config: this.decryptedConfigs.get(botId) || config.config },
        botUserId: config.userId,
        runId,
        trigger,
        event,
        entitiesCreated: 0,
        entitiesUpdated: 0,
        apiCallsMade: 0,
        signal: abortController.signal,
      };

      // Execution timeout
      timeout = setTimeout(() => {
        abortController.abort();
      }, BOT_EXECUTION_TIMEOUT_MS);

      // Audit: bot run started (fire-and-forget — don't block execution)
      logActivity({
        userId: config.userId,
        category: 'bot',
        action: `run.${trigger}`,
        detail: `Bot "${config.name}" triggered by ${trigger}${event ? `: ${event.type}` : ''}`,
        itemId: runId,
        itemTitle: config.name,
        folderId: event?.folderId,
      }).catch(() => {});

      // Dispatch to the right handler, wrapped in botEventDepth and
      // botEventOrigins context so entity mutations emitted by the bot
      // carry incremented depth and the full chain of origin bot IDs
      const nextDepth = (event?.depth || 0) + 1;
      const origins = [...(event?.originBotIds || []), config.userId];
      await botEventDepth.run(nextDepth, () =>
        botEventOrigins.run(origins, async () => {
          const bot = this.bots.get(botId);
          if (bot) {
            if (trigger === 'event' && event && bot.onEvent) {
              await bot.onEvent(ctx!, event);
            } else if (trigger === 'schedule' && bot.onSchedule) {
              await bot.onSchedule(ctx!);
            } else if (trigger === 'webhook' && webhookPayload && bot.onWebhook) {
              await bot.onWebhook(ctx!, webhookPayload);
            }
          }
        }),
      );
    } catch (err) {
      if (abortController.signal.aborted) {
        status = 'timeout';
        error = `Bot execution timed out after ${BOT_EXECUTION_TIMEOUT_MS}ms`;
      } else {
        status = 'error';
        error = String(err);
      }
      logger.error(`Bot "${config.name}" execution failed`, { botId, runId, error });
    } finally {
      if (timeout) clearTimeout(timeout);
      this.activeRuns--;
      this.drainQueue();

      // Remove this AbortController from tracking
      const controllers = this.activeAbortControllers.get(botId);
      if (controllers) {
        controllers.delete(abortController);
        if (controllers.size === 0) {
          this.activeAbortControllers.delete(botId);
        }
      }

      if (runInserted) {
        const durationMs = Date.now() - startTime;

        // Update run record + bot config stats in parallel
        const statsUpdate: Record<string, unknown> = {
          lastRunAt: new Date(),
          lastError: error,
          runCount: sql`${schema.botConfigs.runCount} + 1`,
          updatedAt: new Date(),
        };
        if (status === 'error' || status === 'timeout') {
          statsUpdate.errorCount = sql`${schema.botConfigs.errorCount} + 1`;
        }

        await Promise.all([
          db.update(schema.botRuns).set({
            status,
            durationMs,
            error,
            outputSummary: ctx ? `Created: ${ctx.entitiesCreated}, Updated: ${ctx.entitiesUpdated}, API calls: ${ctx.apiCallsMade}` : '',
            entitiesCreated: ctx?.entitiesCreated ?? 0,
            entitiesUpdated: ctx?.entitiesUpdated ?? 0,
            apiCallsMade: ctx?.apiCallsMade ?? 0,
          }).where(eq(schema.botRuns.id, runId)).catch(err => {
            logger.error(`Failed to update bot run record ${runId}`, { error: String(err) });
          }),
          db.update(schema.botConfigs).set(statsUpdate).where(eq(schema.botConfigs.id, botId)).catch(err => {
            logger.error(`Failed to update bot config stats for ${botId}`, { error: String(err) });
          }),
        ]);

        // Update in-memory config (best-effort cache)
        const updatedConfig = this.configs.get(botId);
        if (updatedConfig) {
          updatedConfig.runCount++;
          updatedConfig.lastRunAt = new Date();
          updatedConfig.lastError = error;
          if (status === 'error' || status === 'timeout') updatedConfig.errorCount++;
        }

        // Circuit breaker: in-memory counter avoids DB query on every error
        if (status === 'error' || status === 'timeout') {
          const count = (this.consecutiveErrors.get(botId) || 0) + 1;
          this.consecutiveErrors.set(botId, count);
          if (count >= 5) {
            try {
              logger.warn(`Circuit breaker: auto-disabling bot "${config.name}" after ${count} consecutive failures`, { botId });
              await db.update(schema.botConfigs).set({ enabled: false, updatedAt: new Date() }).where(eq(schema.botConfigs.id, botId));
              await this.unloadBot(botId);
              createNotification({
                userId: config.createdBy,
                type: 'bot_disabled',
                message: `Bot "${config.name}" was auto-disabled after ${count} consecutive failures. Last error: ${error}`,
              }).catch(() => { /* best effort */ });
            } catch (err) {
              logger.error(`Failed to check circuit breaker for bot ${botId}`, { error: String(err) });
            }
          }
        } else {
          this.consecutiveErrors.delete(botId);
        }

        // Audit: bot run completed (fire-and-forget)
        logActivity({
          userId: config.userId,
          category: 'bot',
          action: `run.${status}`,
          detail: `Bot "${config.name}" ${status} in ${durationMs}ms — created ${ctx?.entitiesCreated ?? 0}, updated ${ctx?.entitiesUpdated ?? 0}`,
          itemId: runId,
          itemTitle: config.name,
          folderId: event?.folderId,
        }).catch(err => {
          logger.error(`Failed to log bot run audit for ${botId}`, { error: String(err) });
        });
      }
    }
  }

  /** Get cached webhook secret for a bot (returns null if bot not loaded or no webhook configured) */
  getWebhookSecret(botId: string): string | null {
    const config = this.configs.get(botId);
    if (!config || !config.enabled) return null;
    const triggers = config.triggers;
    if (!triggers?.webhook) return null;
    const decrypted = this.decryptedConfigs.get(botId);
    const secret = decrypted?.webhookSecret as string | undefined;
    return secret && secret.length > 0 ? secret : null;
  }

  /** Check if a bot has a specific capability */
  hasCapability(botId: string, capability: BotCapability): boolean {
    const config = this.configs.get(botId);
    if (!config) return false;
    return config.capabilities.includes(capability);
  }

  /** Check if a folder is within a bot's configured scope */
  private isInScope(config: BotConfig, folderId?: string): boolean {
    if (config.scopeType === 'global') return true;
    if (!folderId) return false;
    return config.scopeFolderIds.includes(folderId);
  }

  /** Set up cron-like scheduling for a bot */
  private setupSchedule(config: BotConfig): void {
    // Simple interval-based scheduling from cron expression
    // Supports: '*/N * * * *' (every N minutes), '0 */N * * *' (every N hours)
    const intervalMs = parseCronToMs(config.triggers.schedule!);
    if (intervalMs <= 0) {
      logger.warn(`Invalid cron expression for bot ${config.name}: ${config.triggers.schedule}`);
      return;
    }

    const interval = setInterval(() => {
      this.executeBot(config.id, 'schedule').catch(err => {
        logger.error(`Scheduled bot ${config.name} execution failed`, { botId: config.id, error: String(err) });
      });
    }, intervalMs);
    interval.unref(); // Don't prevent process exit

    this.cronIntervals.set(config.id, interval);
    logger.info(`Scheduled bot ${config.name} every ${Math.round(intervalMs / 1000)}s`, { botId: config.id });
  }

  /** Get all loaded bot configs (for admin API) */
  getLoadedBots(): BotConfig[] {
    return Array.from(this.configs.values());
  }

  /** Get runtime stats for observability */
  getStats() {
    return {
      loadedBots: this.bots.size,
      activeRuns: this.activeRuns,
      queueSize: this.executionQueue.length,
      ...this.stats,
    };
  }

  /** Drain one item from the execution queue */
  private drainQueue(): void {
    if (this.executionQueue.length > 0) {
      const next = this.executionQueue.shift()!;
      next();
    }
  }
}

/** Parse a simple cron expression to interval in milliseconds. */
function parseCronToMs(cron: string): number {
  const parts = cron.trim().split(/\s+/);
  if (parts.length < 5) return 0;

  const [minute, hour] = parts;

  // Every N minutes: '*/N * * * *'
  if (minute.startsWith('*/')) {
    const n = parseInt(minute.slice(2), 10);
    if (n > 0 && n <= 1440) return n * 60 * 1000;
  }

  // Every N hours: '0 */N * * *'
  if (minute === '0' && hour.startsWith('*/')) {
    const n = parseInt(hour.slice(2), 10);
    if (n > 0 && n <= 24) return n * 60 * 60 * 1000;
  }

  // Daily at specific hour: '0 N * * *' or 'M N * * *'
  if (/^\d+$/.test(minute) && /^\d+$/.test(hour) && parts[2] === '*') {
    return 24 * 60 * 60 * 1000; // Run daily
  }

  // Hourly: '0 * * * *' or 'N * * * *'
  if (/^\d+$/.test(minute) && hour === '*') {
    return 60 * 60 * 1000;
  }

  return 0;
}

/** Validate a cron expression can be parsed. Returns error message or null. */
export function validateCronExpression(cron: string): string | null {
  const parts = cron.trim().split(/\s+/);
  if (parts.length < 5) return 'Cron expression must have 5 fields (minute hour day month weekday)';
  const ms = parseCronToMs(cron);
  if (ms <= 0) return 'Unsupported cron pattern. Supported: */N * * * * (every N min), 0 */N * * * (every N hours), 0 0 * * * (daily), N * * * * (hourly at min N)';
  return null;
}

// Singleton
export const botManager = new BotManager();
