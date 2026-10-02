/** Verified, resumable legacy transfer; deletion requires a separate saved backup and confirmation. */
import { db } from '../db';
import { decryptField, isEncryptedEnvelope } from './crypto';
import { ENCRYPTED_FIELDS, getSessionKey } from './encryptionMiddleware';
import { isEncryptionEnabled } from './encryptionStore';
import { canonicalBackupJSON, decryptBackup, encryptBackup, type EncryptedBackupBlob } from './backup-crypto';
import { suppressSyncInCurrentTransaction } from './sync-state';
import { withEntityDraftBarrier } from './entity-drafts';

export const LEGACY_DB_NAME = 'BrowserNotesDB';
export const LEGACY_TRANSFER_KEY = 'legacy-transfer:BrowserNotesDB:v1';
type Row = Record<string, unknown>;
interface StoreSnapshot { name: string; keyPath: string; rows: Row[]; keys: (string | number)[] }
interface Snapshot { version: number; stores: StoreSnapshot[]; fingerprint: string }
interface Transfer {
  key: typeof LEGACY_TRANSFER_KEY; status: 'copying' | 'verified'; sourceVersion: number;
  fingerprint: string; completed: string[]; counts: Record<string, number>; verifiedAt?: number;
}
export interface LegacyCleanupStatus { exists: boolean; verified: boolean; records: number }
export interface LegacyCleanupArchive { blob: EncryptedBackupBlob; filename: string; records: number }
interface RecoveryArchive { version: 1; kind: 'threatcaddy-legacy-recovery'; database: string; databaseVersion: number; fingerprint: string; stores: StoreSnapshot[] }
const cleanupReceipts = new WeakMap<LegacyCleanupArchive, string>();

function openExistingLegacy(): Promise<IDBDatabase | null> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(LEGACY_DB_NAME);
    let missing = false;
    let rejected = false;
    request.onupgradeneeded = () => { missing = true; request.transaction?.abort(); };
    request.onerror = () => missing ? resolve(null) : reject(request.error);
    request.onblocked = () => { rejected = true; reject(new Error('Close other BrowserNotes tabs before transferring legacy data.')); };
    request.onsuccess = () => {
      if (rejected) { request.result.close(); return; }
      request.result.onversionchange = () => request.result.close();
      resolve(request.result);
    };
  });
}

async function fingerprint(value: unknown): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(canonicalBackupJSON(value)));
  return [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, '0')).join('');
}

/** One consistent source transaction; no plaintext staging database or localStorage copy. */
async function readLegacySnapshot(sourceKey = getSessionKey()): Promise<Snapshot | null> {
  const source = await openExistingLegacy();
  if (!source) return null;
  try {
    const names = [...source.objectStoreNames].filter(name => name !== '$meta').sort();
    const stores = await new Promise<StoreSnapshot[]>((resolve, reject) => {
      if (!names.length) { resolve([]); return; }
      const transaction = source.transaction(names, 'readonly');
      const result: StoreSnapshot[] = [];
      let validationError: Error | undefined;
      for (const name of names) {
        const store = transaction.objectStore(name);
        const rows = store.getAll();
        const keys = store.getAllKeys();
        rows.onsuccess = () => {
          const target = db.tables.find(table => table.name === name && name !== '_localMigrations');
          if (!target && !rows.result.length) return;
          if (!target || typeof store.keyPath !== 'string' || store.keyPath !== target.schema.primKey.keyPath) {
            validationError = new Error(`Unsupported legacy store or key layout: ${name}. The original database has been retained.`);
            transaction.abort(); return;
          }
          result.push({ name, keyPath: store.keyPath, rows: rows.result, keys: [] });
        };
        keys.onsuccess = () => {
          if (keys.result.some(key => typeof key !== 'string' && typeof key !== 'number')) {
            validationError = new Error(`Unsupported legacy keys in ${name}.`); transaction.abort(); return;
          }
          const entry = result.find(value => value.name === name);
          if (entry) entry.keys = keys.result as (string | number)[];
        };
      }
      transaction.oncomplete = () => resolve(result);
      transaction.onabort = () => reject(validationError ?? transaction.error ?? new Error('Legacy snapshot was interrupted.'));
      transaction.onerror = () => reject(transaction.error);
    });
    for (const store of stores) for (const row of store.rows) {
      if (!row || typeof row !== 'object' || Array.isArray(row)) throw new Error(`Invalid legacy record in ${store.name}.`);
      for (const field of ENCRYPTED_FIELDS[store.name] ?? []) {
        if (!isEncryptedEnvelope(row[field])) continue;
        if (!sourceKey) throw new Error('Unlock the original workspace before transferring encrypted legacy records.');
        row[field] = await decryptField(row[field], sourceKey);
      }
    }
    return { version: source.version, stores, fingerprint: await fingerprint({ version: source.version, stores }) };
  } finally { source.close(); }
}

export async function migrateIndexedDB(options: { sourceKey?: CryptoKey | null } = {}): Promise<void> {
  if (db.name !== 'ThreatCaddyDB') return;
  if (isEncryptionEnabled() && !getSessionKey()) throw new Error('Unlock the workspace before transferring legacy data.');
  await db.open();
  const snapshot = await readLegacySnapshot(options.sourceKey ?? getSessionKey());
  if (!snapshot) return;
  const markers = db.table<Transfer, string>('_localMigrations');
  let progress = await db.transaction('rw', markers, async () => {
    const existing = await markers.get(LEGACY_TRANSFER_KEY);
    if (existing) return existing;
    const created: Transfer = { key: LEGACY_TRANSFER_KEY, status: 'copying', sourceVersion: snapshot.version,
      fingerprint: snapshot.fingerprint, completed: [], counts: Object.fromEntries(snapshot.stores.map(store => [store.name, store.rows.length])) };
    await markers.add(created);
    return created;
  });
  if (progress && progress.fingerprint !== snapshot.fingerprint) {
    throw new Error('The legacy database changed after transfer began. Close the old app and reconcile both copies before retrying; neither copy was deleted.');
  }
  if (progress?.status === 'verified') return;
  for (const store of snapshot.stores) {
    if (progress.completed.includes(store.name)) continue;
    await db.transaction('rw', [store.name, '_localMigrations'], async () => {
      suppressSyncInCurrentTransaction();
      const target = db.table(store.name);
      for (let i = 0; i < store.rows.length; i++) {
        const existing = await target.get(store.keys[i]);
        if (existing && canonicalBackupJSON(existing) !== canonicalBackupJSON(store.rows[i])) {
          throw new Error(`Legacy transfer conflicts with existing ${store.name}:${store.keys[i]}. Both copies are preserved; reconcile them before retrying.`);
        }
        if (!existing) await target.add(store.rows[i]);
      }
      const copied = await target.bulkGet(store.keys);
      if (canonicalBackupJSON(copied) !== canonicalBackupJSON(store.rows)) throw new Error(`Legacy verification failed for ${store.name}; this store was rolled back.`);
      const saved = await markers.get(LEGACY_TRANSFER_KEY);
      if (!saved || saved.fingerprint !== snapshot.fingerprint) throw new Error('Legacy transfer state changed; retry startup.');
      progress = { ...saved, completed: [...new Set([...saved.completed, store.name])] };
      await markers.put(progress);
    });
  }
  const fresh = await readLegacySnapshot(options.sourceKey ?? getSessionKey());
  if (!fresh || fresh.fingerprint !== snapshot.fingerprint) throw new Error('The legacy source changed during transfer. Keep both copies and retry after closing the old app.');
  await markers.put({ ...progress, status: 'verified', verifiedAt: Date.now() });
}

export async function getLegacyCleanupStatus(): Promise<LegacyCleanupStatus> {
  if (db.name !== 'ThreatCaddyDB') return { exists: false, verified: false, records: 0 };
  const snapshot = await readLegacySnapshot();
  if (!snapshot) return { exists: false, verified: false, records: 0 };
  const marker = await db.table<Transfer, string>('_localMigrations').get(LEGACY_TRANSFER_KEY);
  return { exists: true, verified: marker?.status === 'verified' && marker.fingerprint === snapshot.fingerprint,
    records: snapshot.stores.reduce((count, store) => count + store.rows.length, 0) };
}

/** Includes all supported stores, including operational history omitted by ordinary exports. */
export async function prepareLegacyCleanup(password: string): Promise<LegacyCleanupArchive> {
  if (db.name !== 'ThreatCaddyDB') throw new Error('Legacy cleanup is available only in the original local workspace.');
  if (password.length < 12) throw new Error('Use at least 12 characters for the legacy recovery archive password.');
  const snapshot = await readLegacySnapshot();
  const marker = await db.table<Transfer, string>('_localMigrations').get(LEGACY_TRANSFER_KEY);
  if (!snapshot || marker?.status !== 'verified' || marker.fingerprint !== snapshot.fingerprint) throw new Error('Complete and verify the legacy transfer before preparing cleanup.');
  const archive: RecoveryArchive = { version: 1, kind: 'threatcaddy-legacy-recovery', database: LEGACY_DB_NAME,
    databaseVersion: snapshot.version, fingerprint: snapshot.fingerprint, stores: snapshot.stores };
  const blob = await encryptBackup(password, archive);
  if (new TextEncoder().encode(JSON.stringify(blob)).byteLength > 512 * 1024 * 1024) {
    throw new Error('Legacy recovery archive exceeds the supported 512 MiB restore limit. Keep the original database.');
  }
  const verified = await decryptBackup<RecoveryArchive>(password, blob);
  if (canonicalBackupJSON(verified) !== canonicalBackupJSON(archive)) throw new Error('Legacy recovery archive verification failed.');
  const receipt = { blob, filename: `threatcaddy-legacy-recovery-${new Date().toISOString().slice(0, 10)}.enc.json`,
    records: snapshot.stores.reduce((count, store) => count + store.rows.length, 0) };
  cleanupReceipts.set(receipt, snapshot.fingerprint);
  return receipt;
}

export async function removeLegacyDatabase(
  receipt: LegacyCleanupArchive, confirmation: { backupSaved: boolean; deleteConfirmed: boolean }, onBlocked?: () => void,
): Promise<void> {
  if (db.name !== 'ThreatCaddyDB') throw new Error('Legacy cleanup is available only in the original local workspace.');
  if (!confirmation.backupSaved || !confirmation.deleteConfirmed) throw new Error('Save the verified recovery archive and explicitly confirm legacy deletion first.');
  const expected = cleanupReceipts.get(receipt);
  if (!expected) throw new Error('Prepare a new verified legacy recovery archive before cleanup.');
  const current = await readLegacySnapshot();
  if (!current || current.fingerprint !== expected) throw new Error('Legacy records changed after backup. Create a new recovery archive before cleanup.');
  const marker = await db.table<Transfer, string>('_localMigrations').get(LEGACY_TRANSFER_KEY);
  if (marker?.status !== 'verified' || marker.fingerprint !== expected) throw new Error('Legacy transfer verification is no longer valid.');
  await new Promise<void>((resolve, reject) => {
    const request = indexedDB.deleteDatabase(LEGACY_DB_NAME);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error ?? new Error('Legacy cleanup failed; retain your recovery archive.'));
    // A delete request cannot be cancelled. Keep confirmed cleanup pending and
    // disabled while other handles close; never report success on `blocked`.
    request.onblocked = () => onBlocked?.();
  });
  cleanupReceipts.delete(receipt);
}

/** Recovery never merges operational history or overwrites an existing workspace. */
export async function restoreLegacyRecoveryArchive(password: string, blob: EncryptedBackupBlob, confirmed: boolean): Promise<number> {
  if (!confirmed) throw new Error('Explicitly confirm recovery into an empty workspace first.');
  if (isEncryptionEnabled() && !getSessionKey()) throw new Error('Unlock this workspace before restoring legacy recovery data.');
  await db.open();
  const archive = await decryptBackup<RecoveryArchive>(password, blob);
  if (!archive || archive.version !== 1 || archive.kind !== 'threatcaddy-legacy-recovery' || archive.database !== LEGACY_DB_NAME
    || !Number.isInteger(archive.databaseVersion) || !Array.isArray(archive.stores)) throw new Error('Invalid legacy recovery archive.');
  const names = new Set<string>();
  for (const store of archive.stores) {
    const target = store && db.tables.find(table => table.name === store.name && store.name !== '_localMigrations');
    if (!target || names.has(store.name) || typeof store.keyPath !== 'string' || target.schema.primKey.keyPath !== store.keyPath
      || !Array.isArray(store.rows) || !Array.isArray(store.keys) || store.rows.length !== store.keys.length) throw new Error('Unsupported or duplicate recovery store.');
    names.add(store.name);
    const keys = new Set<string>();
    for (let i = 0; i < store.rows.length; i++) {
      const row = store.rows[i]; const key = store.keys[i]; const identity = JSON.stringify(key);
      if (!row || typeof row !== 'object' || Array.isArray(row) || !['string', 'number'].includes(typeof key)
        || row[store.keyPath] !== key || keys.has(identity)) throw new Error('Invalid or duplicate recovery record.');
      keys.add(identity);
    }
  }
  if (await fingerprint({ version: archive.databaseVersion, stores: archive.stores }) !== archive.fingerprint) throw new Error('Legacy recovery archive content verification failed.');
  return withEntityDraftBarrier(() => db.transaction('rw', db.tables, async () => {
    suppressSyncInCurrentTransaction();
    for (const table of db.tables) if (table.name !== '_localMigrations' && await table.count()) {
      throw new Error('Legacy recovery requires an empty workspace. Existing records and sync history were not changed. Use a fresh browser profile.');
    }
    let count = 0;
    for (const store of archive.stores) {
      const target = db.table(store.name);
      await target.bulkAdd(store.rows);
      if (canonicalBackupJSON(await target.bulkGet(store.keys)) !== canonicalBackupJSON(store.rows)) throw new Error('Legacy recovery verification failed; all writes were rolled back.');
      count += store.rows.length;
    }
    await db.table('_localMigrations').delete('content-v1');
    return count;
  }));
}
