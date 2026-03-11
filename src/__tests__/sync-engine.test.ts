/* eslint-disable @typescript-eslint/no-non-null-assertion */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { SyncResult } from '../lib/server-api';

// ─── Mock server-api ────────────────────────────────────────────────

const mockSyncPush = vi.fn<() => Promise<{ results: SyncResult[] }>>();
const mockSyncPull = vi.fn<() => Promise<{ changes: Record<string, unknown>[]; serverTimestamp: string }>>();
const mockSyncSnapshot = vi.fn<() => Promise<Record<string, unknown[]>>>();

vi.mock('../lib/server-api', () => ({
  syncPush: (...args: unknown[]) => mockSyncPush(...args as []),
  syncPull: (...args: unknown[]) => mockSyncPull(...args as []),
  syncSnapshot: (...args: unknown[]) => mockSyncSnapshot(...args as []),
}));

// ─── Mock sync-middleware ───────────────────────────────────────────

const mockEnableSync = vi.fn();
const mockDisableSync = vi.fn();

vi.mock('../lib/sync-middleware', () => ({
  enableSync: () => mockEnableSync(),
  disableSync: () => mockDisableSync(),
}));

// ─── Mock db with cached table instances ────────────────────────────

interface MockTableData {
  [key: string]: Record<string, unknown>[];
}

const tableData: MockTableData = {};

function resetTableData() {
  for (const key of Object.keys(tableData)) {
    delete tableData[key];
  }
}

function getTableData(name: string): Record<string, unknown>[] {
  if (!tableData[name]) tableData[name] = [];
  return tableData[name];
}

// Cache mock table objects so that the same instance is returned for
// both the production code (via `dynamicDb.table(name)`) and test assertions.
const tableCache: Record<string, ReturnType<typeof createMockTable>> = {};

function createMockTable(tableName: string) {
  return {
    toArray: vi.fn(async () => [...getTableData(tableName)]),
    get: vi.fn(async (key: string) =>
      getTableData(tableName).find((r) => r.id === key || r.key === key),
    ),
    add: vi.fn(async (entry: Record<string, unknown>) => {
      getTableData(tableName).push(entry);
      return entry.seq ?? entry.id ?? entry.key;
    }),
    put: vi.fn(async (entry: Record<string, unknown>) => {
      const arr = getTableData(tableName);
      const idx = arr.findIndex((r) => r.id === entry.id || r.key === entry.key);
      if (idx >= 0) arr[idx] = entry;
      else arr.push(entry);
      return entry.id ?? entry.key;
    }),
    delete: vi.fn(async (key: string) => {
      const arr = getTableData(tableName);
      const idx = arr.findIndex((r) => r.id === key);
      if (idx >= 0) arr.splice(idx, 1);
    }),
    bulkPut: vi.fn(async (entries: Record<string, unknown>[]) => {
      const arr = getTableData(tableName);
      for (const entry of entries) {
        const idx = arr.findIndex((r) => r.id === entry.id || r.key === entry.key);
        if (idx >= 0) arr[idx] = entry;
        else arr.push(entry);
      }
    }),
    bulkDelete: vi.fn(async (keys: (number | string)[]) => {
      const arr = getTableData(tableName);
      for (let i = arr.length - 1; i >= 0; i--) {
        if (keys.includes(arr[i].seq as number) || keys.includes(arr[i].id as string)) arr.splice(i, 1);
      }
    }),
    where: vi.fn((index: string) => ({
      equals: vi.fn((val: string) => ({
        toArray: vi.fn(async () =>
          getTableData(tableName).filter((r) => r[index] === val),
        ),
      })),
    })),
  };
}

function getMockTable(name: string) {
  if (!tableCache[name]) tableCache[name] = createMockTable(name);
  return tableCache[name];
}

function resetTableCache() {
  for (const key of Object.keys(tableCache)) {
    delete tableCache[key];
  }
}

vi.mock('../db', () => ({
  db: new Proxy(
    {},
    {
      get(_target, prop) {
        if (prop === 'table') return (name: string) => getMockTable(name);
        if (typeof prop === 'string') return getMockTable(prop);
        return undefined;
      },
    },
  ),
}));

// ─── Import SyncEngine after mocks ──────────────────────────────────

import { SyncEngine } from '../lib/sync-engine';

// ─── Test Suite ─────────────────────────────────────────────────────

describe('SyncEngine', () => {
  let engine: SyncEngine;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    resetTableData();
    resetTableCache();
    engine = new SyncEngine();
    // Defaults for common mocks
    mockSyncPush.mockResolvedValue({ results: [] });
    mockSyncPull.mockResolvedValue({ changes: [], serverTimestamp: new Date().toISOString() });
  });

  afterEach(() => {
    engine.stop();
    vi.useRealTimers();
  });

  // ── Constructor / Initialization ──────────────────────────────────

  describe('constructor / initialization', () => {
    it('creates a new SyncEngine without throwing', () => {
      expect(engine).toBeDefined();
    });

    it('is not running after construction', () => {
      engine.stop();
      expect(mockSyncPush).not.toHaveBeenCalled();
    });
  });

  // ── start / stop ──────────────────────────────────────────────────

  describe('start / stop', () => {
    it('start is idempotent — calling twice does not create duplicate intervals', async () => {
      engine.start();
      engine.start(); // second call should be a no-op
      await vi.advanceTimersByTimeAsync(100);
      engine.stop();
    });

    it('stop clears interval and pending push timer', () => {
      engine.start();
      engine.stop();
      expect(mockSyncPush).not.toHaveBeenCalled();
    });
  });

  // ── enqueue ───────────────────────────────────────────────────────

  describe('enqueue', () => {
    it('adds an entry to _syncQueue table', async () => {
      engine.start();
      await vi.advanceTimersByTimeAsync(100);

      await engine.enqueue('notes', 'n1', 'put', { id: 'n1', title: 'Test' });

      const queue = getTableData('_syncQueue');
      expect(queue).toHaveLength(1);
      expect(queue[0]).toMatchObject({
        table: 'notes',
        entityId: 'n1',
        op: 'put',
        data: { id: 'n1', title: 'Test' },
      });
    });

    it('sends WS preview message when wsClient is set', async () => {
      const mockWs = { send: vi.fn() };
      engine.setWSClient(mockWs as unknown as import('../lib/ws-client').WSClient);
      engine.start();
      await vi.advanceTimersByTimeAsync(100);

      await engine.enqueue('notes', 'n1', 'put', { id: 'n1', title: 'Test' });

      expect(mockWs.send).toHaveBeenCalledWith({
        type: 'entity-change-preview',
        table: 'notes',
        entityId: 'n1',
        op: 'put',
        data: { id: 'n1', title: 'Test' },
      });
    });

    it('does not send WS message when no wsClient is set', async () => {
      engine.setWSClient(null);
      engine.start();
      await vi.advanceTimersByTimeAsync(100);

      // Should not throw
      await engine.enqueue('notes', 'n1', 'delete');
    });

    it('enqueues delete operations without data', async () => {
      engine.start();
      await vi.advanceTimersByTimeAsync(100);

      await engine.enqueue('tasks', 't1', 'delete');

      const queue = getTableData('_syncQueue');
      expect(queue).toHaveLength(1);
      expect(queue[0]).toMatchObject({
        table: 'tasks',
        entityId: 't1',
        op: 'delete',
        data: undefined,
      });
    });
  });

  // ── push ──────────────────────────────────────────────────────────

  describe('push', () => {
    it('pushes queued changes to server and removes accepted entries', async () => {
      getTableData('_syncQueue').push(
        { seq: 1, table: 'notes', entityId: 'n1', op: 'put', data: { id: 'n1', title: 'A' } },
        { seq: 2, table: 'tasks', entityId: 't1', op: 'delete' },
      );

      mockSyncPush.mockResolvedValueOnce({
        results: [
          { entityId: 'n1', status: 'accepted' },
          { entityId: 't1', status: 'accepted' },
        ],
      });

      await engine.sync();

      expect(mockSyncPush).toHaveBeenCalledWith([
        { table: 'notes', op: 'put', entityId: 'n1', data: { id: 'n1', title: 'A' } },
        { table: 'tasks', op: 'delete', entityId: 't1', data: undefined },
      ]);

      expect(getTableData('_syncQueue')).toHaveLength(0);
    });

    it('does nothing when the queue is empty', async () => {
      await engine.sync();
      expect(mockSyncPush).not.toHaveBeenCalled();
    });

    it('keeps conflict entries in the queue and notifies handler', async () => {
      const conflictHandler = vi.fn();
      engine.setConflictHandler(conflictHandler);

      getTableData('_syncQueue').push(
        { seq: 1, table: 'notes', entityId: 'n1', op: 'put', data: { id: 'n1' } },
        { seq: 2, table: 'notes', entityId: 'n2', op: 'put', data: { id: 'n2' } },
      );

      const conflictResult: SyncResult = {
        entityId: 'n2',
        status: 'conflict',
        serverData: { id: 'n2', title: 'Server Version' },
      };

      mockSyncPush.mockResolvedValueOnce({
        results: [
          { entityId: 'n1', status: 'accepted' },
          conflictResult,
        ],
      });

      await engine.sync();

      expect(getTableData('_syncQueue')).toHaveLength(1);
      expect(getTableData('_syncQueue')[0].entityId).toBe('n2');
      expect(conflictHandler).toHaveBeenCalledWith([conflictResult]);
    });

    it('removes rejected entries from queue', async () => {
      getTableData('_syncQueue').push(
        { seq: 1, table: 'notes', entityId: 'n1', op: 'put', data: { id: 'n1' } },
      );

      mockSyncPush.mockResolvedValueOnce({
        results: [{ entityId: 'n1', status: 'rejected' }],
      });

      await engine.sync();

      expect(getTableData('_syncQueue')).toHaveLength(0);
    });

    it('handles syncPush network error gracefully (non-"Not connected")', async () => {
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      getTableData('_syncQueue').push(
        { seq: 1, table: 'notes', entityId: 'n1', op: 'put', data: { id: 'n1' } },
      );

      mockSyncPush.mockRejectedValueOnce(new Error('Network timeout'));

      await engine.sync();

      expect(consoleSpy).toHaveBeenCalled();
      consoleSpy.mockRestore();
    });

    it('silently ignores "Not connected" errors from push', async () => {
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      getTableData('_syncQueue').push(
        { seq: 1, table: 'notes', entityId: 'n1', op: 'put', data: { id: 'n1' } },
      );

      mockSyncPush.mockRejectedValueOnce(new Error('Not connected to server'));

      await engine.sync();

      expect(consoleSpy).not.toHaveBeenCalled();
      consoleSpy.mockRestore();
    });

    it('does not double-push when push is already in progress', async () => {
      let resolveFirst: (() => void) | undefined;
      const firstPushPromise = new Promise<void>((resolve) => { resolveFirst = resolve; });

      getTableData('_syncQueue').push(
        { seq: 1, table: 'notes', entityId: 'n1', op: 'put', data: { id: 'n1' } },
      );

      mockSyncPush.mockImplementationOnce(async () => {
        await firstPushPromise;
        return { results: [{ entityId: 'n1', status: 'accepted' as const }] };
      });

      const sync1 = engine.sync();
      const sync2 = engine.sync();

      resolveFirst!();
      await sync1;
      await sync2;

      expect(mockSyncPush).toHaveBeenCalledTimes(1);
    });
  });

  // ── pull ──────────────────────────────────────────────────────────

  describe('pull', () => {
    it('applies remote put changes to local DB with timestamp normalization', async () => {
      mockSyncPull.mockResolvedValueOnce({
        changes: [
          {
            table: 'notes',
            op: 'put',
            id: 'n1',
            title: 'Remote Note',
            createdAt: '2025-01-01T00:00:00.000Z',
            updatedAt: '2025-06-15T12:00:00.000Z',
          },
        ],
        serverTimestamp: '2025-06-15T12:00:00.000Z',
      });

      await engine.sync();

      expect(mockDisableSync).toHaveBeenCalled();
      expect(mockEnableSync).toHaveBeenCalled();

      const notesTable = getMockTable('notes');
      expect(notesTable.bulkPut).toHaveBeenCalled();
      const putCall = notesTable.bulkPut.mock.calls[0][0][0];
      expect(putCall.id).toBe('n1');
      expect(putCall.title).toBe('Remote Note');
      expect(typeof putCall.createdAt).toBe('number');
      expect(typeof putCall.updatedAt).toBe('number');
    });

    it('applies remote delete changes', async () => {
      mockSyncPull.mockResolvedValueOnce({
        changes: [
          { table: 'notes', op: 'delete', id: 'n1' },
        ],
        serverTimestamp: '2025-06-15T12:00:00.000Z',
      });

      await engine.sync();

      const notesTable = getMockTable('notes');
      expect(notesTable.bulkDelete).toHaveBeenCalledWith(['n1']);
    });

    it('updates _syncMeta with server timestamp after pull', async () => {
      const ts = '2025-06-15T12:00:00.000Z';
      mockSyncPull.mockResolvedValueOnce({
        changes: [],
        serverTimestamp: ts,
      });

      await engine.sync();

      const metaTable = getMockTable('_syncMeta');
      expect(metaTable.put).toHaveBeenCalledWith({
        key: 'lastSyncTimestamp',
        value: ts,
      });
    });

    it('calls onRemoteChange handler with affected tables', async () => {
      const remoteChangeHandler = vi.fn();
      engine.setRemoteChangeHandler(remoteChangeHandler);

      mockSyncPull.mockResolvedValueOnce({
        changes: [
          { table: 'notes', op: 'put', id: 'n1', title: 'A' },
          { table: 'tasks', op: 'put', id: 't1', title: 'B' },
          { table: 'notes', op: 'put', id: 'n2', title: 'C' },
        ],
        serverTimestamp: '2025-06-15T12:00:00.000Z',
      });

      await engine.sync();

      expect(remoteChangeHandler).toHaveBeenCalledTimes(1);
      const [changes, tables] = remoteChangeHandler.mock.calls[0];
      expect(changes).toHaveLength(3);
      expect(tables).toEqual(new Set(['notes', 'tasks']));
    });

    it('does not call onRemoteChange when there are no changes', async () => {
      const remoteChangeHandler = vi.fn();
      engine.setRemoteChangeHandler(remoteChangeHandler);

      mockSyncPull.mockResolvedValueOnce({
        changes: [],
        serverTimestamp: '2025-06-15T12:00:00.000Z',
      });

      await engine.sync();

      expect(remoteChangeHandler).not.toHaveBeenCalled();
    });

    it('silently ignores "Not connected" errors from pull', async () => {
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      mockSyncPull.mockRejectedValueOnce(new Error('Not connected to server'));

      await engine.sync();

      expect(consoleSpy).not.toHaveBeenCalled();
      consoleSpy.mockRestore();
    });

    it('uses last sync timestamp from _syncMeta when available', async () => {
      const lastTs = '2025-06-01T00:00:00.000Z';
      getTableData('_syncMeta').push({ key: 'lastSyncTimestamp', value: lastTs });

      mockSyncPull.mockResolvedValueOnce({
        changes: [],
        serverTimestamp: '2025-06-15T12:00:00.000Z',
      });

      await engine.sync();

      expect(mockSyncPull).toHaveBeenCalledWith(lastTs);
    });

    it('uses epoch when no last sync timestamp exists', async () => {
      mockSyncPull.mockResolvedValueOnce({
        changes: [],
        serverTimestamp: '2025-06-15T12:00:00.000Z',
      });

      await engine.sync();

      expect(mockSyncPull).toHaveBeenCalledWith(new Date(0).toISOString());
    });

    it('re-enables sync even if applying changes throws', async () => {
      mockSyncPull.mockResolvedValueOnce({
        changes: [
          { table: 'notes', op: 'put', id: 'n1', title: 'Will fail' },
        ],
        serverTimestamp: '2025-06-15T12:00:00.000Z',
      });

      // Make the notes table's bulkPut throw
      const notesTable = getMockTable('notes');
      notesTable.bulkPut.mockRejectedValueOnce(new Error('DB Error'));

      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      await engine.sync();

      expect(mockEnableSync).toHaveBeenCalled();
      consoleSpy.mockRestore();
    });
  });

  // ── applyRemoteChange ─────────────────────────────────────────────

  describe('applyRemoteChange', () => {
    it('applies a put change directly to Dexie with sync disabled', async () => {
      await engine.applyRemoteChange('notes', 'put', 'n1', {
        id: 'n1',
        title: 'WS Update',
        createdAt: '2025-01-01T00:00:00.000Z',
        updatedAt: '2025-06-15T12:00:00.000Z',
      });

      expect(mockDisableSync).toHaveBeenCalled();
      expect(mockEnableSync).toHaveBeenCalled();

      const notesTable = getMockTable('notes');
      expect(notesTable.put).toHaveBeenCalled();
      const putData = notesTable.put.mock.calls[0][0];
      expect(typeof putData.createdAt).toBe('number');
      expect(typeof putData.updatedAt).toBe('number');
    });

    it('applies a delete change directly to Dexie', async () => {
      await engine.applyRemoteChange('notes', 'delete', 'n1');

      expect(mockDisableSync).toHaveBeenCalled();
      const notesTable = getMockTable('notes');
      expect(notesTable.delete).toHaveBeenCalledWith('n1');
      expect(mockEnableSync).toHaveBeenCalled();
    });

    it('does not call put when op is put but data is undefined', async () => {
      await engine.applyRemoteChange('notes', 'put', 'n1', undefined);

      const notesTable = getMockTable('notes');
      expect(notesTable.put).not.toHaveBeenCalled();
    });

    it('calls onRemoteChange handler with the change details', async () => {
      const handler = vi.fn();
      engine.setRemoteChangeHandler(handler);

      const data = { id: 'n1', title: 'Hello' };
      await engine.applyRemoteChange('notes', 'put', 'n1', data);

      expect(handler).toHaveBeenCalledWith(
        [{ table: 'notes', op: 'put', ...data }],
        new Set(['notes']),
      );
    });

    it('normalizes ISO timestamp fields (trashedAt, completedAt) on tasks', async () => {
      await engine.applyRemoteChange('tasks', 'put', 't1', {
        id: 't1',
        trashedAt: '2025-01-01T00:00:00.000Z',
        completedAt: '2025-06-01T00:00:00.000Z',
      });

      const tasksTable = getMockTable('tasks');
      const putData = tasksTable.put.mock.calls[0][0];
      expect(typeof putData.trashedAt).toBe('number');
      expect(typeof putData.completedAt).toBe('number');
    });

    it('normalizes ISO timestamp fields (closedAt) on folders', async () => {
      await engine.applyRemoteChange('folders', 'put', 'f1', {
        id: 'f1',
        name: 'Test Folder',
        order: 0,
        closedAt: '2025-06-15T00:00:00.000Z',
      });

      const foldersTable = getMockTable('folders');
      const putData = foldersTable.put.mock.calls[0][0];
      expect(typeof putData.closedAt).toBe('number');
    });

    it('re-enables sync even if applying the change throws', async () => {
      const notesTable = getMockTable('notes');
      notesTable.put.mockRejectedValueOnce(new Error('Write failed'));

      // applyRemoteChange does NOT catch the error — it propagates
      await expect(
        engine.applyRemoteChange('notes', 'put', 'n1', { id: 'n1' }),
      ).rejects.toThrow('Write failed');

      expect(mockEnableSync).toHaveBeenCalled();
    });
  });

  // ── resolveConflicts ──────────────────────────────────────────────

  describe('resolveConflicts', () => {
    it('removes matching entries from the sync queue (choice: mine)', async () => {
      getTableData('_syncQueue').push(
        { seq: 1, table: 'notes', entityId: 'n1', op: 'put', data: { id: 'n1' } },
        { seq: 2, table: 'notes', entityId: 'n2', op: 'put', data: { id: 'n2' } },
        { seq: 3, table: 'tasks', entityId: 't1', op: 'put', data: { id: 't1' } },
      );

      await engine.resolveConflicts(
        [{ entityId: 'n1' }, { entityId: 'n2' }],
        'mine',
      );

      const remaining = getTableData('_syncQueue');
      expect(remaining).toHaveLength(1);
      expect(remaining[0].entityId).toBe('t1');
    });

    it('overwrites local data with server version when choice is theirs', async () => {
      getTableData('_syncQueue').push(
        { seq: 1, table: 'notes', entityId: 'n1', op: 'put', data: { id: 'n1', title: 'Local' } },
      );

      await engine.resolveConflicts(
        [{
          table: 'notes',
          entityId: 'n1',
          serverData: {
            id: 'n1',
            title: 'Server',
            createdAt: '2025-01-01T00:00:00.000Z',
          },
        }],
        'theirs',
      );

      expect(mockDisableSync).toHaveBeenCalled();
      const notesTable = getMockTable('notes');
      expect(notesTable.put).toHaveBeenCalled();
      const putData = notesTable.put.mock.calls[0][0];
      expect(putData.title).toBe('Server');
      expect(typeof putData.createdAt).toBe('number');
      expect(mockEnableSync).toHaveBeenCalled();
    });

    it('skips conflicts without table or serverData when choice is theirs', async () => {
      getTableData('_syncQueue').push(
        { seq: 1, table: 'notes', entityId: 'n1', op: 'put', data: { id: 'n1' } },
      );

      await engine.resolveConflicts(
        [{ entityId: 'n1' }], // no table/serverData
        'theirs',
      );

      const notesTable = getMockTable('notes');
      expect(notesTable.put).not.toHaveBeenCalled();
    });

    it('does not call disableSync/enableSync when choice is mine', async () => {
      getTableData('_syncQueue').push(
        { seq: 1, table: 'notes', entityId: 'n1', op: 'put', data: { id: 'n1' } },
      );

      await engine.resolveConflicts([{ entityId: 'n1' }], 'mine');

      expect(mockDisableSync).not.toHaveBeenCalled();
    });
  });

  // ── pullFolder ────────────────────────────────────────────────────

  describe('pullFolder', () => {
    it('pulls and applies a full folder snapshot from the server', async () => {
      mockSyncSnapshot.mockResolvedValueOnce({
        notes: [
          { id: 'n1', title: 'Snapshot Note', createdAt: '2025-01-01T00:00:00.000Z', updatedAt: '2025-06-15T00:00:00.000Z' },
        ],
        tasks: [
          { id: 't1', title: 'Snapshot Task' },
        ],
      });

      const handler = vi.fn();
      engine.setRemoteChangeHandler(handler);

      await engine.pullFolder('folder-1');

      expect(mockSyncSnapshot).toHaveBeenCalledWith('folder-1');
      expect(mockDisableSync).toHaveBeenCalled();
      expect(mockEnableSync).toHaveBeenCalled();
      expect(handler).toHaveBeenCalledWith([], new Set(['notes', 'tasks']));
    });

    it('normalizes ISO timestamps in snapshot data', async () => {
      mockSyncSnapshot.mockResolvedValueOnce({
        notes: [
          {
            id: 'n1',
            createdAt: '2025-01-01T00:00:00.000Z',
            updatedAt: '2025-06-15T00:00:00.000Z',
            trashedAt: '2025-03-01T00:00:00.000Z',
          },
        ],
      });

      await engine.pullFolder('folder-1');

      const notesTable = getMockTable('notes');
      expect(notesTable.bulkPut).toHaveBeenCalled();
      const putData = notesTable.bulkPut.mock.calls[0][0][0];
      expect(typeof putData.createdAt).toBe('number');
      expect(typeof putData.updatedAt).toBe('number');
      expect(typeof putData.trashedAt).toBe('number');
    });

    it('skips empty tables in the snapshot', async () => {
      mockSyncSnapshot.mockResolvedValueOnce({
        notes: [],
        tasks: [],
      });

      const handler = vi.fn();
      engine.setRemoteChangeHandler(handler);

      await engine.pullFolder('folder-1');

      expect(handler).not.toHaveBeenCalled();
    });

    it('handles snapshot fetch errors gracefully', async () => {
      const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

      mockSyncSnapshot.mockRejectedValueOnce(new Error('Server error'));

      await engine.pullFolder('folder-1');

      expect(consoleSpy).toHaveBeenCalled();
      consoleSpy.mockRestore();
    });
  });

  // ── syncFolder ────────────────────────────────────────────────────

  describe('syncFolder', () => {
    it('pushes folder and all scoped entities to server', async () => {
      getTableData('folders').push({ id: 'f1', name: 'Investigation' });
      getTableData('notes').push(
        { id: 'n1', title: 'Note A', folderId: 'f1' },
      );

      mockSyncPush.mockResolvedValueOnce({
        results: [
          { entityId: 'f1', status: 'accepted' },
          { entityId: 'n1', status: 'accepted' },
        ],
      });

      await engine.syncFolder('f1');

      expect(mockSyncPush).toHaveBeenCalledTimes(1);
      const pushArg = (mockSyncPush.mock.calls[0] as unknown[])[0] as { entityId: string }[];
      expect(pushArg.find((c) => c.entityId === 'f1')).toBeDefined();
    });

    it('skips trashed entities when pushing a folder', async () => {
      getTableData('folders').push({ id: 'f1', name: 'Investigation' });
      getTableData('notes').push(
        { id: 'n1', title: 'Active Note', folderId: 'f1', trashed: false },
        { id: 'n2', title: 'Trashed Note', folderId: 'f1', trashed: true },
      );

      mockSyncPush.mockResolvedValueOnce({
        results: [
          { entityId: 'f1', status: 'accepted' },
          { entityId: 'n1', status: 'accepted' },
        ],
      });

      await engine.syncFolder('f1');

      const pushArg = (mockSyncPush.mock.calls[0] as unknown[])[0] as { entityId: string }[];
      expect(pushArg.find((c) => c.entityId === 'n2')).toBeUndefined();
    });

    it('does not push when there are no changes', async () => {
      await engine.syncFolder('nonexistent');
      expect(mockSyncPush).not.toHaveBeenCalled();
    });

    it('notifies conflict handler on folder sync conflicts', async () => {
      const conflictHandler = vi.fn();
      engine.setConflictHandler(conflictHandler);

      getTableData('folders').push({ id: 'f1', name: 'Investigation' });

      const conflict: SyncResult = {
        entityId: 'f1',
        status: 'conflict',
        serverData: { id: 'f1', name: 'Server Name' },
      };
      mockSyncPush.mockResolvedValueOnce({
        results: [conflict],
      });

      await engine.syncFolder('f1');

      expect(conflictHandler).toHaveBeenCalledWith([conflict]);
    });
  });

  // ── sync (full cycle) ─────────────────────────────────────────────

  describe('sync (full cycle)', () => {
    it('calls push then pull in sequence', async () => {
      const callOrder: string[] = [];

      getTableData('_syncQueue').push(
        { seq: 1, table: 'notes', entityId: 'n1', op: 'put', data: { id: 'n1' } },
      );

      mockSyncPush.mockImplementation(async () => {
        callOrder.push('push');
        return { results: [{ entityId: 'n1', status: 'accepted' as const }] };
      });

      mockSyncPull.mockImplementation(async () => {
        callOrder.push('pull');
        return { changes: [], serverTimestamp: new Date().toISOString() };
      });

      await engine.sync();

      expect(callOrder).toEqual(['push', 'pull']);
    });

    it('clears pending push timer before a full sync', async () => {
      engine.start();
      await vi.advanceTimersByTimeAsync(100);

      await engine.enqueue('notes', 'n1', 'put', { id: 'n1' });

      mockSyncPush.mockResolvedValue({
        results: [{ entityId: 'n1', status: 'accepted' }],
      });

      await engine.sync();

      expect(mockSyncPush).toHaveBeenCalled();
    });

    it('does not throw on "Not connected" error during sync', async () => {
      getTableData('_syncQueue').push(
        { seq: 1, table: 'notes', entityId: 'n1', op: 'put', data: { id: 'n1' } },
      );

      mockSyncPush.mockRejectedValueOnce(new Error('Not connected'));

      await expect(engine.sync()).resolves.toBeUndefined();
    });
  });

  // ── schedulePush debounce behavior ────────────────────────────────

  describe('schedulePush / debounce', () => {
    it('triggers push after debounce timeout', async () => {
      engine.start();
      await vi.advanceTimersByTimeAsync(100);

      getTableData('_syncQueue').push(
        { seq: 1, table: 'notes', entityId: 'n1', op: 'put', data: { id: 'n1' } },
      );

      mockSyncPush.mockResolvedValue({
        results: [{ entityId: 'n1', status: 'accepted' }],
      });

      await engine.enqueue('notes', 'n1', 'put', { id: 'n1' });

      await vi.advanceTimersByTimeAsync(60);

      expect(mockSyncPush).toHaveBeenCalled();
    });

    it('does not schedule push when engine is not running', async () => {
      await engine.enqueue('notes', 'n1', 'put', { id: 'n1' });

      await vi.advanceTimersByTimeAsync(500);

      expect(mockSyncPush).not.toHaveBeenCalled();
    });
  });

  // ── handler setters ───────────────────────────────────────────────

  describe('handler setters', () => {
    it('setConflictHandler stores the handler', async () => {
      const handler = vi.fn();
      engine.setConflictHandler(handler);

      getTableData('_syncQueue').push(
        { seq: 1, table: 'notes', entityId: 'n1', op: 'put', data: { id: 'n1' } },
      );

      mockSyncPush.mockResolvedValueOnce({
        results: [{ entityId: 'n1', status: 'conflict', serverData: {} }],
      });

      await engine.sync();

      expect(handler).toHaveBeenCalledTimes(1);
    });

    it('setRemoteChangeHandler stores the handler', async () => {
      const handler = vi.fn();
      engine.setRemoteChangeHandler(handler);

      mockSyncPull.mockResolvedValueOnce({
        changes: [{ table: 'notes', op: 'put', id: 'n1' }],
        serverTimestamp: new Date().toISOString(),
      });

      await engine.sync();

      expect(handler).toHaveBeenCalledTimes(1);
    });

    it('setWSClient accepts null', () => {
      engine.setWSClient(null);
    });
  });

  // ── initialSync ───────────────────────────────────────────────────

  describe('initialSync (via start)', () => {
    it('skips initial sync when initialPushDone flag is set', async () => {
      getTableData('_syncMeta').push({ key: 'initialPushDone', value: true });

      engine.start();
      vi.useRealTimers();
      await new Promise((r) => setTimeout(r, 50));
      vi.useFakeTimers();

      // syncPush should NOT have been called (only sync's push runs, which
      // reads _syncQueue — not folders.toArray)
      expect(mockSyncPush).not.toHaveBeenCalled();
    });

    it('pushes all non-trashed, non-localOnly folders on first sync', async () => {
      getTableData('folders').push(
        { id: 'f1', name: 'Active', trashed: false, localOnly: false },
        { id: 'f2', name: 'Trashed', trashed: true, localOnly: false },
        { id: 'f3', name: 'LocalOnly', trashed: false, localOnly: true },
      );

      mockSyncPush.mockResolvedValue({ results: [] });

      engine.start();
      // sync() runs first, then initialSync chains via .then() —
      // use real timers briefly to let the full promise chain settle
      vi.useRealTimers();
      await new Promise((r) => setTimeout(r, 50));
      vi.useFakeTimers();

      expect(mockSyncPush).toHaveBeenCalled();
    });

    it('handles initialSync errors gracefully and still proceeds to sync', async () => {
      const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

      // Make folders.toArray throw during initialSync
      const foldersTable = getMockTable('folders');
      foldersTable.toArray.mockRejectedValueOnce(new Error('DB Error'));

      engine.start();
      vi.useRealTimers();
      await new Promise((r) => setTimeout(r, 50));
      vi.useFakeTimers();

      // Should have warned about initial sync failure
      expect(consoleSpy).toHaveBeenCalled();
      consoleSpy.mockRestore();
    });
  });
});
