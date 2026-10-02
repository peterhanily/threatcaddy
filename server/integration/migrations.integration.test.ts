import { afterEach, describe, expect, it } from 'vitest';
import { resolve } from 'node:path';
import { migrateDatabase } from '../src/db/migrate.js';
import { scratchDatabase, testDatabaseUrl, type ScratchDatabase } from './database.js';
import { applyCurrentMigrations, applyHistoricalMigrations, applySchemaPushFixture, injectMigrationFault, migrationJournal, missingMigrationRecords, preservedData, seedHistoricalData, temporaryCurrentMigrations } from './migrations.js';
import { schemaDifferences } from './schema-parity.js';
import { bootBuiltServer, stageBuiltServer } from './startup.js';

// Fail immediately when no isolated database was explicitly provided. Never silently skip integration.
testDatabaseUrl(process.env.TEST_DATABASE_URL);

describe('committed PostgreSQL migrations', () => {
  const databases: ScratchDatabase[] = [];
  async function fresh() { const database = await scratchDatabase(); databases.push(database); return database; }
  afterEach(async () => {
    const results = await Promise.allSettled(databases.splice(0).map(database => database.close()));
    const failures = results.filter(result => result.status === 'rejected');
    if (failures.length) throw new AggregateError(failures.map(result => result.reason), 'Scratch database cleanup failed');
  });

  it('applies every committed migration to an empty database and reruns without changing data or history', async () => {
    const database = await fresh();
    await applyCurrentMigrations(database);
    expect(await missingMigrationRecords(database)).toEqual([]);
    await seedHistoricalData(database);
    const dataBefore = await preservedData(database);
    const historyBefore = await database.sql`SELECT * FROM drizzle.__drizzle_migrations ORDER BY id`;
    await applyCurrentMigrations(database);
    expect(await preservedData(database)).toEqual(dataBefore);
    expect(await database.sql`SELECT * FROM drizzle.__drizzle_migrations ORDER BY id`).toEqual(historyBefore);
  });

  it('produces every runtime table, column, default presence, key, and required index', async () => {
    const database = await fresh();
    await applyCurrentMigrations(database);
    expect(await schemaDifferences(database.sql)).toEqual([]);
  });

  it.each([
    ['missing capture', 'DROP TRIGGER sync_record_change ON notes', /Sync trigger notes.sync_record_change/],
    ['disabled capture', 'ALTER TABLE notes DISABLE TRIGGER sync_record_change', /Sync trigger notes.sync_record_change/],
    ['incorrect table mapping', "DROP TRIGGER sync_record_change ON notes; CREATE TRIGGER sync_record_change AFTER INSERT OR UPDATE OR DELETE ON notes FOR EACH ROW EXECUTE FUNCTION sync_record_change('tasks')", /Sync trigger notes.sync_record_change/],
    ['changed trigger function', 'CREATE OR REPLACE FUNCTION sync_revision() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN NEW.version := 1; RETURN NEW; END; $$', /Sync function sync_revision/],
    ['missing clock', 'DELETE FROM sync_clock', /Sync clock is missing/],
  ])('refuses startup with %s instead of silently omitting durable sync changes', async (_label, statement, expected) => {
    const database = await fresh();
    await applyCurrentMigrations(database);
    const history = await database.sql`SELECT * FROM drizzle.__drizzle_migrations ORDER BY id`;
    await database.sql.unsafe(statement as string);
    await expect(applyCurrentMigrations(database)).rejects.toThrow(expected as RegExp);
    expect(await database.sql`SELECT * FROM drizzle.__drizzle_migrations ORDER BY id`).toEqual(history);
  });

  it('refuses a clock behind its committed log without rewinding or discarding records', async () => {
    const database = await fresh();
    await applyCurrentMigrations(database);
    await seedHistoricalData(database);
    const before = await preservedData(database);
    await database.sql`UPDATE sync_clock SET cursor = 0`;
    await expect(applyCurrentMigrations(database)).rejects.toThrow(/Sync clock is missing or precedes committed changes/);
    expect(await preservedData(database)).toEqual(before);
  });

  for (const through of [2, 17, 19]) {
    it(`upgrades the original ${String(through).padStart(4, '0')} history without skipped migrations or changed investigation data`, async () => {
      const database = await fresh();
      await applyHistoricalMigrations(database, through);
      const historicalCount = await database.sql`SELECT count(*)::int AS count FROM drizzle.__drizzle_migrations`;
      expect(historicalCount[0].count).toBe(through + 1);
      await seedHistoricalData(database);
      const dataBefore = await preservedData(database);
      await applyCurrentMigrations(database);
      expect.soft(await missingMigrationRecords(database)).toEqual([]);
      expect.soft(await schemaDifferences(database.sql)).toEqual([]);
      expect(await preservedData(database)).toEqual(dataBefore);
      const countAfter = await database.sql`SELECT count(*)::int AS count FROM drizzle.__drizzle_migrations`;
      expect(countAfter[0].count).toBeGreaterThanOrEqual((await migrationJournal()).entries.length);
    });
  }

  it('creates the runtime schema independently of migrations with no migration journal, as db:push does', async () => {
    const database = await fresh();
    await applySchemaPushFixture(database);
    expect(await schemaDifferences(database.sql)).toEqual([]);
    expect((await database.sql`SELECT to_regclass('drizzle.__drizzle_migrations') AS journal`)[0].journal).toBeNull();
  });

  it('adopts the pre-cursor schema-push baseline and executes subsequent data migrations', async () => {
    const database = await fresh();
    await applySchemaPushFixture(database);
    await database.sql`DROP TABLE sync_changes`;
    await database.sql`DROP TABLE sync_clock`;
    await seedHistoricalData(database);
    const before = await preservedData(database);
    await applyCurrentMigrations(database);
    expect(await preservedData(database)).toEqual(before);
    expect(await schemaDifferences(database.sql)).toEqual([]);
    expect(await missingMigrationRecords(database)).toEqual([]);
    expect(await database.sql`SELECT entity_id FROM sync_changes WHERE entity_id = 'fixture-note'`).toEqual([{ entity_id: 'fixture-note' }]);
    expect(await database.sql`SELECT baseline FROM drizzle.threatcaddy_adoptions`).toEqual([{ baseline: '0020_runtime_schema_completion' }]);
  });

  it('refuses partial unjournaled schemas without creating history or changing data', async () => {
    const database = await fresh();
    await applySchemaPushFixture(database);
    await seedHistoricalData(database);
    await database.sql`ALTER TABLE notes DROP COLUMN annotations`;
    const before = await preservedData(database);
    await expect(applyCurrentMigrations(database)).rejects.toThrow(/Cannot adopt.*notes.annotations/);
    expect(await preservedData(database)).toEqual(before);
    expect((await database.sql`SELECT to_regclass('drizzle.__drizzle_migrations') AS journal`)[0].journal).toBeNull();
  });

  it('refuses changed defaults during schema adoption', async () => {
    const database = await fresh();
    await applySchemaPushFixture(database);
    await database.sql`ALTER TABLE users ALTER COLUMN role SET DEFAULT 'admin'`;
    await expect(applyCurrentMigrations(database)).rejects.toThrow(/default expression/);
    expect((await database.sql`SELECT to_regclass('drizzle.__drizzle_migrations') AS journal`)[0].journal).toBeNull();
  });

  it('refuses changed or non-prefix historical migration records', async () => {
    const database = await fresh();
    await applyHistoricalMigrations(database, 2);
    await seedHistoricalData(database);
    await database.sql`UPDATE drizzle.__drizzle_migrations SET hash = 'unrecognized-history' WHERE id = 2`;
    const before = await preservedData(database);
    const history = await database.sql`SELECT * FROM drizzle.__drizzle_migrations ORDER BY id`;
    await expect(applyCurrentMigrations(database)).rejects.toThrow(/Unsupported or modified migration history/);
    expect(await preservedData(database)).toEqual(before);
    expect(await database.sql`SELECT * FROM drizzle.__drizzle_migrations ORDER BY id`).toEqual(history);
  });

  it('refuses historical journals with a missing middle entry', async () => {
    const database = await fresh();
    await applyHistoricalMigrations(database, 2);
    await database.sql`DELETE FROM drizzle.__drizzle_migrations WHERE id = 2`;
    const history = await database.sql`SELECT * FROM drizzle.__drizzle_migrations ORDER BY id`;
    await expect(applyCurrentMigrations(database)).rejects.toThrow(/Unsupported or modified migration history/);
    expect(await database.sql`SELECT * FROM drizzle.__drizzle_migrations ORDER BY id`).toEqual(history);
  });

  it('refuses undeclared foreign keys when adopting a schema-push installation', async () => {
    const database = await fresh();
    await applySchemaPushFixture(database);
    await database.sql`ALTER TABLE notes ADD CONSTRAINT unexpected_note_owner FOREIGN KEY (folder_id) REFERENCES users(id) ON DELETE CASCADE`;
    await expect(applyCurrentMigrations(database)).rejects.toThrow(/Unexpected foreign key notes/);
    expect((await database.sql`SELECT to_regclass('drizzle.__drizzle_migrations') AS journal`)[0].journal).toBeNull();
  });

  it('refuses incompatible sync clock constraints during schema adoption', async () => {
    const database = await fresh();
    await applySchemaPushFixture(database);
    await database.sql`ALTER TABLE sync_clock DROP CONSTRAINT sync_clock_singleton`;
    await database.sql`ALTER TABLE sync_clock ADD CONSTRAINT sync_clock_singleton CHECK (id = 2)`;
    await expect(applyCurrentMigrations(database)).rejects.toThrow(/Check sync_clock.sync_clock_singleton/);
    expect((await database.sql`SELECT to_regclass('drizzle.__drizzle_migrations') AS journal`)[0].journal).toBeNull();
  });

  it('serializes concurrent startup without applying a migration twice', async () => {
    const database = await scratchDatabase({ maxConnections: 2 });
    databases.push(database);
    await applyHistoricalMigrations(database, 2);
    await seedHistoricalData(database);
    const before = await preservedData(database);
    await Promise.all([applyCurrentMigrations(database), applyCurrentMigrations(database)]);
    expect(await missingMigrationRecords(database)).toEqual([]);
    expect((await database.sql`SELECT count(*)::int AS count FROM drizzle.__drizzle_migrations`)[0].count).toBe((await migrationJournal()).entries.length);
    expect(await preservedData(database)).toEqual(before);
  });

  it('adopts a schema-push installation without replaying table creation or changing existing data', async () => {
    const database = await fresh();
    await applySchemaPushFixture(database);
    await seedHistoricalData(database);
    const dataBefore = await preservedData(database);
    await expect.soft(applyCurrentMigrations(database)).resolves.toBeUndefined();
    expect(await preservedData(database)).toEqual(dataBefore);
    expect(await schemaDifferences(database.sql)).toEqual([]);
    expect(await missingMigrationRecords(database)).toEqual([]);
  });

  it('rolls back a failed migration and retries it once without changing existing investigation data', async () => {
    const database = await fresh();
    await applyHistoricalMigrations(database, 19);
    await seedHistoricalData(database);
    const dataBefore = await preservedData(database);
    const historyBefore = await database.sql`SELECT * FROM drizzle.__drizzle_migrations ORDER BY id`;
    const migrationFixture = await temporaryCurrentMigrations();
    try {
      const fault = await injectMigrationFault(migrationFixture.folder);
      await expect(migrateDatabase(database.sql, migrationFixture.folder)).rejects.toThrow(/division by zero|SELECT 1\s*\/\s*0/i);
      expect((await database.sql`SELECT to_regclass('public.integration_retry_probe') AS marker`)[0].marker).toBeNull();
      expect(await database.sql`SELECT * FROM drizzle.__drizzle_migrations ORDER BY id`).toEqual(historyBefore);
      expect(await preservedData(database)).toEqual(dataBefore);
      await fault.repair();
      await migrateDatabase(database.sql, migrationFixture.folder);
      expect(await database.sql`SELECT value FROM integration_retry_probe`).toEqual([{ value: 'committed once' }]);
      const expectedCount = (await migrationJournal()).entries.length + 1;
      expect((await database.sql`SELECT count(*)::int AS count FROM drizzle.__drizzle_migrations`)[0].count).toBe(expectedCount);
      await migrateDatabase(database.sql, migrationFixture.folder);
      expect(await database.sql`SELECT value FROM integration_retry_probe`).toEqual([{ value: 'committed once' }]);
      expect((await database.sql`SELECT count(*)::int AS count FROM drizzle.__drizzle_migrations`)[0].count).toBe(expectedCount);
      expect(await preservedData(database)).toEqual(dataBefore);
    } finally { await migrationFixture.close(); }
  });

  it('boots and restarts an existing schema-push installation through the compiled artifact', async () => {
    const database = await fresh();
    await applySchemaPushFixture(database);
    await seedHistoricalData(database);
    const artifact = await stageBuiltServer();
    try {
      await bootBuiltServer(database, artifact);
      const dataBeforeRestart = await preservedData(database);
      await bootBuiltServer(database, artifact);
      expect(await preservedData(database)).toEqual(dataBeforeRestart);
      expect(await schemaDifferences(database.sql)).toEqual([]);
      expect(await missingMigrationRecords(database)).toEqual([]);
    } finally { await artifact.close(); }
  });

  it('recovers compiled startup after a migration failure without partial changes or damaged data', async () => {
    const database = await fresh();
    await applyHistoricalMigrations(database, 19);
    await seedHistoricalData(database);
    const dataBefore = await preservedData(database);
    const historyBefore = await database.sql`SELECT * FROM drizzle.__drizzle_migrations ORDER BY id`;
    const artifact = await stageBuiltServer();
    try {
      // Missing packaged assets must fail here; never repair the artifact by copying from src.
      const fault = await injectMigrationFault(resolve(artifact.folder, 'dist/db/migrations'));
      await expect(bootBuiltServer(database, artifact)).rejects.toThrow(/division by zero|SELECT 1\s*\/\s*0/i);
      expect((await database.sql`SELECT to_regclass('public.integration_retry_probe') AS marker`)[0].marker).toBeNull();
      expect(await database.sql`SELECT * FROM drizzle.__drizzle_migrations ORDER BY id`).toEqual(historyBefore);
      expect(await preservedData(database)).toEqual(dataBefore);
      await fault.remove();
      await bootBuiltServer(database, artifact);
      expect(await schemaDifferences(database.sql)).toEqual([]);
      const dataBeforeRestart = await preservedData(database);
      await bootBuiltServer(database, artifact);
      expect(await preservedData(database)).toEqual(dataBeforeRestart);
    } finally { await artifact.close(); }
  });

  for (const history of [undefined, 2, 17, 19]) {
    it(`boots and restarts the compiled artifact against ${history === undefined ? 'an empty database' : `original ${String(history).padStart(4, '0')} history`}`, async () => {
      const database = await fresh();
      if (history !== undefined) {
        await applyHistoricalMigrations(database, history);
        await seedHistoricalData(database);
      }
      const artifact = await stageBuiltServer();
      try {
        await bootBuiltServer(database, artifact);
        expect(await schemaDifferences(database.sql)).toEqual([]);
        const settings = await database.sql`SELECT key, value FROM server_settings WHERE key IN ('server_name', 'registration_mode') ORDER BY key`;
        const dataBeforeRestart = await preservedData(database);
        await bootBuiltServer(database, artifact);
        expect(await database.sql`SELECT key, value FROM server_settings WHERE key IN ('server_name', 'registration_mode') ORDER BY key`).toEqual(settings);
        expect(await preservedData(database)).toEqual(dataBeforeRestart);
        expect(await missingMigrationRecords(database)).toEqual([]);
      } finally { await artifact.close(); }
    });
  }
});
