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
import { executeCheckpointedTool } from '../lib/checkpoints';
import { deleteEntitiesWithReferences } from '../lib/entity-relations';
import { disableSync } from '../lib/sync-state';
import { setSessionKey } from '../lib/encryptionMiddleware';
import { setEncryptionMeta, clearEncryptionMeta } from '../lib/encryptionStore';
import { SyncEngine } from '../lib/sync-engine';
import { ensureSyncWorkspace } from '../lib/sync-workspace';
import { evictSyncedFolder } from '../lib/sync-cache';
import { clearIgnoredNames } from '../lib/ignored-names';
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
    expect(holdsPhone(held.filter(entry => entry.entityId === 'dana'))).toBe(0);
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

  it('spends no per-entry reads on held entries in a sync cycle, and uploads one change each once the server takes identities', async () => {
    const sync = await onOlderServer();
    for (let i = 0; i < 20; i++) await db.identities.add(identity(`p${i}`, `Person ${i}`));
    await db.notes.add({ id: 'n1', folderId: 'f1', title: 'Note', content: 'x', tags: [], pinned: false, archived: false, trashed: false, createdAt: 1, updatedAt: 1 } as never);
    const localOnlyChecks = vi.spyOn(SyncEngine.prototype as unknown as { isLocalOnly: () => Promise<boolean> }, 'isLocalOnly');
    await sync.sync();
    const checkedTables = localOnlyChecks.mock.calls.map(call => (call as unknown[])[0]);
    expect(checkedTables).not.toContain('identities');
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
    expect(stored).not.toContain('f1');
    expect(result.current.isIgnored('f1', 'Jordan Reyes')).toBe(true);
  });
});
