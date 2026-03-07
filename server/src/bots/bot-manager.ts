import { nanoid } from 'nanoid';
import { eq, sql } from 'drizzle-orm';
import { db } from '../db/index.js';
import * as schema from '../db/schema.js';
import { logActivity } from '../services/audit-service.js';
import { logger } from '../lib/logger.js';
import { botEventBus, botEventDepth, botEventOrigins } from './event-bus.js';
import { botRateLimiter } from './rate-limiter.js';
import { decryptConfigSecrets } from './secret-store.js';
import type { Bot, BotConfig, BotContext, BotEvent, BotRunStatus, BotTriggerType, BotCapability } from './types.js';
import { createBotImplementation } from './implementations/index.js';

const BOT_EXECUTION_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes max per run
const MAX_CONCURRENT_RUNS = 10;

/**
 * BotManager: lifecycle management, event routing, scheduling, and execution.
 * Runs in-process on the Hono server — no external infrastructure needed.
 */
export class BotManager {
  private bots = new Map<string, Bot>();
  private configs = new Map<string, BotConfig>();
  private cronIntervals = new Map<string, ReturnType<typeof setInterval>>();
  private activeRuns = 0;
  private initialized = false;

  /** Load all enabled bot configs from DB and start them */
  async init(): Promise<void> {
    if (this.initialized) return;

    const rows = await db.select().from(schema.botConfigs).where(eq(schema.botConfigs.enabled, true));
    for (const row of rows) {
      try {
        await this.loadBot(row as unknown as BotConfig);
      } catch (err) {
        logger.error(`Failed to load bot ${row.name}`, { botId: row.id, error: String(err) });
      }
    }

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
    botEventBus.onBotEvent('*', (event) => {
      void this.routeEvent(event);
    });

    this.initialized = true;
    logger.info(`BotManager initialized with ${this.bots.size} bot(s)`);
  }

  /** Shut down all bots and clean up */
  async shutdown(): Promise<void> {
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
    this.cronIntervals.clear();
    this.initialized = false;
  }

  /** Load and start a single bot from its config */
  async loadBot(config: BotConfig): Promise<void> {
    // Store config
    this.configs.set(config.id, config);

    // Register rate limit buckets
    botRateLimiter.register(`bot:${config.id}:hour`, config.rateLimitPerHour, 60 * 60 * 1000);
    botRateLimiter.register(`bot:${config.id}:day`, config.rateLimitPerDay, 24 * 60 * 60 * 1000);

    // Create and initialize bot implementation
    const bot = createBotImplementation(config);
    await bot.onInit(config);
    this.bots.set(config.id, bot);

    // Set up cron schedule if configured
    if (config.triggers.schedule) {
      this.setupSchedule(config);
    }

    logger.info(`Bot loaded: ${config.name} (${config.type})`, { botId: config.id });
  }

  /** Unload a bot */
  async unloadBot(botId: string): Promise<void> {
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

    botRateLimiter.removeBuckets(botId);
    this.configs.delete(botId);
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

    for (const [botId, config] of this.configs) {
      if (!config.enabled) continue;
      if (!config.triggers.events?.includes(event.type)) continue;

      // Check event filters
      const filters = config.triggers.eventFilters;
      if (filters) {
        if (filters.tables && event.table && !filters.tables.includes(event.table)) continue;
        if (filters.folderIds && event.folderId && !filters.folderIds.includes(event.folderId)) continue;
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

      void this.executeBot(botId, 'event', event);
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

    // Rate limiting — check both limits before consuming either to avoid
    // consuming an hourly token when the daily limit is already exhausted
    const hourlyKey = `bot:${botId}:hour`;
    const dailyKey = `bot:${botId}:day`;
    if (!botRateLimiter.canConsume(hourlyKey) || !botRateLimiter.canConsume(dailyKey)) {
      logger.warn(`Bot ${config.name} rate limited`, { botId });
      return;
    }
    botRateLimiter.tryConsume(hourlyKey);
    botRateLimiter.tryConsume(dailyKey);

    // Concurrency limit
    if (this.activeRuns >= MAX_CONCURRENT_RUNS) {
      logger.warn('Max concurrent bot runs reached, skipping', { botId, activeRuns: this.activeRuns });
      return;
    }
    this.activeRuns++;

    const runId = nanoid();
    const startTime = Date.now();
    const abortController = new AbortController();

    // Create run record
    await db.insert(schema.botRuns).values({
      id: runId,
      botConfigId: botId,
      status: 'running',
      trigger,
      inputSummary: event ? `${event.type} on ${event.table || 'unknown'}` : trigger,
      createdAt: new Date(),
    });

    const ctx: BotContext = {
      botConfig: { ...config, config: decryptConfigSecrets(config.config) },
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
    const timeout = setTimeout(() => {
      abortController.abort();
    }, BOT_EXECUTION_TIMEOUT_MS);

    let status: BotRunStatus = 'success';
    let error: string | null = null;

    try {
      // Audit: bot run started
      await logActivity({
        userId: config.userId,
        category: 'bot',
        action: `run.${trigger}`,
        detail: `Bot "${config.name}" triggered by ${trigger}${event ? `: ${event.type}` : ''}`,
        itemId: runId,
        itemTitle: config.name,
        folderId: event?.folderId,
      });

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
              await bot.onEvent(ctx, event);
            } else if (trigger === 'schedule' && bot.onSchedule) {
              await bot.onSchedule(ctx);
            } else if (trigger === 'webhook' && webhookPayload && bot.onWebhook) {
              await bot.onWebhook(ctx, webhookPayload);
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
      clearTimeout(timeout);
      this.activeRuns--;

      const durationMs = Date.now() - startTime;

      // Update run record
      try {
        await db.update(schema.botRuns).set({
          status,
          durationMs,
          error,
          outputSummary: `Created: ${ctx.entitiesCreated}, Updated: ${ctx.entitiesUpdated}, API calls: ${ctx.apiCallsMade}`,
          entitiesCreated: ctx.entitiesCreated,
          entitiesUpdated: ctx.entitiesUpdated,
          apiCallsMade: ctx.apiCallsMade,
        }).where(eq(schema.botRuns.id, runId));
      } catch (err) {
        logger.error(`Failed to update bot run record ${runId}`, { error: String(err) });
      }

      // Update bot config stats using SQL increment to avoid race conditions
      try {
        const statsUpdate: Record<string, unknown> = {
          lastRunAt: new Date(),
          lastError: error,
          runCount: sql`${schema.botConfigs.runCount} + 1`,
          updatedAt: new Date(),
        };
        if (status === 'error' || status === 'timeout') {
          statsUpdate.errorCount = sql`${schema.botConfigs.errorCount} + 1`;
        }
        await db.update(schema.botConfigs).set(statsUpdate).where(eq(schema.botConfigs.id, botId));
      } catch (err) {
        logger.error(`Failed to update bot config stats for ${botId}`, { error: String(err) });
      }

      // Update in-memory config (best-effort cache)
      const updatedConfig = this.configs.get(botId);
      if (updatedConfig) {
        updatedConfig.runCount++;
        updatedConfig.lastRunAt = new Date();
        updatedConfig.lastError = error;
        if (status === 'error' || status === 'timeout') updatedConfig.errorCount++;
      }

      // Audit: bot run completed
      try {
        await logActivity({
          userId: config.userId,
          category: 'bot',
          action: `run.${status}`,
          detail: `Bot "${config.name}" ${status} in ${durationMs}ms — created ${ctx.entitiesCreated}, updated ${ctx.entitiesUpdated}`,
          itemId: runId,
          itemTitle: config.name,
          folderId: event?.folderId,
        });
      } catch (err) {
        logger.error(`Failed to log bot run audit for ${botId}`, { error: String(err) });
      }
    }
  }

  /** Register a bot implementation (called by bot modules) */
  registerBot(bot: Bot): void {
    this.bots.set(bot.id, bot);
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
      void this.executeBot(config.id, 'schedule');
    }, intervalMs);
    interval.unref(); // Don't prevent process exit

    this.cronIntervals.set(config.id, interval);
    logger.info(`Scheduled bot ${config.name} every ${Math.round(intervalMs / 1000)}s`, { botId: config.id });
  }

  /** Get all loaded bot configs (for admin API) */
  getLoadedBots(): BotConfig[] {
    return Array.from(this.configs.values());
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
