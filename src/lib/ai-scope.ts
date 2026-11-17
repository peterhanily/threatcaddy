import { db } from '../db';
import type { Folder } from '../types';

/** Same facts as evictSyncedFolder (sync-cache.ts) and the outbox (sync-outbox.ts):
 * the folder flag, or the persisted privacy marker that survives a missing flag.
 * Not the notCached marker, which marks evicted synced folders, not privacy. */
export async function isFolderLocalOnly(folderOrId: Folder | string): Promise<boolean> {
  const id = typeof folderOrId === 'string' ? folderOrId : folderOrId.id;
  const folder = typeof folderOrId === 'string' ? await db.folders.get(id) : folderOrId;
  if (folder?.localOnly) return true;
  return (await db.table('_syncMeta').get(JSON.stringify(['localOnly', id])))?.value === true;
}

/** Shareable means "not local-only", whether or not a team server is bound:
 * a later bind pushes every folder that is not local-only. */
export async function isShareableFolder(id: string | undefined): Promise<boolean> {
  if (!id) return false;
  const folder = await db.folders.get(id);
  return !!folder && !await isFolderLocalOnly(folder);
}
