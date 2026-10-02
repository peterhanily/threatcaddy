import { createHash } from 'node:crypto';
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import { migrateDatabase } from '../src/db/migrate.js';
import * as schema from '../src/db/schema.js';
import type { ScratchDatabase } from './database.js';

export const serverRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const currentMigrations = resolve(serverRoot, 'src/db/migrations');
const historicalMigrations = resolve(serverRoot, 'integration/fixtures/historical-migrations');
// drizzle-kit 0.30's ESM bundle contains dynamic require calls; its shipped CJS API works in Node.
const { generateDrizzleJson, generateMigration } = createRequire(import.meta.url)('drizzle-kit/api') as typeof import('drizzle-kit/api');

interface Journal { version: string; dialect: string; entries: { idx: number; tag: string; when: number; version: string; breakpoints: boolean }[] }
export async function migrationJournal(folder = currentMigrations): Promise<Journal> {
  return JSON.parse(await readFile(resolve(folder, 'meta/_journal.json'), 'utf8')) as Journal;
}

export async function applyHistoricalMigrations(database: ScratchDatabase, through: number): Promise<void> {
  const journal = await migrationJournal(historicalMigrations);
  journal.entries = journal.entries.filter(entry => entry.idx <= through);
  if (journal.entries.at(-1)?.idx !== through) throw new Error(`Missing historical fixture ${through}`);
  const folder = await mkdtemp(resolve(tmpdir(), 'threatcaddy-historical-'));
  try {
    await mkdir(resolve(folder, 'meta'));
    await writeFile(resolve(folder, 'meta/_journal.json'), JSON.stringify(journal));
    for (const entry of journal.entries) await cp(resolve(historicalMigrations, `${entry.tag}.sql`), resolve(folder, `${entry.tag}.sql`));
    // Run the installed migrator over immutable original SQL and original journal timestamps.
    await migrate(database.db, { migrationsFolder: folder });
  } finally { await rm(folder, { recursive: true, force: true }); }
}

export async function applyCurrentMigrations(database: ScratchDatabase): Promise<void> {
  await migrateDatabase(database.sql, currentMigrations);
}

/** Materialize the same exported tables as db:push, deliberately leaving no migration journal. */
export async function applySchemaPushFixture(database: ScratchDatabase): Promise<void> {
  const statements = await generateMigration(generateDrizzleJson({}), generateDrizzleJson(schema));
  if (!statements.length) throw new Error('Schema-push fixture generation unexpectedly produced no SQL.');
  await database.sql.begin(async transaction => {
    for (const statement of statements) await transaction.unsafe(statement);
  });
}

export async function temporaryCurrentMigrations() {
  const folder = await mkdtemp(resolve(tmpdir(), 'threatcaddy-migration-retry-'));
  try { await cp(currentMigrations, folder, { recursive: true }); }
  catch (error) { await rm(folder, { recursive: true, force: true }); throw error; }
  return { folder, close: () => rm(folder, { recursive: true, force: true }) };
}

/** Inject an ordinary SQL error into a temporary migration folder, never into production source. */
export async function injectMigrationFault(folder: string) {
  const journalFile = resolve(folder, 'meta/_journal.json');
  const originalJournal = await readFile(journalFile, 'utf8');
  const journal = JSON.parse(originalJournal) as Journal;
  const nextIdx = Math.max(...journal.entries.map(entry => entry.idx)) + 1;
  const tag = `${String(nextIdx).padStart(4, '0')}_integration_retry_probe`;
  const migrationFile = resolve(folder, `${tag}.sql`);
  const successfulSql = 'CREATE TABLE "integration_retry_probe" ("value" text NOT NULL);\n--> statement-breakpoint\nINSERT INTO "integration_retry_probe" ("value") VALUES (\'committed once\');\n';
  journal.entries.push({ idx: nextIdx, version: '7', when: Math.max(...journal.entries.map(entry => entry.when)) + 1000, tag, breakpoints: true });
  await writeFile(migrationFile, `${successfulSql}--> statement-breakpoint\nSELECT 1 / 0;\n`);
  await writeFile(journalFile, JSON.stringify(journal));
  return {
    repair: () => writeFile(migrationFile, successfulSql),
    async remove() {
      await writeFile(journalFile, originalJournal);
      await rm(migrationFile);
    },
  };
}

export async function missingMigrationRecords(database: ScratchDatabase): Promise<string[]> {
  const journal = await migrationJournal();
  const rows = await database.sql<{ hash: string; created_at: string }[]>`SELECT hash, created_at FROM drizzle.__drizzle_migrations ORDER BY id`;
  const missing: string[] = [];
  for (const entry of journal.entries) {
    const hash = createHash('sha256').update(await readFile(resolve(currentMigrations, `${entry.tag}.sql`))).digest('hex');
    if (!rows.some(row => row.hash === hash && Number(row.created_at) === entry.when)) missing.push(entry.tag);
  }
  return missing;
}

export async function seedHistoricalData(database: ScratchDatabase): Promise<void> {
  await database.sql`INSERT INTO users (id, email, display_name, password_hash) VALUES ('fixture-user', 'fixture@example.invalid', 'Migration Fixture', 'non-login-fixture')`;
  await database.sql`INSERT INTO folders (id, name, created_by, updated_by, created_at, updated_at) VALUES ('fixture-folder', 'Preserved investigation', 'fixture-user', 'fixture-user', '2025-01-01T00:00:00Z', '2025-01-01T00:00:00Z')`;
  await database.sql`INSERT INTO investigation_members (id, folder_id, user_id, role) VALUES ('fixture-member', 'fixture-folder', 'fixture-user', 'owner')`;
  await database.sql`INSERT INTO notes (id, title, content, folder_id, tags, created_by, updated_by, version, created_at, updated_at) VALUES ('fixture-note', 'Preserved note', 'Migration fixture body', 'fixture-folder', '["fixture-tag"]', 'fixture-user', 'fixture-user', 7, '2025-01-01T00:00:00Z', '2025-01-02T00:00:00Z')`;
}

export async function preservedData(database: ScratchDatabase) {
  const notes = await database.sql`SELECT id, title, content, folder_id, tags, created_by, updated_by, version, created_at, updated_at FROM notes ORDER BY id`;
  const folders = await database.sql`SELECT id, name, created_by, updated_by, created_at, updated_at FROM folders ORDER BY id`;
  const members = await database.sql`SELECT id, folder_id, user_id, role, joined_at FROM investigation_members ORDER BY id`;
  const users = await database.sql`SELECT id, email, display_name, password_hash, created_at, updated_at FROM users ORDER BY id`;
  return JSON.parse(JSON.stringify({ notes, folders, members, users })) as unknown;
}
