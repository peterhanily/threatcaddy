import Dexie from 'dexie';
import { beforeEach, afterEach, describe, expect, it } from 'vitest';
import { generateMasterKey, isEncryptedEnvelope } from '../lib/crypto';
import { ENCRYPTED_FIELDS, ENCRYPTION_COVERAGE_VERSION, installEncryptionMiddleware, setSessionKey, getSessionKey, encryptAllExistingData, decryptAllExistingData, ensureEncryptionReady } from '../lib/encryptionMiddleware';
import { getEncryptionMeta, setEncryptionMeta, clearEncryptionMeta } from '../lib/encryptionStore';
import { installSyncOutbox } from '../lib/sync-outbox';
import { enableSync, disableSync } from '../lib/sync-state';

// Uses real Web Crypto and a disposable fake-indexeddb database, never browser data.
let fixture: Dexie;
let key: CryptoKey;
let sequence = 0;
let failOutboxWrite = false;
const metadata = () => ({ version: 1 as const, salt: 'fixture-salt', wrappedKey: 'fixture-wrapped', recoverySalt: 'fixture-recovery-salt', recoveryWrappedKey: 'fixture-recovery-key', enabledAt: 1 });
const note = (id: string, title = 'Private finding') => ({ id, title, content: 'Private analysis', folderId: 'case', updatedAt: 1 });

beforeEach(async () => {
  clearEncryptionMeta();
  setSessionKey(null);
  disableSync();
  failOutboxWrite = false;
  fixture = new Dexie(`encryption-fixture-${++sequence}`);
  const schema = Object.fromEntries(Object.keys(ENCRYPTED_FIELDS).map(name => [name, 'id']));
  fixture.version(1).stores({ ...schema, notes: 'id,folderId', _syncQueue: '++seq', _syncMeta: 'key' });
  installEncryptionMiddleware(fixture);
  installSyncOutbox(fixture);
  fixture.use({ stack: 'dbcore', name: 'fixture-storage-failure', level: 5, create: core => ({
    ...core,
    table(name) {
      const table = core.table(name);
      return name !== '_syncQueue' ? table : { ...table, mutate(request) {
        if (failOutboxWrite) throw new Error('Simulated outbox storage failure');
        return table.mutate(request);
      } };
    },
  }) });
  await fixture.open();
  key = await generateMasterKey();
});

afterEach(async () => {
  disableSync();
  clearEncryptionMeta();
  setSessionKey(null);
  await fixture.delete();
});

function raw(table: string, id: IDBValidKey): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    const request = fixture.backendDB().transaction(table).objectStore(table).get(id);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

describe('complete content encryption', () => {
  it('encrypts every registered content field, including durable copies and whiteboard files', async () => {
    setEncryptionMeta(metadata());
    setSessionKey(key);
    for (const [name, fields] of Object.entries(ENCRYPTED_FIELDS)) {
      const record = { id: name, seq: 1, ...Object.fromEntries(fields.map(field => [field, { text: 'Private fixture content' }])) };
      await fixture.table(name).put(record);
      const stored = await raw(name, name === '_syncQueue' ? 1 : name);
      for (const field of fields) expect(isEncryptedEnvelope(stored[field]), `${name}.${field}`).toBe(true);
      expect(await fixture.table(name).get(name === '_syncQueue' ? 1 : name)).toEqual(record);
    }
    await fixture.table('_syncMeta').put({ key: 'cursor', value: 42 });
    expect((await raw('_syncMeta', 'cursor')).value).toBe(42);
  });

  it('decrypts filter, each and modify cursor paths with real asynchronous crypto', async () => {
    setSessionKey(key);
    await fixture.table('notes').bulkPut([note('one', 'First finding'), note('two', 'Second finding')]);
    expect((await fixture.table('notes').filter(row => row.title.startsWith('First')).toArray()).map(row => row.id)).toEqual(['one']);
    const seen: string[] = [];
    await fixture.table('notes').each(row => { seen.push(row.title); });
    expect(seen).toEqual(['First finding', 'Second finding']);
    await fixture.table('notes').toCollection().modify(row => { row.content += ' updated'; });
    expect((await fixture.table('notes').get('one')).content).toBe('Private analysis updated');
    expect(isEncryptedEnvelope((await raw('notes', 'one')).content)).toBe(true);
  });

  it('rejects writes while a metadata-protected workspace is locked', async () => {
    setEncryptionMeta(metadata());
    await expect(fixture.table('notes').put(note('one'))).rejects.toThrow('locked');
    expect(await fixture.table('notes').count()).toBe(0);
  });

  it('pauses ordinary writes during a pending disable transition', async () => {
    setEncryptionMeta({ ...metadata(), transition: 'decrypting' });
    setSessionKey(key);
    await expect(fixture.table('notes').put(note('one'))).rejects.toThrow('being disabled');
    expect(await fixture.table('notes').count()).toBe(0);
    await ensureEncryptionReady(fixture);
    expect(getEncryptionMeta()).toBeNull();
  });

  it('allows unlocked schema preparation before resuming an interrupted disable', async () => {
    setEncryptionMeta({ ...metadata(), transition: 'decrypting' });
    setSessionKey(key);
    fixture.close();
    fixture.version(2).stores({ notes: 'id,folderId,updatedAt' }).upgrade(async transaction => {
      await transaction.table('notes').put(note('schema-fixture'));
    });
    await fixture.open();
    expect(isEncryptedEnvelope((await raw('notes', 'schema-fixture')).content)).toBe(true);
    await ensureEncryptionReady(fixture);
    expect((await raw('notes', 'schema-fixture')).content).toBe('Private analysis');
    expect(getEncryptionMeta()).toBeNull();
  });
});

describe('atomic and resumable encryption transitions', () => {
  it('captures encrypted outbox data and reads it back for sync with the same key', async () => {
    setEncryptionMeta(metadata());
    setSessionKey(key);
    enableSync();
    await fixture.table('notes').put(note('one'));
    const entry = (await fixture.table('_syncQueue').toArray())[0];
    expect(entry.data).toEqual(note('one'));
    expect(isEncryptedEnvelope((await raw('_syncQueue', entry.seq)).data)).toBe(true);
    expect(isEncryptedEnvelope((await raw('notes', 'one')).content)).toBe(true);
  });

  it('aborts both encrypted entity and queue when durable outbox storage fails', async () => {
    setEncryptionMeta(metadata());
    setSessionKey(key);
    enableSync();
    failOutboxWrite = true;
    await expect(fixture.table('notes').put(note('one'))).rejects.toThrow();
    expect(await fixture.table('notes').count()).toBe(0);
    expect(await fixture.table('_syncQueue').count()).toBe(0);
  });
  it('upgrades a previously encrypted workspace and existing outbox payloads without producing sync changes', async () => {
    await fixture.table('notes').put(note('one'));
    await fixture.table('evidenceItems').put({ id: 'evidence', title: 'Source', content: 'Private source', imageData: 'Private pixels' });
    await fixture.table('_syncQueue').put({ seq: 1, table: 'notes', entityId: 'one', op: 'put', data: note('one') });
    await fixture.table('_syncMeta').put({ key: 'cursor', value: 12 });
    setEncryptionMeta(metadata());
    setSessionKey(key);
    enableSync();
    await ensureEncryptionReady(fixture);
    expect(getEncryptionMeta()?.coverageVersion).toBe(ENCRYPTION_COVERAGE_VERSION);
    expect(isEncryptedEnvelope((await raw('evidenceItems', 'evidence')).imageData)).toBe(true);
    expect(isEncryptedEnvelope((await raw('_syncQueue', 1)).data)).toBe(true);
    expect(await fixture.table('_syncQueue').count()).toBe(1);
    expect((await raw('_syncMeta', 'cursor')).value).toBe(12);
  });

  it('rolls back an interrupted enable and finishes it after unlocking again', async () => {
    await fixture.table('notes').bulkPut([note('one'), note('two')]);
    setEncryptionMeta(metadata());
    setSessionKey(key);
    await expect(encryptAllExistingData(fixture, progress => { if (progress.current === 1) throw new Error('Simulated interrupted conversion'); })).rejects.toThrow('interrupted');
    expect((await raw('notes', 'one')).content).toBe('Private analysis');
    expect((await raw('notes', 'two')).content).toBe('Private analysis');
    expect(getEncryptionMeta()?.transition).toBe('encrypting');
    setSessionKey(null);
    setSessionKey(key);
    await ensureEncryptionReady(fixture);
    expect(getEncryptionMeta()?.transition).toBeUndefined();
    expect(isEncryptedEnvelope((await raw('notes', 'one')).content)).toBe(true);
  });

  it('rolls back an interrupted disable, retaining the key until a resumed commit', async () => {
    setEncryptionMeta(metadata());
    setSessionKey(key);
    await fixture.table('notes').bulkPut([note('one'), note('two')]);
    await encryptAllExistingData(fixture);
    await expect(decryptAllExistingData(fixture, progress => { if (progress.current === 1) throw new Error('Simulated storage failure'); })).rejects.toThrow('storage failure');
    expect(isEncryptedEnvelope((await raw('notes', 'one')).content)).toBe(true);
    expect(isEncryptedEnvelope((await raw('notes', 'two')).content)).toBe(true);
    expect(getSessionKey()).toBe(key);
    expect(getEncryptionMeta()?.transition).toBe('decrypting');
    setSessionKey(null);
    setSessionKey(key);
    await ensureEncryptionReady(fixture);
    expect(getSessionKey()).toBeNull();
    expect(getEncryptionMeta()).toBeNull();
    expect((await raw('notes', 'one')).content).toBe('Private analysis');
    expect((await raw('notes', 'two')).content).toBe('Private analysis');
  });
});
