import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { SyncChange } from '../types.js';

const state = vi.hoisted(() => ({
  rows: [] as unknown[][],
  returned: [] as unknown[][],
  inserts: [] as Record<string, unknown>[],
  updates: [] as Record<string, unknown>[],
  inTransaction: false,
  commitError: false,
  writeErrorAt: 0,
  writeCount: 0,
  events: vi.fn(),
}));
vi.mock('../db/index.js', () => {
  const chain = () => {
    const query: Record<string, unknown> = {};
    for (const key of ['from', 'where', 'limit', 'for', 'orderBy']) query[key] = () => query;
    query.then = (resolve: (rows: unknown[]) => unknown, reject: (error: unknown) => unknown) =>
      Promise.resolve(state.rows.shift() ?? []).then(resolve, reject);
    return query;
  };
  const write = (collection: Record<string, unknown>[]) => {
    const query = {
      values: (value: Record<string, unknown>) => { collection.push(value); return query; },
      set: (value: Record<string, unknown>) => { collection.push(value); return query; },
      where: () => query,
      onConflictDoNothing: async () => undefined,
      returning: async () => {
        if (++state.writeCount === state.writeErrorAt) throw new Error('Constraint failure');
        return state.returned.shift() ?? [];
      },
    };
    return query;
  };
  const database = {
    select: chain,
    execute: vi.fn(async () => []),
    insert: () => write(state.inserts),
    update: () => write(state.updates),
  };
  return { db: { ...database, transaction: async (run: (tx: typeof database) => Promise<unknown>) => {
    state.inTransaction = true;
    try {
      const result = await run(database);
      if (state.commitError) throw new Error('Commit failure');
      return result;
    } finally { state.inTransaction = false; }
  } } };
});
vi.mock('../bots/event-bus.js', () => ({ emitEntityEvent: (...args: unknown[]) => state.events(state.inTransaction, ...args) }));
vi.mock('../lib/logger.js', () => ({ logger: { warn: vi.fn(), error: vi.fn() } }));

import { processPush, lookupEntityFolderId, pullChanges } from '../services/sync-service.js';

beforeEach(() => {
  state.rows.length = 0; state.returned.length = 0;
  state.inserts.length = 0; state.updates.length = 0;
  state.inTransaction = false; state.commitError = false;
  state.writeErrorAt = 0; state.writeCount = 0; state.events.mockClear();
});

describe('transactional sync writes', () => {
  const current = { id: 'note-1', folderId: 'folder-1', title: 'Saved', content: 'Existing content', version: 3 };
  const patch: SyncChange = { table: 'notes', entityId: current.id, op: 'put', data: { title: 'Edited' }, clientVersion: 3 };

  it('creates a new record with server-managed attribution and revision', async () => {
    state.rows.push([]);
    state.returned.push([{ ...current, version: 1 }]);
    const [result] = await processPush([{ ...patch, clientVersion: 0, data: { title: 'Created', version: 99, createdBy: 'ignored' } }], 'user-1');
    expect(result).toMatchObject({ status: 'accepted', serverVersion: 1 });
    expect(state.inserts[0]).toMatchObject({ id: current.id, title: 'Created', version: 1, createdBy: 'user-1' });
  });

  it.each(['put', 'delete'] as const)('applies %s only with its acknowledged revision', async op => {
    state.rows.push([current]);
    state.returned.push([{ ...current, title: 'Edited', version: 4 }]);
    const [result] = await processPush([{ ...patch, op }], 'user-1');
    expect(result).toMatchObject({ status: 'accepted', serverVersion: 4 });
    expect(state.updates[0]).toMatchObject({ version: 4, updatedBy: 'user-1' });
    if (op === 'delete') expect(state.updates[0].deletedAt).toBeInstanceOf(Date);
    expect(state.events.mock.calls[0][0]).toBe(false);
  });

  it.each([
    ['put', undefined], ['put', 2], ['put', 0],
    ['delete', undefined], ['delete', 2], ['delete', 0],
  ] as const)('returns the current record for %s with baseline %s', async (op, clientVersion) => {
    state.rows.push([current]);
    const [result] = await processPush([{ ...patch, op, clientVersion }], 'user-1');
    expect(result).toMatchObject({ status: 'conflict', serverVersion: 3, serverData: current });
    expect(state.updates).toEqual([]);
    expect(state.events).not.toHaveBeenCalled();
  });

  it('does not silently recreate a removed record from an old revision', async () => {
    state.rows.push([]);
    expect((await processPush([patch], 'user-1'))[0].status).toBe('conflict');
    expect(state.inserts).toEqual([]);
  });

  it('rejects an oversized field instead of acknowledging a silently dropped value', async () => {
    state.rows.push([current]);
    await expect(processPush([{ ...patch, data: { content: 'Ordinary note text '.repeat(30_000) } }], 'user-1'))
      .rejects.toThrow('exceeds the supported value limits');
    expect(state.updates).toEqual([]);
    expect(state.events).not.toHaveBeenCalled();
  });

  it('allows a trusted internal field patch without replacing unspecified content', async () => {
    state.rows.push([current]);
    state.returned.push([{ ...current, title: 'Edited', version: 4 }]);
    await processPush([{ ...patch, clientVersion: undefined }], 'bot-1', { trustedInternal: true });
    expect(state.updates[0]).toMatchObject({ title: 'Edited', version: 4 });
    expect(state.updates[0]).not.toHaveProperty('content');
  });

  it('propagates later SQL failures and publishes no events from the failed batch', async () => {
    state.rows.push([], []);
    state.returned.push([{ ...current, version: 1 }]);
    state.writeErrorAt = 2;
    await expect(processPush([
      { ...patch, clientVersion: 0 },
      { ...patch, entityId: 'note-2', clientVersion: 0 },
    ], 'user-1')).rejects.toThrow('Constraint failure');
    expect(state.events).not.toHaveBeenCalled();
  });

  it('publishes no events when commit fails', async () => {
    state.rows.push([current]);
    state.returned.push([{ ...current, version: 4 }]);
    state.commitError = true;
    await expect(processPush([patch], 'user-1')).rejects.toThrow('Commit failure');
    expect(state.events).not.toHaveBeenCalled();
  });

  it('creates ownership before children in the same transaction', async () => {
    state.rows.push([{ active: true, role: 'analyst' }], [], [], []);
    state.returned.push([{ id: 'new-folder', name: 'New', version: 1 }], [{ id: 'child', folderId: 'new-folder', version: 1 }]);
    const result = await processPush([
      { table: 'notes', entityId: 'child', op: 'put', clientVersion: 0, data: { title: 'Child', folderId: 'new-folder' } },
      { table: 'folders', entityId: 'new-folder', op: 'put', clientVersion: 0, data: { name: 'New' } },
    ], 'user-1', { authorize: true });
    expect(result.map(row => row.status)).toEqual(['accepted', 'accepted']);
    expect(state.inserts[1]).toMatchObject({ folderId: 'new-folder', userId: 'user-1', role: 'owner' });
  });

  it('rejects a user without current write membership before returning record contents', async () => {
    state.rows.push([{ active: true, role: 'analyst' }], [], [current]);
    expect(await processPush([patch], 'user-1', { authorize: true })).toEqual([{ table: 'notes', entityId: current.id, status: 'rejected' }]);
    expect(state.updates).toEqual([]);
  });

  it('rejects duplicate identities before any writes', async () => {
    await expect(processPush([patch, patch], 'user-1')).rejects.toThrow('Duplicate');
    expect(state.updates).toEqual([]);
  });

  it('rejects unknown tables before any writes', async () => {
    await expect(processPush([{ ...patch, table: 'unknown' }], 'user-1')).rejects.toThrow('Unknown table');
  });
});

describe('evidence preview sync contract', () => {
  it.each([undefined, 'application/pdf', 'image/tiff', 7])('rejects preview MIME %s before acknowledging bytes', async imageDataMimeType => {
    state.rows.push([]);
    await expect(processPush([{ table: 'evidenceItems', entityId: 'image', op: 'put', clientVersion: 0,
      data: { imageData: 'YQ==', imageDataMimeType } }], 'user')).rejects.toThrow('MIME type');
    expect(state.inserts).toEqual([]);
    expect(state.events).not.toHaveBeenCalled();
  });
  it('normalizes a supported MIME and retains existing MIME for an image-only PATCH', async () => {
    state.rows.push([]);
    state.returned.push([{ id: 'image', version: 1 }]);
    await processPush([{ table: 'evidenceItems', entityId: 'image', op: 'put', clientVersion: 0,
      data: { imageData: 'YQ==', imageDataMimeType: ' IMAGE/PNG ' } }], 'user');
    expect(state.inserts[0].imageDataMimeType).toBe('image/png');
    state.rows.push([{ id: 'image', version: 1, imageData: 'YQ==', imageDataMimeType: 'image/png' }]);
    state.returned.push([{ id: 'image', version: 2 }]);
    await processPush([{ table: 'evidenceItems', entityId: 'image', op: 'put', clientVersion: 1, data: { imageData: 'Yg==' } }], 'user');
    expect(state.updates[0].imageData).toBe('Yg==');
  });
  it('rejects removing the MIME while retaining bytes, but permits explicit preview removal', async () => {
    const current = { id: 'image', version: 1, imageData: 'YQ==', imageDataMimeType: 'image/png' };
    state.rows.push([current]);
    await expect(processPush([{ table: 'evidenceItems', entityId: 'image', op: 'put', clientVersion: 1,
      data: { imageDataMimeType: null } }], 'user')).rejects.toThrow('MIME type');
    state.rows.push([current]); state.returned.push([{ ...current, version: 2 }]);
    expect((await processPush([{ table: 'evidenceItems', entityId: 'image', op: 'put', clientVersion: 1,
      data: { imageData: null, imageDataMimeType: null } }], 'user'))[0].status).toBe('accepted');
  });
});

describe('legacy sync compatibility and folder lookup', () => {
  it('returns a folder for normal and soft-deleted records', async () => {
    state.rows.push([{ folderId: 'folder-1', deletedAt: new Date() }]);
    expect(await lookupEntityFolderId('notes', 'note-1')).toBe('folder-1');
  });

  it('returns no folder for missing records and global catalogs', async () => {
    state.rows.push([]);
    expect(await lookupEntityFolderId('notes', 'missing')).toBeUndefined();
    expect(await lookupEntityFolderId('tags', 'tag-1')).toBeUndefined();
  });

  it('includes only shared catalogs when there are no memberships', async () => {
    state.rows.push([{ id: 'tag-1', name: 'Tag' }], []);
    expect((await pullChanges('2000-01-01', [])).changes).toEqual([{ table: 'tags', op: 'put', id: 'tag-1', name: 'Tag' }]);
  });

  it('represents soft-deleted catalog records as deletes', async () => {
    state.rows.push([{ id: 'tag-1', deletedAt: new Date() }], []);
    expect((await pullChanges('2000-01-01', [])).changes).toEqual([{ table: 'tags', op: 'delete', id: 'tag-1' }]);
  });
});
