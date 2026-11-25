/**
 * F2: personal data does not outlive its deletion on this device, and held sync changes stay small.
 * - On a team server that does not sync identities (2.0.4), changes held on this device are kept as
 *   one entry per identity, and nothing at all once an identity the server never stored is deleted;
 *   Remove Local Copy then works, and held entries cost no per-entry reads in a sync cycle.
 * - AI undo checkpoints go with the rows and chat threads they hold.
 * - Names ignored on this device are kept per investigation, forgotten when it is deleted, and
 *   stored encrypted when the workspace is.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import { db } from '../db';
import { executeCheckpointedTool, restoreCheckpoint } from '../lib/checkpoints';
import { deleteEntitiesWithReferences } from '../lib/entity-relations';
import { disableSync } from '../lib/sync-state';
import { setSessionKey } from '../lib/encryptionMiddleware';
import { setEncryptionMeta, clearEncryptionMeta } from '../lib/encryptionStore';
import { SyncEngine } from '../lib/sync-engine';
import { ensureSyncWorkspace } from '../lib/sync-workspace';
import { evictSyncedFolder } from '../lib/sync-cache';
import { compactHeldQueue } from '../lib/sync-outgoing';
import { LEGACY_SYNC_TABLES, revisionKey } from '../lib/sync-state';
import { clearIgnoredNames, forgetIgnoredNames, ignoreName, ignoredSnapshot, keepIgnoredNamesThroughDecryption, rewriteIgnoredNames, subscribeIgnored } from '../lib/ignored-names';
import { decryptField } from '../lib/crypto';
import { useIgnoredNames } from '../hooks/useIgnoredNames';
import { foundKey, ignoredHash } from '../lib/identity-model';
import { execTool } from './helpers/tool-exec';
import { useIdentities } from '../hooks/useIdentities';
import type { Identity, ToolUseBlock } from '../types';

const api = vi.hoisted(() => ({ push: vi.fn(), pull: vi.fn() }));
vi.mock('../lib/server-api', () => ({
  syncPush: api.push,
  syncPull: async (...args: unknown[]) => ({ generation: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', ...await api.pull(...args) }),
}));

const PHONE = '+1 555 0100';
const identity = (id: string, name: string): Identity => ({ id, folderId: 'f1', type: 'person', name, aliases: [],
  details: [{ id: 'd1', label: 'Phone', value: PHONE, private: true }], connections: [], tags: [], trashed: false, archived: false,
  createdAt: 1, updatedAt: 1 });
const tool = (name: string, input: Record<string, unknown>): ToolUseBlock => ({ type: 'tool_use', id: 'call', name, input });
const holdsPhone = (rows: unknown[]) => rows.filter(row => JSON.stringify(row).includes(PHONE)).length;
const identityEntries = async () => (await db.table('_syncQueue').toArray()).filter(entry => entry.table === 'identities');

let engine: SyncEngine | undefined;
beforeEach(async () => {
  disableSync();
  setSessionKey(null);
  await db.transaction('rw', db.tables, async () => { for (const table of db.tables) await table.clear(); });
  await db.folders.add({ id: 'f1', name: 'Case', order: 0, createdAt: 1 } as never);
  vi.clearAllMocks();
});
afterEach(() => { engine?.stop(); engine = undefined; disableSync(); });

/** A new client bound to a team server that does not list its tables (2.0.4): identities are held. */
async function onOlderServer(tables?: string[]) {
  api.pull.mockImplementation(async (_since, _folder, cursor) => ({ changes: [], cursor, hasMore: false, serverTimestamp: '', tables }));
  api.push.mockImplementation(async (changes: Array<{ table: string; entityId: string }>) => ({
    results: changes.map(change => ({ table: change.table, entityId: change.entityId, status: 'accepted', serverVersion: 1 })),
  }));
  engine = new SyncEngine();
  await ensureSyncWorkspace('https://test.invalid', 'u1');
  await db.table('_syncMeta').put({ key: 'syncHistoryGenerationV1', value: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' });
  engine.setWorkspaceIdentity('https://test.invalid', 'u1');
  return engine;
}

describe('changes held for a server that does not sync identities', () => {
  it('keeps one entry per identity, and none once one the server never stored is deleted', async () => {
    const sync = await onOlderServer();
    await db.identities.add(identity('dana', 'Dana Okafor'));
    await db.identities.add(identity('lee', 'Lee Park'));
    await sync.sync();
    for (let edit = 2; edit < 6; edit++) await db.identities.update('lee', { description: `edit ${edit}`, updatedAt: edit });
    await db.identities.update('dana', { details: [], updatedAt: 2 });
    await deleteEntitiesWithReferences({ identities: ['dana'] });
    await sync.sync();
    // Dana is gone without a trace; Lee is one entry, the latest edit, never uploaded.
    const held = await identityEntries();
    expect(held.map(entry => [entry.entityId, entry.op, entry.data?.description])).toEqual([['lee', 'put', 'edit 5']]);
    expect(api.push.mock.calls.flatMap(([changes]) => (changes as Array<{ table: string }>).map(change => change.table))).not.toContain('identities');
  });

  it('lets Remove Local Copy finish once the held identities are deleted, as its message advises', async () => {
    const sync = await onOlderServer();
    await db.identities.add(identity('dana', 'Dana Okafor'));
    await sync.sync();
    await expect(evictSyncedFolder('f1')).rejects.toThrow(/only on this device|kept on this device|held|Dana Okafor/i);
    await deleteEntitiesWithReferences({ identities: ['dana'] });
    await expect(evictSyncedFolder('f1')).resolves.toBeUndefined();
    expect(await identityEntries()).toEqual([]);
  });

  it('leaves no queued copy when the whole investigation is deleted', async () => {
    const sync = await onOlderServer();
    await db.identities.add(identity('dana', 'Dana Okafor'));
    await sync.sync();
    await deleteEntitiesWithReferences({ folders: ['f1'] }, 'f1');
    await sync.sync();
    expect(holdsPhone(await db.table('_syncQueue').toArray())).toBe(0);
  });

  it('keeps no earlier copy after a deletion or a hand edit while the server is unreachable', async () => {
    const sync = await onOlderServer();
    await sync.sync();
    api.pull.mockRejectedValue(new Error('offline'));
    await db.identities.add(identity('dana', 'Dana Okafor'));
    await db.identities.add(identity('lee', 'Lee Park'));
    for (let edit = 2; edit < 5; edit++) await db.identities.update('dana', { description: `edit ${edit}`, updatedAt: edit });
    await deleteEntitiesWithReferences({ identities: ['dana'] });
    const { result } = renderHook(() => useIdentities('f1'));
    await waitFor(() => expect(result.current.loadedSuccessfully).toBe(true));
    await act(async () => { await result.current.updateIdentity('lee', { details: [] }); });
    await waitFor(async () => expect((await identityEntries()).map(entry => entry.entityId)).toEqual(['lee']));
    expect(holdsPhone(await db.table('_syncQueue').toArray())).toBe(0);
    await expect(sync.sync()).resolves.toBeUndefined();
  });

  it('compacts by the rules push sends by: the latest operation, the first clientVersion, deletes of stored rows kept', async () => {
    const put = (entityId: string, clientVersion: number, description: string) => ({ table: 'identities', entityId, op: 'put', clientVersion, folderId: 'f1', data: { ...identity(entityId, entityId), description } });
    await db.table('_syncQueue').bulkAdd([
      put('stored', 4, 'a'), put('stored', 7, 'b'), { table: 'identities', entityId: 'stored', op: 'delete', clientVersion: 7, folderId: 'f1' },
      put('known', 0, 'a'), { table: 'identities', entityId: 'known', op: 'delete', clientVersion: 0, folderId: 'f1' },
      put('edited', 3, 'first'), put('edited', 5, 'latest'),
      put('new', 0, 'a'), { table: 'identities', entityId: 'new', op: 'delete', clientVersion: 0, folderId: 'f1' },
      { table: 'notes', entityId: 'n1', op: 'put', clientVersion: 1, folderId: 'f1', data: { id: 'n1' } },
      { table: 'notes', entityId: 'n1', op: 'put', clientVersion: 2, folderId: 'f1', data: { id: 'n1' } },
    ]);
    // The server stored "known" (its revision is recorded here), though its queued entries predate it.
    await db.table('_syncMeta').put({ key: revisionKey('identities', 'known'), value: 2 });
    await db.transaction('rw', ['_syncQueue', '_syncMeta'], () => compactHeldQueue(new Set(LEGACY_SYNC_TABLES)));
    const rest = (await db.table('_syncQueue').orderBy('seq').toArray()).map(entry => [entry.table, entry.entityId, entry.op, entry.clientVersion, entry.data?.description]);
    expect(rest).toEqual([
      ['identities', 'stored', 'delete', 4, undefined],
      ['identities', 'known', 'delete', 0, undefined],
      ['identities', 'edited', 'put', 3, 'latest'],
      ['notes', 'n1', 'put', 1, undefined],
      ['notes', 'n1', 'put', 2, undefined],
    ]);
  });

  it('acknowledges an uploaded backlog without rereading the queue for each change', async () => {
    const queueReads = async (count: number) => {
      await db.table('_syncQueue').clear();
      for (let i = 0; i < count; i++) await db.table('_syncQueue').add({ table: 'notes', entityId: `n${i}`, op: 'put', clientVersion: 0, folderId: 'f1',
        data: { id: `n${i}`, folderId: 'f1', title: 'Note', content: 'x', tags: [], pinned: false, archived: false, trashed: false, createdAt: 1, updatedAt: 1 } });
      const reads = vi.spyOn(db.table('_syncQueue'), 'toArray');
      await sync.sync();
      const calls = reads.mock.calls.length;
      reads.mockRestore();
      expect(await db.table('_syncQueue').count()).toBe(0);
      return calls;
    };
    const sync = await onOlderServer();
    expect(await queueReads(25)).toBe(await queueReads(5));
  });

  it('does not count held entries of a local-only investigation in the held notice', async () => {
    const sync = await onOlderServer();
    const notices: string[] = [];
    sync.setErrorHandler(message => { if (message) notices.push(message); });
    await db.folders.add({ id: 'f2', name: 'Private case', order: 1, createdAt: 1 } as never);
    await db.identities.add(identity('dana', 'Dana Okafor'));
    await db.identities.add({ ...identity('lee', 'Lee Park'), folderId: 'f2' });
    await db.folders.update('f2', { localOnly: true });
    await sync.sync();
    const held = notices.filter(notice => /items held back/.test(notice));
    expect(held.at(-1)).toMatch(/items held back: 1\)/);
  });

  it('spends no per-entry reads on held entries in a sync cycle, and uploads one change each once the server takes identities', async () => {
    const sync = await onOlderServer();
    for (let i = 0; i < 20; i++) await db.identities.add(identity(`p${i}`, `Person ${i}`));
    await db.notes.add({ id: 'n1', folderId: 'f1', title: 'Note', content: 'x', tags: [], pinned: false, archived: false, trashed: false, createdAt: 1, updatedAt: 1 } as never);
    const localOnlyChecks = vi.spyOn(SyncEngine.prototype as unknown as { isLocalOnly: () => Promise<boolean> }, 'isLocalOnly');
    await sync.sync();
    // Once per investigation (one here), not once for each of the 20 held entries.
    const checkedTables = localOnlyChecks.mock.calls.map(call => (call as unknown[])[0]);
    expect(checkedTables.filter(table => table === 'identities')).toHaveLength(1);
    localOnlyChecks.mockRestore();
    for (let i = 0; i < 20; i++) await db.identities.update(`p${i}`, { description: 'changed', updatedAt: 3 });
    // The server is upgraded: it now lists identities.
    sync.stop();
    const upgraded = await onOlderServer(['notes', 'tasks', 'folders', 'tags', 'timelineEvents', 'timelines', 'whiteboards', 'standaloneIOCs', 'chatThreads', 'evidenceItems', 'identities']);
    await upgraded.sync();
    const uploaded = api.push.mock.calls.flatMap(([changes]) => (changes as Array<{ table: string; entityId: string }>)).filter(change => change.table === 'identities');
    expect(uploaded).toHaveLength(20);
    expect(await identityEntries()).toEqual([]);
  });
});

describe('AI undo checkpoints', () => {
  const checkpoint = async (id: string, threadId: string) => {
    const call = tool('update_identity', { id: 'dana', status: 'compromised' });
    expect((await executeCheckpointedTool({ id, threadId, messageId: `m-${id}` }, call, () => execTool(call, 'f1'))).isError).toBe(false);
  };

  it('go with the identity they hold, whichever way it is deleted', async () => {
    await db.identities.bulkAdd([identity('dana', 'Dana Okafor'), identity('lee', 'Lee Park')]);
    await checkpoint('cp1', 'thread1');
    expect(holdsPhone(await db.checkpoints.toArray())).toBe(1);
    await deleteEntitiesWithReferences({ identities: ['dana'] });
    expect(await db.checkpoints.count()).toBe(0);
  });

  it('go with a merged-away identity, the chat thread they belong to, and the investigation', async () => {
    await db.identities.bulkAdd([identity('dana', 'Dana Okafor'), identity('lee', 'Lee Park')]);
    await checkpoint('cp1', 'thread1');
    const { result } = renderHook(() => useIdentities('f1'));
    await waitFor(() => expect(result.current.loadedSuccessfully).toBe(true));
    await act(async () => { await result.current.mergeIdentities('lee', 'dana'); });
    expect(await db.checkpoints.count()).toBe(0);
    await db.identities.add(identity('dana', 'Dana Okafor'));
    await db.chatThreads.add({ id: 'thread2', folderId: 'f1', title: 't', messages: [], tags: [], createdAt: 1, updatedAt: 1 } as never);
    await checkpoint('cp2', 'thread2');
    await db.identities.update('dana', { updatedAt: 9 }); // The checkpoint can no longer apply, but its thread still holds it.
    await deleteEntitiesWithReferences({ chatThreads: ['thread2'] });
    expect(await db.checkpoints.count()).toBe(0);
    await checkpoint('cp3', 'thread3');
    await deleteEntitiesWithReferences({ folders: ['f1'] }, 'f1');
    expect(await db.checkpoints.count()).toBe(0);
  });
});

describe('AI undo checkpoints and changes from the team', () => {
  const ALL = ['notes', 'tasks', 'folders', 'tags', 'timelineEvents', 'timelines', 'whiteboards', 'standaloneIOCs', 'chatThreads', 'evidenceItems', 'identities'];
  const checkpoint = async () => {
    const call = tool('update_identity', { id: 'dana', status: 'compromised' });
    expect((await executeCheckpointedTool({ id: 'cp1', threadId: 'thread1', messageId: 'm1' }, call, () => execTool(call, 'f1'))).isError).toBe(false);
  };

  it('go when a teammate deletes the identity, and a deleted investigation forgets its ignored names', async () => {
    const sync = await onOlderServer(ALL);
    await db.identities.add(identity('dana', 'Dana Okafor'));
    await checkpoint();
    await sync.sync();
    expect(await db.checkpoints.count()).toBe(1);
    await ignoreName('f1', 'Jordan Reyes');
    let pulled = false;
    api.pull.mockImplementation(async (_since, _folder, cursor) => (pulled ? { changes: [], cursor, hasMore: false, serverTimestamp: '', tables: ALL }
      : (pulled = true, { changes: [{ table: 'identities', op: 'delete', id: 'dana', version: 2, folderId: 'f1' }, { table: 'folders', op: 'delete', id: 'f1', version: 2 }], cursor: '9', hasMore: false, serverTimestamp: '', tables: ALL })));
    await sync.sync();
    expect(await db.identities.get('dana')).toBeUndefined();
    expect(await db.checkpoints.count()).toBe(0);
    expect(localStorage.getItem('threatcaddy-identities-ignored-v3')).toBeNull();
  });

  it('go when a teammate edits the identity, but not on the echo of this device\'s own change', async () => {
    const sync = await onOlderServer(ALL);
    await db.identities.add(identity('dana', 'Dana Okafor'));
    await sync.sync();
    await checkpoint();
    await sync.sync();
    const echo = { ...(await db.identities.get('dana')), table: 'identities', op: 'put', createdBy: 'u1', updatedBy: 'u1', deletedAt: null };
    let next: Array<Record<string, unknown>> = [];
    let served = 10;
    api.pull.mockImplementation(async () => {
      const changes = next;
      next = [];
      return { changes, cursor: String(++served), hasMore: false, serverTimestamp: '', tables: ALL };
    });
    next = [{ ...echo, version: 1 }];
    await sync.sync();
    expect(await db.checkpoints.count()).toBe(1);
    next = [{ ...echo, details: [], updatedBy: 'u2', version: 3 }];
    await sync.sync();
    expect((await db.identities.get('dana'))?.details).toEqual([]);
    expect(await db.checkpoints.count()).toBe(0);
  });

  it('go when Keep theirs deletes the identity', async () => {
    const sync = await onOlderServer(ALL);
    await db.identities.add(identity('dana', 'Dana Okafor'));
    await checkpoint();
    await sync.resolveConflicts([{ table: 'identities', entityId: 'dana', serverVersion: 2 }], 'theirs');
    expect(await db.identities.get('dana')).toBeUndefined();
    expect(await db.checkpoints.count()).toBe(0);
  });

  it('go when the analyst edits the identity by hand (a private detail edited out leaves no copy)', async () => {
    await db.identities.add(identity('dana', 'Dana Okafor'));
    await checkpoint();
    const { result } = renderHook(() => useIdentities('f1'));
    await waitFor(() => expect(result.current.loadedSuccessfully).toBe(true));
    await act(async () => { await result.current.updateIdentity('dana', { details: [] }); });
    expect(await db.checkpoints.count()).toBe(0);
  });

  it('go when Remove Local Copy removes the investigation from this device', async () => {
    const sync = await onOlderServer(ALL);
    await db.identities.add(identity('dana', 'Dana Okafor'));
    await checkpoint();
    await sync.sync();
    expect(await db.checkpoints.count()).toBe(1);
    await evictSyncedFolder('f1');
    expect(await db.identities.get('dana')).toBeUndefined();
    expect(await db.checkpoints.count()).toBe(0);
  });

  it('keep no copy of an identity the AI created once that is undone', async () => {
    const call = tool('create_identity', { name: 'Dana Okafor', type: 'person', details: [{ label: 'Phone', value: PHONE, private: true }] });
    expect((await executeCheckpointedTool({ id: 'cp9', threadId: 'thread1', messageId: 'm9' }, call, () => execTool(call, 'f1'))).isError).toBe(false);
    expect(holdsPhone(await db.checkpoints.toArray())).toBe(1);
    expect(await restoreCheckpoint('cp9')).toBe(true);
    expect(await db.identities.count()).toBe(0);
    expect(holdsPhone(await db.checkpoints.toArray())).toBe(0);
    expect(JSON.stringify(await db.checkpoints.toArray())).not.toContain('Dana Okafor');
    // Still marked as undone: a later write in the same turn is refused.
    expect((await db.checkpoints.get('cp9'))?.restored).toBe(true);
  });

  it('are not read for deletions they cannot hold', async () => {
    await db.identities.add(identity('dana', 'Dana Okafor'));
    await checkpoint();
    await db.whiteboards.add({ id: 'w1', folderId: 'f1', name: 'Board', elements: '[]', tags: [], trashed: false, archived: false, createdAt: 1, updatedAt: 1 } as never);
    const reads = vi.spyOn(db.checkpoints, 'toArray');
    await deleteEntitiesWithReferences({ whiteboards: ['w1'] });
    expect(reads).not.toHaveBeenCalled();
    reads.mockRestore();
    expect(await db.checkpoints.count()).toBe(1);
  });
});

describe('names ignored on this device', () => {
  afterEach(() => { clearIgnoredNames(); clearEncryptionMeta(); setSessionKey(null); });

  it('are kept per investigation and forgotten when it is deleted', async () => {
    clearIgnoredNames();
    const { result } = renderHook(() => useIgnoredNames());
    act(() => { result.current.ignore('f1', 'Jordan Reyes'); result.current.ignore('f2', 'Sam Lee'); });
    await waitFor(() => expect(localStorage.getItem('threatcaddy-identities-ignored-v3')).toContain('f2'));
    expect(result.current.isIgnored('f1', 'Jordan Reyes')).toBe(true);
    await deleteEntitiesWithReferences({ folders: ['f1'] }, 'f1');
    await waitFor(() => expect(result.current.isIgnored('f1', 'Jordan Reyes')).toBe(false));
    expect(result.current.isIgnored('f2', 'Sam Lee')).toBe(true);
    expect(localStorage.getItem('threatcaddy-identities-ignored-v3')).not.toContain(ignoredHash(foundKey('f1', 'Jordan Reyes')));
  });

  it('are stored encrypted when the workspace is, so a guessed name cannot be checked while it is locked', async () => {
    clearIgnoredNames();
    const key = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
    setEncryptionMeta({ version: 1, salt: 'fixture-salt', wrappedKey: 'fixture-wrapped', recoverySalt: 'fixture-recovery-salt', recoveryWrappedKey: 'fixture-recovery-key', enabledAt: 1 } as never);
    setSessionKey(key);
    const { result } = renderHook(() => useIgnoredNames());
    act(() => { result.current.ignore('f1', 'Jordan Reyes'); });
    await waitFor(() => expect(localStorage.getItem('threatcaddy-identities-ignored-v3')).toContain('"enc"'));
    const stored = localStorage.getItem('threatcaddy-identities-ignored-v3') ?? '';
    expect(stored).not.toContain(ignoredHash(foundKey('f1', 'Jordan Reyes')));
    // Only ciphertext is stored: no investigation id. (Random base64 can hold the letters "f1", so the
    // check is on the stored shape and on the id as a JSON string, not on a substring.)
    expect(JSON.parse(stored)).toEqual({ v: 3, enc: { __enc: 1, ct: expect.any(String), iv: expect.any(String), json: true } });
    expect(stored).not.toContain('"f1"');
    expect(result.current.isIgnored('f1', 'Jordan Reyes')).toBe(true);
  });

  describe('in an encrypted workspace', () => {
    let key: CryptoKey;
    const KEY = 'threatcaddy-identities-ignored-v3';
    const stored = async () => {
      const raw = JSON.parse(localStorage.getItem(KEY) ?? '{}');
      return (raw.enc ? await decryptField(raw.enc, key) : raw.folders) as Record<string, string[]>;
    };
    const hash = (folderId: string, name: string) => ignoredHash(foundKey(folderId, name));
    beforeEach(async () => {
      clearIgnoredNames();
      key = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
      setEncryptionMeta({ version: 1, salt: 'fixture-salt', wrappedKey: 'fixture-wrapped', recoverySalt: 'fixture-recovery-salt', recoveryWrappedKey: 'fixture-recovery-key', enabledAt: 1 } as never);
      setSessionKey(key);
      await ignoreName('f1', 'Jordan Reyes');
      await ignoreName('f2', 'Sam Lee');
    });
    /** As after a reload: the encrypted list is stored, and nothing has decoded it yet. */
    const reload = () => { const raw = localStorage.getItem(KEY) ?? ''; clearIgnoredNames(); localStorage.setItem(KEY, raw); };

    it('forgets a deleted investigation even before anything has decoded the list', async () => {
      reload();
      await forgetIgnoredNames(['f1']);
      expect(await stored()).toEqual({ f2: [hash('f2', 'Sam Lee')] });
    });

    it('keeps the earlier names when one is ignored while the list is still decoding', async () => {
      reload();
      const { result } = renderHook(() => useIgnoredNames());
      act(() => { result.current.ignore('f3', 'Ana Ruiz'); });
      await waitFor(async () => expect(Object.keys(await stored()).sort()).toEqual(['f1', 'f2', 'f3']));
      await waitFor(() => expect(result.current.isIgnored('f1', 'Jordan Reyes')).toBe(true));
    });

    it('keeps both of two quick ignores', async () => {
      await Promise.all([ignoreName('f1', 'Ana Ruiz'), ignoreName('f1', 'Bo Chen')]);
      expect((await stored()).f1.sort()).toEqual([hash('f1', 'Jordan Reyes'), hash('f1', 'Ana Ruiz'), hash('f1', 'Bo Chen')].sort());
    });

    it('keeps the list, as plain hashes, when encryption is turned off', async () => {
      await keepIgnoredNamesThroughDecryption(async () => { clearEncryptionMeta(); setSessionKey(null); });
      expect(JSON.parse(localStorage.getItem(KEY) ?? '{}').folders).toEqual({ f1: [hash('f1', 'Jordan Reyes')], f2: [hash('f2', 'Sam Lee')] });
      const { result } = renderHook(() => useIgnoredNames());
      expect(result.current.isIgnored('f1', 'Jordan Reyes')).toBe(true);
    });

    it('stores a plain list encrypted after the read that finds it, not during it (a snapshot must not notify)', async () => {
      localStorage.removeItem(KEY);
      setEncryptionMeta({ version: 1, salt: 'fixture-salt', wrappedKey: 'fixture-wrapped', recoverySalt: 'fixture-recovery-salt', recoveryWrappedKey: 'fixture-recovery-key', enabledAt: 1 } as never);
      setSessionKey(key);
      const listener = vi.fn();
      const unsubscribe = subscribeIgnored(listener);
      ignoredSnapshot();
      // Another tab, on a build without encryption, writes a plain list; a component reads it while rendering.
      localStorage.setItem(KEY, JSON.stringify({ v: 3, folders: { f1: [hash('f1', 'Jordan Reyes')] } }));
      ignoredSnapshot();
      // React calls the snapshot while rendering: telling subscribers then would update other components mid-render.
      expect(listener).not.toHaveBeenCalled();
      await waitFor(() => expect(localStorage.getItem(KEY)).toContain('"enc"'));
      expect(listener).toHaveBeenCalled();
      unsubscribe();
    });

    it('stores a plain list encrypted once encryption is turned on', async () => {
      await keepIgnoredNamesThroughDecryption(async () => { clearEncryptionMeta(); setSessionKey(null); });
      setEncryptionMeta({ version: 1, salt: 'fixture-salt', wrappedKey: 'fixture-wrapped', recoverySalt: 'fixture-recovery-salt', recoveryWrappedKey: 'fixture-recovery-key', enabledAt: 1 } as never);
      setSessionKey(key);
      await rewriteIgnoredNames();
      const raw = localStorage.getItem(KEY) ?? '';
      expect(raw).toContain('"enc"');
      expect(raw).not.toContain(hash('f1', 'Jordan Reyes'));
    });
  });

  it('drop the plain list an earlier build kept (v2) when the page loads', async () => {
    localStorage.setItem('threatcaddy-identities-ignored-v2', JSON.stringify([ignoredHash(foundKey('f1', 'Jordan Reyes'))]));
    vi.resetModules();
    const fresh = await import('../lib/ignored-names');
    fresh.ignoredSnapshot();
    expect(localStorage.getItem('threatcaddy-identities-ignored-v2')).toBeNull();
  });
});
