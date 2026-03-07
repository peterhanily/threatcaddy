import { logger } from '../../lib/logger.js';
import type { BotExecutionContext } from '../bot-context.js';
import type { BotEvent } from '../types.js';
import { GenericBot } from './generic-bot.js';

/**
 * EnrichmentBot: reference implementation that enriches newly created IOCs.
 *
 * When an IOC is created in standaloneIOCs, it queries an external enrichment
 * API (if configured) and creates a note with the results.
 */
export class EnrichmentBot extends GenericBot {
  protected override async handleEvent(execCtx: BotExecutionContext, event: BotEvent): Promise<void> {
    // Only handle entity.created events for standaloneIOCs
    if (event.type !== 'entity.created' || event.table !== 'standaloneIOCs') {
      return;
    }

    const folderId = event.folderId;
    if (!folderId) {
      logger.warn(`EnrichmentBot "${this.name}": event missing folderId`, { botId: this.id });
      return;
    }

    // Use the IOC data directly from the event instead of querying the DB
    // (event.data contains the full entity record from sync-service)
    if (!event.data || !event.entityId) {
      logger.warn(`EnrichmentBot "${this.name}": event missing data or entityId`, { botId: this.id, folderId });
      return;
    }

    const iocValue = (event.data.value as string) || 'unknown';
    const iocType = (event.data.type as string) || 'unknown';

    const botConfig = execCtx.getConfig();
    const enrichmentUrl = botConfig.enrichmentUrl as string | undefined;
    const enrichmentApiKey = botConfig.enrichmentApiKey as string | undefined;

    if (enrichmentUrl && enrichmentApiKey) {
      try {
        const url = `${enrichmentUrl}?value=${encodeURIComponent(iocValue)}&type=${encodeURIComponent(iocType)}`;
        const response = await execCtx.fetchExternal(url, {
          headers: {
            'Authorization': `Bearer ${enrichmentApiKey}`,
            'Accept': 'application/json',
          },
        });

        if (response.ok) {
          const data = await response.json() as Record<string, unknown>;
          const summary = JSON.stringify(data, null, 2);
          await execCtx.createNote(
            folderId,
            `Enrichment: ${iocType} - ${iocValue}`,
            `## Enrichment Results\n\n**IOC:** ${iocValue} (${iocType})\n\n\`\`\`json\n${summary}\n\`\`\``,
            ['bot-enrichment'],
          );
        } else {
          await execCtx.createNote(
            folderId,
            `Enrichment Failed: ${iocType} - ${iocValue}`,
            `Enrichment API returned status ${response.status} for ${iocValue} (${iocType}).`,
            ['bot-enrichment', 'error'],
          );
        }
      } catch (err) {
        logger.error(`EnrichmentBot "${this.name}": enrichment API call failed`, { botId: this.id, error: String(err) });
        await execCtx.createNote(
          folderId,
          `Enrichment Error: ${iocType} - ${iocValue}`,
          `Failed to query enrichment API: ${String(err)}`,
          ['bot-enrichment', 'error'],
        );
      }
    } else {
      await execCtx.createNote(
        folderId,
        `Enrichment: ${iocType} - ${iocValue}`,
        `Enrichment not configured. Set \`enrichmentUrl\` and \`enrichmentApiKey\` in the bot config to enable automatic enrichment.`,
        ['bot-enrichment'],
      );
    }
  }
}
