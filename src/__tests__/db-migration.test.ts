import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { db } from '../db';
import { migrateIndexedDB, getLegacyCleanupStatus, prepareLegacyCleanup, removeLegacyDatabase, restoreLegacyRecoveryArchive, LEGACY_DB_NAME, LEGACY_TRANSFER_KEY } from '../lib/db-migration';
import { decryptBackup } from '../lib/backup-crypto';
import { encryptField, generateMasterKey, isEncryptedEnvelope } from '../lib/crypto';
import { setSessionKey } from '../lib/encryptionMiddleware';
import { clearEncryptionMeta, setEncryptionMeta } from '../lib/encryptionStore';
import { disableSync } from '../lib/sync-state';

const note = { id: 'n', title: 'Original analyst content', content: 'Private evidence', tags: [] };
function deleteRaw(name: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.deleteDatabase(name);
    request.onsuccess = () => resolve(); request.onerror = () => reject(request.error);
  });
}
async function seedLegacy(data: Record<string, unknown[]> = {}, version = 120): Promise<IDBDatabase> {
  const source = await new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(LEGACY_DB_NAME, version);
    request.onupgradeneeded = () => {
      for (const name of Object.keys(data)) request.result.createObjectStore(name, {
        keyPath: name === '_syncMeta' ? 'key' : name === '_syncQueue' ? 'seq' : 'id', autoIncrement: name === '_syncQueue',
      });
    };
    request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error);
  });
  if (Object.keys(data).length) await new Promise<void>((resolve, reject) => {
    const tx = source.transaction(Object.keys(data), 'readwrite');
    for (const [name, rows] of Object.entries(data)) for (const row of rows) tx.objectStore(name).put(row);
    tx.oncomplete = () => resolve(); tx.onerror = () => reject(tx.error);
  });
  return source;
}
async function sourceExists(): Promise<boolean> { return (await indexedDB.databases()).some(entry => entry.name === LEGACY_DB_NAME); }
async function rawTarget(name: string) {
  return new Promise<unknown[]>((resolve, reject) => {
    const request = db.backendDB().transaction(name).objectStore(name).getAll();
    request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error);
  });
}
beforeEach(async () => {
  disableSync(); setSessionKey(null); clearEncryptionMeta(); db.close();
  await deleteRaw('ThreatCaddyDB'); await deleteRaw(LEGACY_DB_NAME);
});
afterEach(async () => {
  setSessionKey(null); clearEncryptionMeta(); db.close();
  await deleteRaw('ThreatCaddyDB'); await deleteRaw(LEGACY_DB_NAME);
});

describe('resumable verified legacy database transfer', () => {
  it('does not create or delete a missing legacy source', async () => {
    await migrateIndexedDB();
    expect(await sourceExists()).toBe(false);
    expect(await db.table('_localMigrations').get(LEGACY_TRANSFER_KEY)).toBeUndefined();
  });

  it.each([12, 120, 320])('uses current schema and preserves all supported stores from source version %i', async version => {
    const data = { notes: [note], evidenceItems: [{ id: 'e', content: 'Extracted evidence' }],
      agentMeetings: [{ id: 'm', agenda: 'Preserve this too' }], checkpoints: [{ id: 'c', snapshot: { notes: [note] } }],
      integrationRuns: [{ id: 'r', log: ['Original import log'] }],
      _syncQueue: [{ seq: 4, table: 'notes', entityId: 'n', op: 'put', data: note }],
      _syncMeta: [{ key: 'lastSyncTimestamp', value: 'historical' }] };
    (await seedLegacy(data, version)).close();
    await migrateIndexedDB();
    for (const [name, rows] of Object.entries(data)) expect(await db.table(name).toArray()).toEqual(rows);
    expect(db.verno).toBe(33);
    expect(db.notes.schema.indexes.some(index => index.name === '[folderId+updatedAt]')).toBe(true);
    expect(await getLegacyCleanupStatus()).toEqual({ exists: true, verified: true, records: 7 });
    expect(await sourceExists()).toBe(true);
  });

  it('fills a preexisting partial target rather than skipping it', async () => {
    (await seedLegacy({ notes: [note, { ...note, id: 'missing' }] })).close();
    await db.open();
    await db.notes.add(note as never);
    await migrateIndexedDB();
    expect(await db.notes.count()).toBe(2);
    await db.notes.update('n', { title: 'New post-transfer work' });
    await migrateIndexedDB();
    expect((await db.notes.get('n'))?.title).toBe('New post-transfer work');
  });

  it('refuses identity collisions without overwriting either copy', async () => {
    (await seedLegacy({ notes: [note] })).close();
    await db.open();
    await db.notes.add({ ...note, title: 'Different current work' } as never);
    await expect(migrateIndexedDB()).rejects.toThrow('conflicts with existing');
    expect((await db.notes.get('n'))?.title).toBe('Different current work');
    expect(await sourceExists()).toBe(true);
    expect((await db.table('_localMigrations').get(LEGACY_TRANSFER_KEY)).status).toBe('copying');
  });

  it('resumes after a later store fails, with transactional verification markers', async () => {
    (await seedLegacy({ folders: [{ id: 'f', name: 'Case' }], notes: [note] })).close();
    const fail = () => { throw new DOMException('Storage full', 'QuotaExceededError'); };
    db.notes.hook('creating', fail);
    try { await expect(migrateIndexedDB()).rejects.toThrow(); }
    finally { db.notes.hook('creating').unsubscribe(fail); }
    expect(await db.folders.count()).toBe(1);
    expect(await db.notes.count()).toBe(0);
    expect((await db.table('_localMigrations').get(LEGACY_TRANSFER_KEY)).completed).toEqual(['folders']);
    await migrateIndexedDB();
    expect(await db.notes.get('n')).toEqual(note);
    expect((await getLegacyCleanupStatus()).verified).toBe(true);
  });

  it('serializes duplicate startup calls without treating existence as completion', async () => {
    (await seedLegacy({ notes: [note] })).close();
    await Promise.all([migrateIndexedDB(), migrateIndexedDB()]);
    expect(await db.notes.count()).toBe(1);
    expect((await getLegacyCleanupStatus()).verified).toBe(true);
  });

  it('fails closed on unsupported nonempty stores and retains source data', async () => {
    (await seedLegacy({ unfamiliarRecords: [{ id: 'new-format', content: 'Preserve me' }] })).close();
    await expect(migrateIndexedDB()).rejects.toThrow('Unsupported legacy store');
    expect(await sourceExists()).toBe(true);
    expect(await db.table('_localMigrations').get(LEGACY_TRANSFER_KEY)).toBeUndefined();
  });

  it('refuses changed legacy data after transfer instead of overwriting newer work', async () => {
    (await seedLegacy({ notes: [note] })).close();
    await migrateIndexedDB();
    (await seedLegacy({ notes: [{ ...note, title: 'Old app still editing' }] })).close();
    await expect(migrateIndexedDB()).rejects.toThrow('legacy database changed');
    expect(await db.notes.get('n')).toEqual(note);
  });

  it('requires the key and verifies encrypted legacy rows through current encryption middleware', async () => {
    const key = await generateMasterKey();
    setEncryptionMeta({ version: 1, salt: '', wrappedKey: '', recoverySalt: '', recoveryWrappedKey: '', enabledAt: 1 });
    const encrypted = { ...note, title: await encryptField(note.title, key), content: await encryptField(note.content, key) };
    (await seedLegacy({ notes: [encrypted] })).close();
    await expect(migrateIndexedDB()).rejects.toThrow('Unlock');
    setSessionKey(key);
    await migrateIndexedDB();
    expect(await db.notes.get('n')).toEqual(note);
    expect(isEncryptedEnvelope((await rawTarget('notes'))[0] && ((await rawTarget('notes'))[0] as Record<string, unknown>).content)).toBe(true);
  });
});

describe('explicit verified legacy cleanup', () => {
  it('restores the encrypted all-store archive only into an empty workspace', async () => {
    const queue = { seq: 3, table: 'notes', entityId: 'n', op: 'put', data: note };
    (await seedLegacy({ notes: [note], _syncQueue: [queue] })).close();
    await migrateIndexedDB();
    const receipt = await prepareLegacyCleanup('sufficient-recovery-password');
    await expect(restoreLegacyRecoveryArchive('sufficient-recovery-password', receipt.blob, true)).rejects.toThrow('empty workspace');
    expect(await db.notes.get('n')).toEqual(note);
    await removeLegacyDatabase(receipt, { backupSaved: true, deleteConfirmed: true });
    await db.transaction('rw', db.tables, async () => { for (const table of db.tables) await table.clear(); });
    await expect(restoreLegacyRecoveryArchive('sufficient-recovery-password', receipt.blob, false)).rejects.toThrow('Explicitly confirm');
    await expect(restoreLegacyRecoveryArchive('incorrect-password', receipt.blob, true)).rejects.toThrow('Wrong password');
    expect(await db.notes.count()).toBe(0);
    expect(await restoreLegacyRecoveryArchive('sufficient-recovery-password', receipt.blob, true)).toBe(2);
    expect(await db.notes.get('n')).toEqual(note);
    expect(await db.table('_syncQueue').toArray()).toEqual([queue]);
  });

  it('keeps the source until the backup is saved and deletion is confirmed', async () => {
    (await seedLegacy({ notes: [note] })).close();
    await migrateIndexedDB();
    const receipt = await prepareLegacyCleanup('sufficient-recovery-password');
    expect(JSON.stringify(receipt.blob)).not.toContain(note.content);
    const archive = await decryptBackup<{ kind: string; stores: { name: string; rows: unknown[] }[] }>('sufficient-recovery-password', receipt.blob);
    expect(archive.kind).toBe('threatcaddy-legacy-recovery');
    expect(archive.stores.find(store => store.name === 'notes')?.rows).toEqual([note]);
    await expect(removeLegacyDatabase(receipt, { backupSaved: false, deleteConfirmed: true })).rejects.toThrow('explicitly confirm');
    await expect(removeLegacyDatabase(receipt, { backupSaved: true, deleteConfirmed: false })).rejects.toThrow('explicitly confirm');
    expect(await sourceExists()).toBe(true);
    await removeLegacyDatabase(receipt, { backupSaved: true, deleteConfirmed: true });
    expect(await sourceExists()).toBe(false);
    expect(await db.notes.get('n')).toEqual(note);
  });

  it('requires an unchanged source and a real verified recovery receipt', async () => {
    (await seedLegacy({ notes: [note] })).close();
    await migrateIndexedDB();
    const receipt = await prepareLegacyCleanup('sufficient-recovery-password');
    await expect(removeLegacyDatabase({ ...receipt }, { backupSaved: true, deleteConfirmed: true })).rejects.toThrow('new verified');
    (await seedLegacy({ notes: [{ ...note, title: 'Changed after backup' }] })).close();
    await expect(removeLegacyDatabase(receipt, { backupSaved: true, deleteConfirmed: true })).rejects.toThrow('changed after backup');
    expect(await sourceExists()).toBe(true);
  });

  it('reports blocked deletion truthfully and waits for the legacy handle to close', async () => {
    const held = await seedLegacy({ notes: [note] });
    await migrateIndexedDB();
    const receipt = await prepareLegacyCleanup('sufficient-recovery-password');
    const blocked = vi.fn();
    let finished = false;
    const work = removeLegacyDatabase(receipt, { backupSaved: true, deleteConfirmed: true }, blocked).then(() => { finished = true; });
    await vi.waitFor(() => expect(blocked).toHaveBeenCalled());
    expect(finished).toBe(false);
    held.close();
    await work;
    expect(await sourceExists()).toBe(false);
  });
});
