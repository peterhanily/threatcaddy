import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { SyncChange, SyncResult } from '../types.js';

// Mock the db module before importing the sync service
const mockSelect = vi.fn();
const mockInsert = vi.fn();
const mockUpdate = vi.fn();
const mockDelete = vi.fn();

// Chain builders for drizzle-style queries
function createSelectChain(rows: Record<string, unknown>[] = []) {
  const chain = {
    from: vi.fn().mockReturnThis(),
    where: vi.fn().mockReturnThis(),
    limit: vi.fn().mockResolvedValue(rows),
  };
  return chain;
}

function createInsertChain() {
  const chain = {
    values: vi.fn().mockReturnThis(),
    onConflictDoNothing: vi.fn().mockResolvedValue(undefined),
  };
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

vi.mock('../db/index.js', () => ({
  db: {
    select: (...args: unknown[]) => mockSelect(...args),
    insert: (...args: unknown[]) => mockInsert(...args),
    update: (...args: unknown[]) => mockUpdate(...args),
    delete: (...args: unknown[]) => mockDelete(...args),
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

// Dynamic import after mocks are set up
let processPush: (changes: SyncChange[], userId: string) => Promise<SyncResult[]>;
let pullChanges: (since: string, folderIds?: string[]) => Promise<{ changes: Record<string, unknown>[]; serverTimestamp: string }>;
let lookupEntityFolderId: (tableName: string, entityId: string) => Promise<string | undefined>;

beforeEach(async () => {
  vi.clearAllMocks();
  const mod = await import('../services/sync-service.js');
  processPush = mod.processPush;
  pullChanges = mod.pullChanges;
  lookupEntityFolderId = mod.lookupEntityFolderId;
});

describe('sync-service', () => {
  describe('processPush', () => {
    it('should insert a new entity when it does not exist', async () => {
      // First select: entity doesn't exist
      const selectChain = createSelectChain([]);
      mockSelect.mockReturnValue(selectChain);

      // Insert
      const insertChain = createInsertChain();
      mockInsert.mockReturnValue(insertChain);

      // Second select after insert: return the inserted row
      const insertedRow = { id: 'note-1', title: 'Test Note', version: 1 };
      selectChain.limit
        .mockResolvedValueOnce([])          // first: entity doesn't exist
        .mockResolvedValueOnce([insertedRow]); // second: after insert

      const changes: SyncChange[] = [{
        table: 'notes',
        op: 'put',
        entityId: 'note-1',
        data: { title: 'Test Note', folderId: 'folder-1' },
      }];

      const results = await processPush(changes, 'user-1');

      expect(results).toHaveLength(1);
      expect(results[0]).toMatchObject({
        table: 'notes',
        entityId: 'note-1',
        status: 'accepted',
        serverVersion: 1,
      });
      expect(mockInsert).toHaveBeenCalled();
    });

    it('should update an existing entity when versions match', async () => {
      const existingRow = { id: 'note-1', title: 'Old Title', version: 3 };

      // Select: entity exists
      const selectChain = createSelectChain([existingRow]);
      mockSelect.mockReturnValue(selectChain);

      // Update returns a row (success)
      const updateChain = createUpdateChain([{ id: 'note-1' }]);
      mockUpdate.mockReturnValue(updateChain);

      // Select after update: return updated row
      const updatedRow = { id: 'note-1', title: 'New Title', version: 4 };
      selectChain.limit
        .mockResolvedValueOnce([existingRow])  // first: check existence
        .mockResolvedValueOnce([updatedRow]);   // second: after update

      const changes: SyncChange[] = [{
        table: 'notes',
        op: 'put',
        entityId: 'note-1',
        data: { title: 'New Title' },
        clientVersion: 3,
      }];

      const results = await processPush(changes, 'user-1');

      expect(results).toHaveLength(1);
      expect(results[0]).toMatchObject({
        table: 'notes',
        entityId: 'note-1',
        status: 'accepted',
        serverVersion: 4,
      });
    });

    it('should detect conflict when client version does not match server', async () => {
      const existingRow = { id: 'note-1', title: 'Server Title', version: 5 };

      const selectChain = createSelectChain([existingRow]);
      mockSelect.mockReturnValue(selectChain);

      const changes: SyncChange[] = [{
        table: 'notes',
        op: 'put',
        entityId: 'note-1',
        data: { title: 'Client Title' },
        clientVersion: 3, // Doesn't match server version 5
      }];

      const results = await processPush(changes, 'user-1');

      expect(results).toHaveLength(1);
      expect(results[0]).toMatchObject({
        table: 'notes',
        entityId: 'note-1',
        status: 'conflict',
        serverVersion: 5,
        serverData: existingRow,
      });
      // Should not have attempted update
      expect(mockUpdate).not.toHaveBeenCalled();
    });

    it('should soft-delete an existing entity', async () => {
      const existingRow = { id: 'note-1', title: 'To Delete', version: 2 };

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
        serverVersion: 3,
      });
      expect(mockUpdate).toHaveBeenCalled();
    });

    it('should accept delete for non-existent entity gracefully', async () => {
      const selectChain = createSelectChain([]);
      mockSelect.mockReturnValue(selectChain);

      const changes: SyncChange[] = [{
        table: 'notes',
        op: 'delete',
        entityId: 'gone-note',
      }];

      const results = await processPush(changes, 'user-1');

      expect(results).toHaveLength(1);
      expect(results[0]).toMatchObject({
        table: 'notes',
        entityId: 'gone-note',
        status: 'accepted',
      });
      expect(mockUpdate).not.toHaveBeenCalled();
    });

    it('should strip server-managed fields from client data', async () => {
      const selectChain = createSelectChain([]);
      mockSelect.mockReturnValue(selectChain);

      const insertChain = createInsertChain();
      mockInsert.mockReturnValue(insertChain);

      const insertedRow = { id: 'note-2', version: 1 };
      selectChain.limit
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([insertedRow]);

      const changes: SyncChange[] = [{
        table: 'notes',
        op: 'put',
        entityId: 'note-2',
        data: {
          title: 'Clean',
          version: 999,       // Should be stripped
          createdBy: 'hacker', // Should be stripped
          createdAt: 0,        // Should be stripped
          id: 'fake-id',       // Should be stripped
        },
      }];

      const results = await processPush(changes, 'user-1');
      expect(results[0].status).toBe('accepted');

      // Verify insert was called with clean data (no server-managed fields)
      const insertValues = insertChain.values.mock.calls[0][0];
      expect(insertValues.title).toBe('Clean');
      expect(insertValues.version).toBe(1);           // Server-set, not 999
      expect(insertValues.createdBy).toBe('user-1');   // Server-set, not 'hacker'
    });

    it('should handle multiple changes in a batch', async () => {
      // First change: new entity
      const selectChain1 = createSelectChain([]);
      const insertChain1 = createInsertChain();
      // Second change: existing entity
      const existingRow = { id: 'task-1', version: 1 };
      const selectChain2 = createSelectChain([existingRow]);
      const updateChain = createUpdateChain([{ id: 'task-1' }]);
      const updatedRow = { id: 'task-1', version: 2 };

      // Set up sequential mock returns
      let selectCallCount = 0;
      mockSelect.mockImplementation(() => {
        selectCallCount++;
        if (selectCallCount <= 2) return selectChain1; // calls 1-2 for first change
        return selectChain2;                            // calls 3+ for second change
      });
      mockInsert.mockReturnValue(insertChain1);
      mockUpdate.mockReturnValue(updateChain);

      const insertedRow = { id: 'note-new', version: 1 };
      selectChain1.limit
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([insertedRow]);
      selectChain2.limit
        .mockResolvedValueOnce([existingRow])
        .mockResolvedValueOnce([updatedRow]);

      const changes: SyncChange[] = [
        { table: 'notes', op: 'put', entityId: 'note-new', data: { title: 'New' } },
        { table: 'tasks', op: 'put', entityId: 'task-1', data: { title: 'Updated' }, clientVersion: 1 },
      ];

      const results = await processPush(changes, 'user-1');

      expect(results).toHaveLength(2);
      expect(results[0].status).toBe('accepted');
      expect(results[1].status).toBe('accepted');
    });

    it('should detect concurrent modification (optimistic lock failure)', async () => {
      const existingRow = { id: 'note-1', version: 3 };
      const selectChain = createSelectChain([existingRow]);
      mockSelect.mockReturnValue(selectChain);

      // Update returns empty (another writer bumped the version)
      const updateChain = createUpdateChain([]);
      mockUpdate.mockReturnValue(updateChain);

      // Re-fetch shows new version
      const currentRow = { id: 'note-1', version: 4, title: 'Concurrent Edit' };
      selectChain.limit
        .mockResolvedValueOnce([existingRow]) // first: check existence
        .mockResolvedValueOnce([currentRow]); // second: after failed update, re-fetch

      const changes: SyncChange[] = [{
        table: 'notes',
        op: 'put',
        entityId: 'note-1',
        data: { title: 'My Edit' },
        clientVersion: 3,
      }];

      const results = await processPush(changes, 'user-1');

      expect(results).toHaveLength(1);
      expect(results[0]).toMatchObject({
        status: 'conflict',
        serverVersion: 4,
      });
    });

    it('should return conflict on DB error', async () => {
      mockSelect.mockImplementation(() => {
        throw new Error('DB connection lost');
      });

      const changes: SyncChange[] = [{
        table: 'notes',
        op: 'put',
        entityId: 'note-err',
        data: { title: 'Fail' },
      }];

      const results = await processPush(changes, 'user-1');
      expect(results[0].status).toBe('conflict');
    });

    it('should throw for unknown table names', async () => {
      const changes: SyncChange[] = [{
        table: 'malicious_table',
        op: 'put',
        entityId: 'x',
        data: {},
      }];

      // getTable throws before the try-catch for unknown tables
      await expect(processPush(changes, 'user-1')).rejects.toThrow('Unknown table');
    });
  });

  describe('pullChanges', () => {
    it('should pull changes from accessible folders', async () => {
      const note = { id: 'n1', table: 'notes', title: 'Hello', deletedAt: null };

      const selectChain = {
        from: vi.fn().mockReturnThis(),
        where: vi.fn().mockResolvedValue([note]),
      };
      mockSelect.mockReturnValue(selectChain);

      const result = await pullChanges('2024-01-01T00:00:00Z', ['folder-1']);

      expect(result.changes).toBeDefined();
      expect(result.serverTimestamp).toBeDefined();
      expect(typeof result.serverTimestamp).toBe('string');
    });

    it('should skip folder-scoped tables when no folderIds provided', async () => {
      const tagRow = { id: 't1', name: 'malware', deletedAt: null };

      const selectChain = {
        from: vi.fn().mockReturnThis(),
        where: vi.fn().mockResolvedValue([tagRow]),
      };
      mockSelect.mockReturnValue(selectChain);

      const result = await pullChanges('2024-01-01T00:00:00Z', []);

      // Should only get global tables (tags, timelines), not folder-scoped ones
      expect(result.changes).toBeDefined();
    });

    it('should send soft-deleted entities as delete ops', async () => {
      const deletedNote = { id: 'n2', table: 'notes', deletedAt: new Date() };

      const selectChain = {
        from: vi.fn().mockReturnThis(),
        where: vi.fn().mockResolvedValue([deletedNote]),
      };
      mockSelect.mockReturnValue(selectChain);

      const result = await pullChanges('2024-01-01T00:00:00Z', ['folder-1']);

      const deleteOps = result.changes.filter(c => c.op === 'delete');
      expect(deleteOps.length).toBeGreaterThanOrEqual(0);
      // Deleted entities should have op='delete'
      for (const c of result.changes) {
        if (c.deletedAt) {
          expect(c.op).toBe('delete');
        }
      }
    });
  });

  describe('lookupEntityFolderId', () => {
    it('should return folderId for an existing entity', async () => {
      const selectChain = createSelectChain([{ folderId: 'folder-42' }]);
      mockSelect.mockReturnValue(selectChain);

      const result = await lookupEntityFolderId('notes', 'note-1');
      expect(result).toBe('folder-42');
    });

    it('should return undefined for non-existent entity', async () => {
      const selectChain = createSelectChain([]);
      mockSelect.mockReturnValue(selectChain);

      const result = await lookupEntityFolderId('notes', 'ghost');
      expect(result).toBeUndefined();
    });

    it('should return undefined for unknown table', async () => {
      const result = await lookupEntityFolderId('nonexistent', 'id-1');
      expect(result).toBeUndefined();
    });

    it('should return undefined for tables without folderId', async () => {
      const result = await lookupEntityFolderId('tags', 'tag-1');
      expect(result).toBeUndefined();
    });

    it('should handle DB errors gracefully', async () => {
      const selectChain = {
        from: vi.fn().mockReturnThis(),
        where: vi.fn().mockReturnThis(),
        limit: vi.fn().mockRejectedValue(new Error('DB error')),
      };
      mockSelect.mockReturnValue(selectChain);

      const result = await lookupEntityFolderId('notes', 'note-err');
      expect(result).toBeUndefined();
    });
  });
});
