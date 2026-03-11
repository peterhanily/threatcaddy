import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { SyncChange, SyncResult } from '../types.js';

// ─── Mock helpers ────────────────────────────────────────────────
const mockSelect = vi.fn();
const mockInsert = vi.fn();
const mockUpdate = vi.fn();
const mockDelete = vi.fn();

function createSelectChain(rows: Record<string, unknown>[] = []) {
  const chain: Record<string, ReturnType<typeof vi.fn>> = {
    from: vi.fn(),
    where: vi.fn(),
    limit: vi.fn().mockResolvedValue(rows),
    then: vi.fn((resolve: (v: unknown) => void) => resolve(rows)),
  };
  chain.from.mockReturnValue(chain);
  chain.where.mockReturnValue(chain);
  return chain;
}


function createUpdateChain(returningRows: Record<string, unknown>[] = [{ id: 'test' }]) {
  const chain = {
    set: vi.fn().mockReturnThis(),
    where: vi.fn().mockReturnThis(),
    returning: vi.fn().mockResolvedValue(returningRows),
  };
  return chain;
}

// ─── Mocks ───────────────────────────────────────────────────────
const mockTxDb = {
  select: (...args: unknown[]) => mockSelect(...args),
  insert: (...args: unknown[]) => mockInsert(...args),
  update: (...args: unknown[]) => mockUpdate(...args),
  delete: (...args: unknown[]) => mockDelete(...args),
};

vi.mock('../db/index.js', () => ({
  db: {
    ...mockTxDb,
    transaction: vi.fn(async (fn: (tx: typeof mockTxDb) => Promise<unknown>) => fn(mockTxDb)),
  },
}));

vi.mock('../db/schema.js', () => {
  const makeTable = (name: string, hasFolderId = true) => {
    const t: Record<string, unknown> = {
      id: { name: 'id' },
      version: { name: 'version' },
      updatedAt: { name: 'updated_at' },
      createdAt: { name: 'created_at' },
      createdBy: { name: 'created_by' },
      updatedBy: { name: 'updated_by' },
      deletedAt: { name: 'deleted_at' },
    };
    if (hasFolderId) t.folderId = { name: 'folder_id' };
    return t;
  };
  return {
    notes: makeTable('notes'),
    tasks: makeTable('tasks'),
    folders: makeTable('folders'),
    tags: makeTable('tags', false),
    timelineEvents: makeTable('timelineEvents'),
    timelines: makeTable('timelines', false),
    whiteboards: makeTable('whiteboards'),
    standaloneIOCs: makeTable('standaloneIOCs'),
    chatThreads: makeTable('chatThreads'),
    investigationMembers: makeTable('investigationMembers'),
  };
});

vi.mock('../lib/logger.js', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

const mockEmitEntityEvent = vi.fn();
vi.mock('../bots/event-bus.js', () => ({
  emitEntityEvent: (...args: unknown[]) => mockEmitEntityEvent(...args),
}));

// ─── Dynamic imports after mocks ─────────────────────────────────
let processPush: (changes: SyncChange[], userId: string) => Promise<SyncResult[]>;
let lookupEntityFolderId: (tableName: string, entityId: string) => Promise<string | undefined>;

beforeEach(async () => {
  vi.resetAllMocks();
  const mod = await import('../services/sync-service.js');
  processPush = mod.processPush;
  lookupEntityFolderId = mod.lookupEntityFolderId;
});

// ═════════════════════════════════════════════════════════════════
// Section 1: processPush delete scenarios
// ═════════════════════════════════════════════════════════════════
describe('processPush delete broadcast scenarios', () => {
  it('soft-delete sets deletedAt and bumps version', async () => {
    const existingRow = { id: 'note-1', title: 'Doomed', version: 4, folderId: 'folder-1' };

    const selectChain = createSelectChain([existingRow]);
    mockSelect.mockReturnValue(selectChain);

    const updateChain = createUpdateChain([{ id: 'note-1' }]);
    mockUpdate.mockReturnValue(updateChain);

    const changes: SyncChange[] = [{
      table: 'notes',
      op: 'delete',
      entityId: 'note-1',
    }];

    const results = await processPush(changes, 'user-1');

    expect(results).toHaveLength(1);
    expect(results[0]).toMatchObject({
      table: 'notes',
      entityId: 'note-1',
      status: 'accepted',
      serverVersion: 5, // bumped from 4 to 5
    });
    expect(mockUpdate).toHaveBeenCalled();

    // Verify the update set call includes deletedAt and bumped version
    const setArg = updateChain.set.mock.calls[0][0];
    expect(setArg.deletedAt).toBeInstanceOf(Date);
    expect(setArg.version).toBe(5);
    expect(setArg.updatedBy).toBe('user-1');
  });

  it('soft-delete of entity with folderId emits event with that folderId', async () => {
    const existingRow = { id: 'note-2', title: 'Has Folder', version: 1, folderId: 'folder-abc' };

    const selectChain = createSelectChain([existingRow]);
    mockSelect.mockReturnValue(selectChain);

    const updateChain = createUpdateChain([{ id: 'note-2' }]);
    mockUpdate.mockReturnValue(updateChain);

    const changes: SyncChange[] = [{
      table: 'notes',
      op: 'delete',
      entityId: 'note-2',
    }];

    await processPush(changes, 'user-del');

    // emitEntityEvent should be called with the folderId from existing record
    expect(mockEmitEntityEvent).toHaveBeenCalledTimes(1);
    expect(mockEmitEntityEvent).toHaveBeenCalledWith(
      'delete',
      'notes',
      'note-2',
      'folder-abc',  // folderId extracted from existing[0]
      'user-del',
      false,
    );
  });

  it('soft-delete of entity without folderId (tags table) still succeeds', async () => {
    const existingTag = { id: 'tag-1', name: 'malware', version: 2 };

    const selectChain = createSelectChain([existingTag]);
    mockSelect.mockReturnValue(selectChain);

    const updateChain = createUpdateChain([{ id: 'tag-1' }]);
    mockUpdate.mockReturnValue(updateChain);

    const changes: SyncChange[] = [{
      table: 'tags',
      op: 'delete',
      entityId: 'tag-1',
    }];

    const results = await processPush(changes, 'user-1');

    expect(results).toHaveLength(1);
    expect(results[0]).toMatchObject({
      table: 'tags',
      entityId: 'tag-1',
      status: 'accepted',
      serverVersion: 3,
    });
    // Event should be emitted with undefined folderId (tags have no folderId)
    expect(mockEmitEntityEvent).toHaveBeenCalledWith(
      'delete',
      'tags',
      'tag-1',
      undefined,
      'user-1',
      false,
    );
  });

  it('multiple deletes in a batch all get processed', async () => {
    const note = { id: 'note-a', version: 1, folderId: 'f-1' };
    const task = { id: 'task-b', version: 3, folderId: 'f-2' };

    let selectCallCount = 0;
    const selectChainNote = createSelectChain([note]);
    const selectChainTask = createSelectChain([task]);

    mockSelect.mockImplementation(() => {
      selectCallCount++;
      return selectCallCount === 1 ? selectChainNote : selectChainTask;
    });

    const updateChainNote = createUpdateChain([{ id: 'note-a' }]);
    const updateChainTask = createUpdateChain([{ id: 'task-b' }]);
    let updateCallCount = 0;
    mockUpdate.mockImplementation(() => {
      updateCallCount++;
      return updateCallCount === 1 ? updateChainNote : updateChainTask;
    });

    const changes: SyncChange[] = [
      { table: 'notes', op: 'delete', entityId: 'note-a' },
      { table: 'tasks', op: 'delete', entityId: 'task-b' },
    ];

    const results = await processPush(changes, 'user-batch');

    expect(results).toHaveLength(2);
    expect(results[0]).toMatchObject({ table: 'notes', entityId: 'note-a', status: 'accepted', serverVersion: 2 });
    expect(results[1]).toMatchObject({ table: 'tasks', entityId: 'task-b', status: 'accepted', serverVersion: 4 });
    expect(mockEmitEntityEvent).toHaveBeenCalledTimes(2);
  });

  it('delete followed by put of same entity uses pre-fetched version (batch check)', async () => {
    // With batched existence checks, both changes share the same pre-fetched record.
    // The delete bumps version 5→6 in the DB, but the put still sees version 5
    // from the pre-fetched map. Since clientVersion (6) !== serverVersion (5),
    // the put results in a conflict.
    const existingRow = { id: 'note-rc', version: 5, folderId: 'f-rc', title: 'Old' };

    // Single batch select for table 'notes' — returns the existing row
    const selectChain = createSelectChain([existingRow]);
    mockSelect.mockReturnValue(selectChain);

    const updateChainDel = createUpdateChain([{ id: 'note-rc' }]);
    mockUpdate.mockReturnValue(updateChainDel);

    const changes: SyncChange[] = [
      { table: 'notes', op: 'delete', entityId: 'note-rc' },
      { table: 'notes', op: 'put', entityId: 'note-rc', data: { title: 'Reborn', folderId: 'f-rc' }, clientVersion: 6 },
    ];

    const results = await processPush(changes, 'user-rc');

    expect(results).toHaveLength(2);
    // First: delete accepted (version bumped from 5 to 6)
    expect(results[0]).toMatchObject({ table: 'notes', entityId: 'note-rc', status: 'accepted', serverVersion: 6 });
    // Second: put conflicts because pre-fetched serverVersion (5) !== clientVersion (6)
    expect(results[1]).toMatchObject({ table: 'notes', entityId: 'note-rc', status: 'conflict', serverVersion: 5 });
  });
});

// ═════════════════════════════════════════════════════════════════
// Section 2: lookupEntityFolderId for soft-deleted entities
// ═════════════════════════════════════════════════════════════════
describe('lookupEntityFolderId for soft-deleted entities', () => {
  it('returns folderId for a soft-deleted entity (record has deletedAt set)', async () => {
    // The critical scenario: entity was soft-deleted (has deletedAt) but
    // lookupEntityFolderId does NOT filter on deletedAt, so it still finds it.
    const selectChain = createSelectChain([{ folderId: 'folder-deleted' }]);
    mockSelect.mockReturnValue(selectChain);

    const result = await lookupEntityFolderId('notes', 'soft-del-note');

    expect(result).toBe('folder-deleted');
    // Verify it queried the DB (did not short-circuit)
    expect(mockSelect).toHaveBeenCalled();
    expect(selectChain.from).toHaveBeenCalled();
    expect(selectChain.where).toHaveBeenCalled();
    expect(selectChain.limit).toHaveBeenCalledWith(1);
  });

  it('returns folderId for a normal (non-deleted) entity', async () => {
    const selectChain = createSelectChain([{ folderId: 'folder-normal' }]);
    mockSelect.mockReturnValue(selectChain);

    const result = await lookupEntityFolderId('tasks', 'task-normal');

    expect(result).toBe('folder-normal');
  });

  it('returns undefined for a truly deleted (hard-deleted) entity', async () => {
    // Hard-deleted means the row is gone entirely — select returns empty
    const selectChain = createSelectChain([]);
    mockSelect.mockReturnValue(selectChain);

    const result = await lookupEntityFolderId('notes', 'hard-del-note');

    expect(result).toBeUndefined();
  });

  it('returns undefined for tables without folderId column', async () => {
    // tags has no folderId — should return undefined without hitting the DB
    const result = await lookupEntityFolderId('tags', 'tag-1');

    expect(result).toBeUndefined();
    expect(mockSelect).not.toHaveBeenCalled();
  });

  it('returns undefined for unknown table names', async () => {
    const result = await lookupEntityFolderId('nonexistent', 'id-1');

    expect(result).toBeUndefined();
    expect(mockSelect).not.toHaveBeenCalled();
  });
});

// ═════════════════════════════════════════════════════════════════
// Section 3: emitEntityEvent on delete
// ═════════════════════════════════════════════════════════════════
describe('emitEntityEvent on delete operations', () => {
  it('calls emitEntityEvent with delete op and correct folderId from existing record', async () => {
    const existingRow = { id: 'note-ev1', version: 2, folderId: 'folder-ev1', title: 'Event Test' };

    const selectChain = createSelectChain([existingRow]);
    mockSelect.mockReturnValue(selectChain);

    const updateChain = createUpdateChain([{ id: 'note-ev1' }]);
    mockUpdate.mockReturnValue(updateChain);

    const changes: SyncChange[] = [{
      table: 'notes',
      op: 'delete',
      entityId: 'note-ev1',
    }];

    await processPush(changes, 'user-ev');

    expect(mockEmitEntityEvent).toHaveBeenCalledTimes(1);
    const [op, table, entityId, folderId, userId, isNew] = mockEmitEntityEvent.mock.calls[0];
    expect(op).toBe('delete');
    expect(table).toBe('notes');
    expect(entityId).toBe('note-ev1');
    expect(folderId).toBe('folder-ev1');
    expect(userId).toBe('user-ev');
    expect(isNew).toBe(false);
  });

  it('does NOT call emitEntityEvent when deleting a non-existent entity', async () => {
    const selectChain = createSelectChain([]);
    mockSelect.mockReturnValue(selectChain);

    const changes: SyncChange[] = [{
      table: 'notes',
      op: 'delete',
      entityId: 'gone-note',
    }];

    await processPush(changes, 'user-ev');

    // Non-existent entity delete is accepted gracefully but no event emitted
    expect(mockEmitEntityEvent).not.toHaveBeenCalled();
  });

  it('emits delete event with undefined folderId for tables without folderId', async () => {
    const existingTimeline = { id: 'tl-1', name: 'Test Timeline', version: 1 };

    const selectChain = createSelectChain([existingTimeline]);
    mockSelect.mockReturnValue(selectChain);

    const updateChain = createUpdateChain([{ id: 'tl-1' }]);
    mockUpdate.mockReturnValue(updateChain);

    const changes: SyncChange[] = [{
      table: 'timelines',
      op: 'delete',
      entityId: 'tl-1',
    }];

    await processPush(changes, 'user-ev');

    expect(mockEmitEntityEvent).toHaveBeenCalledTimes(1);
    expect(mockEmitEntityEvent).toHaveBeenCalledWith(
      'delete',
      'timelines',
      'tl-1',
      undefined, // timelines has no folderId
      'user-ev',
      false,
    );
  });

  it('emits correct folderId from each entity in a mixed delete batch', async () => {
    const note = { id: 'n-mix', version: 1, folderId: 'f-a' };
    const task = { id: 't-mix', version: 2, folderId: 'f-b' };

    let selectCallCount = 0;
    mockSelect.mockImplementation(() => {
      selectCallCount++;
      return selectCallCount === 1
        ? createSelectChain([note])
        : createSelectChain([task]);
    });

    let updateCallCount = 0;
    mockUpdate.mockImplementation(() => {
      updateCallCount++;
      return updateCallCount === 1
        ? createUpdateChain([{ id: 'n-mix' }])
        : createUpdateChain([{ id: 't-mix' }]);
    });

    const changes: SyncChange[] = [
      { table: 'notes', op: 'delete', entityId: 'n-mix' },
      { table: 'tasks', op: 'delete', entityId: 't-mix' },
    ];

    await processPush(changes, 'user-batch-ev');

    expect(mockEmitEntityEvent).toHaveBeenCalledTimes(2);

    // First call: note delete with folderId 'f-a'
    expect(mockEmitEntityEvent.mock.calls[0]).toEqual([
      'delete', 'notes', 'n-mix', 'f-a', 'user-batch-ev', false,
    ]);

    // Second call: task delete with folderId 'f-b'
    expect(mockEmitEntityEvent.mock.calls[1]).toEqual([
      'delete', 'tasks', 't-mix', 'f-b', 'user-batch-ev', false,
    ]);
  });
});
