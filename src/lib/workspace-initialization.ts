import { db, runWorkspaceContentMigrations } from '../db';
import { migrateIndexedDB } from './db-migration';
import { ensureEncryptionReady, getSessionKey } from './encryptionMiddleware';
import { isEncryptionEnabled } from './encryptionStore';

let initialized = false;
export function isWorkspaceInitialized(): boolean { return initialized; }

/** Nothing consumes persisted content until a key is available and upgrades finish. */
export async function initializeWorkspace(): Promise<void> {
  initialized = false;
  if (isEncryptionEnabled() && !getSessionKey()) throw new Error('Unlock the workspace before preparing stored data.');
  const sourceKey = getSessionKey();
  await db.open();
  await ensureEncryptionReady(db);
  await migrateIndexedDB({ sourceKey });
  await runWorkspaceContentMigrations();
  initialized = true;
}
