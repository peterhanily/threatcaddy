import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { scratchDatabase, type ScratchDatabase } from './database.js';
import { applyCurrentMigrations } from './migrations.js';

const state = vi.hoisted(() => ({ db: undefined as unknown, events: vi.fn() }));
vi.mock('../src/db/index.js', () => ({ db: new Proxy({}, { get(_target, property) {
  const database = state.db as Record<PropertyKey, unknown>;
  const value = database[property];
  return typeof value === 'function' ? value.bind(database) : value;
} }) }));
vi.mock('../src/bots/event-bus.js', () => ({ emitEntityEvent: state.events }));

import { processPush, pullCursorChanges } from '../src/services/sync-service.js';

describe('committed sync revisions and cursors in PostgreSQL', () => {
  let database: ScratchDatabase;
  beforeEach(async () => {
    database = await scratchDatabase({ maxConnections: 4 });
    state.db = database.db;
    state.events.mockClear();
    await applyCurrentMigrations(database);
    await database.sql`INSERT INTO users (id,email,display_name,password_hash,role) VALUES
      ('owner','owner@example.invalid','Owner','fixture','analyst'),
      ('reader','reader@example.invalid','Reader','fixture','analyst')`;
    await database.sql`INSERT INTO folders (id,name,created_at,updated_at) VALUES
      ('shared','Shared',now(),now()), ('private','Private',now(),now())`;
    await database.sql`INSERT INTO investigation_members (id,folder_id,user_id,role) VALUES
      ('owner-shared','shared','owner','owner'), ('owner-private','private','owner','owner'), ('reader-shared','shared','reader','viewer')`;
    await database.sql`INSERT INTO notes (id,title,content,folder_id,created_at,updated_at) VALUES
      ('note-a','Initial A','A body','shared',now(),now()), ('note-b','Initial B','B body','shared',now(),now()),
      ('private-note','Private note','Private body','private',now(),now())`;
  });
  afterEach(async () => { await database?.close(); });

  it('requires the observed revision for both edits and deletes', async () => {
    for (const op of ['put', 'delete'] as const) {
      for (const clientVersion of [undefined, 0, 5]) {
        const [result] = await processPush([{ table: 'notes', entityId: 'note-a', op, clientVersion, data: { title: 'Changed' } }], 'owner', { authorize: true });
        expect(result).toMatchObject({ status: 'conflict', serverVersion: 1 });
      }
    }
    const [saved] = await processPush([{ table: 'notes', entityId: 'note-a', op: 'put', clientVersion: 1, data: { title: 'Saved' } }], 'owner', { authorize: true });
    expect(saved).toMatchObject({ status: 'accepted', serverVersion: 2 });
    const [staleDelete] = await processPush([{ table: 'notes', entityId: 'note-a', op: 'delete', clientVersion: 1 }], 'owner', { authorize: true });
    expect(staleDelete).toMatchObject({ status: 'conflict', serverVersion: 2 });
    expect((await database.sql`SELECT title,deleted_at FROM notes WHERE id = 'note-a'`)[0]).toEqual({ title: 'Saved', deleted_at: null });
  });

  it('serializes concurrent normal edits from the same baseline without losing one silently', async () => {
    const results = await Promise.all(['First edit', 'Second edit'].map(title => processPush([
      { table: 'notes', entityId: 'note-a', op: 'put', clientVersion: 1, data: { title } },
    ], 'owner', { authorize: true })));
    expect(results.map(result => result[0].status).sort()).toEqual(['accepted', 'conflict']);
    expect((await database.sql`SELECT version FROM notes WHERE id = 'note-a'`)[0].version).toBe(2);
  });

  it('rolls back all writes, clock changes and events after an ordinary constraint failure', async () => {
    const before = (await database.sql`SELECT cursor FROM sync_clock WHERE id = 1`)[0].cursor;
    await expect(processPush([
      { table: 'notes', entityId: 'note-a', op: 'put', clientVersion: 1, data: { title: 'Should roll back' } },
      { table: 'notes', entityId: 'note-b', op: 'put', clientVersion: 1, data: { title: null } },
    ], 'owner', { authorize: true })).rejects.toThrow();
    expect((await database.sql`SELECT title,version FROM notes WHERE id = 'note-a'`)[0]).toEqual({ title: 'Initial A', version: 1 });
    expect((await database.sql`SELECT cursor FROM sync_clock WHERE id = 1`)[0].cursor).toBe(before);
    expect(state.events).not.toHaveBeenCalled();
  });

  it('acknowledges an already-absent delete with a zero revision and no side effects', async () => {
    const before = (await database.sql`SELECT cursor FROM sync_clock WHERE id = 1`)[0].cursor;
    expect(await processPush([{ table: 'notes', entityId: 'already-absent', op: 'delete', clientVersion: 3 }], 'owner', { authorize: true }))
      .toEqual([{ table: 'notes', entityId: 'already-absent', status: 'accepted', serverVersion: 0 }]);
    expect((await database.sql`SELECT cursor FROM sync_clock WHERE id = 1`)[0].cursor).toBe(before);
    expect(state.events).not.toHaveBeenCalled();
  });

  it('offers a zero-revision conflict for an edit after physical cleanup and permits explicit recreation', async () => {
    await database.sql`DELETE FROM notes WHERE id = 'note-a'`;
    const deletedPage = await pullCursorChanges('0', 'reader');
    expect(deletedPage.changes).toContainEqual({ table: 'notes', op: 'delete', id: 'note-a', version: 2 });
    const edit = { table: 'notes', entityId: 'note-a', op: 'put' as const, clientVersion: 1,
      data: { title: 'Recovered local edit', content: 'Retained content', folderId: 'shared' } };
    const [conflict] = await processPush([edit], 'owner', { authorize: true });
    expect(conflict).toMatchObject({ status: 'conflict', serverVersion: 0 });
    expect(conflict.serverData).toBeUndefined();
    expect(await database.sql`SELECT id FROM notes WHERE id = 'note-a'`).toEqual([]);
    expect(state.events).not.toHaveBeenCalled();
    const [recreated] = await processPush([{ ...edit, clientVersion: 0 }], 'owner', { authorize: true });
    expect(recreated).toMatchObject({ status: 'accepted', serverVersion: 3,
      serverRecord: { title: 'Recovered local edit', content: 'Retained content', folderId: 'shared' } });
    expect((await pullCursorChanges(deletedPage.cursor, 'reader')).changes)
      .toEqual([expect.objectContaining({ table: 'notes', id: 'note-a', op: 'put', version: 3, title: 'Recovered local edit' })]);
  });

  it('restores a tombstone only after authorization and its current revision are confirmed', async () => {
    const [removed] = await processPush([{ table: 'notes', entityId: 'note-a', op: 'delete', clientVersion: 1 }], 'owner', { authorize: true });
    expect(removed).toMatchObject({ status: 'accepted', serverVersion: 2 });
    const cursor = (await pullCursorChanges('0', 'owner')).cursor;
    const restore = { table: 'notes', entityId: 'note-a', op: 'put' as const, clientVersion: 2,
      data: { title: 'Restored note', folderId: 'shared' } };
    expect((await processPush([{ ...restore, clientVersion: 1 }], 'owner', { authorize: true }))[0])
      .toMatchObject({ status: 'conflict', serverVersion: 2 });
    expect((await processPush([restore], 'reader', { authorize: true }))[0].status).toBe('rejected');
    expect((await database.sql`SELECT deleted_at FROM notes WHERE id = 'note-a'`)[0].deleted_at).not.toBeNull();
    expect((await processPush([restore], 'owner', { authorize: true }))[0])
      .toMatchObject({ status: 'accepted', serverVersion: 3, serverRecord: { deletedAt: null, content: 'A body' } });
    expect((await pullCursorChanges(cursor, 'reader')).changes)
      .toEqual([expect.objectContaining({ table: 'notes', id: 'note-a', op: 'put', title: 'Restored note', version: 3, deletedAt: null })]);
  });

  it('retains revision continuity for every API table whose database name differs', async () => {
    const fixtures = [
      { table: 'timelineEvents', dbName: 'timeline_events', data: { title: 'Timeline entry', timestamp: new Date(), eventType: 'other', timelineId: 'timeline' } },
      { table: 'standaloneIOCs', dbName: 'standalone_iocs', data: { type: 'domain', value: 'example.invalid' } },
      { table: 'chatThreads', dbName: 'chat_threads', data: { title: 'Thread', model: 'fixture', provider: 'local' } },
    ];
    for (const fixture of fixtures) {
      const change = { table: fixture.table, entityId: 'reused-id', op: 'put' as const, clientVersion: 0,
        data: { ...fixture.data, folderId: 'shared' } };
      expect((await processPush([change], 'owner', { authorize: true }))[0]).toMatchObject({ status: 'accepted', serverVersion: 1 });
      await database.sql`DELETE FROM ${database.sql(fixture.dbName)} WHERE id = 'reused-id'`;
      expect((await processPush([change], 'owner', { authorize: true }))[0]).toMatchObject({ status: 'accepted', serverVersion: 3 });
    }
    const page = await pullCursorChanges('0', 'reader');
    for (const fixture of fixtures) expect(page.changes).toContainEqual(expect.objectContaining({ table: fixture.table, id: 'reused-id', op: 'put', version: 3 }));
  });

  it('creates the folder owner and children together even when children arrive first', async () => {
    const results = await processPush([
      { table: 'notes', entityId: 'new-note', op: 'put', clientVersion: 0, data: { title: 'Child', folderId: 'new-folder' } },
      { table: 'folders', entityId: 'new-folder', op: 'put', clientVersion: 0, data: { name: 'New investigation' } },
    ], 'owner', { authorize: true });
    expect(results.map(result => result.status)).toEqual(['accepted', 'accepted']);
    expect((await database.sql`SELECT role FROM investigation_members WHERE folder_id = 'new-folder' AND user_id = 'owner'`)[0].role).toBe('owner');
    expect((await database.sql`SELECT folder_id FROM notes WHERE id = 'new-note'`)[0].folder_id).toBe('new-folder');
    expect(state.events).toHaveBeenCalledTimes(2);
  });

  it('captures updates made outside the sync service and keeps unspecified patch fields', async () => {
    const initial = await pullCursorChanges('0', 'owner');
    await database.sql`UPDATE notes SET title = 'Route update', updated_at = '2000-01-01' WHERE id = 'note-a'`;
    const page = await pullCursorChanges(initial.cursor, 'owner');
    expect(page.changes).toEqual([expect.objectContaining({ table: 'notes', id: 'note-a', title: 'Route update', version: 2, content: 'A body' })]);
    const [patched] = await processPush([{ table: 'notes', entityId: 'note-a', op: 'put', data: { title: 'Internal patch' } }], 'owner', { trustedInternal: true });
    expect(patched).toMatchObject({ status: 'accepted', serverRecord: { content: 'A body', version: 3 } });
  });

  it('pages committed changes and filters current membership without advancing past pending commits', async () => {
    const initial = await pullCursorChanges('0', 'reader');
    let release!: () => void;
    let started!: () => void;
    const held = new Promise<void>(resolve => { release = resolve; });
    const written = new Promise<void>(resolve => { started = resolve; });
    const pending = database.sql.begin(async transaction => {
      await transaction`UPDATE notes SET title = 'Delayed commit' WHERE id = 'note-a'`;
      started();
      await held;
    });
    try {
      await written;
      const whilePending = await pullCursorChanges(initial.cursor, 'reader');
      expect(whilePending.changes).toEqual([]);
      expect(whilePending.cursor).toBe(initial.cursor);
      // A separate writer cannot allocate and commit a later cursor first.
      await expect(database.sql.begin(async transaction => {
        await transaction`SET LOCAL lock_timeout = '150ms'`;
        await transaction`UPDATE notes SET title = 'Later writer' WHERE id = 'note-b'`;
      })).rejects.toMatchObject({ code: '55P03' });
    } finally { release(); await pending; }
    await database.sql`UPDATE notes SET title = 'Later writer' WHERE id = 'note-b'`;
    await database.sql`UPDATE notes SET title = 'Private update' WHERE id = 'private-note'`;
    const first = await pullCursorChanges(initial.cursor, 'reader', { limit: 1 });
    expect(first.hasMore).toBe(true);
    expect(first.changes[0]).toMatchObject({ id: 'note-a', title: 'Delayed commit' });
    const second = await pullCursorChanges(first.cursor, 'reader', { limit: 1 });
    expect(second.hasMore).toBe(false);
    expect(second.changes[0]).toMatchObject({ id: 'note-b', title: 'Later writer' });
    expect(JSON.stringify([first, second])).not.toContain('Private update');
    expect((await pullCursorChanges(second.cursor, 'reader')).changes).toEqual([]);
  });

  it('sends only a removal when an entity moves to an inaccessible investigation', async () => {
    const initial = await pullCursorChanges('0', 'reader');
    await database.sql`UPDATE notes SET folder_id = 'private', content = 'Destination content' WHERE id = 'note-a'`;
    const page = await pullCursorChanges(initial.cursor, 'reader');
    expect(page.changes).toEqual([{ table: 'notes', op: 'delete', id: 'note-a', version: 2 }]);
    expect(JSON.stringify(page)).not.toContain('Destination content');
  });

  it('retains deletions after physical cleanup and honors current membership on the next read', async () => {
    const initial = await pullCursorChanges('0', 'reader');
    await database.sql`DELETE FROM notes WHERE id = 'note-a'`;
    expect((await pullCursorChanges(initial.cursor, 'reader')).changes).toEqual([{ table: 'notes', op: 'delete', id: 'note-a', version: 2 }]);
    await database.sql`DELETE FROM investigation_members WHERE user_id = 'reader'`;
    expect((await pullCursorChanges('0', 'reader')).changes).toEqual([]);
  });

  it('coalesces repeated changes in one page to the final operation and strips metadata fields', async () => {
    const initial = await pullCursorChanges('0', 'reader');
    await database.sql`UPDATE notes SET title = 'First update' WHERE id = 'note-a'`;
    await database.sql`UPDATE notes SET title = 'Final update' WHERE id = 'note-a'`;
    const page = await pullCursorChanges(initial.cursor, 'reader', { metadataOnly: true });
    expect(page.changes).toHaveLength(1);
    expect(page.changes[0]).toMatchObject({ id: 'note-a', title: 'Final update', version: 3 });
    expect(page.changes[0]).not.toHaveProperty('content');
  });

  it('rejects a cursor from a newer server state with a reset instruction', async () => {
    await expect(pullCursorChanges('999999', 'reader')).rejects.toMatchObject({ status: 409, resetRequired: true });
  });
});
