import { nanoid } from 'nanoid';
import { logger } from '../../lib/logger.js';
import type { BotExecutionContext } from '../bot-context.js';
import type { BotEvent } from '../types.js';
import { GenericBot } from './generic-bot.js';
import { IntegrationExecutor } from '../../services/integration-executor.js';
import type { ExecutionCallbacks, ExecutionInput } from '../../services/integration-executor.js';
import type { IntegrationTemplate, InstalledIntegration, IntegrationTriggerType } from '../../types/integration-types.js';

/**
 * IntegrationBot: executes integration templates as a bot.
 *
 * The bot config stores the full template JSON and user config.
 * Config shape:
 *   config.template: IntegrationTemplate  — the template definition
 *   config.integrationConfig: Record<string,unknown>  — user-provided config values
 *   config.scopeFolderIds?: string[]  — folder scope for entity creation
 */
export class IntegrationBot extends GenericBot {
  private executor = new IntegrationExecutor();

  private getTemplate(): IntegrationTemplate | null {
    const botConfig = this.config.config as Record<string, unknown>;
    const template = botConfig.template as IntegrationTemplate | undefined;
    if (!template || !template.id || !template.steps) {
      return null;
    }
    return template;
  }

  private getIntegrationConfig(): Record<string, unknown> {
    const botConfig = this.config.config as Record<string, unknown>;
    return (botConfig.integrationConfig as Record<string, unknown>) ?? {};
  }

  private buildInstallation(): InstalledIntegration {
    const template = this.getTemplate();
    return {
      id: this.config.id,
      templateId: template?.id ?? '',
      name: this.config.name,
      enabled: this.config.enabled,
      config: this.getIntegrationConfig(),
      scopeType: this.config.scopeType === 'global' ? 'all' : 'investigation',
      scopeFolderIds: this.config.scopeFolderIds,
      lastRunAt: this.config.lastRunAt?.getTime(),
      lastError: this.config.lastError ?? undefined,
      runCount: this.config.runCount,
      errorCount: this.config.errorCount,
      createdAt: this.config.createdAt.getTime(),
      updatedAt: this.config.updatedAt.getTime(),
    };
  }

  private buildCallbacks(execCtx: BotExecutionContext, folderId?: string): ExecutionCallbacks {
    return {
      onCreateEntity: async (type: string, fields: Record<string, unknown>): Promise<string> => {
        const entityFolderId = (fields.folderId as string) || folderId;
        if (!entityFolderId) {
          throw new Error('No folderId available for entity creation');
        }

        switch (type) {
          case 'ioc':
            return execCtx.createIOC(
              entityFolderId,
              (fields.type as string) || 'unknown',
              (fields.value as string) || '',
              (fields.confidence as string) || 'medium',
              fields.analystNotes as string | undefined,
            );
          case 'note':
            return execCtx.createNote(
              entityFolderId,
              (fields.title as string) || 'Untitled',
              (fields.content as string) || '',
              (fields.tags as string[]) || [],
            );
          case 'task':
            return execCtx.createTask(
              entityFolderId,
              (fields.title as string) || 'Untitled',
              fields.description as string | undefined,
              (fields.priority as string) || 'none',
            );
          case 'timeline-event':
            return execCtx.createTimelineEvent(
              entityFolderId,
              (fields.title as string) || 'Untitled',
              (fields.eventType as string) || 'other',
              fields.timestamp ? new Date(fields.timestamp as string) : new Date(),
              {
                description: fields.description as string | undefined,
                source: (fields.source as string) || 'integration',
                confidence: fields.confidence as string | undefined,
                mitreAttackIds: fields.mitreAttackIds as string[] | undefined,
                linkedIOCIds: fields.linkedIOCIds as string[] | undefined,
              },
            );
          default:
            throw new Error(`Unsupported entity type: ${type}`);
        }
      },

      onUpdateEntity: async (type: string, id: string, fields: Record<string, unknown>): Promise<void> => {
        const table = entityTypeToTable(type);
        await execCtx.updateEntity(table, id, fields);
      },

      onNotify: (message: string): void => {
        // Notify the bot creator
        execCtx.notifyUser(this.config.createdBy, message, folderId).catch((err) => {
          logger.error(`IntegrationBot "${this.name}": notification failed`, { error: String(err) });
        });
      },

      onPostToFeed: async (content: string, postFolderId?: string): Promise<void> => {
        await execCtx.postToFeed(content, postFolderId || folderId);
      },

      onLog: (entry) => {
        execCtx.addLogEntry({
          ts: entry.ts,
          type: entry.type,
          name: entry.stepLabel,
          output: entry.detail,
          durationMs: entry.durationMs,
        });
      },

      fetchFn: async (url: string, opts?: RequestInit): Promise<Response> => {
        return execCtx.fetchExternal(url, opts);
      },
    };
  }

  // ─── Event Handler ──────────────────────────────────────────────

  protected override async handleEvent(execCtx: BotExecutionContext, event: BotEvent): Promise<void> {
    const template = this.getTemplate();
    if (!template) {
      logger.warn(`IntegrationBot "${this.name}": no valid template in config`, { botId: this.id });
      return;
    }

    // Determine which trigger type matches the event
    const triggerType = mapBotEventToTriggerType(event);
    if (!triggerType) return;

    // Check if this template has a matching trigger
    const matchingTrigger = template.triggers.find((t) => t.type === triggerType);
    if (!matchingTrigger) return;

    // For entity triggers, check IOC type filter
    if (matchingTrigger.iocTypes && matchingTrigger.iocTypes.length > 0) {
      if (event.table === 'standaloneIOCs' && event.data) {
        const iocType = event.data.type as string;
        if (!matchingTrigger.iocTypes.includes(iocType)) return;
      }
    }

    // For entity triggers, check entity table filter
    if (matchingTrigger.entityTables && matchingTrigger.entityTables.length > 0) {
      if (event.table && !matchingTrigger.entityTables.includes(event.table)) return;
    }

    const folderId = event.folderId;

    // Build execution input from event data
    const input: ExecutionInput = {};

    if (event.table === 'standaloneIOCs' && event.data) {
      input.ioc = {
        id: event.entityId || nanoid(),
        value: (event.data.value as string) || '',
        type: (event.data.type as string) || 'unknown',
        confidence: (event.data.confidence as string) || 'medium',
      };
    }

    if (folderId) {
      const investigation = await execCtx.getInvestigation(folderId);
      if (investigation) {
        input.investigation = {
          id: folderId,
          name: (investigation.name as string) || 'Unknown',
        };
      }
    }

    const installation = this.buildInstallation();
    const callbacks = this.buildCallbacks(execCtx, folderId);

    const result = await this.executor.run(
      template,
      installation,
      input,
      callbacks,
      this.config.enabled ? undefined : AbortSignal.abort(),
    );

    if (result.status === 'error') {
      logger.error(`IntegrationBot "${this.name}": execution failed`, {
        botId: this.id,
        error: result.error,
        durationMs: result.durationMs,
      });
    } else {
      logger.info(`IntegrationBot "${this.name}": execution completed`, {
        botId: this.id,
        status: result.status,
        durationMs: result.durationMs,
        entitiesCreated: result.entitiesCreated,
        apiCalls: result.apiCallsMade,
      });
    }
  }

  // ─── Schedule Handler ───────────────────────────────────────────

  protected override async handleSchedule(execCtx: BotExecutionContext): Promise<void> {
    const template = this.getTemplate();
    if (!template) {
      logger.warn(`IntegrationBot "${this.name}": no valid template in config`, { botId: this.id });
      return;
    }

    // Check if this template has a scheduled trigger
    const hasScheduledTrigger = template.triggers.some((t) => t.type === 'scheduled');
    if (!hasScheduledTrigger) {
      logger.warn(`IntegrationBot "${this.name}": template has no scheduled trigger`, { botId: this.id });
      return;
    }

    const input: ExecutionInput = {};

    // If the bot is scoped to specific folders, use the first one for context
    const folderId = this.config.scopeFolderIds.length > 0 ? this.config.scopeFolderIds[0] : undefined;

    if (folderId) {
      const investigation = await execCtx.getInvestigation(folderId);
      if (investigation) {
        input.investigation = {
          id: folderId,
          name: (investigation.name as string) || 'Unknown',
        };
      }
    }

    const installation = this.buildInstallation();
    const callbacks = this.buildCallbacks(execCtx, folderId);

    const result = await this.executor.run(
      template,
      installation,
      input,
      callbacks,
    );

    if (result.status === 'error') {
      logger.error(`IntegrationBot "${this.name}": scheduled execution failed`, {
        botId: this.id,
        error: result.error,
        durationMs: result.durationMs,
      });
    }
  }

  // ─── Webhook Handler ───────────────────────────────────────────

  protected override async handleWebhook(execCtx: BotExecutionContext, payload: Record<string, unknown>): Promise<void> {
    const template = this.getTemplate();
    if (!template) {
      logger.warn(`IntegrationBot "${this.name}": no valid template in config`, { botId: this.id });
      return;
    }

    const hasWebhookTrigger = template.triggers.some((t) => t.type === 'webhook');
    if (!hasWebhookTrigger) {
      logger.warn(`IntegrationBot "${this.name}": template has no webhook trigger`, { botId: this.id });
      return;
    }

    const folderId = this.config.scopeFolderIds.length > 0 ? this.config.scopeFolderIds[0] : undefined;

    const input: ExecutionInput = {};
    if (folderId) {
      const investigation = await execCtx.getInvestigation(folderId);
      if (investigation) {
        input.investigation = {
          id: folderId,
          name: (investigation.name as string) || 'Unknown',
        };
      }
    }

    // Make webhook payload available via the installation config merged with webhook data
    const installation = this.buildInstallation();
    installation.config = { ...installation.config, webhook: payload };

    const callbacks = this.buildCallbacks(execCtx, folderId);

    const result = await this.executor.run(
      template,
      installation,
      input,
      callbacks,
    );

    if (result.status === 'error') {
      logger.error(`IntegrationBot "${this.name}": webhook execution failed`, {
        botId: this.id,
        error: result.error,
        durationMs: result.durationMs,
      });
    }
  }
}

// ─── Helpers ──────────────────────────────────────────────────────

function mapBotEventToTriggerType(event: BotEvent): IntegrationTriggerType | null {
  switch (event.type) {
    case 'entity.created':
      return 'on-entity-create';
    case 'entity.updated':
      return 'on-entity-update';
    case 'webhook.received':
      return 'webhook';
    default:
      return null;
  }
}

function entityTypeToTable(type: string): string {
  switch (type) {
    case 'ioc': return 'standaloneIOCs';
    case 'note': return 'notes';
    case 'task': return 'tasks';
    case 'timeline-event': return 'timelineEvents';
    default: return type;
  }
}
