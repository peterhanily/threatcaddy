import { and, eq, inArray, isNull, lt, sql } from 'drizzle-orm';
import { db } from '../db/index.js';
import * as schema from '../db/schema.js';
import { assertInvestigationOwner, InvestigationPolicyError, lockInvestigationPolicy } from './investigation-policy.js';
import { lockStorage } from './storage-policy.js';

export type InvestigationTransaction = Parameters<Parameters<typeof db.transaction>[0]>[0];
export const INVESTIGATION_CONTENT_TABLES = [
  ['notes', schema.notes], ['tasks', schema.tasks], ['timelineEvents', schema.timelineEvents],
  ['whiteboards', schema.whiteboards], ['standaloneIOCs', schema.standaloneIOCs],
  ['chatThreads', schema.chatThreads], ['evidenceItems', schema.evidenceItems],
] as const;

/** A folder tombstone hides, but does not delete, its retained children/files.
 * Publish small child removals so existing cursors discard cached content. On
 * restore, republish only live children; independently deleted rows stay deleted.
 * The caller already owns the sync clock and has authorized the owner transition. */
export async function publishInvestigationVisibility(tx: InvestigationTransaction, folderId: string, deleted: boolean): Promise<void> {
  for (const [name, table] of INVESTIGATION_CONTENT_TABLES) {
    if (!deleted) {
      await tx.update(table).set({ updatedAt: new Date() }).where(and(eq(table.folderId, folderId), isNull(table.deletedAt)));
      continue;
    }
    // No inline image, chat or note body is copied for a visibility tombstone.
    // Allocate cursors under the same writer lock as normal database triggers.
    const rows = await tx.select({ id: table.id, version: table.version }).from(table).where(eq(table.folderId, folderId));
    if (!rows.length) continue;
    const [clock] = await tx.update(schema.syncClock).set({ cursor: sql`${schema.syncClock.cursor} + ${rows.length}` })
      .where(eq(schema.syncClock.id, 1)).returning({ cursor: schema.syncClock.cursor });
    if (!clock) throw new Error('Sync clock is missing');
    const start = clock.cursor - BigInt(rows.length);
    for (let offset = 0; offset < rows.length; offset += 200) {
      await tx.insert(schema.syncChanges).values(rows.slice(offset, offset + 200).map((row, index) => ({
        cursor: start + BigInt(offset + index + 1), tableName: name, entityId: row.id,
        folderId, op: 'delete' as const, record: { id: row.id, version: row.version },
      })));
    }
  }
}

type PurgeActor = { kind: 'user' | 'admin'; userId: string };
export interface PurgeInvestigationOptions { actor: PurgeActor; folderId: string; confirmName?: string }

/** Physical purge is deliberately distinct from reversible sync soft-delete.
 * Filesystem removal/revocation/audit happen only after this promise commits. */
export async function purgeInvestigation(options: PurgeInvestigationOptions) {
  return db.transaction(async tx => {
    await lockInvestigationPolicy(tx);
    await lockStorage(tx);
    const { actor, folderId } = options;
    let folder: typeof schema.folders.$inferSelect;
    if (actor.kind === 'user') folder = await assertInvestigationOwner(tx, actor.userId, folderId, { includeDeleted: true });
    else {
      const [admin] = await tx.select().from(schema.adminUsers).where(eq(schema.adminUsers.id, actor.userId)).for('share');
      if (!admin?.active) throw new InvestigationPolicyError('Administrator is no longer active', 403, 'INSUFFICIENT_PERMISSIONS');
      const [record] = await tx.select().from(schema.folders).where(eq(schema.folders.id, folderId)).for('update');
      if (!record) throw new InvestigationPolicyError('Investigation not found', 404, 'INVESTIGATION_NOT_FOUND');
      folder = record;
      if (options.confirmName !== folder.name) throw new InvestigationPolicyError('Confirmation name does not match', 400, 'VALIDATION_FAILED');
    }
    return purgeRows(tx, folder);
  });
}

/** Retention must recheck the tombstone under the writer lock; a restored folder
 * cannot be purged using a stale candidate selected before the transaction. */
export async function purgeExpiredInvestigation(folderId: string, cutoff: Date) {
  return db.transaction(async tx => {
    await lockInvestigationPolicy(tx);
    await lockStorage(tx);
    const [folder] = await tx.select().from(schema.folders)
      .where(and(eq(schema.folders.id, folderId), lt(schema.folders.deletedAt, cutoff))).for('update');
    return folder ? purgeRows(tx, folder) : null;
  });
}

async function purgeRows(tx: InvestigationTransaction, folder: typeof schema.folders.$inferSelect) {
  const folderId = folder.id;
  // Older replies could omit folderId. Follow only same-scope/unscoped edges;
  // a foreign investigation's content is never included in this purge.
  const postRows = await tx.execute<{ id: string }>(sql`
    WITH RECURSIVE owned_posts AS (
      SELECT id FROM posts WHERE folder_id = ${folderId}
      UNION
      SELECT child.id FROM posts child JOIN owned_posts parent
        ON child.parent_id = parent.id OR child.reply_to_id = parent.id
        WHERE child.folder_id = ${folderId} OR child.folder_id IS NULL OR child.folder_id = ''
    ) SELECT id FROM owned_posts LIMIT 10001`);
  if (postRows.length > 10000) throw new InvestigationPolicyError('Investigation reply tree exceeds the safe purge limit; no data was changed. Ask an administrator to review it.', 409, 'PURGE_SCOPE_LIMIT');
  const postIds = postRows.map(row => row.id);
  const folderFiles = await tx.select({ storagePath: schema.files.storagePath, thumbnailPath: schema.files.thumbnailPath })
    .from(schema.files).where(eq(schema.files.folderId, folderId));
  const deleted: Record<string, number> = {};
  for (const [name, table] of INVESTIGATION_CONTENT_TABLES) {
    deleted[name] = (await tx.delete(table).where(eq(table.folderId, folderId)).returning({ id: table.id })).length;
  }
  deleted.posts = 0;
  if (postIds.length) {
    deleted.posts = (await tx.delete(schema.posts).where(inArray(schema.posts.id, postIds)).returning({ id: schema.posts.id })).length;
    await tx.update(schema.posts).set({ parentId: null, updatedAt: new Date() }).where(inArray(schema.posts.parentId, postIds));
    await tx.update(schema.posts).set({ replyToId: null, updatedAt: new Date() }).where(inArray(schema.posts.replyToId, postIds));
  }
  for (const [name, table] of [ ['files', schema.files], ['notifications', schema.notifications], ['members', schema.investigationMembers] ] as const) {
    deleted[name] = (await tx.delete(table).where(eq(table.folderId, folderId)).returning({ id: table.id })).length;
  }
  await tx.delete(schema.agentActions).where(eq(schema.agentActions.investigationId, folderId));
  await tx.delete(schema.agentHeartbeats).where(eq(schema.agentHeartbeats.folderId, folderId));
  await tx.delete(schema.folders).where(eq(schema.folders.id, folderId));
  return { folder, deleted, folderFiles };
}
