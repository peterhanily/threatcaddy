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

    const lines: string[] = [`**Investigation Summary** (${new Date().toISOString()})`, ''];

    for (const inv of investigations) {
      const folderId = inv.id as string;
      const folderName = (inv.name as string) || 'Unnamed';

      let iocCount = 0;
      let taskCount = 0;

      try {
        const iocs = await execCtx.listIOCs(folderId, undefined, 500);
        iocCount = iocs.length;
      } catch {
        // Bot may lack scope for some folders
      }

      try {
        const tasks = await execCtx.listTasks(folderId, undefined, 500);
        taskCount = tasks.length;
      } catch {
        // Bot may lack scope for some folders
      }

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
