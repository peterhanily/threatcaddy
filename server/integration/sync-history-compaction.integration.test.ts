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

import { clientSyncTables, pullCursorChanges, SYNC_TABLE_NAMES } from '../src/services/sync-service.js';
import { compactSyncHistory, getSyncHistoryRetentionDays } from '../src/services/cleanup-service.js';

testDatabaseUrl(process.env.TEST_DATABASE_URL);
const tables = clientSyncTables(SYNC_TABLE_NAMES.join(','));

describe('sync history compaction in PostgreSQL', () => {
  let database: ScratchDatabase;
  beforeEach(async () => {
    database = await scratchDatabase({ maxConnections: 4 });
    state.db = database.db;
    await applyCurrentMigrations(database);
    await database.sql`INSERT INTO users (id,email,display_name,password_hash,role) VALUES
      ('both','both@example.invalid','Both','fixture','analyst'), ('only-a','a@example.invalid','Only A','fixture','analyst')`;
    await database.sql`INSERT INTO folders (id,name,created_at,updated_at) VALUES ('a','A',now(),now()), ('b','B',now(),now())`;
    await database.sql`INSERT INTO investigation_members (id,folder_id,user_id,role) VALUES
      ('m1','a','both','owner'), ('m2','b','both','owner'), ('m3','a','only-a','viewer')`;
  });
  afterEach(async () => { await database?.close(); });

  const note = (id: string, folder: string, title: string) =>
    database.sql`INSERT INTO notes (id,title,content,folder_id,created_at,updated_at) VALUES (${id},${title},'',${folder},now(),now())`;
  const retitle = (id: string, title: string) => database.sql`UPDATE notes SET title = ${title} WHERE id = ${id}`;
  const history = async (id: string) => (await database.sql`SELECT folder_id, previous_folder_id, op, record->>'title' AS title
    FROM sync_changes WHERE entity_id = ${id} ORDER BY cursor`).map(row => ({ ...row }));
  /** What a client that starts from nothing ends with, by record id. */
  async function finalState(user: string) {
    const state = new Map<string, unknown>();
    let cursor = '0';
    for (;;) {
      const page = await pullCursorChanges(cursor, user, { tables, limit: 2 });
      for (const change of page.changes as Array<Record<string, unknown>>) {
        state.set(`${change.table}:${change.id}`, change.op === 'delete' ? 'deleted' : (change.data as Record<string, unknown> | undefined)?.title ?? change.title);
      }
      cursor = page.cursor;
      if (!page.hasMore) return Object.fromEntries([...state].filter(([key]) => key.startsWith('notes:')).sort());
    }
  }

  it('removes superseded revisions and leaves every client ending in the same state', async () => {
    await note('edited', 'a', 'v1'); await retitle('edited', 'v2'); await retitle('edited', 'v3');
    await note('moved', 'a', 'in A'); await retitle('moved', 'still in A');
    await database.sql`UPDATE notes SET folder_id = 'b' WHERE id = 'moved'`;
    await retitle('moved', 'in B'); await retitle('moved', 'in B again');
    await note('deleted', 'a', 'gone soon'); await retitle('deleted', 'gone sooner');
    await database.sql`UPDATE notes SET deleted_at = now() WHERE id = 'deleted'`;
    await note('untouched', 'a', 'once');

    const before = { both: await finalState('both'), onlyA: await finalState('only-a') };
    expect(before.onlyA['notes:moved']).toBe('deleted');
    const rows = Number((await database.sql`SELECT count(*)::int AS n FROM sync_changes`)[0].n);
    const maxCursor = (await database.sql`SELECT max(cursor)::text AS c FROM sync_changes`)[0].c;

    // Nothing is old enough yet.
    expect(await compactSyncHistory(90)).toBe(0);
    await database.sql`UPDATE sync_changes SET created_at = now() - interval '100 days'`;
    const removed = await compactSyncHistory(90, 2);
    expect(removed).toBeGreaterThan(0);
    expect(Number((await database.sql`SELECT count(*)::int AS n FROM sync_changes`)[0].n)).toBe(rows - removed);

    expect(await history('edited')).toEqual([{ folder_id: 'a', previous_folder_id: null, op: 'put', title: 'v3' }]);
    // The last row in A, the move itself and the newest row in B stay; the edits between go.
    expect(await history('moved')).toEqual([
      { folder_id: 'a', previous_folder_id: null, op: 'put', title: 'still in A' },
      { folder_id: 'b', previous_folder_id: 'a', op: 'put', title: 'still in A' },
      { folder_id: 'b', previous_folder_id: null, op: 'put', title: 'in B again' },
    ]);
    expect(await history('untouched')).toHaveLength(1);
    expect((await history('deleted')).at(-1)).toMatchObject({ folder_id: 'a' });
    expect(await history('deleted')).toHaveLength(1);

    expect({ both: await finalState('both'), onlyA: await finalState('only-a') }).toEqual(before);
    // The newest cursor is still in the log, and a re-used id continues from the kept version.
    expect((await database.sql`SELECT max(cursor)::text AS c FROM sync_changes`)[0].c).toBe(maxCursor);
    expect(await compactSyncHistory(90)).toBe(0);
  });

  it('keeps everything when retention is 0, and reads the setting', async () => {
    await note('edited', 'a', 'v1'); await retitle('edited', 'v2');
    await database.sql`UPDATE sync_changes SET created_at = now() - interval '400 days'`;
    expect(await compactSyncHistory(0)).toBe(0);
    expect(await history('edited')).toHaveLength(2);
    expect(await getSyncHistoryRetentionDays()).toBe(90);
    await database.sql`INSERT INTO server_settings (key, value) VALUES ('sync_history_retention_days', '0')`;
    expect(await getSyncHistoryRetentionDays()).toBe(0);
    await database.sql`UPDATE server_settings SET value = '30' WHERE key = 'sync_history_retention_days'`;
    expect(await getSyncHistoryRetentionDays()).toBe(30);
  });
});
