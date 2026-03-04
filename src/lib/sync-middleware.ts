import { db } from '../db';
import { syncEngine } from './sync-engine';

// Tables that should be synced to server
const SYNCED_TABLES = [
  'notes', 'tasks', 'folders', 'tags',
  'timelineEvents', 'timelines', 'whiteboards',
  'standaloneIOCs', 'chatThreads',
];

let syncEnabled = false;

export function enableSync() {
  syncEnabled = true;
}

export function disableSync() {
  syncEnabled = false;
}

/**
 * Install Dexie table hooks on all synced tables so that every local
 * add / update / delete is automatically captured in the sync queue.
 *
 * Hooks fire synchronously inside the Dexie transaction, before the
 * DBCore encryption middleware, so the data is unencrypted (what the
 * server expects).  We defer the actual _syncQueue write via
 * setTimeout so it runs in its own transaction after the original
 * write commits.
 */
export function installSyncHooks() {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const dexie = db as any;

  for (const tableName of SYNCED_TABLES) {
    const table = dexie[tableName];
    if (!table?.hook) continue;

    // Creating — fires with (primKey, obj, transaction)
    table.hook('creating', function (_primKey: string, obj: Record<string, unknown>) {
      if (!syncEnabled) return;
      const entityId = (obj.id as string) || _primKey;
      const data = { ...obj };
      setTimeout(() => {
        syncEngine.enqueue(tableName, entityId, 'put', data).catch(() => {});
      }, 0);
    });

    // Updating — fires with (modifications, primKey, obj, transaction)
    // obj = original record, modifications = changed fields
    table.hook('updating', function (
      modifications: Record<string, unknown>,
      primKey: string,
      obj: Record<string, unknown>,
    ) {
      if (!syncEnabled) return;
      const merged = { ...obj, ...modifications };
      setTimeout(() => {
        syncEngine.enqueue(tableName, primKey, 'put', merged).catch(() => {});
      }, 0);
    });

    // Deleting — fires with (primKey, obj, transaction)
    table.hook('deleting', function (primKey: string) {
      if (!syncEnabled) return;
      setTimeout(() => {
        syncEngine.enqueue(tableName, primKey, 'delete').catch(() => {});
      }, 0);
    });
  }
}
