import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { readMigrationFiles } from 'drizzle-orm/migrator';
import type { Sql } from 'postgres';
import { schemaDifferences } from './schema-contract.js';
import { durableSyncDifferences } from './sync-contract.js';

interface JournalEntry { idx: number; tag: string; when: number }
const ADOPTION_BASELINE = '0020_runtime_schema_completion';
const LEGACY_LAST_INDEX = 19;

/**
 * Recover the original backwards-timestamp journal without rewriting history.
 * Drizzle's parser still defines SQL splitting and hashes, but application order
 * is the verified journal prefix, never the maximum historical timestamp.
 * Everything, including adoption/history changes, rolls back on failure.
 */
export async function migrateDatabase(sql: Sql, migrationsFolder: string): Promise<void> {
  const journal = JSON.parse(await readFile(resolve(migrationsFolder, 'meta/_journal.json'), 'utf8')) as { entries: JournalEntry[] };
  if (!Array.isArray(journal.entries) || journal.entries.length === 0) throw new Error('Missing migration journal entries.');
  let latestTimestamp = 0;
  for (const [index, entry] of journal.entries.entries()) {
    if (entry.idx !== index || !/^\d{4}_[a-z0-9_]+$/.test(entry.tag) || !Number.isSafeInteger(entry.when)
      || (index > LEGACY_LAST_INDEX && entry.when <= latestTimestamp)) {
      throw new Error('Unsupported migration journal order; historical entries must remain intact and new timestamps must increase.');
    }
    latestTimestamp = Math.max(latestTimestamp, entry.when);
  }
  const migrations = readMigrationFiles({ migrationsFolder });
  const syncMigrationIndex = journal.entries.findIndex(entry => entry.tag === '0021_durable_sync_cursor');
  if (syncMigrationIndex < 0) throw new Error('The durable sync migration contract is missing.');
  const syncStatements = migrations.slice(syncMigrationIndex).flatMap(migration => migration.sql);
  await sql.begin(async transaction => {
    // A transaction-held lock serializes startup across application replicas.
    await transaction`SELECT pg_advisory_xact_lock(1413693764, 1296648018)`;
    await transaction`SET LOCAL search_path = public`;
    await transaction`CREATE SCHEMA IF NOT EXISTS drizzle`;
    await transaction`CREATE TABLE IF NOT EXISTS drizzle.__drizzle_migrations (id SERIAL PRIMARY KEY, hash text NOT NULL, created_at bigint)`;
    const history = await transaction<{ hash: string; created_at: string }[]>`SELECT hash, created_at FROM drizzle.__drizzle_migrations ORDER BY id`;
    if (history.length > migrations.length || history.some((entry, index) =>
      entry.hash !== migrations[index]?.hash || Number(entry.created_at) !== migrations[index]?.folderMillis)) {
      throw new Error('Unsupported or modified migration history. Restore the matching release and review the database before retrying; no migrations were applied.');
    }
    let applied = history.length;
    if (applied === 0) {
      const tables = await transaction`SELECT tablename FROM pg_tables WHERE schemaname = 'public'`;
      if (tables.length > 0) {
        let differences = await schemaDifferences(transaction);
        // The explicitly supported pre-cursor schema-push baseline has neither
        // sync table. Migration 0021 creates both and backfills their contents.
        if (differences.includes('Missing table sync_clock') && differences.includes('Missing table sync_changes')) {
          differences = differences.filter(value => value !== 'Missing table sync_clock' && value !== 'Missing table sync_changes');
        }
        // Explicitly recognized pre-0023 shape: both asset additions absent.
        // A partially applied asset schema remains an error, not an adoption.
        if (differences.includes('Missing table evidence_items') && differences.includes('Missing column whiteboards.files')) {
          differences = differences.filter(value => !['Missing table evidence_items', 'Missing column whiteboards.files', 'Missing column sync_clock.generation'].includes(value));
        }
        // Optional provenance was added independently in 0024; absence is the
        // supported predecessor shape, but a wrong existing type still fails.
        differences = differences.filter(value => value !== 'Missing column standalone_iocs.enrichment');
        if (differences.length) throw new Error(`Cannot adopt an unjournaled or partial database: ${differences.join('; ')}`);
        const baseline = journal.entries.findIndex(entry => entry.tag === ADOPTION_BASELINE);
        if (baseline < 0) throw new Error('The explicit schema-adoption baseline is missing.');
        // Explicitly reproduce the sole historical data normalization (0013).
        // No analyst-owned records or investigation contents are transformed.
        await transaction`UPDATE users SET email = 'system@threatcaddy.internal' WHERE id = '__system_admin__' AND email <> 'system@threatcaddy.internal'`;
        // Only historical work through the reviewed baseline can be adopted.
        // Future data migrations (including sync-log backfill) always execute.
        for (const migration of migrations.slice(0, baseline + 1)) {
          await transaction`INSERT INTO drizzle.__drizzle_migrations (hash, created_at) VALUES (${migration.hash}, ${migration.folderMillis})`;
        }
        await transaction`CREATE TABLE IF NOT EXISTS drizzle.threatcaddy_adoptions (baseline text PRIMARY KEY, adopted_at timestamptz NOT NULL DEFAULT now())`;
        await transaction`INSERT INTO drizzle.threatcaddy_adoptions (baseline) VALUES (${ADOPTION_BASELINE})`;
        applied = baseline + 1;
      }
    }
    for (const migration of migrations.slice(applied)) {
      for (const statement of migration.sql) if (statement.trim()) await transaction.unsafe(statement);
      await transaction`INSERT INTO drizzle.__drizzle_migrations (hash, created_at) VALUES (${migration.hash}, ${migration.folderMillis})`;
    }
    // Additional operational tables are permitted for journaled installations;
    // unsupported columns, missing required objects and mismatched definitions
    // abort the entire recovery rather than declaring a damaged schema healthy.
    const differences = (await schemaDifferences(transaction)).filter(difference => !difference.startsWith('Unexpected table '));
    if (differences.length) throw new Error(`Migrated schema does not match the runtime contract: ${differences.join('; ')}`);
    const syncDifferences = await durableSyncDifferences(transaction, syncStatements);
    if (syncDifferences.length) throw new Error(`Migrated sync runtime does not match its contract: ${syncDifferences.join('; ')}`);
  });
}
