/** A merge folded after a teammate edited the merged-away identity, then "Theirs" on the kept identity:
 * the teammate's version comes back, not this device's copy from before the merge (found by the F8 re-audit). */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import { db } from '../db';
import { disableSync, revisionKey, suppressSyncInCurrentTransaction, SYNC_TABLES } from '../lib/sync-state';
import { setSessionKey } from '../lib/encryptionMiddleware';
import { clearEncryptionMeta } from '../lib/encryptionStore';
import { SyncEngine } from '../lib/sync-engine';
import { ensureSyncWorkspace } from '../lib/sync-workspace';
import { useIdentities } from '../hooks/useIdentities';
import type { Identity } from '../types';

const api = vi.hoisted(() => ({ push: vi.fn(), pull: vi.fn() }));
vi.mock('../lib/server-api', () => ({
  syncPush: api.push,
  syncPull: async (...args: unknown[]) => ({ generation: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', ...await api.pull(...args) }),
}));

const base = (id: string, name: string, extra: Partial<Identity> = {}): Identity => ({ id, folderId: 'f1', type: 'person', name, aliases: [],
  details: [], connections: [], tags: [], trashed: false, archived: false, createdAt: 1, updatedAt: 1, ...extra });
const keep = base('keep', 'Dana Okafor');
const gone = base('gone', 'D. Okafor-Reyes', { aliases: ['dokafor'], details: [{ id: 'g1', label: 'Phone', value: '+1 555 0100', private: true }] });
const other = base('other', 'Lee Park', { connections: [{ targetId: 'gone', label: 'reports to' }] });
const stamp = { createdAt: '2026-11-21T10:00:00.000Z', updatedAt: '2026-11-21T10:00:00.000Z' };

type Row = { version: number; data?: Record<string, unknown>; deleted?: boolean };
let server: Map<string, Row>;
let engine: SyncEngine;
const sent = () => api.push.mock.calls.flatMap(([changes]) => changes as Array<{ table: string; entityId: string; op: string; clientVersion: number }>);

async function seed(rows: Identity[], revisions: Record<string, number>) {
  await db.transaction('rw', [...SYNC_TABLES.map(name => db.table(name)), db.table('_syncMeta'), db.table('_syncQueue')], async () => {
    suppressSyncInCurrentTransaction();
    await db.folders.add({ id: 'f1', name: 'Case', order: 0, createdAt: 1, updatedAt: 1 } as never);
    await db.identities.bulkAdd(rows);
    await db.table('_syncMeta').bulkPut([
      { key: 'syncHistoryGenerationV1', value: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' },
      { key: 'syncCursorV2', value: '100' }, { key: 'syncCursorTablesV1', value: [...SYNC_TABLES] }, { key: 'initialPushDoneV2', value: true },
      { key: 'syncServerTablesV1', value: [...SYNC_TABLES] },
      { key: revisionKey('folders', 'f1'), value: 1 },
      ...Object.entries(revisions).map(([id, value]) => ({ key: revisionKey('identities', id), value })),
    ]);
  });
}

beforeEach(async () => {
  disableSync();
  setSessionKey(null);
  await db.transaction('rw', db.tables, async () => { for (const table of db.tables) await table.clear(); });
  vi.clearAllMocks();
  await ensureSyncWorkspace('https://test.invalid', 'u1');
  server = new Map();
  api.pull.mockImplementation(async (_since, _folder, cursor) => ({ changes: [], cursor, hasMore: false, tables: [...SYNC_TABLES] }));
  // The revision rule of processPush (as in identity-multi-row-sync.test.ts).
  api.push.mockImplementation(async (changes: Array<{ table: string; entityId: string; op: string; clientVersion: number; data?: Record<string, unknown> }>) => ({
    results: changes.map(change => {
      const key = `${change.table}:${change.entityId}`;
      const current = server.get(key);
      if (current?.deleted && change.op === 'delete') return { table: change.table, entityId: change.entityId, status: 'accepted', serverVersion: current.version, unchanged: true };
      if (current && change.clientVersion !== current.version) {
        return { table: change.table, entityId: change.entityId, status: 'conflict', serverVersion: current.version, serverData: current.deleted ? { id: change.entityId, deletedAt: stamp.updatedAt } : current.data };
      }
      const version = (current?.version ?? 0) + 1;
      server.set(key, { version, data: change.data ? { ...change.data, version, ...stamp } : current?.data, deleted: change.op === 'delete' });
      return { table: change.table, entityId: change.entityId, status: 'accepted', serverVersion: version };
    }),
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

describe('a fold, then Keep theirs on the kept identity', () => {
  beforeEach(async () => {
    await seed([keep, gone, other], { keep: 1, gone: 1, other: 1 });
    server.set('identities:keep', { version: 1, data: { ...keep, version: 1, ...stamp } });
    server.set('identities:gone', { version: 1, data: { ...gone, version: 1, ...stamp } });
    server.set('identities:other', { version: 1, data: { ...other, version: 1, ...stamp } });
  });

  it('brings the merged-away identity back as the teammate has it, their edit included', async () => {
    await merge();
    const onConflict = vi.fn(); engine.setConflictHandler(onConflict);
    await engine.sync(); // the kept identity's put is accepted (v2); what waited is released
    // A teammate adds an email to the merged-away identity.
    server.set('identities:gone', { version: 2, data: { ...gone, details: [...gone.details, { id: 't1', label: 'Email', value: 'dokafor@example.invalid' }], version: 2, ...stamp } });
    await engine.sync(); // its delete conflicts: folded into the kept identity, and its queue entries move to v2
    expect(onConflict).not.toHaveBeenCalled();
    // A teammate edits the kept identity before the fold's put reaches the server.
    server.set('identities:keep', { version: 3, data: { ...keep, description: 'Finance lead', version: 3, ...stamp } });
    await engine.sync();
    const conflicts = onConflict.mock.calls.at(-1)?.[0] as Array<{ entityId: string; mergedFrom?: string[] }>;
    // Labelled: "Theirs" cancels what is still waiting.
    expect(conflicts.map(conflict => [conflict.entityId, conflict.mergedFrom])).toEqual([['keep', ['D. Okafor-Reyes']]]);
    await engine.resolveConflicts(conflicts, 'theirs');
    onConflict.mockClear();
    for (let cycle = 0; cycle < 3; cycle++) await engine.sync();
    // The teammate's version goes back up at their revision: nothing of theirs is overwritten.
    expect(onConflict).not.toHaveBeenCalled();
    expect(sent().filter(change => change.entityId === 'gone').map(change => `${change.op}@${change.clientVersion}`)).toEqual(['delete@1', 'put@2']);
    const values = (row?: Row) => ((row?.data?.details ?? []) as Array<{ value: string }>).map(detail => detail.value);
    expect(values(server.get('identities:gone'))).toEqual(['+1 555 0100', 'dokafor@example.invalid']);
    expect(server.get('identities:gone')?.deleted).toBeFalsy();
    expect((await db.identities.get('gone'))?.details.map(detail => detail.value)).toEqual(['+1 555 0100', 'dokafor@example.invalid']);
    // The reconnection was already accepted, so it is not undone: Lee still reports to the kept identity.
    expect(server.get('identities:other')?.data?.connections).toEqual([{ targetId: 'keep', label: 'reports to' }]);
  });
});
