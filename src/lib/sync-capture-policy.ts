import type Dexie from 'dexie';

export const SYNC_WORKSPACE_KEY = 'syncWorkspaceIdentityV1';
export const SYNC_CAPTURE_KEY = 'sync-capture-v1';
export const SYNC_RECOVERY_KEY = 'syncRecoveryRequiredV2';
export const SYNC_CAPTURE_MESSAGE = 'Sync paused: older sync history may be missing edits made while signed out. Your local data is retained. Use Settings → General → Sync history recovery to download a verified archive and reconcile before resuming.';
export const SYNC_HISTORY_MESSAGE = 'Sync paused because the server history changed or recovery was requested. Your local edits are retained. Use Settings → General → Sync history recovery to download a verified archive and review conflicts before resuming.';

export interface SyncWorkspaceIdentity { version: 1; serverUrl: string; userId: string }
export interface SyncCaptureCoverage {
  key: typeof SYNC_CAPTURE_KEY;
  version: 1;
  state: 'ready' | 'reconciliation-required';
  reason?: 'legacy-capture-gap' | 'restored-history';
}

/** Keep destination validation independent of the singleton DB: the outbox uses
 * it while constructing that DB and must never infer ownership from login state. */
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

export function isSyncWorkspaceIdentity(value: unknown): value is SyncWorkspaceIdentity {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const row = value as Partial<SyncWorkspaceIdentity>;
  if (row.version !== 1 || typeof row.serverUrl !== 'string' || typeof row.userId !== 'string') return false;
  try { return normalizeSyncWorkspaceIdentity(row.serverUrl, row.userId).serverUrl === row.serverUrl; }
  catch { return false; }
}

export function isOnlyLocalPrivacyMetadata(entry: { key: unknown; value: unknown }): boolean {
  if (typeof entry.key !== 'string' || typeof entry.value !== 'boolean') return false;
  try {
    const key: unknown = JSON.parse(entry.key);
    return Array.isArray(key) && key.length === 2 && key[0] === 'localOnly'
      && typeof key[1] === 'string' && key[1].length > 0;
  } catch { return false; }
}

/** No content changes and no clock-dependent metadata: preparing an archive and
 * then checking readiness must not invalidate its exact snapshot fingerprint. */
export async function ensureSyncCaptureCoverage(database: Dexie): Promise<void> {
  await database.transaction('rw', '_localMigrations', '_syncMeta', '_syncQueue', async () => {
    const markers = database.table('_localMigrations');
    if (await markers.get(SYNC_CAPTURE_KEY)) return;
    const history = (await database.table('_syncMeta').toArray()).some(entry => !isOnlyLocalPrivacyMetadata(entry));
    const needsReview = history || await database.table('_syncQueue').count() > 0;
    const marker: SyncCaptureCoverage = needsReview
      ? { key: SYNC_CAPTURE_KEY, version: 1, state: 'reconciliation-required', reason: 'legacy-capture-gap' }
      : { key: SYNC_CAPTURE_KEY, version: 1, state: 'ready' };
    await markers.add(marker);
  });
}

/** Call inside the same transaction as destructive writes to serialize against
 * another tab pausing recovery. Initialization is deliberately separate. */
export async function getSyncPauseReason(database: Dexie): Promise<string | null> {
  const marker: SyncCaptureCoverage | undefined = await database.table('_localMigrations').get(SYNC_CAPTURE_KEY);
  if (marker?.version !== 1 || marker.state !== 'ready') return SYNC_CAPTURE_MESSAGE;
  return (await database.table('_syncMeta').get(SYNC_RECOVERY_KEY))?.value ? SYNC_HISTORY_MESSAGE : null;
}

export async function assertSyncCaptureReady(database: Dexie): Promise<void> {
  const reason = await getSyncPauseReason(database);
  if (reason) throw new Error(reason);
}

export async function markRestoredSyncHistory(database: Dexie): Promise<void> {
  await database.table('_localMigrations').put({ key: SYNC_CAPTURE_KEY, version: 1,
    state: 'reconciliation-required', reason: 'restored-history' } satisfies SyncCaptureCoverage);
  await database.table('_syncMeta').put({ key: SYNC_RECOVERY_KEY, value: true });
}
