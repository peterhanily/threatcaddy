import type { EntityTable } from 'dexie';
import { deleteEntitiesWithReferences, ENTITY_RELATIONS } from './entity-relations';
import { PendingChangesError } from './pending-changes';
import { db } from '../db';
import { deferTrashPurge, hasPulledThisSession, revisionKey } from './sync-state';
import { readStoredAuth } from './auth-storage';

const TRASH_PURGE_DAYS = 30;
/** How much longer trash the team server holds may wait for a pull (a retired or unreachable server). */
const PULL_GRACE_DAYS = 7;

interface Trashable {
  id: string;
  trashed: boolean;
  trashedAt?: number;
}

/**
 * Auto-purge items that have been in trash longer than TRASH_PURGE_DAYS.
 * Returns the remaining items after purging.
 */
export async function purgeOldTrash<T extends Trashable>(
  items: T[],
  table: EntityTable<T, 'id'>,
): Promise<T[]> {
  const purgeThreshold = Date.now() - TRASH_PURGE_DAYS * 86400000;
  let toPurge = items.filter((item) => item.trashed && item.trashedAt && item.trashedAt < purgeThreshold);
  const graceThreshold = purgeThreshold - PULL_GRACE_DAYS * 86400000;
  if (toPurge.some(item => (item.trashedAt ?? 0) >= graceThreshold) && !hasPulledThisSession() && readStoredAuth()) {
    // Signed in to a team server: rows it holds wait for this session's first pull, since another device
    // may already have purged them and deleting them again from a stale revision only makes conflicts
    // (DATA-2). Signed out, they are purged as before (the server accepts the same purge again).
    // Up to PULL_GRACE_DAYS: a device that never pulls (server retired or unreachable, sync paused)
    // still purges, and the server accepts a purge another device already made.
    const recent = toPurge.filter(item => (item.trashedAt ?? 0) >= graceThreshold);
    const revisions = await db.table('_syncMeta').bulkGet(recent.map(item => revisionKey(table.name, item.id)));
    const synced = new Set(recent.filter((_, index) => revisions[index]?.value).map(item => item.id));
    // A pull that finished while this was read reloads nothing more: purge now instead.
    if (synced.size && !hasPulledThisSession()) {
      deferTrashPurge(table.name);
      toPurge = toPurge.filter(item => !synced.has(item.id));
    }
  }
  if (toPurge.length > 0) {
    if (!ENTITY_RELATIONS[table.name]) throw new Error('No safe purge lifecycle registered for ' + table.name);
    try {
      await deleteEntitiesWithReferences({ [table.name]: toPurge.map(item => item.id) }, undefined, purgeThreshold);
    } catch (error) {
      // Background maintenance must not hide already-loaded records merely
      // because unsent work needs attention. A later load can retry the purge.
      // Check the queued operation's refusal, not a racy preflight snapshot.
      if (error instanceof PendingChangesError) return items;
      throw error;
    }
  }
  if (!toPurge.length) return items;
  // A record restored or edited while its queued purge waited must not vanish from the view.
  const retained = new Map((await table.where('id').anyOf(toPurge.map(item => item.id)).toArray()).map(item => [item.id, item]));
  const candidates = new Set(toPurge.map(item => item.id));
  return items.flatMap(item => candidates.has(item.id) ? retained.get(item.id) ?? [] : item);
}
