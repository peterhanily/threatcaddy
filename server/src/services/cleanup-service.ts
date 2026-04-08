import { eq, lt, and, isNotNull, notInArray } from 'drizzle-orm';
import { db } from '../db/index.js';
import * as schema from '../db/schema.js';
import { serverSettings, notifications, activityLog, investigationMembers, folders, botRuns } from '../db/schema.js';
import { logger } from '../lib/logger.js';

const NOTIF_RETENTION_KEY = 'notification_retention_days';
const AUDIT_RETENTION_KEY = 'audit_log_retention_days';
const TOMBSTONE_RETENTION_KEY = 'tombstone_retention_days';

const DEFAULT_NOTIF_DAYS = 90;
const DEFAULT_AUDIT_DAYS = 365;
const DEFAULT_TOMBSTONE_DAYS = 90;

export async function getRetentionSettings(): Promise<{ notificationRetentionDays: number; auditLogRetentionDays: number; tombstoneRetentionDays: number }> {
  const notifRow = await db.select().from(serverSettings).where(eq(serverSettings.key, NOTIF_RETENTION_KEY)).limit(1);
  const auditRow = await db.select().from(serverSettings).where(eq(serverSettings.key, AUDIT_RETENTION_KEY)).limit(1);
  const tombstoneRow = await db.select().from(serverSettings).where(eq(serverSettings.key, TOMBSTONE_RETENTION_KEY)).limit(1);
  const parsedNotif = notifRow.length > 0 ? parseInt(notifRow[0].value, 10) : NaN;
  const parsedAudit = auditRow.length > 0 ? parseInt(auditRow[0].value, 10) : NaN;
  const parsedTombstone = tombstoneRow.length > 0 ? parseInt(tombstoneRow[0].value, 10) : NaN;
  return {
    notificationRetentionDays: isFinite(parsedNotif) && parsedNotif >= 1 ? parsedNotif : DEFAULT_NOTIF_DAYS,
    auditLogRetentionDays: isFinite(parsedAudit) && parsedAudit >= 1 ? parsedAudit : DEFAULT_AUDIT_DAYS,
    tombstoneRetentionDays: isFinite(parsedTombstone) && parsedTombstone >= 1 ? parsedTombstone : DEFAULT_TOMBSTONE_DAYS,
  };
}

export async function setRetentionSettings(notifDays: number, auditDays: number): Promise<void> {
  for (const [key, value] of [[NOTIF_RETENTION_KEY, String(notifDays)], [AUDIT_RETENTION_KEY, String(auditDays)]] as const) {
    const existing = await db.select().from(serverSettings).where(eq(serverSettings.key, key)).limit(1);
    if (existing.length > 0) {
      await db.update(serverSettings).set({ value, updatedAt: new Date() }).where(eq(serverSettings.key, key));
    } else {
      await db.insert(serverSettings).values({ key, value });
    }
  }
}

// Entity tables that support soft-delete via deletedAt column
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const TOMBSTONE_TABLES: { name: string; table: any }[] = [
  { name: 'notes', table: schema.notes },
  { name: 'tasks', table: schema.tasks },
  { name: 'folders', table: schema.folders },
  { name: 'tags', table: schema.tags },
  { name: 'timelineEvents', table: schema.timelineEvents },
  { name: 'timelines', table: schema.timelines },
  { name: 'whiteboards', table: schema.whiteboards },
  { name: 'standaloneIOCs', table: schema.standaloneIOCs },
  { name: 'chatThreads', table: schema.chatThreads },
];

export async function pruneOldData(): Promise<void> {
  try {
    const settings = await getRetentionSettings();

    const notifCutoff = new Date(Date.now() - settings.notificationRetentionDays * 86400000);
    const deletedNotifs = await db
      .delete(notifications)
      .where(lt(notifications.createdAt, notifCutoff))
      .returning({ id: notifications.id });

    const auditCutoff = new Date(Date.now() - settings.auditLogRetentionDays * 86400000);
    const deletedAudit = await db
      .delete(activityLog)
      .where(lt(activityLog.timestamp, auditCutoff))
      .returning({ id: activityLog.id });

    // Hard-delete tombstones (soft-deleted entities) older than retention period
    const tombstoneCutoff = new Date(Date.now() - settings.tombstoneRetentionDays * 86400000);
    let totalTombstones = 0;
    for (const { name, table } of TOMBSTONE_TABLES) {
      try {
        const deleted = await db
          .delete(table)
          .where(and(isNotNull(table.deletedAt), lt(table.deletedAt, tombstoneCutoff)))
          .returning({ id: table.id });
        if (deleted.length > 0) {
          totalTombstones += deleted.length;
          logger.info(`Tombstone cleanup: hard-deleted ${deleted.length} ${name} record(s)`);
        }
      } catch (err) {
        logger.error(`Tombstone cleanup failed for ${name}`, { error: String(err) });
      }
    }

    // Clean up orphaned investigationMembers (folders that no longer exist)
    let orphanedMembers = 0;
    try {
      const allFolderIds = await db.select({ id: folders.id }).from(folders);
      const validIds = allFolderIds.map(f => f.id);
      if (validIds.length > 0) {
        const deleted = await db.delete(investigationMembers)
          .where(notInArray(investigationMembers.folderId, validIds))
          .returning({ id: investigationMembers.id });
        orphanedMembers = deleted.length;
      } else {
        // No folders exist — all memberships are orphaned
        const deleted = await db.delete(investigationMembers)
          .returning({ id: investigationMembers.id });
        orphanedMembers = deleted.length;
      }
      if (orphanedMembers > 0) {
        logger.info(`Orphan cleanup: removed ${orphanedMembers} orphaned investigation member(s)`);
      }
    } catch (err) {
      logger.error('Orphaned membership cleanup failed', { error: String(err) });
    }

    // Delete bot_runs older than 90 days
    let deletedBotRuns = 0;
    try {
      const botRunsCutoff = new Date(Date.now() - 90 * 86400000);
      const deleted = await db
        .delete(botRuns)
        .where(lt(botRuns.createdAt, botRunsCutoff))
        .returning({ id: botRuns.id });
      deletedBotRuns = deleted.length;
      if (deletedBotRuns > 0) {
        logger.info(`Bot runs cleanup: deleted ${deletedBotRuns} bot run(s) older than 90 days`);
      }
    } catch (err) {
      logger.error('Bot runs cleanup failed', { error: String(err) });
    }

    if (deletedNotifs.length > 0 || deletedAudit.length > 0 || totalTombstones > 0 || orphanedMembers > 0 || deletedBotRuns > 0) {
      logger.info(`Data pruning: deleted ${deletedNotifs.length} notification(s), ${deletedAudit.length} audit log entry(ies), ${totalTombstones} tombstone(s), ${orphanedMembers} orphaned member(s), ${deletedBotRuns} bot run(s)`);
    }
  } catch (err) {
    logger.error('Data pruning failed', { error: String(err) });
  }
}
