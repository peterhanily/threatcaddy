import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { db } from '../db';
import { disableSync } from '../lib/sync-state';
import { setSessionKey, lockEncryptionSession } from '../lib/encryptionMiddleware';
import { setEncryptionMeta, clearEncryptionMeta } from '../lib/encryptionStore';
import { generateMasterKey, exportKeyRaw, arrayBufferToBase64 } from '../lib/crypto';
import { SyncEngine, syncEngine } from '../lib/sync-engine';
import { ensureSyncWorkspace } from '../lib/sync-workspace';

const api = vi.hoisted(() => ({ push: vi.fn(), pull: vi.fn(), snapshot: vi.fn() }));
vi.mock('../lib/server-api', () => ({
  syncPush: api.push, syncPull: async (...args: unknown[]) => ({ generation: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', ...await api.pull(...args) }), syncSnapshot: api.snapshot,
}));
const note = (id: string, title = 'Private title') => ({ id, title, content: 'Private body', folderId: 'f1', tags: [], pinned: false, archived: false, trashed: false, createdAt: 1, updatedAt: 1 });
const metadata = { version: 1 as const, salt: 'test', wrappedKey: 'test', recoverySalt: 'test', recoveryWrappedKey: 'test', enabledAt: 1, coverageVersion: 2, sessionDuration: '1h' as const };
type Change = { table: string; entityId: string; clientVersion?: number; data?: Record<string, unknown> };
let engine: SyncEngine;
let key: CryptoKey;
let raw: string;

beforeEach(async () => {
  disableSync(); clearEncryptionMeta(); setSessionKey(null);
  await db.transaction('rw', db.tables, async () => { for (const table of db.tables) await table.clear(); });
  key = await generateMasterKey(); raw = arrayBufferToBase64(await exportKeyRaw(key));
  setEncryptionMeta(metadata); setSessionKey(key, raw);
  await db.folders.add({ id: 'f1', name: 'Case', order: 0, createdAt: 1 });
  vi.clearAllMocks();
  api.push.mockImplementation(async (changes: Change[]) => ({ results: changes.map(c => ({ table: c.table, entityId: c.entityId, status: 'accepted', serverVersion: (c.clientVersion ?? 0) + 1 })) }));
  api.pull.mockImplementation(async (_since, _folder, cursor) => ({ changes: [], cursor, hasMore: false, serverTimestamp: new Date().toISOString() }));
  api.snapshot.mockResolvedValue({});
  engine = new SyncEngine();
  await ensureSyncWorkspace('https://test.invalid', 'u1');
  await db.table('_syncMeta').put({ key: 'syncHistoryGenerationV1', value: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' });
  await db.table('_syncMeta').put({ key: 'initialPushDoneV2', value: true });
  engine.setWorkspaceIdentity('https://test.invalid', 'u1');
});
afterEach(async () => {
  engine.stop(); disableSync();
  setEncryptionMeta(metadata); setSessionKey(key, raw);
  await db.transaction('rw', db.tables, async () => { for (const table of db.tables) await table.clear(); });
  clearEncryptionMeta(); setSessionKey(null);
});

describe('team sync across a workspace lock', () => {
  it('sends nothing while locked, keeps the queue, and pushes plaintext after unlock', async () => {
    await db.notes.add(note('n1'));
    lockEncryptionSession();
    const errors: Array<string | null> = []; engine.setErrorHandler(message => { errors.push(message); });
    await engine.sync();
    expect(api.push).not.toHaveBeenCalled();
    // A real lock stops the shared engine; the push pauses without a banner.
    expect(errors.filter(Boolean)).toEqual([]);
    setSessionKey(key, raw);
    expect(await db.table('_syncQueue').count()).toBeGreaterThan(0);
    await engine.sync();
    const sent = api.push.mock.calls.flatMap(call => call[0] as Change[]).find(change => change.table === 'notes');
    expect(sent?.data).toMatchObject({ title: 'Private title', content: 'Private body' });
    expect(Object.keys(sent?.data ?? {})).not.toContain('__enc');
  });

  it('does not push when the lock fires between the pull and the push', async () => {
    await db.notes.add(note('n2'));
    api.pull.mockImplementationOnce(async (_since, _folder, cursor) => {
      lockEncryptionSession();
      return { changes: [], cursor, hasMore: false, serverTimestamp: new Date().toISOString() };
    });
    await engine.sync();
    expect(api.push).not.toHaveBeenCalled();
  });

  it('does not report a lock while encryption is being enabled, and pushes once the key is set', async () => {
    // EncryptionSetup stores the metadata before it installs the session key.
    clearEncryptionMeta(); setSessionKey(null);
    await db.notes.add(note('n4', 'Edit made before enabling'));
    setEncryptionMeta(metadata);
    const errors: Array<string | null> = []; engine.setErrorHandler(message => { errors.push(message); });
    await engine.sync();
    expect(api.push).not.toHaveBeenCalled();
    expect(errors.filter(Boolean)).toEqual([]);
    setSessionKey(key, raw);
    await engine.sync();
    const sent = api.push.mock.calls.flatMap(call => call[0] as Change[]).find(change => change.entityId === 'n4');
    expect(sent?.data).toMatchObject({ title: 'Edit made before enabling' });
  });

  it('does not report a lock when the session is re-keyed during a push, and retries the held batch', async () => {
    // 101 changes split into two push batches; the re-key lands between them.
    await db.notes.bulkAdd(Array.from({ length: 101 }, (_, i) => note(`n${i}`)));
    const accepted = api.push.getMockImplementation();
    api.push.mockImplementationOnce(async (changes: Change[]) => { setSessionKey(key, raw); return accepted?.(changes); });
    const errors: Array<string | null> = []; engine.setErrorHandler(message => { errors.push(message); });
    const retry = vi.spyOn(engine as unknown as { scheduleSync(): void }, 'scheduleSync');
    await engine.sync();
    expect(api.push).toHaveBeenCalledOnce();
    expect(errors.filter(Boolean)).toEqual([]);
    expect(retry).toHaveBeenCalled();
    await engine.sync();
    expect(api.push).toHaveBeenCalledTimes(2);
    expect(await db.table('_syncQueue').count()).toBe(0);
  });

  it('returns a push the server committed before the lock aborted it as a conflict that keeps the edit either way', async () => {
    await db.notes.add(note('n3', 'Edit made before the lock'));
    let committed: Change | undefined;
    api.push.mockImplementationOnce(async (changes: Change[]) => {
      committed = changes.find(change => change.entityId === 'n3');
      lockEncryptionSession();
      throw new DOMException('The operation was aborted.', 'AbortError');
    });
    await engine.sync();
    setSessionKey(key, raw);
    api.push.mockImplementationOnce(async (changes: Change[]) => ({ results: changes.map(c => ({ table: c.table, entityId: c.entityId, status: 'conflict',
      serverVersion: 1, serverData: { ...committed?.data, version: 1, createdAt: new Date(1).toISOString(), updatedAt: new Date(2).toISOString() } })) }));
    const conflicts: Array<{ table?: string; entityId: string; serverVersion?: number; serverData?: Record<string, unknown> }> = [];
    engine.setConflictHandler(found => { conflicts.push(...found); });
    await engine.sync();
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0].serverData).toMatchObject({ title: 'Edit made before the lock', content: 'Private body' });
    await engine.resolveConflicts(conflicts, 'theirs');
    expect(await db.notes.get('n3')).toMatchObject({ title: 'Edit made before the lock', content: 'Private body' });
    expect(await db.table('_syncQueue').count()).toBe(0);
  });

  it('stops the shared engine as soon as the workspace is about to lock', () => {
    const stop = vi.spyOn(syncEngine, 'stop');
    try {
      lockEncryptionSession();
      expect(stop).toHaveBeenCalled();
    } finally { stop.mockRestore(); }
  });
});
