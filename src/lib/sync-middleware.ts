import { db } from '../db';
import { markFolderLocalOnly } from './sync-state';
export { enableSync, disableSync, markFolderLocalOnly } from './sync-state';

export async function initLocalOnlyFlags() {
  for (const folder of await db.folders.toArray()) {
    markFolderLocalOnly(folder.id, folder.localOnly === true);
  }
}

/** Capture is installed before db opens by installSyncOutbox. */
export function installSyncHooks() { /* compatibility for older callers */ }
