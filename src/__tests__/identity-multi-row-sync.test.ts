/**
 * F3: local actions that change several rows, uploaded over sync.
 * - DATA-1: a merge's delete and reconnections wait until the kept identity's change is accepted.
 *   Keeping a teammate's version of the kept identity cancels the merge (nothing is lost); a teammate's
 *   change to the merged-away identity is merged too.
 * - DATA-2: trash the server holds is purged only after this session's first pull.
 * - DATA-3: deleting an investigation uploads its delete; its items' deletes are covered by it.
 * The mock server applies the revision rule of server/src/services/sync-service.ts processPush.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import { db } from '../db';
import { disableSync, revisionKey, suppressSyncInCurrentTransaction, SYNC_TABLES } from '../lib/sync-state';
import { setSessionKey } from '../lib/encryptionMiddleware';
import { setEncryptionMeta, clearEncryptionMeta } from '../lib/encryptionStore';
import { SyncEngine } from '../lib/sync-engine';
import { ensureSyncWorkspace } from '../lib/sync-workspace';
import { deleteEntitiesWithReferences } from '../lib/entity-relations';
import { useIdentities } from '../hooks/useIdentities';
import type { Identity } from '../types';

const api = vi.hoisted(() => ({ push: vi.fn(), pull: vi.fn() }));
vi.mock('../lib/server-api', () => ({
  syncPush: api.push,
  syncPull: async (...args: unknown[]) => ({ generation: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', ...await api.pull(...args) }),
}));

const DAY = 86_400_000;
const base = (id: string, name: string, extra: Partial<Identity> = {}): Identity => ({ id, folderId: 'f1', type: 'person', name, aliases: [],
  details: [], connections: [], tags: [], trashed: false, archived: false, createdAt: 1, updatedAt: 1, ...extra });
const keep = base('keep', 'Dana Okafor');
const gone = base('gone', 'D. Okafor-Reyes', { aliases: ['dokafor'], details: [{ id: 'g1', label: 'Phone', value: '+1 555 0100', private: true }] });
const other = base('other', 'Lee Park', { connections: [{ targetId: 'gone', label: 'reports to' }] });
const stamp = { createdAt: '2026-11-21T10:00:00.000Z', updatedAt: '2026-11-21T10:00:00.000Z' };

type Row = { version: number; data?: Record<string, unknown>; deleted?: boolean };
let server: Map<string, Row>;
/** 2.0.4 refuses an item's delete once its investigation is deleted; the current server accepts it. */
let legacyServer = false;
let engine: SyncEngine;
const sent = () => api.push.mock.calls.flatMap(([changes]) => changes as Array<{ table: string; entityId: string; op: string }>);
const sentKeys = () => sent().map(change => `${change.op} ${change.entityId}`);

async function seed(rows: Identity[], revisions: Record<string, number>) {
  await db.transaction('rw', [...SYNC_TABLES.map(name => db.table(name)), db.table('_syncMeta'), db.table('_syncQueue')], async () => {
    suppressSyncInCurrentTransaction();
    await db.folders.add({ id: 'f1', name: 'Case', order: 0, createdAt: 1, updatedAt: 1 } as never);
    await db.identities.bulkAdd(rows);
    await db.table('_syncMeta').bulkPut([
      { key: 'syncHistoryGenerationV1', value: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' },
      { key: 'syncCursorV2', value: '100' }, { key: 'syncCursorTablesV1', value: [...SYNC_TABLES] }, { key: 'initialPushDoneV2', value: true },
      { key: revisionKey('folders', 'f1'), value: 1 },
      ...Object.entries(revisions).map(([id, value]) => ({ key: revisionKey('identities', id), value })),
    ]);
  });
}

beforeEach(async () => {
  disableSync();
  setSessionKey(null);
  legacyServer = false;
  await db.transaction('rw', db.tables, async () => { for (const table of db.tables) await table.clear(); });
  vi.clearAllMocks();
  await ensureSyncWorkspace('https://test.invalid', 'u1');
  server = new Map();
  api.pull.mockImplementation(async (_since, _folder, cursor) => ({ changes: [], cursor, hasMore: false, tables: [...SYNC_TABLES] }));
  api.push.mockImplementation(async (changes: Array<{ table: string; entityId: string; op: string; clientVersion: number; data?: Record<string, unknown> }>) => ({
    results: [...changes].sort((a, b) => Number(b.table === 'folders') - Number(a.table === 'folders')).map(change => {
      const key = `${change.table}:${change.entityId}`;
      const current = server.get(key);
      const folder = server.get(`folders:${change.data?.folderId ?? 'f1'}`);
      if (change.table !== 'folders' && folder?.deleted && (legacyServer || change.op !== 'delete')) return { table: change.table, entityId: change.entityId, status: 'rejected' };
      if (current?.deleted && change.op === 'delete') return { table: change.table, entityId: change.entityId, status: 'accepted', serverVersion: current.version, unchanged: true };
      if (current && change.clientVersion !== current.version && !(change.op === 'delete' && folder?.deleted)) {
        return { table: change.table, entityId: change.entityId, status: 'conflict', serverVersion: current.version, serverData: current.deleted ? { id: change.entityId, deletedAt: stamp.updatedAt } : current.data };
      }
      const version = (current?.version ?? 0) + 1;
      server.set(key, { version, data: change.data ? { ...change.data, version, ...stamp } : current?.data, deleted: change.op === 'delete' });
      return { table: change.table, entityId: change.entityId, status: 'accepted', serverVersion: version };
    }).sort((a, b) => changes.findIndex(change => change.entityId === a.entityId) - changes.findIndex(change => change.entityId === b.entityId)),
  }));
  engine = new SyncEngine();
  engine.setWorkspaceIdentity('https://test.invalid', 'u1');
});
afterEach(() => { engine.stop(); disableSync(); clearEncryptionMeta(); setSessionKey(null); });

async function merge() {
  const hook = renderHook(() => useIdentities('f1'));
  await waitFor(() => expect(hook.result.current.loadedSuccessfully).toBe(true));
  await act(async () => { await hook.result.current.mergeIdentities('keep', 'gone'); });
  hook.unmount();
}

describe('DATA-1: a merge over sync', () => {
  beforeEach(async () => {
    await seed([keep, gone, other], { keep: 1, gone: 1, other: 1 });
    server.set('identities:keep', { version: 1, data: { ...keep, version: 1, ...stamp } });
    server.set('identities:gone', { version: 1, data: { ...gone, version: 1, ...stamp } });
    server.set('identities:other', { version: 1, data: { ...other, version: 1, ...stamp } });
  });

  it('sends the merged-away delete and the reconnection only after the kept identity is accepted', async () => {
    await merge();
    await engine.sync();
    expect(sentKeys()).toEqual(['put keep']);
    expect(server.get('identities:gone')?.deleted).toBeFalsy();
    await engine.sync();
    expect(sentKeys().slice(1).sort()).toEqual(['delete gone', 'put other']);
    expect(server.get('identities:gone')?.deleted).toBe(true);
    expect(await db.table('_syncQueue').count()).toBe(0);
  });

  it('labels the kept identity\'s conflict as a merge, and Keep theirs cancels the merge without losing anything', async () => {
    server.set('identities:keep', { version: 2, data: { ...keep, description: 'Finance lead', version: 2, ...stamp } });
    await merge();
    const onConflict = vi.fn(); engine.setConflictHandler(onConflict);
    await engine.sync();
    const conflicts = onConflict.mock.calls[0][0] as Array<{ entityId: string; status: string; mergedFrom?: string[] }>;
    expect(conflicts.map(conflict => [conflict.entityId, conflict.status, conflict.mergedFrom])).toEqual([['keep', 'conflict', ['D. Okafor-Reyes']]]);
    // Nothing of the merge reached the server.
    expect(sentKeys()).toEqual(['put keep']);
    await engine.resolveConflicts(conflicts, 'theirs');
    // Their kept identity; the merged-away identity back as it was; Lee reports to her again.
    expect((await db.identities.get('keep'))?.description).toBe('Finance lead');
    expect((await db.identities.get('keep'))?.aliases).toEqual([]);
    expect(await db.identities.get('gone')).toEqual(gone);
    expect((await db.identities.get('other'))?.connections).toEqual([{ targetId: 'gone', label: 'reports to' }]);
    await engine.sync();
    expect(server.get('identities:gone')?.deleted).toBeFalsy();
    expect(sentKeys()).not.toContain('delete gone');
    expect(server.get('identities:other')?.data?.connections).toEqual([{ targetId: 'gone', label: 'reports to' }]);
    expect(await db.table('_syncQueue').count()).toBe(0);
  });

  it('completes the merge with Keep mine', async () => {
    server.set('identities:keep', { version: 2, data: { ...keep, description: 'Finance lead', version: 2, ...stamp } });
    await merge();
    const onConflict = vi.fn(); engine.setConflictHandler(onConflict);
    await engine.sync();
    await engine.resolveConflicts(onConflict.mock.calls[0][0], 'mine');
    await engine.sync();
    await engine.sync();
    expect(server.get('identities:keep')?.data?.aliases).toEqual(['D. Okafor-Reyes', 'dokafor']);
    expect(server.get('identities:gone')?.deleted).toBe(true);
    expect(server.get('identities:other')?.data?.connections).toEqual([{ targetId: 'keep', label: 'reports to' }]);
  });

  it('merges a teammate\'s change to the merged-away identity too, instead of a conflict or a duplicate', async () => {
    server.set('identities:gone', { version: 2, data: { ...gone, details: [...gone.details, { id: 't1', label: 'Email', value: 'dokafor@example.invalid' }], version: 2, ...stamp } });
    await merge();
    const onConflict = vi.fn(); engine.setConflictHandler(onConflict);
    for (let cycle = 0; cycle < 4; cycle++) await engine.sync();
    expect(onConflict).not.toHaveBeenCalled();
    expect(server.get('identities:gone')?.deleted).toBe(true);
    const kept = server.get('identities:keep')?.data as unknown as Identity;
    expect(kept.details.map(detail => detail.value)).toEqual(['+1 555 0100', 'dokafor@example.invalid']);
    expect(await db.identities.count()).toBe(2);
    expect(await db.table('_syncQueue').count()).toBe(0);
  });

  it('asks for another cycle once what waited can go, never while it still waits', async () => {
    const schedule = vi.spyOn(SyncEngine.prototype as unknown as { scheduleSync: () => void }, 'scheduleSync');
    server.set('identities:keep', { version: 2, data: { ...keep, version: 2, ...stamp } });
    await merge();
    await engine.sync();
    expect(schedule).not.toHaveBeenCalled();
    // The teammate's change is undone on the server: the kept identity is accepted, and what waited can go.
    server.set('identities:keep', { version: 1, data: { ...keep, version: 1, ...stamp } });
    await engine.sync();
    expect(schedule).toHaveBeenCalledTimes(1);
    schedule.mockRestore();
  });

  it('keeps the merged-away copy encrypted in the queue when the workspace is encrypted', async () => {
    const key = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
    setEncryptionMeta({ version: 1, salt: 'fixture-salt', wrappedKey: 'fixture-wrapped', recoverySalt: 'fixture-recovery-salt', recoveryWrappedKey: 'fixture-recovery-key', enabledAt: 1 } as never);
    setSessionKey(key);
    await merge();
    const raw = await new Promise<Array<Record<string, unknown>>>((resolve, reject) => {
      const request = indexedDB.open(db.name);
      request.onsuccess = () => {
        const all = request.result.transaction('_syncQueue').objectStore('_syncQueue').getAll();
        all.onsuccess = () => { resolve(all.result); request.result.close(); };
        all.onerror = () => reject(all.error);
      };
    });
    const held = raw.filter(entry => entry.after);
    expect(held.map(entry => entry.entityId).sort()).toEqual(['gone', 'other']);
    expect(JSON.stringify(held)).not.toContain('+1 555 0100');
    expect(JSON.stringify(held)).not.toContain('Okafor-Reyes');
    const decoded = (await db.table('_syncQueue').toArray()).find(entry => entry.entityId === 'gone');
    expect(decoded?.restore).toEqual(gone);
  });
});

describe('DATA-3: deleting an investigation', () => {
  beforeEach(async () => {
    const people = Array.from({ length: 20 }, (_, i) => base(`p${i}`, `Person ${i}`));
    await seed(people, Object.fromEntries(people.map(person => [person.id, 1])));
    server.set('folders:f1', { version: 1, data: { id: 'f1', name: 'Case' } });
    for (const person of people) server.set(`identities:${person.id}`, { version: 1, data: { ...person, version: 1 } });
  });

  it.each([false, true])('uploads only the investigation\'s delete, and drops its items\' deletes once accepted (2.0.4 server: %s)', async legacy => {
    legacyServer = legacy;
    await deleteEntitiesWithReferences({ folders: ['f1'] }, 'f1');
    const onConflict = vi.fn(); engine.setConflictHandler(onConflict);
    await engine.sync();
    await engine.sync();
    expect(sentKeys()).toEqual(['delete f1']);
    expect(onConflict).not.toHaveBeenCalled();
    expect(await db.table('_syncQueue').count()).toBe(0);
  });

  it('keeps the items\' deletes when the investigation\'s delete is refused', async () => {
    api.push.mockImplementationOnce(async (changes: Array<{ table: string; entityId: string }>) => ({
      results: changes.map(change => ({ table: change.table, entityId: change.entityId, status: 'rejected' })),
    }));
    await deleteEntitiesWithReferences({ folders: ['f1'] }, 'f1');
    await engine.sync();
    expect(sentKeys()).toEqual(['delete f1']);
    expect((await db.table('_syncQueue').toArray()).filter(entry => entry.table === 'identities')).toHaveLength(20);
  });
});

describe('DATA-2: the 30-day purge on a second device', () => {
  const org = base('org', 'Synthetic Org', { type: 'organization', trashed: true, trashedAt: Date.now() - 31 * DAY });
  const members = Array.from({ length: 5 }, (_, i) => base(`m${i}`, `Member ${i}`, { connections: [{ targetId: 'org', label: 'works at' }] }));
  const local = base('local', 'Never synced', { trashed: true, trashedAt: Date.now() - 31 * DAY });

  beforeEach(async () => {
    await seed([org, ...members, local], { org: 2, ...Object.fromEntries(members.map(member => [member.id, 1])) });
    server.set('identities:org', { version: 3, deleted: true });
    for (const member of members) server.set(`identities:${member.id}`, { version: 2, data: { ...member, connections: [], version: 2, ...stamp } });
    // Device A's purge is in the log after this device's cursor.
    api.pull.mockImplementation(async (_since, _folder, cursor) => cursor === '100'
      ? { changes: [{ table: 'identities', op: 'delete', id: 'org', version: 3 },
        ...members.map(member => ({ table: 'identities', op: 'put', version: 2, ...member, connections: [], ...stamp }))], cursor: '200', hasMore: false, tables: [...SYNC_TABLES] }
      : { changes: [], cursor, hasMore: false, tables: [...SYNC_TABLES] });
  });

  it('purges only what the server does not hold before the first pull, then nothing conflicts', async () => {
    const hook = renderHook(() => useIdentities());
    await waitFor(() => expect(hook.result.current.loadedSuccessfully).toBe(true));
    expect(await db.identities.get('local')).toBeUndefined();
    expect(await db.identities.get('org')).toBeDefined();
    expect(await db.table('_syncQueue').count()).toBe(0);
    const onConflict = vi.fn(); engine.setConflictHandler(onConflict);
    const reloaded = vi.fn(); engine.setRemoteChangeHandler(reloaded);
    await engine.sync();
    // The pull brought device A's purge; the identities view reloads once the first pull is in.
    expect(await db.identities.get('org')).toBeUndefined();
    expect(reloaded.mock.calls.some(([, tables]) => (tables as Set<string>).has('identities'))).toBe(true);
    expect(onConflict).not.toHaveBeenCalled();
    expect(sent()).toEqual([]);
    hook.unmount();
  });

  it('purges what the server holds after the first pull', async () => {
    api.pull.mockImplementation(async (_since, _folder, cursor) => ({ changes: [], cursor, hasMore: false, tables: [...SYNC_TABLES] }));
    server.set('identities:org', { version: 2, data: { ...org, version: 2, ...stamp } });
    const hook = renderHook(() => useIdentities());
    await waitFor(() => expect(hook.result.current.loadedSuccessfully).toBe(true));
    expect(await db.identities.get('org')).toBeDefined();
    await engine.sync();
    await act(async () => { await hook.result.current.reload(); });
    expect(await db.identities.get('org')).toBeUndefined();
    hook.unmount();
  });
});
