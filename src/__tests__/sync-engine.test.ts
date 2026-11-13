import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { db } from '../db';
import { disableSync, revisionKey, suppressSyncInCurrentTransaction } from '../lib/sync-state';
import { setSessionKey } from '../lib/encryptionMiddleware';
import { SyncEngine } from '../lib/sync-engine';
import { ensureSyncWorkspace } from '../lib/sync-workspace';
import { evictSyncedFolder, uncachedFolderKey, cacheOperationKey } from '../lib/sync-cache';

const api = vi.hoisted(() => ({ push: vi.fn(), pull: vi.fn(), snapshot: vi.fn() }));
vi.mock('../lib/server-api', () => ({
  syncPush: api.push, syncPull: async (...args: unknown[]) => ({ generation: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', ...await api.pull(...args) }), syncSnapshot: api.snapshot,
}));
const note = (id: string, title = 'Local') => ({ id, title, content: 'body', folderId: 'f1', tags: [], pinned: false, archived: false, trashed: false, createdAt: 1, updatedAt: 1 });
const seedNote = (row: Parameters<typeof db.notes.add>[0]) => db.transaction('rw', db.notes, async () => { suppressSyncInCurrentTransaction(); return db.notes.add(row); });
let engine: SyncEngine;
beforeEach(async () => {
  disableSync();
  setSessionKey(null);
  await db.transaction('rw', db.tables, async () => { for (const table of db.tables) await table.clear(); });
  await db.folders.add({ id: 'f1', name: 'Case', order: 0, createdAt: 1 });
  vi.clearAllMocks();
  api.push.mockResolvedValue({ results: [] });
  api.pull.mockImplementation(async (_since, _folder, cursor) => ({ changes: [], cursor, hasMore: false, serverTimestamp: new Date().toISOString() }));
  api.snapshot.mockResolvedValue({});
  engine = new SyncEngine();
  await ensureSyncWorkspace('https://test.invalid', 'u1');
  await db.table('_syncMeta').put({ key: 'syncHistoryGenerationV1', value: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' });
  engine.setWorkspaceIdentity('https://test.invalid', 'u1');
});
afterEach(() => { engine.stop(); disableSync(); });

describe('sync engine persistence contract', () => {
  it.each([false, true])('preserves a newer cross-tab eviction while replay is in flight (later page: %s)', async laterPage => {
    const onError = vi.fn(); engine.setErrorHandler(onError);
    await evictSyncedFolder('f1');
    let release: (() => void) | undefined;
    let requests = 0;
    api.pull.mockImplementation(async (_since, folderId, cursor) => {
      if (!folderId) return { changes: [], cursor, hasMore: false };
      requests++;
      if (laterPage && requests === 1) return { changes: [{ ...note('first'), table: 'notes', op: 'put', version: 1 }], cursor: '1', hasMore: true };
      await new Promise<void>(resolve => { release = resolve; });
      return { changes: [{ ...note('late'), table: 'notes', op: 'put', version: 1 }], cursor: '2', hasMore: false };
    });
    const download = engine.pullFolder('f1');
    await vi.waitFor(() => expect(release).toBeDefined());
    const staleToken = (await db.table('_syncMeta').get(cacheOperationKey('f1')))?.value;
    if (laterPage) expect(await db.notes.get('first')).toBeDefined();
    // This operation uses the persisted DB identity, not the downloading engine instance.
    await evictSyncedFolder('f1');
    const winningToken = (await db.table('_syncMeta').get(cacheOperationKey('f1')))?.value;
    expect(winningToken).not.toBe(staleToken);
    release?.();
    await expect(download).rejects.toThrow('offline-cache choice changed');
    expect(onError).toHaveBeenCalledWith(expect.stringContaining('offline-cache choice changed'));
    expect(await db.notes.count()).toBe(0);
    expect((await db.table('_syncMeta').get(uncachedFolderKey('f1')))?.value).toBe(true);
    expect((await db.table('_syncMeta').get(cacheOperationKey('f1')))?.value).toBe(winningToken);
    expect((await db.table('_syncMeta').get('syncCursorV2'))?.value).toBe('0');
  });

  it('retains old queued private content after offline privacy changes and entity deletion', async () => {
    await engine.enqueue('notes', 'n1', 'put', note('n1'));
    await db.folders.update('f1', { localOnly: true });
    await db.folders.delete('f1');
    await engine.sync();
    expect(api.push).not.toHaveBeenCalled();
    expect(await db.table('_syncQueue').count()).toBe(1);
  });

  it('retains legacy tombstones when their investigation scope cannot be verified', async () => {
    await db.table('_syncQueue').add({ table: 'notes', entityId: 'gone', op: 'delete', clientVersion: 1 });
    const handler = vi.fn(); engine.setErrorHandler(handler);
    await engine.sync();
    expect(api.push).not.toHaveBeenCalled();
    expect(handler).toHaveBeenCalledWith(expect.stringContaining('no verified investigation scope'));
    expect(await db.table('_syncQueue').count()).toBe(1);
  });

  it('evicts all offline investigation records without server tombstones and restores them through verified replay', async () => {
    await seedNote(note('n1'));
    await db.transaction('rw', db.evidenceItems, async () => { suppressSyncInCurrentTransaction(); await db.evidenceItems.add({ ...note('e1'), type: 'finding' } as never); });
    await seedNote({ ...note('other'), folderId: 'f2' });
    await evictSyncedFolder('f1');
    expect(await db.notes.get('n1')).toBeUndefined();
    expect(await db.evidenceItems.count()).toBe(0);
    expect(await db.notes.get('other')).toBeDefined();
    expect(await db.table('_syncQueue').count()).toBe(0);
    const changes = [{ ...note('n1', 'Remote'), table: 'notes', op: 'put', version: 1 },
      { id: 'f1', name: 'Case', order: 0, createdAt: 1, table: 'folders', op: 'put', version: 1 }];
    api.pull.mockResolvedValue({ changes, cursor: '2', hasMore: false });
    await engine.sync();
    expect(await db.notes.get('n1')).toBeUndefined();
    expect((await db.table('_syncMeta').get(uncachedFolderKey('f1'))).value).toBe(true);
    await engine.pullFolder('f1');
    expect((await db.notes.get('n1'))?.title).toBe('Remote');
    expect(await db.table('_syncMeta').get(uncachedFolderKey('f1'))).toBeUndefined();
    expect(await db.table('_syncQueue').count()).toBe(0);
    expect(api.snapshot).not.toHaveBeenCalled();
  });

  it('refuses cache removal for pending edits or a local-only investigation', async () => {
    await seedNote(note('n1'));
    await engine.enqueue('notes', 'n1', 'put', note('n1'));
    await expect(evictSyncedFolder('f1')).rejects.toThrow('unsynced edits');
    expect(await db.notes.get('n1')).toBeDefined();
    await db.table('_syncQueue').clear();
    await db.folders.update('f1', { localOnly: true });
    await expect(evictSyncedFolder('f1')).rejects.toThrow('local-only');
    expect(await db.notes.get('n1')).toBeDefined();
  });

  it('keeps cache intent on invalid replay and pauses if history changes during a folder download', async () => {
    await evictSyncedFolder('f1');
    api.pull.mockImplementation(async (_since, folderId, cursor) => folderId
      ? { changes: [{ ...note('bad'), table: 'notes', op: 'put' }], cursor: '1', hasMore: false }
      : { changes: [], cursor, hasMore: false });
    await expect(engine.pullFolder('f1')).rejects.toThrow('no server revision');
    expect((await db.table('_syncMeta').get(uncachedFolderKey('f1'))).value).toBe(true);
    api.pull.mockImplementation(async (_since, folderId, cursor) => ({ changes: [], cursor,
      ...(folderId ? { generation: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb' } : {}), hasMore: false }));
    await expect(engine.pullFolder('f1')).rejects.toThrow('server history changed');
    expect((await db.table('_syncMeta').get('syncRecoveryRequiredV2')).value).toBe(true);
    expect((await db.table('_syncMeta').get(uncachedFolderKey('f1'))).value).toBe(true);
    api.pull.mockClear();
    await expect(engine.pullFolder('f1')).rejects.toThrow('server history changed');
    expect(api.pull).not.toHaveBeenCalled();
  });
  it('makes no requests after switching this workspace to another server/account', async () => {
    await engine.enqueue('notes', 'n1', 'put', note('n1'));
    engine.setWorkspaceIdentity('https://other.invalid', 'u2');
    const handler = vi.fn(); engine.setErrorHandler(handler);
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try { await engine.sync(); } finally { warn.mockRestore(); }
    expect(api.push).not.toHaveBeenCalled();
    expect(api.pull).not.toHaveBeenCalled();
    expect(await db.table('_syncQueue').count()).toBe(1);
    expect(handler).toHaveBeenCalledWith(expect.stringContaining('different server/account'));
  });
  it('retains queued and remote changes when their investigation becomes local-only', async () => {
    await seedNote(note('n1'));
    await engine.enqueue('notes', 'n1', 'put', note('n1'));
    await engine.enqueue('folders', 'f1', 'put', { id: 'f1', name: 'Case' });
    await db.folders.update('f1', { localOnly: true });
    api.pull.mockResolvedValue({ changes: [
      { table: 'folders', id: 'f1', name: 'Remote', op: 'put', version: 2 },
      { table: 'notes', id: 'n1', op: 'delete', version: 2 },
    ], cursor: '2' });
    await engine.sync();
    expect(api.push).not.toHaveBeenCalled();
    expect((await db.folders.get('f1'))?.localOnly).toBe(true);
    expect((await db.notes.get('n1'))?.title).toBe('Local');
    expect(await db.table('_syncQueue').count()).toBe(2);
    expect(await db.table('_syncMeta').get(revisionKey('notes', 'n1'))).toBeUndefined();
  });
  it('sends the acknowledged baseline and coalesces edits for each entity', async () => {
    await seedNote(note('n1'));
    await db.table('_syncMeta').put({ key: revisionKey('notes', 'n1'), value: 4 });
    await db.notes.update('n1', { title: 'First' });
    await db.notes.update('n1', { title: 'Latest' });
    api.push.mockResolvedValue({ results: [{ table: 'notes', entityId: 'n1', status: 'accepted', serverVersion: 5 }] });
    await engine.sync();
    expect(api.push.mock.calls[0][0]).toEqual([expect.objectContaining({ entityId: 'n1', clientVersion: 4, data: expect.objectContaining({ title: 'Latest' }) })]);
    expect(await db.table('_syncQueue').count()).toBe(0);
    expect((await db.table('_syncMeta').get(revisionKey('notes', 'n1'))).value).toBe(5);
  });

  it('retains rejected and conflicted edits across pulls', async () => {
    await seedNote(note('n1'));
    await engine.enqueue('notes', 'n1', 'put', note('n1'));
    const conflict = { table: 'notes', entityId: 'n1', status: 'conflict', serverVersion: 3, serverData: { ...note('n1', 'Remote'), version: 3 } };
    api.push.mockResolvedValue({ results: [conflict] });
    api.pull.mockResolvedValue({ changes: [{ ...conflict.serverData, table: 'notes', op: 'put' }], cursor: '3' });
    const handler = vi.fn();
    engine.setConflictHandler(handler);
    await engine.sync();
    expect(await db.table('_syncQueue').count()).toBe(1);
    expect((await db.notes.get('n1'))?.title).toBe('Local');
    expect(handler).toHaveBeenCalledWith([expect.objectContaining(conflict)]);
    api.push.mockResolvedValue({ results: [{ table: 'notes', entityId: 'n1', status: 'rejected' }] });
    await engine.sync();
    expect(await db.table('_syncQueue').count()).toBe(1);
  });

  it('preserves later edits while acknowledging an in-flight upload', async () => {
    await seedNote(note('n1'));
    await db.notes.update('n1', { title: 'Sent' });
    api.push.mockImplementationOnce(async () => {
      await db.notes.update('n1', { title: 'Typed during upload' });
      return { results: [{ table: 'notes', entityId: 'n1', status: 'accepted', serverVersion: 1 }] };
    });
    await engine.sync();
    expect(await db.table('_syncQueue').toArray()).toEqual([expect.objectContaining({ clientVersion: 1, data: expect.objectContaining({ title: 'Typed during upload' }) })]);
  });

  it('keeps work if an acknowledgement is malformed or the network fails', async () => {
    await engine.enqueue('notes', 'n1', 'put', note('n1'));
    api.push.mockResolvedValue({ results: [{ entityId: 'other', status: 'accepted', serverVersion: 1 }] });
    await engine.sync();
    expect(await db.table('_syncQueue').count()).toBe(1);
    api.push.mockRejectedValue(new Error('Not connected'));
    await engine.sync();
    expect(await db.table('_syncQueue').count()).toBe(1);
  });

  it('requeues Keep mine against the reviewed revision', async () => {
    await engine.enqueue('notes', 'n1', 'put', note('n1', 'Mine'));
    await engine.resolveConflicts([{ table: 'notes', entityId: 'n1', serverVersion: 8 }], 'mine');
    expect(await db.table('_syncQueue').toArray()).toEqual([expect.objectContaining({ clientVersion: 8, data: expect.objectContaining({ title: 'Mine' }) })]);
  });

  it('Keep theirs changes only the matching table/entity and suppresses capture', async () => {
    await seedNote(note('shared-id', 'Mine'));
    await engine.enqueue('notes', 'shared-id', 'put', note('shared-id'));
    await engine.enqueue('tasks', 'shared-id', 'delete');
    await engine.resolveConflicts([{ table: 'notes', entityId: 'shared-id', serverVersion: 4, serverData: { ...note('shared-id', 'Theirs'), version: 4 } }], 'theirs');
    expect((await db.notes.get('shared-id'))?.title).toBe('Theirs');
    expect((await db.table('_syncQueue').toArray()).map(e => e.table)).toEqual(['tasks']);
  });

  it('applies cursor pages and revisions atomically without requeueing them', async () => {
    api.pull.mockResolvedValueOnce({ changes: [{ ...note('n1', 'Remote'), table: 'notes', op: 'put', version: 1 }], cursor: '1', hasMore: true })
      .mockResolvedValueOnce({ changes: [{ table: 'notes', op: 'delete', id: 'n1', version: 2 }], cursor: '2', hasMore: false })
      .mockResolvedValueOnce({ changes: [], cursor: '2', hasMore: false });
    await engine.sync();
    expect(api.pull.mock.calls.map(call => call[2])).toEqual(['0', '1', '2']);
    expect(await db.notes.get('n1')).toBeUndefined();
    expect((await db.table('_syncMeta').get('syncCursorV2')).value).toBe('2');
    expect(await db.table('_syncQueue').count()).toBe(0);
  });

  it('catches up revisions skipped while a conflict was awaiting review', async () => {
    await seedNote(note('n1'));
    await engine.enqueue('notes', 'n1', 'put', note('n1'));
    api.push.mockResolvedValue({ results: [{ table: 'notes', entityId: 'n1', status: 'conflict', serverVersion: 2 }] });
    const later = { ...note('n1', 'Newest remote'), version: 3, table: 'notes', op: 'put' };
    api.pull.mockResolvedValue({ changes: [later], cursor: '3' });
    await engine.sync();
    expect((await db.notes.get('n1'))?.title).toBe('Local');
    await engine.resolveConflicts([{ table: 'notes', entityId: 'n1', serverVersion: 2, serverData: { ...note('n1', 'Reviewed remote'), version: 2 } }], 'theirs');
    await engine.sync();
    expect(api.pull.mock.calls.some(call => call[2] === '0')).toBe(true);
    expect((await db.notes.get('n1'))?.title).toBe('Newest remote');
  });

  it('rolls back a whole page and its cursor when a record is invalid', async () => {
    api.pull.mockResolvedValue({ changes: [
      { ...note('n1'), table: 'notes', op: 'put', version: 1 },
      { ...note('n2'), table: 'notes', op: 'put' },
    ], cursor: '2' });
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      await engine.sync();
      expect(await db.notes.count()).toBe(0);
      expect(await db.table('_syncMeta').get('syncCursorV2')).toBeUndefined();
    } finally { warn.mockRestore(); }
  });

  it('pauses before upload when server history resets, preserving edits across restart', async () => {
    await db.table('_syncMeta').put({ key: 'syncCursorV2', value: '99' });
    await engine.enqueue('notes', 'n1', 'put', note('n1'));
    api.pull.mockRejectedValueOnce(Object.assign(new Error('Reset'), { code: 'SYNC_CURSOR_RESET' }));
    const error = vi.fn();
    engine.setErrorHandler(error);
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try { await engine.sync(); } finally { warn.mockRestore(); }
    expect(api.pull.mock.calls.map(call => call[2])).toEqual(['99']);
    expect(api.push).not.toHaveBeenCalled();
    expect(error).toHaveBeenLastCalledWith(expect.stringContaining('Sync paused'));
    expect((await db.table('_syncMeta').get('syncCursorV2')).value).toBe('99');
    engine = new SyncEngine();
    engine.setWorkspaceIdentity('https://test.invalid', 'u1');
    await engine.sync();
    expect(api.pull).toHaveBeenCalledTimes(1);
    expect(await db.table('_syncQueue').count()).toBe(1);
  });

  it('bounds batches by UTF-8 bytes and retains oversized changes while uploading others', async () => {
    for (const id of ['n1', 'n2']) await engine.enqueue('notes', id, 'put', { ...note(id), content: 'é'.repeat(240_000) });
    await engine.enqueue('notes', 'huge', 'put', { ...note('huge'), content: 'é'.repeat(500_000) });
    const error = vi.fn(); engine.setErrorHandler(error);
    api.push.mockImplementation(async changes => ({ results: changes.map((c: { entityId: string }) => ({ table: 'notes', entityId: c.entityId, status: 'accepted', serverVersion: 1 })) }));
    await engine.sync();
    expect(api.push).toHaveBeenCalledTimes(2);
    for (const [changes] of api.push.mock.calls) expect(new TextEncoder().encode(JSON.stringify({ changes })).byteLength).toBeLessThan(900_000);
    expect(await db.table('_syncQueue').toArray()).toEqual([expect.objectContaining({ entityId: 'huge' })]);
    expect(error).toHaveBeenLastCalledWith(expect.stringContaining('too large'));
  });

  it('does not let an in-flight pull overwrite a conflict replay cursor', async () => {
    await engine.enqueue('notes', 'n1', 'put', note('n1'));
    await db.table('_syncMeta').put({ key: 'syncCursorV2', value: '3' });
    let finish!: (value: unknown) => void;
    api.pull.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    api.pull.mockResolvedValue({ changes: [{ ...note('n1', 'Newest'), table: 'notes', op: 'put', version: 3 }], cursor: '4', hasMore: false });
    const work = engine.sync();
    await vi.waitFor(() => expect(finish).toBeDefined());
    await engine.resolveConflicts([{ table: 'notes', entityId: 'n1', serverVersion: 2, serverData: { ...note('n1', 'Reviewed'), version: 2 } }], 'theirs');
    finish({ changes: [], cursor: '4', hasMore: false });
    await work;
    expect(api.pull.mock.calls[1][2]).toBe('0');
    expect((await db.notes.get('n1'))?.title).toBe('Newest');
  });

  it('ignores an old response after the engine is stopped', async () => {
    let finish!: (value: unknown) => void;
    api.pull.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    const work = engine.sync();
    await vi.waitFor(() => expect(finish).toBeDefined());
    engine.stop();
    finish({ changes: [{ ...note('n1'), table: 'notes', op: 'put', version: 1 }], cursor: '1' });
    await work;
    expect(await db.notes.count()).toBe(0);
  });

  it('uses WS entity messages only to fetch accepted server changes', async () => {
    await engine.applyRemoteChange('notes', 'put', 'n1', note('n1', 'Preview'));
    expect(api.pull).toHaveBeenCalled();
    expect(await db.notes.get('n1')).toBeUndefined();
  });

  it('initial capture excludes local-only/unscoped content and does not mark it uploaded', async () => {
    await db.folders.update('f1', { localOnly: true });
    await seedNote(note('n1'));
    await seedNote({ ...note('n2'), folderId: undefined });
    engine.start();
    await vi.waitFor(() => expect(api.pull).toHaveBeenCalled());
    expect(api.push).not.toHaveBeenCalled();
  });
});

describe('round trips keep fields the server cannot store', () => {
  const task = (id: string, title = 'Local task') => ({ id, title, completed: false, priority: 'none', folderId: 'f1', tags: [], status: 'todo', order: 0, trashed: false, archived: false, createdAt: 1, updatedAt: 1 });
  const thread = (id: string) => ({ id, title: 'Thread', messages: [], model: 'm', provider: 'anthropic', folderId: 'f1', tags: [], trashed: false, archived: false, createdAt: 1, updatedAt: 1 });
  const seed = (table: string, row: Record<string, unknown>) => db.transaction('rw', db.table(table), async () => { suppressSyncInCurrentTransaction(); await db.table(table).put(row); });
  /** What the server change log returns: its own columns only, plus provenance and the revision. */
  const echo = (table: string, row: Record<string, unknown>, version: number, drop: string[]) => ({
    ...Object.fromEntries(Object.entries(row).filter(([key]) => !drop.includes(key))), createdBy: 'u1', updatedBy: 'u1', deletedAt: null, table, op: 'put', version,
  });
  const checklist = [{ id: 'c1', text: 'Collect proxy logs', done: true }];
  const rejectionHistory = [{ at: 5, quality: 'needs-redo', reason: 'thin', requestedDelta: 'add sources' }];
  const comments = [{ id: 'k1', content: 'Matches the C2 list', userId: 'u1', userName: 'Ana', createdAt: 7 }];
  const message = { id: 'm1', role: 'assistant', content: 'Done', createdAt: 9, userId: 'u1', tokenCount: { input: 10, output: 20 },
    toolCalls: [{ id: 'tc1', name: 'read_note', input: { id: 'n1' }, result: 'ok', isError: false }],
    attachments: [{ type: 'image', data: 'iVBORw0KGgo=', mimeType: 'image/png' }] };
  const rows = {
    tasks: { ...task('t1'), checklist, escalated: true, rejectionCount: 3, rejectionHistory },
    notes: { ...note('n1'), parentNoteId: 'n0', isFolder: true, reviewRequired: true },
    folders: { id: 'f1', name: 'Case', order: 0, createdAt: 1, agentEnabled: true, agentStatus: 'idle', agentThreadId: 'th', agentLastRunAt: 8,
      agentPolicy: { autoApproveReads: true }, playbookExecution: { templateId: 'p', templateName: 'P', startedAt: 1, steps: [] }, noteTemplateIds: ['tpl'] },
    chatThreads: { ...thread('ch1'), messages: [message], mode: 'plan', source: 'agent', contextSummary: 'summary', parentThreadId: 'ch0', isFolder: true },
    standaloneIOCs: { id: 'i1', type: 'domain', value: 'evil.test', confidence: 'high', folderId: 'f1', tags: [], trashed: false, archived: false, createdAt: 1, updatedAt: 1,
      firstSeen: 2, lastSeen: 3, linkedEvidenceIds: ['ev1'], comments },
    timelineEvents: { id: 'e1', timestamp: 4, title: 'Beacon', eventType: 'command-and-control', source: 'proxy', confidence: 'high', linkedIOCIds: [], linkedNoteIds: [],
      linkedTaskIds: [], mitreAttackIds: [], assets: [], tags: [], starred: false, folderId: 'f1', timelineId: 'tl1', trashed: false, archived: false, createdAt: 1, updatedAt: 1,
      latitude: 51.5072, longitude: -0.1276, comments },
  } as Record<string, Record<string, unknown>>;
  const unstored: Record<string, string[]> = {
    tasks: ['checklist', 'escalated', 'rejectionCount', 'rejectionHistory'], notes: ['parentNoteId', 'isFolder', 'reviewRequired'],
    folders: ['agentEnabled', 'agentStatus', 'agentThreadId', 'agentLastRunAt', 'agentPolicy', 'playbookExecution', 'noteTemplateIds'],
    chatThreads: ['mode', 'source', 'contextSummary', 'parentThreadId', 'isFolder'], standaloneIOCs: ['firstSeen', 'lastSeen', 'linkedEvidenceIds'], timelineEvents: [],
  };
  const serverEcho = (version: number, overrides: Record<string, Record<string, unknown>> = {}) => Object.entries(rows).map(([table, row]) => {
    const stored = echo(table, { ...row, ...overrides[table] }, version, unstored[table]);
    return table === 'timelineEvents' ? { ...stored, latitude: '51.5072', longitude: '-0.1276' } : stored; // TEXT columns
  });

  it('a pushed row is unchanged after its own accepted echo, apart from server provenance', async () => {
    for (const [table, row] of Object.entries(rows)) await seed(table, row);
    for (const [table, row] of Object.entries(rows)) await engine.enqueue(table, row.id as string, 'put', row);
    api.push.mockImplementation(async (changes: Array<{ table: string; entityId: string }>) => ({
      results: changes.map(change => ({ table: change.table, entityId: change.entityId, status: 'accepted', serverVersion: 1 })),
    }));
    api.pull.mockResolvedValueOnce({ changes: [], cursor: '0', hasMore: false })
      .mockResolvedValueOnce({ changes: serverEcho(1), cursor: '6', hasMore: false });
    await engine.sync();
    expect(api.push).toHaveBeenCalledTimes(1);
    expect(await db.table('_syncQueue').count()).toBe(0);
    for (const [table, row] of Object.entries(rows)) {
      expect(await db.table(table).get(row.id as string), table).toMatchObject({ ...row, createdBy: 'u1' });
    }
  });

  it("a teammate's newer revision updates server fields and keeps this device's unstored fields", async () => {
    for (const [table, row] of Object.entries(rows)) await seed(table, row);
    for (const [table, row] of Object.entries(rows)) await db.table('_syncMeta').put({ key: revisionKey(table, row.id as string), value: 1 });
    api.pull.mockResolvedValueOnce({ changes: serverEcho(2, { tasks: { title: 'Renamed by Ben' }, notes: { title: 'Edited by Ben' } }), cursor: '12', hasMore: false });
    await engine.sync();
    expect(await db.table('tasks').get('t1')).toMatchObject({ title: 'Renamed by Ben', checklist, escalated: true, rejectionCount: 3 });
    expect(await db.table('notes').get('n1')).toMatchObject({ title: 'Edited by Ben', parentNoteId: 'n0', isFolder: true });
    expect(await db.table('chatThreads').get('ch1')).toMatchObject({ mode: 'plan', source: 'agent', messages: [expect.objectContaining({ toolCalls: message.toolCalls })] });
    expect(await db.table('folders').get('f1')).toMatchObject({ agentEnabled: true, playbookExecution: rows.folders.playbookExecution });
  });

  it('a concrete server value wins; a null server value means "no value" and keeps the local one', async () => {
    await seed('tasks', rows.tasks);
    await db.table('_syncMeta').put({ key: revisionKey('tasks', 't1'), value: 1 });
    api.pull.mockResolvedValueOnce({ changes: [{ ...echo('tasks', rows.tasks, 2, ['checklist']), escalated: false, rejectionCount: null }], cursor: '2', hasMore: false });
    await engine.sync();
    const stored = await db.table('tasks').get('t1');
    expect(stored.checklist).toEqual(checklist);
    expect(stored.escalated).toBeUndefined();
    expect(stored.rejectionCount).toBe(3);
  });

  it('never takes per-device agent settings from a server change', async () => {
    await seed('folders', { ...rows.folders, agentEnabled: false, agentStatus: 'paused' });
    await db.table('_syncMeta').put({ key: revisionKey('folders', 'f1'), value: 1 });
    const hostile = { ...echo('folders', rows.folders, 2, []), agentEnabled: true, agentStatus: 'running', agentPolicy: { autoApproveCreate: true, autoApproveModify: true } };
    api.pull.mockResolvedValueOnce({ changes: [hostile, { ...hostile, id: 'f9', name: 'New case' }], cursor: '2', hasMore: false });
    await engine.sync();
    expect(await db.table('folders').get('f1')).toMatchObject({ agentEnabled: false, agentStatus: 'paused', agentPolicy: rows.folders.agentPolicy });
    const fresh = await db.table('folders').get('f9');
    expect([fresh.agentEnabled, fresh.agentStatus, fresh.agentPolicy]).toEqual([undefined, undefined, undefined]);
  });

  it('re-downloads an evicted investigation even though its revision keys are still known', async () => {
    await seed('tasks', rows.tasks);
    await db.table('_syncMeta').put({ key: revisionKey('tasks', 't1'), value: 3 });
    await db.table('_syncMeta').put({ key: revisionKey('folders', 'f1'), value: 1 });
    await evictSyncedFolder('f1');
    expect(await db.table('tasks').get('t1')).toBeUndefined();
    api.pull.mockResolvedValue({ changes: [echo('tasks', task('t1', 'Remote'), 3, []), echo('folders', { id: 'f1', name: 'Case', order: 0, createdAt: 1 }, 1, [])], cursor: '2', hasMore: false });
    await engine.pullFolder('f1');
    expect(await db.table('tasks').get('t1')).toMatchObject({ title: 'Remote' });
    expect(await db.table('_syncMeta').get(uncachedFolderKey('f1'))).toBeUndefined();
  });

  it('Keep theirs replaces server fields but keeps unstored local fields', async () => {
    await seed('tasks', rows.tasks);
    await engine.enqueue('tasks', 't1', 'put', { ...rows.tasks, title: 'Mine' });
    await engine.resolveConflicts([{ table: 'tasks', entityId: 't1', serverVersion: 4, serverData: echo('tasks', { ...rows.tasks, title: 'Theirs' }, 4, unstored.tasks) }], 'theirs');
    expect(await db.table('tasks').get('t1')).toMatchObject({ title: 'Theirs', checklist, escalated: true, rejectionHistory });
    expect(await db.table('_syncQueue').count()).toBe(0);
  });

  it('keeps chat tool calls, images and cycle summaries on this device and out of every push', async () => {
    const summary = { startedAt: 1, durationMs: 2, whyThisCycle: 'why', whatIDid: [], entitiesTouched: [], tokens: { input: 1, output: 2 }, costUSD: 0,
      toolCalls: { executed: 1, proposed: 0 }, toolHistogram: {}, errorHistogram: {}, turns: 1, outcome: 'success', provider: 'anthropic', model: 'm' };
    const detailed = { ...message, agentCycleSummary: summary };
    const local = { ...rows.chatThreads, messages: [detailed] };
    await seed('chatThreads', local);
    await engine.enqueue('chatThreads', 'ch1', 'put', local);
    api.push.mockImplementation(async (changes: Array<{ table: string; entityId: string }>) => ({
      results: changes.map(change => ({ table: change.table, entityId: change.entityId, status: 'accepted', serverVersion: 1 })),
    }));
    const plain = { id: 'm1', role: 'assistant', content: 'Done', createdAt: 9, userId: 'u1', tokenCount: { input: 10, output: 20 } };
    const reply = { id: 'm2', role: 'user', content: 'Thanks', createdAt: 10 };
    api.pull.mockResolvedValueOnce({ changes: [], cursor: '0', hasMore: false })
      .mockResolvedValueOnce({ changes: [echo('chatThreads', { ...local, messages: [plain] }, 1, unstored.chatThreads)], cursor: '1', hasMore: false })
      .mockResolvedValueOnce({ changes: [echo('chatThreads', { ...local, messages: [plain, reply] }, 2, unstored.chatThreads)], cursor: '2', hasMore: false });
    await engine.sync();
    expect(api.push.mock.calls[0][0][0].data.messages).toEqual([plain]);
    expect((await db.table('chatThreads').get('ch1')).messages).toEqual([detailed]);
    await engine.sync(); // a teammate's reply arrives
    expect((await db.table('chatThreads').get('ch1')).messages).toEqual([detailed, reply]);
  });

  it("drops a sub-note's parent pointer when a teammate moves it to another investigation", async () => {
    await seed('notes', { ...note('n1'), parentNoteId: 'p1', reviewRequired: true });
    await db.table('_syncMeta').put({ key: revisionKey('notes', 'n1'), value: 1 });
    api.pull.mockResolvedValueOnce({ changes: [echo('notes', { ...note('n1'), folderId: 'f2' }, 2, [])], cursor: '2', hasMore: false });
    await engine.sync();
    const moved = await db.table('notes').get('n1');
    expect(moved).toMatchObject({ folderId: 'f2', reviewRequired: true });
    expect(moved.parentNoteId).toBeUndefined();
  });

  it('a row with no local copy gets no device-only fields', async () => {
    api.pull.mockResolvedValueOnce({ changes: [echo('tasks', task('fresh', 'From server'), 1, [])], cursor: '1', hasMore: false });
    await engine.sync();
    const stored = await db.table('tasks').get('fresh');
    expect(stored).toMatchObject({ title: 'From server', createdBy: 'u1' });
    expect(stored.checklist).toBeUndefined();
  });
});

