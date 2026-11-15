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
    expect(errors.filter(Boolean).at(-1)).toMatch(/locked/i);
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

  it('stops the shared engine as soon as the workspace is about to lock', () => {
    const stop = vi.spyOn(syncEngine, 'stop');
    try {
      lockEncryptionSession();
      expect(stop).toHaveBeenCalled();
    } finally { stop.mockRestore(); }
  });
});
