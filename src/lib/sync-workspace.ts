import { db } from '../db';

export const SYNC_WORKSPACE_KEY = 'syncWorkspaceIdentityV1';

export interface SyncWorkspaceIdentity {
  version: 1;
  serverUrl: string;
  userId: string;
}

const RECONCILE = 'Your local data and queued edits are preserved. Export a local backup and reconnect the original server/account, or select its workspace in Settings → General. Use Sync history recovery there for unverified legacy history, after coordinating with your administrator.';

/** Canonicalize equivalent endpoint spellings, without conflating path mounts,
 * protocols, non-default ports, or different accounts. Never persist credentials. */
export function normalizeSyncWorkspaceIdentity(serverUrl: string, userId: string): SyncWorkspaceIdentity {
  let endpoint: URL;
  try { endpoint = new URL(serverUrl.trim()); }
  catch { throw new Error('Sync requires a valid HTTP(S) server URL and account identity.'); }
  if (!['http:', 'https:'].includes(endpoint.protocol) || endpoint.username || endpoint.password
    || endpoint.search || endpoint.hash || typeof userId !== 'string' || !userId.trim()) {
    throw new Error('Sync requires an HTTP(S) server URL without credentials, query, or fragment, and a nonempty account identity.');
  }
  return { version: 1, serverUrl: endpoint.origin + endpoint.pathname.replace(/\/+$/, ''), userId };
}

/** A workspace has one durable sync destination. Unknown legacy history is not
 * evidence of ownership, so only an empty queue and metadata store may bind.
 * The transaction also serializes competing first connections from other tabs. */
export async function ensureSyncWorkspace(serverUrl: string, userId: string): Promise<void> {
  const identity = normalizeSyncWorkspaceIdentity(serverUrl, userId);
  await db.transaction('rw', '_syncQueue', '_syncMeta', async () => {
    const meta = db.table('_syncMeta');
    const binding = await meta.get(SYNC_WORKSPACE_KEY);
    if (binding) {
      const saved: unknown = binding.value;
      if (saved && typeof saved === 'object' && !Array.isArray(saved)) {
        const value = saved as Partial<SyncWorkspaceIdentity>;
        if (value.version === 1 && value.serverUrl === identity.serverUrl && value.userId === identity.userId) return;
      }
      throw new Error(`Sync paused: this workspace is bound to a different server/account, or its binding is invalid. ${RECONCILE}`);
    }
    // Folder privacy is recorded even before sync has ever been enabled. It is
    // local policy, not evidence of a past destination. Every other metadata
    // entry (even a zero cursor/false initial flag) still requires recovery.
    const hasHistory = (await meta.toArray()).some(entry => {
      try {
        const key: unknown = JSON.parse(entry.key);
        return !(Array.isArray(key) && key.length === 2 && key[0] === 'localOnly'
          && typeof key[1] === 'string' && key[1].length > 0 && typeof entry.value === 'boolean');
      } catch { return true; }
    });
    if (hasHistory || await db.table('_syncQueue').count()) {
      throw new Error(`Sync paused: existing sync history has no verified server/account binding and cannot be adopted automatically. ${RECONCILE}`);
    }
    await meta.add({ key: SYNC_WORKSPACE_KEY, value: identity });
  });
}
