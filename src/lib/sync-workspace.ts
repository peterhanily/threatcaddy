import { db } from '../db';
import { normalizeSyncWorkspaceIdentity, SYNC_WORKSPACE_KEY, isOnlyLocalPrivacyMetadata, ensureSyncCaptureCoverage } from './sync-capture-policy';
export { normalizeSyncWorkspaceIdentity, SYNC_WORKSPACE_KEY, type SyncWorkspaceIdentity } from './sync-capture-policy';

const RECONCILE = 'Your local data and queued edits are preserved. Export a local backup and reconnect the original server/account, or select its workspace in Settings → General. Use Sync history recovery there for unverified legacy history, after coordinating with your administrator.';

/** A workspace has one durable sync destination. Unknown legacy history is not
 * evidence of ownership, so only an empty queue and metadata store may bind.
 * The transaction also serializes competing first connections from other tabs. */
export async function ensureSyncWorkspace(serverUrl: string, userId: string, assertCurrent: () => void = () => {}): Promise<void> {
  const identity = normalizeSyncWorkspaceIdentity(serverUrl, userId);
  await db.transaction('rw', '_syncQueue', '_syncMeta', '_localMigrations', async () => {
    assertCurrent();
    const meta = db.table('_syncMeta');
    const binding = await meta.get(SYNC_WORKSPACE_KEY);
    if (binding) {
      const saved: unknown = binding.value;
      if (saved && typeof saved === 'object' && !Array.isArray(saved)) {
        const value = saved as Partial<typeof identity>;
        if (value.version === 1 && value.serverUrl === identity.serverUrl && value.userId === identity.userId) return;
      }
      throw new Error(`Sync paused: this workspace is bound to a different server/account, or its binding is invalid. ${RECONCILE}`);
    }
    // Folder privacy is recorded even before sync has ever been enabled. It is
    // local policy, not evidence of a past destination. Every other metadata
    // entry (even a zero cursor/false initial flag) still requires recovery.
    const hasHistory = (await meta.toArray()).some(entry => !isOnlyLocalPrivacyMetadata(entry));
    if (hasHistory || await db.table('_syncQueue').count()) {
      throw new Error(`Sync paused: existing sync history has no verified server/account binding and cannot be adopted automatically. ${RECONCILE}`);
    }
    // Establish coverage before the first binding, in the same transaction.
    // Existing bound workspaces are initialized by startup/engine, never adopted here.
    await ensureSyncCaptureCoverage(db);
    assertCurrent();
    await meta.add({ key: SYNC_WORKSPACE_KEY, value: identity });
    assertCurrent();
  });
}
