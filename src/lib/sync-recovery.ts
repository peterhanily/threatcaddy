import { db } from '../db';
import { canonicalBackupJSON, encryptBackup, decryptBackup, type EncryptedBackupBlob } from './backup-crypto';
import { normalizeSyncWorkspaceIdentity, SYNC_WORKSPACE_KEY } from './sync-workspace';
import { SYNC_TABLES, suppressSyncInCurrentTransaction } from './sync-state';
import { withEntityDraftBarrier, hasPendingEntityDrafts } from './entity-drafts';
import { syncPull } from './server-api';
import { readStoredAuth } from './auth-storage';

const RECOVERY_KEY = 'syncRecoveryRequiredV2';
type Snapshot = Record<string, Record<string, unknown>[]>;
interface RecoveryArchive { version: 1; kind: 'threatcaddy-workspace-recovery'; databaseVersion: number; data: Snapshot }
export interface SyncRecoveryReceipt { blob: EncryptedBackupBlob; filename: string; records: number }
const receipts = new WeakMap<SyncRecoveryReceipt, string>();

async function snapshot(): Promise<Snapshot> {
  const entries = await Promise.all([...db.tables].sort((a, b) => a.name.localeCompare(b.name)).map(async table => [table.name, await table.toArray()] as const));
  return Object.fromEntries(entries);
}

/** Snapshot includes the outbox and revisions, not just portable entities. It
 * is encrypted and decrypted again before any reconciliation is permitted. */
export async function prepareSyncRecovery(password: string): Promise<SyncRecoveryReceipt> {
  if (password.length < 12) throw new Error('Use at least 12 characters for the recovery archive password.');
  return withEntityDraftBarrier(async () => {
    if (hasPendingEntityDrafts()) throw new Error('Resolve pending drafts before preparing recovery.');
    const data = await db.transaction('r', db.tables, snapshot);
    const archive: RecoveryArchive = { version: 1, kind: 'threatcaddy-workspace-recovery', databaseVersion: db.verno, data };
    const blob = await encryptBackup(password, archive);
    if (new TextEncoder().encode(JSON.stringify(blob)).byteLength > 512 * 1024 * 1024) throw new Error('Recovery archive exceeds the supported 512 MiB restore limit. Local data was not changed.');
    if (canonicalBackupJSON(await decryptBackup(password, blob)) !== canonicalBackupJSON(archive)) throw new Error('Recovery archive verification failed.');
    const receipt = { blob, filename: `threatcaddy-workspace-recovery-${new Date().toISOString().slice(0, 10)}.enc.json`, records: Object.values(data).reduce((sum, rows) => sum + rows.length, 0) };
    receipts.set(receipt, canonicalBackupJSON(data));
    return receipt;
  });
}

/** Reconciliation never chooses a peer's data or discards queued work. Every
 * local record starts at revision zero: existing server records must conflict
 * and be reviewed. Even pending deletes need an explicit reviewed revision. */
export async function reconcileSyncWorkspace(receipt: SyncRecoveryReceipt, serverUrl: string, userId: string,
  confirmation: { backupSaved: boolean; reconcileConfirmed: boolean }): Promise<void> {
  if (!confirmation.backupSaved || !confirmation.reconcileConfirmed || !receipts.has(receipt)) throw new Error('Download the verified recovery archive and explicitly confirm reconciliation first.');
  const identity = normalizeSyncWorkspaceIdentity(serverUrl, userId);
  const assertIdentity = () => {
    const auth = readStoredAuth();
    if (!auth || auth.serverUrl !== identity.serverUrl || auth.user.id !== identity.userId) throw new Error('The signed-in account changed; recovery was not applied.');
  };
  assertIdentity();
  const page = await syncPull(new Date(0).toISOString(), undefined, '0');
  if (!page.generation || !/^[a-f\d-]{36}$/.test(page.generation)) throw new Error('This server does not support safe history recovery.');
  await withEntityDraftBarrier(() => db.transaction('rw', db.tables, async () => {
    assertIdentity();
    if (hasPendingEntityDrafts()) throw new Error('Resolve pending drafts before reconciliation.');
    if (canonicalBackupJSON(await snapshot()) !== receipts.get(receipt)) throw new Error('Local data changed after backup. Download a new recovery archive before reconciling.');
    const meta = db.table('_syncMeta');
    const binding = (await meta.get(SYNC_WORKSPACE_KEY))?.value;
    if (binding && (binding.version !== 1 || binding.serverUrl !== identity.serverUrl || binding.userId !== identity.userId)) throw new Error('This workspace belongs to another account. Switch workspaces instead of rebinding it.');
    suppressSyncInCurrentTransaction();
    const queue = db.table('_syncQueue');
    const pending = await queue.toArray();
    const pendingIds = new Set(pending.map(row => JSON.stringify([row.table, row.entityId])));
    for (const row of pending) await queue.put({ ...row, clientVersion: 0 });
    const folders = await db.folders.toArray();
    const shared = new Set(folders.filter(folder => !folder.localOnly).map(folder => folder.id));
    for (const table of SYNC_TABLES) for (const row of await db.table(table).toArray()) {
      if (row.localOnly || (table === 'folders' ? !shared.has(row.id) : !['tags', 'timelines'].includes(table) && !shared.has(row.folderId))) continue;
      if (!pendingIds.has(JSON.stringify([table, row.id]))) await queue.add({ table, entityId: row.id,
        folderId: table === 'folders' ? row.id : row.folderId, op: 'put', data: row, clientVersion: 0 });
    }
    for (const entry of await meta.toArray()) {
      if (typeof entry.key === 'string' && entry.key.startsWith('["revision",')) await meta.delete(entry.key);
    }
    await meta.bulkPut([
      { key: SYNC_WORKSPACE_KEY, value: identity }, { key: 'syncCursorV2', value: '0' },
      { key: 'syncHistoryGenerationV1', value: page.generation }, { key: RECOVERY_KEY, value: false },
      { key: 'initialPushDoneV2', value: true },
    ]);
    assertIdentity();
  }));
  receipts.delete(receipt);
}

/** A recovery archive can only restore into an empty workspace. Operational
 * state is restored paused; neither queued writes nor agents auto-execute. */
export async function restoreSyncRecovery(password: string, blob: EncryptedBackupBlob, confirmed: boolean): Promise<number> {
  if (!confirmed) throw new Error('Confirm recovery into an empty workspace first.');
  if (new TextEncoder().encode(JSON.stringify(blob)).byteLength > 512 * 1024 * 1024) throw new Error('Recovery archive exceeds 512 MiB.');
  const archive = await decryptBackup<RecoveryArchive>(password, blob);
  if (archive?.version !== 1 || archive.kind !== 'threatcaddy-workspace-recovery' || archive.databaseVersion !== db.verno
    || !archive.data || Array.isArray(archive.data) || Object.keys(archive.data).length !== db.tables.length) throw new Error('Unsupported workspace recovery archive.');
  for (const [name, rows] of Object.entries(archive.data)) {
    const table = db.tables.find(table => table.name === name);
    if (!table || !Array.isArray(rows)) throw new Error('Unsupported recovery store.');
    const key = table.schema.primKey.keyPath;
    if (typeof key !== 'string' || rows.some(row => !row || typeof row !== 'object' || Array.isArray(row) || !['string', 'number'].includes(typeof row[key]))
      || new Set(rows.map(row => row[key])).size !== rows.length) throw new Error('Invalid or duplicate recovery identity.');
  }
  const binding = archive.data._syncMeta.find(row => row.key === SYNC_WORKSPACE_KEY)?.value as { serverUrl?: string; userId?: string } | undefined;
  const auth = readStoredAuth();
  if (auth && (binding?.serverUrl !== auth.serverUrl || binding.userId !== auth.user.id)) throw new Error('Recovery archive belongs to another server or account.');
  return withEntityDraftBarrier(() => db.transaction('rw', db.tables, async () => {
    if (hasPendingEntityDrafts()) throw new Error('Resolve pending drafts first.');
    suppressSyncInCurrentTransaction();
    for (const table of db.tables) if (table.name !== '_localMigrations' && await table.count()) throw new Error('Recovery requires an empty workspace; existing data was not changed.');
    let count = 0;
    for (const [name, rows] of Object.entries(archive.data)) {
      const restored = name === 'agentDeployments' ? rows.map(row => ({ ...row, status: 'paused', serverSideEnabled: false, handoffState: 'client', shift: 'resting' }))
        : name === 'folders' ? rows.map(row => ({ ...row, ...(row.agentEnabled ? { agentEnabled: false, agentStatus: 'paused' } : {}) }))
        : name === 'installedIntegrations' ? rows.map(row => ({ ...row, enabled: false }))
        : name === 'agentActions' ? rows.map(row => ['approved', 'pending'].includes(String(row.status))
          ? { ...row, status: 'rejected', result: 'Recovered from archive; request and review a new approval before execution.' } : row)
        : rows;
      await db.table(name).bulkPut(restored);
      count += restored.length;
    }
    await db.table('_syncMeta').put({ key: RECOVERY_KEY, value: true });
    return count;
  }));
}
