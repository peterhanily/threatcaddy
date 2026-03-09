import { logger } from '../../lib/logger.js';
import type { BotExecutionContext } from '../bot-context.js';
import { GenericBot } from './generic-bot.js';

/**
 * MonitorBot: reference implementation that posts periodic investigation summaries.
 *
 * On a schedule, it lists all investigations in scope, counts IOCs and tasks
 * for each, and posts (or notes) a summary.
 */
export class MonitorBot extends GenericBot {
  protected override async handleSchedule(execCtx: BotExecutionContext): Promise<void> {
    const investigations = await execCtx.listInvestigations();

    if (investigations.length === 0) {
      logger.info(`MonitorBot "${this.name}": no investigations in scope`, { botId: this.id });
      return;
    }

    const folderIds = investigations.map((inv) => inv.id as string);

    // Batch-fetch IOCs and tasks for all investigations in just 2 queries
    let iocsByFolder = new Map<string, Record<string, unknown>[]>();
    let tasksByFolder = new Map<string, Record<string, unknown>[]>();
    try {
      [iocsByFolder, tasksByFolder] = await Promise.all([
        execCtx.listIOCsBatch(folderIds),
        execCtx.listTasksBatch(folderIds),
      ]);
    } catch {
      // Bot may lack scope — fall back to empty maps
    }

    const lines: string[] = [`**Investigation Summary** (${new Date().toISOString()})`, ''];

    for (const inv of investigations) {
      const folderId = inv.id as string;
      const folderName = (inv.name as string) || 'Unnamed';

      const iocCount = (iocsByFolder.get(folderId) ?? []).length;
      const taskCount = (tasksByFolder.get(folderId) ?? []).length;

      lines.push(`- **${folderName}**: ${iocCount} IOC(s), ${taskCount} task(s)`);
    }

    const summary = lines.join('\n');
    const canPost = this.config.capabilities.includes('post_to_feed');

    if (canPost) {
      await execCtx.postToFeed(summary);
    } else if (investigations.length > 0) {
      // Fall back to creating a note in the first investigation
      const firstFolderId = investigations[0].id as string;
      await execCtx.createNote(
        firstFolderId,
        `Monitor Summary - ${new Date().toISOString()}`,
        summary,
        ['bot-monitor'],
      );
    }
  }
}
