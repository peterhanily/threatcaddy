import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { db } from '../db';
import { SYNC_TABLES, disableSync, revisionKey, suppressSyncInCurrentTransaction } from '../lib/sync-state';
import { setSessionKey } from '../lib/encryptionMiddleware';
import { SyncEngine } from '../lib/sync-engine';
import { ensureSyncWorkspace } from '../lib/sync-workspace';
import { evictSyncedFolder } from '../lib/sync-cache';
import { outgoingSyncData } from '../lib/sync-sanitize';
import type { Identity } from '../types';

const api = vi.hoisted(() => ({ push: vi.fn(), pull: vi.fn() }));
vi.mock('../lib/server-api', () => ({
  syncPush: api.push,
  syncPull: async (...args: unknown[]) => ({ generation: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', ...await api.pull(...args) }),
}));

/** A server from before identities lists no tables; a current one lists every table it syncs. */
const OLD_SERVER = undefined;
const CURRENT_SERVER = [...SYNC_TABLES];
const identity = (id: string, name: string, extra: Partial<Identity> = {}): Identity => ({ id, folderId: 'f1', type: 'person', name, aliases: [],
  details: [{ id: 'd1', label: 'Phone', value: '+1 555 0100', private: true }], connections: [], tags: [], trashed: false, archived: false,
  createdAt: 1, updatedAt: 1, ...extra });
const note = (id: string) => ({ id, title: 'Note', content: 'body', folderId: 'f1', tags: [], pinned: false, archived: false, trashed: false, createdAt: 1, updatedAt: 1 });
const queued = async () => (await db.table('_syncQueue').toArray()).map(entry => `${entry.table}:${entry.entityId}`).sort();
const pushedTables = () => api.push.mock.calls.flatMap(([changes]) => (changes as Array<{ table: string }>).map(change => change.table));

let engine: SyncEngine;
let serverTables: string[] | undefined;
beforeEach(async () => {
  disableSync();
  setSessionKey(null);
  await db.transaction('rw', db.tables, async () => { for (const table of db.tables) await table.clear(); });
  await db.folders.add({ id: 'f1', name: 'Case', order: 0, createdAt: 1 });
  vi.clearAllMocks();
  serverTables = CURRENT_SERVER;
  api.pull.mockImplementation(async (_since, _folder, cursor) => ({ changes: [], cursor, hasMore: false, serverTimestamp: '', tables: serverTables }));
  api.push.mockImplementation(async (changes: Array<{ table: string; entityId: string }>) => ({
    results: changes.map(change => ({ table: change.table, entityId: change.entityId, status: 'accepted', serverVersion: 1 })),
  }));
  engine = new SyncEngine();
  await ensureSyncWorkspace('https://test.invalid', 'u1');
  await db.table('_syncMeta').put({ key: 'syncHistoryGenerationV1', value: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' });
  engine.setWorkspaceIdentity('https://test.invalid', 'u1');
});
afterEach(() => { engine.stop(); disableSync(); });

describe('identity sync with servers of different versions', () => {
  it('keeps identity changes on this device while the server does not sync identities, and says why', async () => {
    serverTables = OLD_SERVER;
    const onError = vi.fn(); engine.setErrorHandler(onError);
    await db.identities.add(identity('dana', 'Dana Okafor'));
    await db.notes.add(note('n1'));
    await engine.sync();
    // An older server would refuse the whole upload because of the unknown table.
    expect(pushedTables()).toEqual(['notes']);
    expect(await queued()).toEqual(['identities:dana']);
    expect(onError).toHaveBeenCalledWith(expect.stringMatching(/^Dana Okafor \(Case\) was not uploaded because the team server must be updated/));
    // Removing the offline copy would lose the identity, so it is refused, naming it as held on this device.
    await expect(evictSyncedFolder('f1')).rejects.toThrow(/^The local copy was not removed: 1 item\(s\) .* because the team server cannot accept them \(Dana Okafor \(Case\)\)/);
    expect(await db.identities.get('dana')).toBeDefined();

    // After the server is updated, the identity uploads and the notice clears.
    serverTables = CURRENT_SERVER;
    onError.mockClear();
    await engine.sync();
    expect(pushedTables()).toEqual(['notes', 'identities']);
    expect(await queued()).toEqual([]);
    expect(onError).toHaveBeenLastCalledWith(null);
  });

  it('remembers which tables the server syncs, so a queued identity on an updated server counts as unsent', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    api.push.mockRejectedValue(new Error('Not connected'));
    await db.identities.add(identity('dana', 'Dana Okafor'));
    try { await engine.sync(); } finally { warn.mockRestore(); }
    expect((await db.table('_syncMeta').get('syncServerTablesV1'))?.value).toEqual([...CURRENT_SERVER].sort());
    expect(await queued()).toEqual(['identities:dana']);
    // It can upload once the connection is back, so removal asks for a sync instead of naming it as held.
    await expect(evictSyncedFolder('f1')).rejects.toThrow(/unsynced edits/);
  });

  it('clears an emptied field on the server by sending it as null', async () => {
    await db.identities.add(identity('dana', 'Dana Okafor', { status: 'compromised', contact: true, clsLevel: 'TLP:RED', description: 'Finance' }));
    await engine.sync();
    api.push.mockClear();
    await db.identities.update('dana', { status: undefined, contact: undefined, clsLevel: undefined, description: undefined });
    await engine.sync();
    const [[changes]] = api.push.mock.calls;
    expect(changes[0].data).toMatchObject({ status: null, contact: null, clsLevel: null, description: null, trashedAt: null, name: 'Dana Okafor' });
    expect(outgoingSyncData('identities', { name: 'Kept', status: 'cleared' })).toEqual({ name: 'Kept', status: 'cleared', description: null, contact: null, clsLevel: null, trashedAt: null });
    expect(outgoingSyncData('notes', { title: 'Untouched' })).toEqual({ title: 'Untouched' });
  });

  it('applies pulled identities and reads null as no value', async () => {
    api.pull.mockResolvedValueOnce({ changes: [{ table: 'identities', op: 'put', id: 'lee', version: 2, folderId: 'f1', type: 'person', name: 'Lee Park',
      aliases: ['L. Park'], status: null, contact: null, description: null, clsLevel: null, trashedAt: null, details: [], connections: [{ targetId: 'dana', label: 'reports to' }],
      tags: [], trashed: false, archived: false, createdAt: '2026-11-21T10:00:00.000Z', updatedAt: '2026-11-21T10:00:00.000Z' }], cursor: '5', hasMore: false, tables: CURRENT_SERVER });
    const onRemote = vi.fn(); engine.setRemoteChangeHandler(onRemote);
    await engine.sync();
    const lee = await db.identities.get('lee');
    expect(lee).toMatchObject({ name: 'Lee Park', aliases: ['L. Park'], connections: [{ targetId: 'dana', label: 'reports to' }], createdAt: Date.parse('2026-11-21T10:00:00.000Z') });
    for (const field of ['status', 'contact', 'description', 'clsLevel', 'trashedAt'] as const) expect(lee?.[field], field).toBeUndefined();
    expect((await db.table('_syncMeta').get(revisionKey('identities', 'lee')))?.value).toBe(2);
    expect(onRemote.mock.calls[0][1]).toEqual(new Set(['identities']));
    expect(await queued()).toEqual([]);
  });

  it('skips a newer table the server lists instead of stopping the whole pull', async () => {
    const onError = vi.fn(); engine.setErrorHandler(onError);
    api.pull.mockResolvedValueOnce({ changes: [
      { table: 'futureTable', op: 'put', id: 'f-1', version: 1, folderId: 'f1' },
      { ...note('n2'), table: 'notes', op: 'put', version: 1 },
    ], cursor: '7', hasMore: false, tables: [...CURRENT_SERVER, 'futureTable'] });
    await engine.sync();
    expect(await db.notes.get('n2')).toMatchObject({ title: 'Note' });
    expect((await db.table('_syncMeta').get('syncCursorV2'))?.value).toBe('7');
    expect(onError).not.toHaveBeenCalledWith(expect.stringContaining('Invalid sync entity'));
  });

  it.each([['an unlisted name', 'futureTable'], ['no table', undefined], ['a number', 7]])('still stops a pull at a change with %s, keeping the cursor', async (_label, table) => {
    const onError = vi.fn(); engine.setErrorHandler(onError);
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    api.pull.mockResolvedValueOnce({ changes: [{ table, op: 'put', id: 'x', version: 1, folderId: 'f1' }, { ...note('n2'), table: 'notes', op: 'put', version: 1 }],
      cursor: '7', hasMore: false, tables: CURRENT_SERVER });
    try { await engine.sync(); } finally { warn.mockRestore(); }
    expect(onError).toHaveBeenCalledWith('Invalid sync entity');
    expect(await db.notes.get('n2')).toBeUndefined();
    expect(await db.table('_syncMeta').get('syncCursorV2')).toBeUndefined();
  });

  it('catches up on the identities a workspace from before identities missed, after the server accepts its cursor', async () => {
    // A 2.0.4 client saved its cursor while the server left identities out of its pulls.
    await db.table('_syncMeta').put({ key: 'syncCursorV2', value: '40' });
    api.pull.mockImplementation(async (_since, _folder, cursor, _generation, tables) => tables?.join() === 'identities'
      ? cursor === '0'
        ? { changes: [{ ...identity('dana', 'Dana Okafor'), table: 'identities', op: 'put', version: 1 }], cursor: '30', hasMore: true, tables: CURRENT_SERVER }
        : { changes: [{ ...identity('lee', 'Lee Park'), table: 'identities', op: 'put', version: 2 }], cursor: '45', hasMore: false, tables: CURRENT_SERVER }
      : { changes: [{ ...note('n3'), table: 'notes', op: 'put', version: 4 }], cursor: '45', hasMore: false, tables: CURRENT_SERVER });
    await engine.sync();
    // The saved cursor is sent first, so the server can still report a restored history.
    // Then only identities are fetched from the start, in pages; the saved cursor is kept.
    // (An ordinary pull names no tables here: syncPull then lists every table this client syncs.)
    expect(api.pull.mock.calls.slice(0, 3).map(call => [call[2], call[4]?.join()])).toEqual([['40', undefined], ['0', 'identities'], ['30', 'identities']]);
    expect((await db.identities.toArray()).map(row => row.name).sort()).toEqual(['Dana Okafor', 'Lee Park']);
    expect(await db.notes.get('n3')).toMatchObject({ title: 'Note' });
    expect((await db.table('_syncMeta').get('syncCursorV2'))?.value).toBe('45');
    expect((await db.table('_syncMeta').get('syncCursorTablesV1'))?.value).toEqual([...SYNC_TABLES]);

    api.pull.mockClear();
    await engine.sync();
    expect(api.pull.mock.calls.map(call => call[2])).toEqual(['45', '45']);
  });

  it('needs no catch-up for a fresh workspace, whose first pull starts at the beginning', async () => {
    await engine.sync();
    expect(api.pull.mock.calls.every(call => call[4] === undefined)).toBe(true);
    expect((await db.table('_syncMeta').get('syncCursorTablesV1'))?.value).toEqual([...SYNC_TABLES]);
  });

  it('catches up again after an interrupted catch-up', async () => {
    await db.table('_syncMeta').put({ key: 'syncCursorV2', value: '40' });
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    api.pull.mockImplementation(async (_since, _folder, cursor, _generation, tables) => {
      if (tables?.join() === 'identities' && cursor === '30') throw new Error('Network lost');
      return tables?.join() === 'identities'
        ? { changes: [{ ...identity('dana', 'Dana Okafor'), table: 'identities', op: 'put', version: 1 }], cursor: '30', hasMore: true, tables: CURRENT_SERVER }
        : { changes: [], cursor: '45', hasMore: false, tables: CURRENT_SERVER };
    });
    try { await engine.sync(); } finally { warn.mockRestore(); }
    expect(await db.table('_syncMeta').get('syncCursorTablesV1')).toBeUndefined();
    expect((await db.table('_syncMeta').get('syncCursorV2'))?.value).toBe('40');
    api.pull.mockClear();
    await engine.sync();
    expect(api.pull.mock.calls[1].slice(2, 5).map(value => Array.isArray(value) ? value.join() : value)).toEqual(['0', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'identities']);
  });

  it('does not replay against a server that has never synced identities', async () => {
    serverTables = OLD_SERVER;
    await db.table('_syncMeta').put({ key: 'syncCursorV2', value: '40' });
    api.pull.mockImplementation(async (_since, _folder, cursor) => ({ changes: [], cursor, hasMore: false }));
    await engine.sync();
    expect(api.pull.mock.calls.map(call => call[2])).toEqual(['40', '40']);
    expect((await db.table('_syncMeta').get('syncCursorTablesV1'))?.value).toEqual([...SYNC_TABLES]);
  });

  it('does not replay when the server reports a different history for the saved cursor', async () => {
    await db.table('_syncMeta').put({ key: 'syncCursorV2', value: '40' });
    api.pull.mockResolvedValue({ changes: [], cursor: '1', hasMore: false, tables: CURRENT_SERVER, generation: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb' });
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try { await engine.sync(); } finally { warn.mockRestore(); }
    expect(api.pull.mock.calls.map(call => call[2])).toEqual(['40']);
    expect((await db.table('_syncMeta').get('syncCursorV2'))?.value).toBe('40');
    expect(await db.table('_syncMeta').get('syncCursorTablesV1')).toBeUndefined();
  });

  it('never queues, uploads or overwrites an identity in a local-only investigation', async () => {
    await db.folders.update('f1', { localOnly: true });
    await db.identities.add(identity('private', 'Private'));
    api.pull.mockResolvedValueOnce({ changes: [{ ...identity('private', 'Server copy'), table: 'identities', op: 'put', version: 2 }], cursor: '3', hasMore: false, tables: CURRENT_SERVER });
    await engine.sync();
    expect(await queued()).toEqual([]);
    expect(api.push).not.toHaveBeenCalled();
    expect((await db.identities.get('private'))?.name).toBe('Private');
  });

  it.each(['theirs', 'mine'] as const)('resolves an identity conflict by keeping %s', async choice => {
    await db.identities.add(identity('dana', 'Mine'));
    const serverData = { ...identity('dana', 'Theirs'), details: [], version: 3, createdAt: '2026-11-21T10:00:00.000Z', updatedAt: '2026-11-21T10:00:00.000Z' };
    api.push.mockResolvedValueOnce({ results: [{ table: 'identities', entityId: 'dana', status: 'conflict', serverVersion: 3, serverData }] });
    const onConflict = vi.fn(); engine.setConflictHandler(onConflict);
    await engine.sync();
    const [[conflicts]] = onConflict.mock.calls;
    expect(conflicts).toEqual([expect.objectContaining({ table: 'identities', entityId: 'dana', status: 'conflict' })]);
    api.push.mockClear();
    await engine.resolveConflicts(conflicts, choice);
    if (choice === 'theirs') {
      expect(await db.identities.get('dana')).toMatchObject({ name: 'Theirs', details: [] });
      expect(await queued()).toEqual([]);
    } else {
      // Mine is retried against the revision the analyst reviewed.
      expect(await db.identities.get('dana')).toMatchObject({ name: 'Mine' });
      await engine.sync();
      expect(api.push.mock.calls[0][0]).toEqual([expect.objectContaining({ entityId: 'dana', clientVersion: 3, data: expect.objectContaining({ name: 'Mine' }) })]);
    }
    expect((await db.table('_syncMeta').get(revisionKey('identities', 'dana')))?.value).toBe(choice === 'theirs' ? 3 : 1);
  });

  it('keeps an identity that exists only here when another member deletes its investigation, and reports it', async () => {
    await db.identities.add(identity('only-here', 'Only Here'));
    api.pull.mockResolvedValueOnce({ changes: [{ table: 'folders', op: 'delete', id: 'f1', version: 3 }], cursor: '9', hasMore: false, tables: CURRENT_SERVER });
    api.push.mockImplementation(async (changes: Array<{ table: string; entityId: string }>) => ({
      results: changes.map(change => ({ table: change.table, entityId: change.entityId, status: 'rejected' })),
    }));
    const onConflict = vi.fn(); engine.setConflictHandler(onConflict);
    await engine.sync();
    // Not deleted silently: the row and its queued change stay, and the refusal is shown (as for a note).
    expect(await db.folders.get('f1')).toBeUndefined();
    expect(await db.identities.get('only-here')).toMatchObject({ name: 'Only Here', folderId: 'f1' });
    expect(await queued()).toEqual(['identities:only-here']);
    expect(onConflict.mock.calls[0][0]).toEqual([expect.objectContaining({ table: 'identities', entityId: 'only-here', status: 'rejected' })]);
  });

  it('removes synced identities with the offline copy of their investigation', async () => {
    await db.transaction('rw', db.identities, async () => {
      suppressSyncInCurrentTransaction();
      await db.identities.add(identity('dana', 'Dana Okafor'));
    });
    await evictSyncedFolder('f1');
    expect(await db.identities.count()).toBe(0);
  });
});
