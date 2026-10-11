import Dexie from 'dexie';
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { db } from '../db';
import { setSessionKey, installEncryptionMiddleware } from '../lib/encryptionMiddleware';
import { clearEncryptionMeta } from '../lib/encryptionStore';
import { disableSync, enableSync, revisionKey, suppressSyncInCurrentTransaction } from '../lib/sync-state';
import { installSyncOutbox } from '../lib/sync-outbox';
import { ensureSyncWorkspace } from '../lib/sync-workspace';
import { ensureSyncCaptureCoverage, getSyncPauseReason, SYNC_CAPTURE_KEY, SYNC_WORKSPACE_KEY, SYNC_RECOVERY_KEY } from '../lib/sync-capture-policy';
import { SyncEngine } from '../lib/sync-engine';
import { evictSyncedFolder } from '../lib/sync-cache';
import { prepareSyncRecovery, reconcileSyncWorkspace, restoreSyncRecovery } from '../lib/sync-recovery';
import { clearPending, markPending, PendingChangesError } from '../lib/pending-changes';

const api = vi.hoisted(() => ({ pull: vi.fn(), push: vi.fn() }));
vi.mock('../lib/server-api', () => ({ syncPull: api.pull, syncPush: api.push }));
const identity = { version: 1, serverUrl: 'https://test.invalid', userId: 'alice' };
const generation = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const folder = { id: 'f', name: 'Synthetic case', order: 0, createdAt: 1 };
const note = (id: string, title = 'Latest local') => ({ id, folderId: 'f', title, content: 'Harmless fixture', tags: [], pinned: false, trashed: false, archived: false, createdAt: 1, updatedAt: 1 });
const password = 'synthetic recovery passphrase';
const confirmed = { backupSaved: true, reconcileConfirmed: true };
const engines: SyncEngine[] = [];
const peers: Dexie[] = [];

async function clean() {
  await db.transaction('rw', db.tables, async () => {
    suppressSyncInCurrentTransaction();
    for (const table of db.tables) await table.clear();
  });
}
async function oldWorkspace() {
  await db.folders.add(folder);
  await db.notes.add(note('n'));
  await db.table('_syncMeta').put({ key: SYNC_WORKSPACE_KEY, value: identity });
}
function engine() {
  const value = new SyncEngine(); engines.push(value);
  value.setWorkspaceIdentity(identity.serverUrl, identity.userId);
  return value;
}
function signedIn() {
  localStorage.setItem('threatcaddy-auth', JSON.stringify({ serverUrl: identity.serverUrl, accessToken: 'fixture', refreshToken: 'fixture', user: { id: identity.userId, displayName: 'Alice', email: 'alice@test.invalid', role: 'analyst' } }));
}

beforeEach(async () => {
  disableSync(); setSessionKey(null); clearEncryptionMeta(); localStorage.clear();
  await clean();
  api.pull.mockReset().mockImplementation(async (_since, _folder, cursor) => ({ changes: [], cursor: cursor ?? '0', generation, hasMore: false }));
  api.push.mockReset().mockResolvedValue({ results: [] });
});
afterEach(() => {
  engines.splice(0).forEach(value => value.stop());
  peers.splice(0).forEach(value => value.close());
  vi.restoreAllMocks(); disableSync(); localStorage.clear();
});

describe('durable signed-out capture and non-destructive coverage migration', () => {
  it.each(['evict', 'prepare', 'reconcile', 'restore'] as const)('rolls back %s if new non-editor pending work arrives during its transaction', async action => {
    await db.folders.add(folder); await db.notes.add(note('n'));
    await ensureSyncWorkspace(identity.serverUrl, identity.userId); signedIn();
    const receipt = action === 'reconcile' || action === 'restore' ? await prepareSyncRecovery(password) : undefined;
    if (action === 'restore') await clean();
    const before = await Promise.all(db.tables.map(async table => [table.name, await table.toArray()]));
    const token = Symbol('late synthetic file/chat work');
    const table = action === 'evict' ? db.notes : action === 'restore' ? db.folders : db.table(action === 'prepare' ? '_syncMeta' : '_syncQueue');
    const hook = action === 'evict' ? 'deleting' : 'creating';
    const pending = () => { markPending(token); };
    if (hook === 'deleting') table.hook('deleting', pending); else table.hook('creating', pending);
    try {
      const operation = action === 'evict' ? evictSyncedFolder('f') : action === 'prepare' ? prepareSyncRecovery(password)
        : action === 'restore' && receipt ? restoreSyncRecovery(password, receipt.blob, true)
          : receipt ? reconcileSyncWorkspace(receipt, identity.serverUrl, identity.userId, confirmed) : Promise.reject(new Error('Missing fixture receipt'));
      await expect(operation).rejects.toBeInstanceOf(PendingChangesError);
      expect(await Promise.all(db.tables.map(async item => [item.name, await item.toArray()]))).toEqual(before);
    } finally { table.hook(hook).unsubscribe(pending); clearPending(token); }
  });

  it('captures updates and deletes at acknowledged revisions without auth or transport', async () => {
    await db.folders.add(folder);
    await ensureSyncWorkspace(identity.serverUrl, identity.userId);
    disableSync();
    await db.notes.add(note('n'));
    await db.table('_syncMeta').put({ key: revisionKey('notes', 'n'), value: 7 });
    await db.notes.update('n', { title: 'Signed-out edit' });
    await db.notes.delete('n');
    expect((await db.table('_syncQueue').toArray()).map(row => [row.op, row.clientVersion, row.data?.title])).toEqual([
      ['put', 0, 'Latest local'], ['put', 7, 'Signed-out edit'], ['delete', 7, undefined],
    ]);
    expect(api.pull).not.toHaveBeenCalled(); expect(api.push).not.toHaveBeenCalled();
  });

  it('captures clear tombstones and peer-tab writes with the same durable owner', async () => {
    await db.folders.add(folder);
    await ensureSyncWorkspace(identity.serverUrl, identity.userId);
    const peer = new Dexie(db.name); peers.push(peer);
    installEncryptionMiddleware(peer); installSyncOutbox(peer); await peer.open();
    await peer.table('notes').bulkAdd([note('a'), note('b')]);
    await db.table('_syncQueue').clear();
    await db.table('_syncMeta').put({ key: revisionKey('notes', 'a'), value: 2 });
    await peer.table('notes').clear();
    expect((await db.table('_syncQueue').toArray()).map(row => [row.entityId, row.op, row.clientVersion])).toEqual([
      ['a', 'delete', 2], ['b', 'delete', 0],
    ]);
  });

  it('does not treat a transient flag or invalid binding as capture authority', async () => {
    await db.folders.add(folder); enableSync();
    await db.notes.add(note('unbound'));
    await db.table('_syncMeta').put({ key: SYNC_WORKSPACE_KEY, value: { ...identity, version: 2 } });
    await db.notes.add(note('unknown-owner'));
    expect(await db.table('_syncQueue').count()).toBe(0);
  });

  it('does not auto-enroll a clip-receipt-only workspace or strict false privacy metadata', async () => {
    await db.table('_clipReceipts').put({ key: 'fictional-receipt', clipId: 'clip', committedAt: 1 });
    await db.table('_syncMeta').put({ key: JSON.stringify(['localOnly', 'f']), value: false });
    await ensureSyncCaptureCoverage(db);
    expect(await getSyncPauseReason(db)).toBeNull();
    expect(await db.table('_syncMeta').get(SYNC_WORKSPACE_KEY)).toBeUndefined();
    await db.folders.add(folder); await db.notes.add(note('local'));
    expect(await db.table('_syncQueue').count()).toBe(0);
    await ensureSyncWorkspace(identity.serverUrl, identity.userId);
    expect(await getSyncPauseReason(db)).toBeNull();
  });

  it.each([
    [SYNC_WORKSPACE_KEY, identity], ['syncCursorV2', '0'], ['initialPushDoneV2', false],
    [JSON.stringify(['localOnly', 'f']), 'false'], [JSON.stringify(['localOnly', '']), false],
  ])('quarantines pre-upgrade history without changing entities or metadata: %s', async (key, value) => {
    await db.notes.add(note('n')); await db.table('_syncMeta').put({ key, value });
    const meta = await db.table('_syncMeta').toArray();
    await ensureSyncCaptureCoverage(db); const marker = await db.table('_localMigrations').get(SYNC_CAPTURE_KEY);
    expect(marker).toMatchObject({ state: 'reconciliation-required', reason: 'legacy-capture-gap' });
    await ensureSyncCaptureCoverage(db);
    expect(await db.table('_localMigrations').get(SYNC_CAPTURE_KEY)).toEqual(marker);
    expect(await db.notes.get('n')).toEqual(note('n'));
    expect(await db.table('_syncMeta').toArray()).toEqual(meta);
  });

  it('captures new edits while a known-owner legacy workspace remains quarantined', async () => {
    await oldWorkspace(); await ensureSyncCaptureCoverage(db);
    await db.notes.update('n', { title: 'New quarantined edit' });
    expect(await db.table('_syncQueue').toArray()).toEqual([expect.objectContaining({ data: expect.objectContaining({ title: 'New quarantined edit' }) })]);
    expect(await getSyncPauseReason(db)).toContain('signed out');
  });

  it('fails closed on unknown marker versions and rolls marker creation back atomically', async () => {
    await expect(db.transaction('rw', '_syncMeta', '_syncQueue', '_localMigrations', async () => {
      await ensureSyncCaptureCoverage(db); throw new Error('Synthetic abort');
    })).rejects.toThrow('Synthetic abort');
    expect(await db.table('_localMigrations').count()).toBe(0);
    await db.table('_localMigrations').put({ key: SYNC_CAPTURE_KEY, version: 9, state: 'ready' });
    await ensureSyncCaptureCoverage(db);
    expect(await getSyncPauseReason(db)).toContain('Sync paused');
    expect((await db.table('_localMigrations').get(SYNC_CAPTURE_KEY)).version).toBe(9);
  });
});

describe('capture-gap transport and recovery boundaries', () => {
  it('blocks initial sync, folder downloads/uploads, conflict replacement and cache eviction before any request', async () => {
    await oldWorkspace(); const value = engine();
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const error = vi.fn(); value.setErrorHandler(error); value.start();
    await vi.waitFor(() => expect(error).toHaveBeenCalledWith(expect.stringContaining('signed out')));
    await value.sync();
    await expect(value.pullFolder('f')).rejects.toThrow('signed out');
    await expect(value.syncFolder('f')).rejects.toThrow('signed out');
    await expect(value.enqueue('notes', 'n', 'delete')).rejects.toThrow('signed out');
    await expect(value.resolveConflicts([{ table: 'notes', entityId: 'n', serverVersion: 1 }], 'theirs')).rejects.toThrow('signed out');
    await expect(evictSyncedFolder('f')).rejects.toThrow('signed out');
    expect(api.pull).not.toHaveBeenCalled(); expect(api.push).not.toHaveBeenCalled();
    expect(await db.table('_syncMeta').get('initialPushDoneV2')).toBeUndefined();
    expect(await db.notes.get('n')).toEqual(note('n'));
  });

  it('rejects a remote page if another tab pauses recovery during its request', async () => {
    await db.folders.add(folder); await ensureSyncWorkspace(identity.serverUrl, identity.userId);
    let release: ((page: unknown) => void) | undefined;
    api.pull.mockImplementationOnce(() => new Promise(resolve => { release = resolve; }));
    const value = engine(); vi.spyOn(console, 'warn').mockImplementation(() => {});
    const pending = value.sync(); await vi.waitFor(() => expect(release).toBeDefined());
    await db.table('_syncMeta').put({ key: SYNC_RECOVERY_KEY, value: true });
    release?.({ changes: [{ ...note('remote'), table: 'notes', op: 'put', version: 1 }], cursor: '1', generation, hasMore: false });
    await pending;
    expect(await db.notes.count()).toBe(0);
    expect(await db.table('_syncMeta').get('syncCursorV2')).toBeUndefined();
    expect(api.push).not.toHaveBeenCalled();
  });

  it('reconciles the verified current row after an older queued put, retaining missing-row deletes', async () => {
    await oldWorkspace(); signedIn();
    await db.table('_syncQueue').bulkAdd([
      { table: 'notes', entityId: 'n', folderId: 'f', op: 'put', data: note('n', 'Old queued'), clientVersion: 4 },
      { table: 'notes', entityId: 'deleted', folderId: 'f', op: 'delete', clientVersion: 8 },
    ]);
    const receipt = await prepareSyncRecovery(password);
    // A read-only gate check must not invalidate this exact verified snapshot.
    await ensureSyncCaptureCoverage(db); await getSyncPauseReason(db);
    await reconcileSyncWorkspace(receipt, identity.serverUrl, identity.userId, confirmed);
    const queue = await db.table('_syncQueue').toArray();
    expect(queue.filter(row => row.entityId === 'n').map(row => row.data.title)).toEqual(['Old queued', 'Latest local']);
    expect(queue.filter(row => row.entityId === 'deleted')).toEqual([expect.objectContaining({ op: 'delete', clientVersion: 0 })]);
    expect(await getSyncPauseReason(db)).toBeNull();
    api.pull.mockClear();
    await engine().sync();
    expect(api.push.mock.calls[0][0]).toContainEqual(expect.objectContaining({ entityId: 'n', clientVersion: 0, data: expect.objectContaining({ title: 'Latest local' }) }));
  });

  it('blocks an absent-row queued put without guessing deletion or replaying stale content', async () => {
    await oldWorkspace(); signedIn();
    await db.table('_syncQueue').add({ table: 'notes', entityId: 'missing', folderId: 'f', op: 'put', data: note('missing', 'Historical'), clientVersion: 9 });
    const receipt = await prepareSyncRecovery(password);
    const before = await db.table('_syncQueue').toArray();
    await expect(reconcileSyncWorkspace(receipt, identity.serverUrl, identity.userId, confirmed)).rejects.toThrow('["notes","missing"]');
    expect(api.pull).not.toHaveBeenCalled();
    expect(await db.table('_syncQueue').toArray()).toEqual(before);
    expect(await getSyncPauseReason(db)).toContain('Sync paused');
    expect(await db.notes.get('missing')).toBeUndefined();
  });

  it('rolls back reconciliation if its final readiness marker cannot commit', async () => {
    await oldWorkspace(); signedIn();
    await db.table('_syncQueue').add({ table: 'notes', entityId: 'n', folderId: 'f', op: 'put', data: note('n', 'Old'), clientVersion: 9 });
    const receipt = await prepareSyncRecovery(password);
    const before = { queue: await db.table('_syncQueue').toArray(), meta: await db.table('_syncMeta').toArray(), markers: await db.table('_localMigrations').toArray() };
    const fail = () => { throw new DOMException('Synthetic quota limit', 'QuotaExceededError'); };
    db.table('_localMigrations').hook('updating', fail);
    try { await expect(reconcileSyncWorkspace(receipt, identity.serverUrl, identity.userId, confirmed)).rejects.toThrow('Synthetic quota'); }
    finally { db.table('_localMigrations').hook('updating').unsubscribe(fail); }
    expect({ queue: await db.table('_syncQueue').toArray(), meta: await db.table('_syncMeta').toArray(), markers: await db.table('_localMigrations').toArray() }).toEqual(before);
    expect(await db.notes.get('n')).toEqual(note('n'));
    // Failure did not consume the verified receipt or authorize transport.
    await reconcileSyncWorkspace(receipt, identity.serverUrl, identity.userId, confirmed);
    expect(await getSyncPauseReason(db)).toBeNull();
  });

  it('restoring an archive resets a ready empty workspace to paused operational history', async () => {
    await oldWorkspace(); const receipt = await prepareSyncRecovery(password);
    await clean(); await ensureSyncCaptureCoverage(db);
    expect(await getSyncPauseReason(db)).toBeNull();
    await restoreSyncRecovery(password, receipt.blob, true);
    expect(await db.table('_localMigrations').get(SYNC_CAPTURE_KEY)).toMatchObject({ state: 'reconciliation-required', reason: 'restored-history' });
    expect(await db.notes.get('n')).toEqual(note('n'));
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    await engine().sync();
    expect(api.pull).not.toHaveBeenCalled(); expect(api.push).not.toHaveBeenCalled();
  });

  it('does not acknowledge a pushed batch after another tab begins recovery', async () => {
    await db.folders.add(folder); await ensureSyncWorkspace(identity.serverUrl, identity.userId);
    await db.notes.add(note('n'));
    let release: ((result: unknown) => void) | undefined;
    api.push.mockImplementationOnce(() => new Promise(resolve => { release = resolve; }));
    const value = engine(); vi.spyOn(console, 'warn').mockImplementation(() => {});
    const pending = value.sync(); await vi.waitFor(() => expect(release).toBeDefined());
    await db.table('_syncMeta').put({ key: SYNC_RECOVERY_KEY, value: true });
    release?.({ results: [{ table: 'notes', entityId: 'n', status: 'accepted', serverVersion: 2 }] });
    await pending;
    expect(await db.table('_syncQueue').toArray()).toEqual([expect.objectContaining({ entityId: 'n', clientVersion: 0 })]);
    expect(await db.table('_syncMeta').get(revisionKey('notes', 'n'))).toBeUndefined();
  });

  it('rolls back a remote row and cursor when logout happens inside its write', async () => {
    await db.folders.add(folder); await db.notes.add(note('n'));
    await ensureSyncWorkspace(identity.serverUrl, identity.userId);
    const value = engine(); vi.spyOn(console, 'warn').mockImplementation(() => {});
    const stop = () => { value.stop(); };
    db.notes.hook('updating', stop);
    api.pull.mockResolvedValueOnce({ changes: [{ ...note('n', 'Remote'), table: 'notes', op: 'put', version: 1 }], cursor: '1', generation, hasMore: false });
    try { await value.sync(); } finally { db.notes.hook('updating').unsubscribe(stop); }
    expect(await db.notes.get('n')).toEqual(note('n'));
    expect(await db.table('_syncMeta').get('syncCursorV2')).toBeUndefined();
    expect(await db.table('_syncMeta').get(revisionKey('notes', 'n'))).toBeUndefined();
  });

  it('rolls back acknowledgement deletion if logout happens while dequeuing', async () => {
    await db.folders.add(folder); await ensureSyncWorkspace(identity.serverUrl, identity.userId);
    await db.notes.add(note('n'));
    const value = engine(); vi.spyOn(console, 'warn').mockImplementation(() => {});
    const stop = () => { value.stop(); };
    db.table('_syncQueue').hook('deleting', stop);
    api.push.mockResolvedValueOnce({ results: [{ table: 'notes', entityId: 'n', status: 'accepted', serverVersion: 2 }] });
    try { await value.sync(); } finally { db.table('_syncQueue').hook('deleting').unsubscribe(stop); }
    expect(await db.table('_syncQueue').toArray()).toEqual([expect.objectContaining({ entityId: 'n', clientVersion: 0 })]);
    expect(await db.table('_syncMeta').get(revisionKey('notes', 'n'))).toBeUndefined();
  });
});
