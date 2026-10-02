import { db } from '../db';
import { SYNC_TABLES, suppressSyncInCurrentTransaction } from './sync-state';
import { withEntityDraftBarrier, hasPendingEntityDrafts } from './entity-drafts';
import { nanoid } from 'nanoid';

export const uncachedFolderKey = (id: string) => JSON.stringify(['notCached', id]);
export const cacheOperationKey = (id: string) => JSON.stringify(['cacheOperation', id]);
export const CACHE_REPLAY_CANCELLED = 'Investigation download cancelled because its offline-cache choice changed. Download again if you want to keep a local copy.';

/** Persisted operation identity coordinates different tabs sharing this workspace.
 * Call inside the entity transaction for eviction/recache, before I/O for downloads. */
export async function rotateCacheOperation(folderId: string): Promise<string> {
  const token = nanoid();
  await db.table('_syncMeta').put({ key: cacheOperationKey(folderId), value: token });
  return token;
}

/** Eviction is not a server deletion. Refuse pending local changes rather than
 * quietly discarding them, and persist the cache choice so ordinary pulls do
 * not immediately recreate the evicted investigation. */
export function evictSyncedFolder(folderId: string): Promise<void> {
  return withEntityDraftBarrier(() => db.transaction('rw', [...SYNC_TABLES, '_syncQueue', '_syncMeta'], async () => {
    if (hasPendingEntityDrafts()) throw new Error('Resolve pending drafts before removing an offline copy.');
    if ((await db.folders.get(folderId))?.localOnly
      || (await db.table('_syncMeta').get(JSON.stringify(['localOnly', folderId])))?.value) {
      throw new Error('This investigation is local-only; its local data cannot be removed as a synced cache.');
    }
    const identities = new Set<string>();
    const rows = new Map<string, string[]>();
    for (const table of SYNC_TABLES) {
      if (table === 'tags' || table === 'timelines') continue;
      const records = table === 'folders' ? [await db.folders.get(folderId)].filter(Boolean) : await db.table(table).where('folderId').equals(folderId).toArray();
      const ids = records.map(record => record.id as string);
      rows.set(table, ids);
      for (const id of ids) identities.add(JSON.stringify([table, id]));
    }
    const pending = await db.table('_syncQueue').toArray();
    if (pending.some(row => row.folderId === folderId || row.data?.folderId === folderId || identities.has(JSON.stringify([row.table, row.entityId])))) {
      throw new Error('This investigation has unsynced edits. Sync or resolve them before removing its offline copy.');
    }
    suppressSyncInCurrentTransaction();
    for (const [table, ids] of rows) await db.table(table).bulkDelete(ids);
    await rotateCacheOperation(folderId);
    await db.table('_syncMeta').put({ key: uncachedFolderKey(folderId), value: true });
  }));
}
