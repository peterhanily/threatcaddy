import { db } from '../db';
import { SYNC_TABLES, suppressSyncInCurrentTransaction } from './sync-state';
import { withEntityDraftBarrier } from './entity-drafts';
import { hasPendingChanges, PendingChangesError } from './pending-changes';
import { nanoid } from 'nanoid';
import { assertSyncCaptureReady, ensureSyncCaptureCoverage } from './sync-capture-policy';
import { queuedPuts, syncItemLabels, type SyncQueueEntry } from './sync-outgoing';
import i18n from '../i18n';

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
export async function evictSyncedFolder(folderId: string): Promise<void> {
  await ensureSyncCaptureCoverage(db);
  return withEntityDraftBarrier(() => db.transaction('rw', [...SYNC_TABLES, 'agentDeployments', '_syncQueue', '_syncMeta', '_localMigrations'], async () => {
    await assertSyncCaptureReady(db);
    if (hasPendingChanges()) throw new PendingChangesError('Resolve pending work before removing an offline copy.');
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
    const inFolder = (row: SyncQueueEntry) => row.folderId === folderId || row.data?.folderId === folderId || identities.has(JSON.stringify([row.table, row.entityId]));
    // Push never sends a held put, so syncing cannot clear it: its changes exist only on this device.
    const { held } = await queuedPuts(inFolder);
    if (held.length) throw new Error(i18n.t('syncStatus.heldBlocksLocalCopyRemoval', { ns: 'common', count: held.length, items: await syncItemLabels(held) }));
    const pending = await db.table('_syncQueue').toArray();
    if (pending.some(inFolder)) {
      throw new Error('This investigation has unsynced edits. Sync or resolve them before removing its offline copy.');
    }
    suppressSyncInCurrentTransaction();
    for (const [table, ids] of rows) await db.table(table).bulkDelete(ids);
    await rotateCacheOperation(folderId);
    await db.table('_syncMeta').put({ key: uncachedFolderKey(folderId), value: true });
    if (hasPendingChanges()) throw new PendingChangesError('Resolve pending work before removing an offline copy.');
  }));
}
