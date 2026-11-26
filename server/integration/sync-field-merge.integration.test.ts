import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { scratchDatabase, testDatabaseUrl, type ScratchDatabase } from './database.js';
import { applyCurrentMigrations } from './migrations.js';

const state = vi.hoisted(() => ({ db: undefined as unknown }));
vi.mock('../src/db/index.js', () => ({ db: new Proxy({}, { get(_target, property) {
  const database = state.db as Record<PropertyKey, unknown>;
  const value = database[property];
  return typeof value === 'function' ? value.bind(database) : value;
} }) }));
vi.mock('../src/bots/event-bus.js', () => ({ emitEntityEvent: vi.fn() }));

import { processPush } from '../src/services/sync-service.js';
import { compactSyncHistory } from '../src/services/cleanup-service.js';

testDatabaseUrl(process.env.TEST_DATABASE_URL);

const task = (changes: Record<string, unknown> = {}) => ({ folderId: 'case', title: 'Collect logs', completed: false, priority: 'none', status: 'todo',
  order: 0, tags: [], trashed: false, archived: false, ...changes });
const put = (data: Record<string, unknown>, clientVersion: number) => [{ table: 'tasks', entityId: 't1', op: 'put' as const, clientVersion, data }];

describe('merging two people\'s changes to one record in PostgreSQL', () => {
  let database: ScratchDatabase;
  let generation: string;
  beforeEach(async () => {
    database = await scratchDatabase({ maxConnections: 4 });
    state.db = database.db;
    await applyCurrentMigrations(database);
    await database.sql`INSERT INTO users (id,email,display_name,password_hash,role) VALUES
      ('dana','dana@example.invalid','Dana','fixture','analyst'), ('omar','omar@example.invalid','Omar','fixture','analyst')`;
    await database.sql`INSERT INTO folders (id,name,created_at,updated_at) VALUES ('case','Case',now(),now())`;
    await database.sql`INSERT INTO investigation_members (id,folder_id,user_id,role) VALUES ('m1','case','dana','owner'), ('m2','case','omar','editor')`;
    generation = (await database.sql`SELECT generation FROM sync_clock`)[0].generation;
  });
  afterEach(async () => { await database?.close(); });

  const push = (user: string, data: Record<string, unknown>, clientVersion: number, fieldMerge = true) =>
    processPush(put(data, clientVersion), user, { authorize: true, generation, rejectInvalidChanges: true, ...(fieldMerge ? { fieldMerge: true } : {}) });
  const row = async () => (await database.sql`SELECT title, priority, status, version FROM tasks WHERE id = 't1'`)[0];

  it('keeps both changes when they are to different fields, and conflicts as before otherwise', async () => {
    const [created] = await push('dana', task(), 0);
    expect(created).toMatchObject({ status: 'accepted', serverVersion: 1 });

    // Both have revision 1. Dana sets the priority; Omar, who has not seen that, sets the status.
    expect((await push('dana', task({ priority: 'high' }), 1))[0]).toMatchObject({ status: 'accepted', serverVersion: 2 });
    const [merged] = await push('omar', task({ status: 'in-progress' }), 1);
    expect(merged).toMatchObject({ status: 'accepted', serverVersion: 3, merged: true });
    expect(merged.serverRecord).toMatchObject({ priority: 'high', status: 'in-progress' });
    expect({ ...(await row()) }).toEqual({ title: 'Collect logs', priority: 'high', status: 'in-progress', version: 3 });

    // Omar still edits from revision 1 (he has not pulled). A second change is merged the same way,
    // and his first one, already stored, is not a conflict.
    const [again] = await push('omar', task({ status: 'in-progress', title: 'Collect all logs' }), 1);
    expect(again).toMatchObject({ status: 'accepted', serverVersion: 4, merged: true });
    expect({ ...(await row()) }).toEqual({ title: 'Collect all logs', priority: 'high', status: 'in-progress', version: 4 });

    // Nothing new in the put: accepted without a write, still marked merged.
    const [nothing] = await push('omar', task({ status: 'in-progress', title: 'Collect all logs' }), 1);
    expect(nothing).toMatchObject({ status: 'accepted', serverVersion: 4, unchanged: true, merged: true });

    // The same field, changed to different values: a conflict, with the stored row to compare.
    const [conflict] = await push('omar', task({ priority: 'low' }), 1);
    expect(conflict).toMatchObject({ status: 'conflict', serverVersion: 4 });
    expect(conflict.serverData).toMatchObject({ priority: 'high' });
    expect((await row()).version).toBe(4);
  });

  it('does not merge for a client that did not ask, for a move, for a deleted record or once the base is gone', async () => {
    await push('dana', task(), 0);
    await push('dana', task({ priority: 'high' }), 1);
    // An older client sends no `merge`: it could not keep its baseline, so it gets the conflict.
    expect((await push('omar', task({ status: 'in-progress' }), 1, false))[0]).toMatchObject({ status: 'conflict', serverVersion: 2 });

    await database.sql`INSERT INTO folders (id,name,created_at,updated_at) VALUES ('other','Other',now(),now())`;
    await database.sql`INSERT INTO investigation_members (id,folder_id,user_id,role) VALUES ('m3','other','omar','owner')`;
    expect((await push('omar', task({ folderId: 'other' }), 1))[0]).toMatchObject({ status: 'conflict' });

    // The revision Omar edited is compacted away: nothing to compare with.
    await database.sql`UPDATE sync_changes SET created_at = now() - interval '100 days'`;
    expect(await compactSyncHistory(90)).toBeGreaterThan(0);
    expect((await push('omar', task({ status: 'in-progress' }), 1))[0]).toMatchObject({ status: 'conflict', serverVersion: 2 });

    await processPush([{ table: 'tasks', entityId: 't1', op: 'delete', clientVersion: 2 }], 'dana', { authorize: true, generation });
    expect((await push('omar', task({ status: 'in-progress' }), 2))[0]).toMatchObject({ status: 'conflict' });
  });
});
