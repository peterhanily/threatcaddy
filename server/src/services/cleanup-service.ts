import { eq, lt, and, isNotNull, notInArray, sql } from 'drizzle-orm';
import { db } from '../db/index.js';
import * as schema from '../db/schema.js';
import { serverSettings, notifications, activityLog, investigationMembers, folders, botRuns } from '../db/schema.js';
import { logger } from '../lib/logger.js';
import { describeError } from '../lib/db-errors.js';
import { purgeExpiredInvestigation } from './investigation-lifecycle.js';
import { lockInvestigationPolicy } from './investigation-policy.js';
import { removeCommittedBlobs } from './storage-policy.js';
import { revokeFolderAccess } from '../ws/handler.js';

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

const SYNC_HISTORY_RETENTION_KEY = 'sync_history_retention_days';
const DEFAULT_SYNC_HISTORY_DAYS = 90;

/** Days an earlier revision of a record stays in the sync change log; 0 keeps every revision. */
export async function getSyncHistoryRetentionDays(): Promise<number> {
  const [row] = await db.select().from(serverSettings).where(eq(serverSettings.key, SYNC_HISTORY_RETENTION_KEY)).limit(1);
  const parsed = row ? parseInt(row.value, 10) : NaN;
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : DEFAULT_SYNC_HISTORY_DAYS;
}

/** Removes revisions the sync change log no longer needs: rows older than `days` for which a later
 *  row exists for the same record in the same investigation. Every change wrote a full copy of its
 *  record, so the log otherwise grows with every save.
 *
 *  What a pull needs is kept. A pull reduces the log to the newest row per record, so a client with
 *  any cursor ends in the same state without the earlier rows. Never removed: the newest row of a
 *  record (its current state, its tombstone or its final copy; it also carries the version a
 *  re-created id continues from), a row that records a move (`previous_folder_id`: members of the
 *  investigation it left learn of the removal from it), and the last row a record had in each
 *  investigation it has been in. */
export async function compactSyncHistory(days: number, batchSize = 5000, maxBatches = 200): Promise<number> {
  if (!(days > 0)) return 0;
  const cutoff = new Date(Date.now() - days * 86400000).toISOString();
  let removed = 0;
  for (let batch = 0; batch < maxBatches; batch++) {
    const deleted = await db.execute<{ cursor: string }>(sql`
      DELETE FROM sync_changes WHERE cursor IN (
        SELECT earlier.cursor FROM sync_changes earlier
        WHERE earlier.created_at < ${cutoff}::timestamptz AND earlier.previous_folder_id IS NULL
          AND EXISTS (
            SELECT 1 FROM sync_changes later
            WHERE later.table_name = earlier.table_name AND later.entity_id = earlier.entity_id
              AND later.cursor > earlier.cursor AND later.folder_id IS NOT DISTINCT FROM earlier.folder_id)
        ORDER BY earlier.cursor LIMIT ${batchSize})
      RETURNING cursor::text AS cursor`);
    removed += deleted.length;
    if (deleted.length < batchSize) break;
  }
  return removed;
}

// Entity tables that support soft-delete via deletedAt column
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const TOMBSTONE_TABLES: { name: string; table: any }[] = [
  { name: 'notes', table: schema.notes },
  { name: 'tasks', table: schema.tasks },
  { name: 'tags', table: schema.tags },
  { name: 'timelineEvents', table: schema.timelineEvents },
  { name: 'timelines', table: schema.timelines },
  { name: 'whiteboards', table: schema.whiteboards },
  { name: 'standaloneIOCs', table: schema.standaloneIOCs },
  { name: 'chatThreads', table: schema.chatThreads },
  { name: 'evidenceItems', table: schema.evidenceItems },
  { name: 'identities', table: schema.identities },
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
    // A retained deleted folder owns live children and file references. Purging
    // just its row would orphan those records and leave managed blobs forever.
    const expiredFolders = await db.select({ id: folders.id }).from(folders).where(lt(folders.deletedAt, tombstoneCutoff));
    for (const folder of expiredFolders) {
      try {
        const purged = await purgeExpiredInvestigation(folder.id, tombstoneCutoff);
        if (!purged) continue;
        totalTombstones += 1 + Object.values(purged.deleted).reduce((sum, count) => sum + count, 0);
        revokeFolderAccess(folder.id);
        await removeCommittedBlobs(process.env.FILE_STORAGE_PATH || '/data/files', purged.folderFiles);
      } catch (err) { logger.error('Investigation retention purge failed', { folderId: folder.id, error: describeError(err) }); }
    }
    for (const { name, table } of TOMBSTONE_TABLES) {
      try {
        const deleted = await db.transaction(async tx => {
          // DELETE triggers append sync history. Take their shared writer lock
          // before row locks, just as normal synchronization/lifecycle writes do.
          await lockInvestigationPolicy(tx);
          return tx.delete(table)
            .where(and(isNotNull(table.deletedAt), lt(table.deletedAt, tombstoneCutoff)))
            .returning({ id: table.id });
        });
        if (deleted.length > 0) {
          totalTombstones += deleted.length;
          logger.info(`Tombstone cleanup: hard-deleted ${deleted.length} ${name} record(s)`);
        }
      } catch (err) {
        logger.error(`Tombstone cleanup failed for ${name}`, { error: describeError(err) });
      }
    }

    // Clean up orphaned investigationMembers (folders that no longer exist)
    let orphanedMembers = 0;
    try {
      orphanedMembers = await db.transaction(async tx => {
        await lockInvestigationPolicy(tx);
        const allFolderIds = await tx.select({ id: folders.id }).from(folders);
        const validIds = allFolderIds.map(f => f.id);
        const deleted = await tx.delete(investigationMembers)
          .where(validIds.length ? notInArray(investigationMembers.folderId, validIds) : undefined)
          .returning({ id: investigationMembers.id });
        return deleted.length;
      });
      if (orphanedMembers > 0) {
        logger.info(`Orphan cleanup: removed ${orphanedMembers} orphaned investigation member(s)`);
      }
    } catch (err) {
      logger.error('Orphaned membership cleanup failed', { error: describeError(err) });
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
      logger.error('Bot runs cleanup failed', { error: describeError(err) });
    }

    try {
      const compacted = await compactSyncHistory(await getSyncHistoryRetentionDays());
      if (compacted > 0) logger.info(`Sync history: removed ${compacted} superseded revision(s)`);
    } catch (err) {
      logger.error('Sync history compaction failed', { error: describeError(err) });
    }

    if (deletedNotifs.length > 0 || deletedAudit.length > 0 || totalTombstones > 0 || orphanedMembers > 0 || deletedBotRuns > 0) {
      logger.info(`Data pruning: deleted ${deletedNotifs.length} notification(s), ${deletedAudit.length} audit log entry(ies), ${totalTombstones} tombstone(s), ${orphanedMembers} orphaned member(s), ${deletedBotRuns} bot run(s)`);
    }
  } catch (err) {
    logger.error('Data pruning failed', { error: describeError(err) });
  }
}
