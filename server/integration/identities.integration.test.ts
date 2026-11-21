import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readMigrationFiles } from 'drizzle-orm/migrator';
import { scratchDatabase, testDatabaseUrl, type ScratchDatabase } from './database.js';
import { applyCurrentMigrations, applySchemaPushFixture, currentMigrations, migrationJournal, missingMigrationRecords, preservedData, seedHistoricalData } from './migrations.js';
import { schemaDifferences } from './schema-parity.js';

const state = vi.hoisted(() => ({ db: undefined as unknown, events: vi.fn() }));
vi.mock('../src/db/index.js', () => ({ db: new Proxy({}, { get(_target, property) {
  const database = state.db as Record<PropertyKey, unknown>;
  const value = database[property];
  return typeof value === 'function' ? value.bind(database) : value;
} }) }));
vi.mock('../src/bots/event-bus.js', () => ({ emitEntityEvent: state.events }));

import { clientSyncTables, getSnapshot, processPush, pullChanges, pullCursorChanges, SYNC_TABLE_NAMES } from '../src/services/sync-service.js';
import { purgeExpiredInvestigation } from '../src/services/investigation-lifecycle.js';

// Fail immediately when no isolated database was explicitly provided. Never silently skip integration.
testDatabaseUrl(process.env.TEST_DATABASE_URL);

/** What a current client lists, and what a 2.0.4 client (which lists nothing) gets. */
const currentClient = clientSyncTables(SYNC_TABLE_NAMES.join(','));
const privatePhone = { id: 'phone', label: 'Phone', value: '+1 555 0100', private: true };
const identity = (name: string, extra: Record<string, unknown> = {}) => ({ folderId: 'shared', type: 'person', name, aliases: [],
  details: [privatePhone], connections: [], tags: [], trashed: false, archived: false, ...extra });
const putIdentity = (entityId: string, data: Record<string, unknown>, clientVersion = 0) =>
  ({ table: 'identities', entityId, op: 'put' as const, clientVersion, data });

/** Applies committed migrations through `tag` exactly as the release that shipped it did. */
async function migrateThrough(database: ScratchDatabase, tag: string) {
  const last = (await migrationJournal()).entries.findIndex(entry => entry.tag === tag);
  if (last < 0) throw new Error(`Missing migration ${tag}`);
  await database.sql.begin(async transaction => {
    await transaction`SET LOCAL search_path = public`;
    await transaction`CREATE SCHEMA IF NOT EXISTS drizzle`;
    await transaction`CREATE TABLE IF NOT EXISTS drizzle.__drizzle_migrations (id SERIAL PRIMARY KEY, hash text NOT NULL, created_at bigint)`;
    for (const migration of readMigrationFiles({ migrationsFolder: currentMigrations }).slice(0, last + 1)) {
      for (const statement of migration.sql) if (statement.trim()) await transaction.unsafe(statement);
      await transaction`INSERT INTO drizzle.__drizzle_migrations (hash, created_at) VALUES (${migration.hash}, ${migration.folderMillis})`;
    }
  });
}

describe('the identities migration in PostgreSQL', () => {
  const databases: ScratchDatabase[] = [];
  async function fresh() { const database = await scratchDatabase(); databases.push(database); return database; }
  afterEach(async () => {
    const results = await Promise.allSettled(databases.splice(0).map(database => database.close()));
    const failures = results.filter(result => result.status === 'rejected');
    if (failures.length) throw new AggregateError(failures.map(result => result.reason), 'Scratch database cleanup failed');
  });

  it('upgrades a database at 0024 without changing its data, sync history or history generation', async () => {
    const database = await fresh();
    await migrateThrough(database, '0024_ioc_provenance');
    expect((await database.sql`SELECT to_regclass('public.identities') AS identities`)[0].identities).toBeNull();
    await seedHistoricalData(database);
    const data = await preservedData(database);
    const history = await database.sql`SELECT cursor::text, table_name, entity_id, op, record FROM sync_changes ORDER BY cursor`;
    const clock = await database.sql`SELECT cursor::text, generation FROM sync_clock`;
    expect(history.length).toBeGreaterThan(0);
    await applyCurrentMigrations(database);
    expect(await preservedData(database)).toEqual(data);
    expect(await database.sql`SELECT cursor::text, table_name, entity_id, op, record FROM sync_changes ORDER BY cursor`).toEqual(history);
    expect(await database.sql`SELECT cursor::text, generation FROM sync_clock`).toEqual(clock);
    expect(await schemaDifferences(database.sql)).toEqual([]);
    expect(await missingMigrationRecords(database)).toEqual([]);
  });

  it('adopts a schema-push installation from before identities and records their changes afterwards', async () => {
    const database = await fresh();
    await applySchemaPushFixture(database);
    await database.sql`DROP TABLE identities`;
    await seedHistoricalData(database);
    const data = await preservedData(database);
    await applyCurrentMigrations(database);
    expect(await preservedData(database)).toEqual(data);
    expect(await schemaDifferences(database.sql)).toEqual([]);
    expect(await missingMigrationRecords(database)).toEqual([]);
    await database.sql`INSERT INTO identities (id,folder_id,type,name,created_at,updated_at)
      VALUES ('later','fixture-folder','person','Synthetic Person',now(),now())`;
    expect(await database.sql`SELECT table_name, folder_id, op FROM sync_changes WHERE entity_id = 'later'`)
      .toEqual([{ table_name: 'identities', folder_id: 'fixture-folder', op: 'put' }]);
  });

  it('records the history of identities a schema-push installation already holds', async () => {
    const database = await fresh();
    await applySchemaPushFixture(database);
    await seedHistoricalData(database);
    await database.sql`INSERT INTO identities (id,folder_id,type,name,version,created_at,updated_at)
      VALUES ('pushed','fixture-folder','organization','Synthetic Org',3,now(),now())`;
    await applyCurrentMigrations(database);
    expect(await database.sql`SELECT table_name, folder_id, op, (record->>'version')::int AS version FROM sync_changes WHERE entity_id = 'pushed'`)
      .toEqual([{ table_name: 'identities', folder_id: 'fixture-folder', op: 'put', version: 3 }]);
  });

  it('refuses to adopt a partial identities table without creating history', async () => {
    const database = await fresh();
    await applySchemaPushFixture(database);
    await database.sql`ALTER TABLE identities DROP COLUMN details`;
    await expect(applyCurrentMigrations(database)).rejects.toThrow(/Cannot adopt.*identities\.details/);
    expect((await database.sql`SELECT to_regclass('drizzle.__drizzle_migrations') AS journal`)[0].journal).toBeNull();
  });
});

describe('identity sync in PostgreSQL', () => {
  let database: ScratchDatabase;
  beforeEach(async () => {
    database = await scratchDatabase({ maxConnections: 4 });
    state.db = database.db;
    state.events.mockClear();
    await applyCurrentMigrations(database);
    await database.sql`INSERT INTO users (id,email,display_name,password_hash,role) VALUES
      ('owner','owner@example.invalid','Owner','fixture','analyst'), ('editor','editor@example.invalid','Editor','fixture','analyst'),
      ('reader','reader@example.invalid','Reader','fixture','analyst'), ('outsider','outsider@example.invalid','Outsider','fixture','analyst')`;
    await database.sql`INSERT INTO folders (id,name,created_at,updated_at) VALUES ('shared','Shared',now(),now()), ('other','Other',now(),now())`;
    await database.sql`INSERT INTO investigation_members (id,folder_id,user_id,role) VALUES
      ('m1','shared','owner','owner'), ('m2','shared','editor','editor'), ('m3','shared','reader','viewer'), ('m4','other','owner','owner')`;
  });
  afterEach(async () => { await database?.close(); });

  it('sends identities only to clients that list them, and moves an older client past them', async () => {
    const start = (await pullCursorChanges('0', 'reader', { tables: currentClient })).cursor;
    expect((await processPush([putIdentity('dana', identity('Dana Okafor')), putIdentity('lee', identity('Lee Park'))], 'editor', { authorize: true }))
      .map(result => result.status)).toEqual(['accepted', 'accepted']);
    await processPush([{ table: 'notes', entityId: 'note', op: 'put', clientVersion: 0, data: { folderId: 'shared', title: 'Seen by every client' } }], 'editor', { authorize: true });

    const current = await pullCursorChanges(start, 'reader', { tables: currentClient });
    expect(current.tables).toContain('identities');
    expect(current.changes).toContainEqual(expect.objectContaining({ table: 'identities', id: 'dana', op: 'put', name: 'Dana Okafor', details: [privatePhone] }));
    // A 2.0.4 client lists no tables. Identities never fill its page, and its cursor still advances past them.
    const older = await pullCursorChanges(start, 'reader', { limit: 1 });
    expect(older).toMatchObject({ hasMore: false, cursor: current.cursor });
    expect(older.changes.map(change => change.table)).toEqual(['notes']);

    expect((await pullChanges('2000-01-01', ['shared'])).changes.some(change => change.table === 'identities')).toBe(false);
    expect((await pullChanges('2000-01-01', ['shared'], { tables: currentClient })).changes)
      .toContainEqual(expect.objectContaining({ table: 'identities', id: 'dana', op: 'put' }));
    expect(await getSnapshot('shared')).not.toHaveProperty('identities');
    expect((await getSnapshot('shared', currentClient)).identities).toHaveLength(2);
  });

  it('keeps identities consistent when an older client deletes and restores their investigation', async () => {
    await processPush([putIdentity('dana', identity('Dana Okafor'))], 'editor', { authorize: true });
    const before = await pullCursorChanges('0', 'owner', { tables: currentClient });
    // An older client edits other content and deletes the investigation; it never names identities.
    await processPush([{ table: 'notes', entityId: 'note', op: 'put', clientVersion: 0, data: { folderId: 'shared', title: 'Older client' } }], 'owner', { authorize: true });
    expect((await database.sql`SELECT version FROM identities WHERE id = 'dana'`)[0].version).toBe(1);
    expect((await processPush([{ table: 'folders', entityId: 'shared', op: 'delete', clientVersion: 1 }], 'owner', { authorize: true }))[0].status).toBe('accepted');

    const removed = await pullCursorChanges(before.cursor, 'owner', { tables: currentClient });
    expect(removed.changes).toContainEqual({ table: 'identities', op: 'delete', id: 'dana', version: 1 });
    expect(JSON.stringify(removed)).not.toContain(privatePhone.value);
    expect((await pullCursorChanges(before.cursor, 'owner')).changes.some(change => change.table === 'identities')).toBe(false);

    await processPush([{ table: 'folders', entityId: 'shared', op: 'put', clientVersion: 2, data: { name: 'Restored' } }], 'owner', { authorize: true });
    expect((await pullCursorChanges(removed.cursor, 'owner', { tables: currentClient })).changes)
      .toContainEqual(expect.objectContaining({ table: 'identities', id: 'dana', op: 'put', name: 'Dana Okafor' }));
  });

  it('lets only editors of an investigation change its identities, and shows them only to its members', async () => {
    const attempt = async (user: string, id: string, folderId = 'shared') =>
      (await processPush([putIdentity(id, identity('Synthetic', { folderId }))], user, { authorize: true }))[0].status;
    expect(await attempt('reader', 'by-viewer')).toBe('rejected');
    expect(await attempt('outsider', 'by-outsider')).toBe('rejected');
    expect(await attempt('editor', 'into-other', 'other')).toBe('rejected');
    expect(await attempt('editor', 'shared-one')).toBe('accepted');
    expect(await attempt('owner', 'private-one', 'other')).toBe('accepted');
    // Moving an identity into an investigation the editor cannot edit is refused.
    expect((await processPush([putIdentity('shared-one', identity('Synthetic', { folderId: 'other' }), 1)], 'editor', { authorize: true }))[0].status).toBe('rejected');

    const seen = async (user: string) => (await pullCursorChanges('0', user, { tables: currentClient })).changes
      .filter(change => change.table === 'identities').map(change => change.id).sort();
    expect(await seen('reader')).toEqual(['shared-one']);
    expect(await seen('outsider')).toEqual([]);
    expect(await seen('owner')).toEqual(['private-one', 'shared-one']);
    expect(await database.sql`SELECT id FROM identities ORDER BY id`).toEqual([{ id: 'private-one' }, { id: 'shared-one' }]);
  });

  it('keeps an omitted field and clears one sent as null', async () => {
    const [created] = await processPush([putIdentity('dana', identity('Dana Okafor', { status: 'compromised', contact: true, clsLevel: 'TLP:RED', description: 'Finance' }))], 'editor', { authorize: true });
    // A push carries the whole row, but JSON drops undefined fields. The server patches, so they stay.
    const [kept] = await processPush([putIdentity('dana', identity('Dana Okafor'), created.serverVersion)], 'editor', { authorize: true });
    expect(kept.serverRecord).toMatchObject({ status: 'compromised', contact: true, clsLevel: 'TLP:RED', description: 'Finance' });
    const [cleared] = await processPush([putIdentity('dana', identity('Dana Okafor', { status: null, contact: null, clsLevel: null, description: null, trashedAt: null }), kept.serverVersion)], 'editor', { authorize: true });
    expect(cleared.serverRecord).toMatchObject({ status: null, contact: null, clsLevel: null, description: null, trashedAt: null });
  });

  it('gives bots no identity events', async () => {
    await processPush([putIdentity('dana', identity('Dana Okafor')),
      { table: 'notes', entityId: 'note', op: 'put', clientVersion: 0, data: { folderId: 'shared', title: 'Note' } }], 'editor', { authorize: true });
    await processPush([{ table: 'identities', entityId: 'dana', op: 'delete', clientVersion: 1 }], 'editor', { authorize: true });
    expect(state.events.mock.calls.map(call => call[1])).toEqual(['notes']);
  });

  it('purges identities with their investigation and keeps their revisions increasing after physical cleanup', async () => {
    await processPush([putIdentity('dana', identity('Dana Okafor'))], 'editor', { authorize: true });
    await database.sql`UPDATE folders SET deleted_at = '2000-01-01' WHERE id = 'shared'`;
    expect((await purgeExpiredInvestigation('shared', new Date('2020-01-01')))?.deleted.identities).toBe(1);
    expect(await database.sql`SELECT id FROM identities`).toEqual([]);

    await database.sql`INSERT INTO identities (id,folder_id,type,name,created_at,updated_at) VALUES ('reborn','other','person','First',now(),now())`;
    await database.sql`DELETE FROM identities WHERE id = 'reborn'`;
    await database.sql`INSERT INTO identities (id,folder_id,type,name,created_at,updated_at) VALUES ('reborn','other','person','Second',now(),now())`;
    expect((await database.sql`SELECT version FROM identities WHERE id = 'reborn'`)[0].version).toBe(3);
  });
});
