import type { Sql, TransactionSql } from 'postgres';

const syncTables: Record<string, string> = {
  notes: 'notes', tasks: 'tasks', folders: 'folders', tags: 'tags',
  timeline_events: 'timelineEvents', timelines: 'timelines', whiteboards: 'whiteboards',
  standalone_iocs: 'standaloneIOCs', chat_threads: 'chatThreads',
  evidence_items: 'evidenceItems',
};
const triggerTypes: Record<string, number> = {
  sync_lock_writes: 30, // BEFORE STATEMENT INSERT/UPDATE/DELETE
  sync_revision: 23, // BEFORE ROW INSERT/UPDATE
  sync_record_change: 29, // AFTER ROW INSERT/UPDATE/DELETE
};

/** Table parity cannot detect missing/disabled change-capture triggers. Validate
 * these runtime objects only after migrations, never before baseline adoption.
 * Function bodies are compared with the already hash-verified migration source,
 * rather than maintaining a second, potentially divergent SQL implementation. */
export async function durableSyncDifferences(sql: Sql | TransactionSql, migrationStatements: readonly string[]): Promise<string[]> {
  const differences: string[] = [];
  const functions = await sql<{ name: string; source: string; language: string; result: string; security_definer: boolean; config: string[] | null }[]>`
    SELECT p.proname AS name, p.prosrc AS source, l.lanname AS language,
           p.prorettype::regtype::text AS result, p.prosecdef AS security_definer, p.proconfig AS config
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    JOIN pg_language l ON l.oid = p.prolang
    WHERE n.nspname = 'public' AND p.pronargs = 0
      AND p.proname IN ('sync_lock_writes', 'sync_revision', 'sync_record_change')`;
  for (const name of Object.keys(triggerTypes)) {
    const pattern = new RegExp(`CREATE OR REPLACE FUNCTION ${name}\\(\\) RETURNS trigger LANGUAGE plpgsql AS \\$\\$([\\s\\S]*?)\\$\\$;`);
    // Later committed migrations may legitimately replace an earlier body.
    const source = [...migrationStatements].reverse().map(statement => pattern.exec(statement)?.[1]).find(value => value !== undefined);
    if (source === undefined) throw new Error(`Missing supported migration definition for ${name}`);
    const actual = functions.find(func => func.name === name);
    if (!actual || actual.source.trim() !== source.trim() || actual.language !== 'plpgsql'
      || actual.result !== 'trigger' || actual.security_definer || actual.config !== null) {
      differences.push(`Sync function ${name} differs from its migration definition`);
    }
  }
  const triggers = await sql<{ table_name: string; name: string; enabled: string; type: number; args: string; function_name: string; function_schema: string; unconditional: boolean; all_columns: boolean; deferrable: boolean }[]>`
    SELECT c.relname AS table_name, t.tgname AS name, t.tgenabled AS enabled, t.tgtype AS type,
           encode(t.tgargs, 'hex') AS args, p.proname AS function_name, pn.nspname AS function_schema,
           t.tgqual IS NULL AS unconditional, cardinality(t.tgattr::smallint[]) = 0 AS all_columns,
           t.tgdeferrable AS deferrable
    FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    JOIN pg_proc p ON p.oid = t.tgfoid JOIN pg_namespace pn ON pn.oid = p.pronamespace
    WHERE n.nspname = 'public' AND NOT t.tgisinternal`;
  for (const [table, apiName] of Object.entries(syncTables)) {
    for (const [name, type] of Object.entries(triggerTypes)) {
      const actual = triggers.find(trigger => trigger.table_name === table && trigger.name === name);
      const args = name === 'sync_record_change' ? Buffer.from(`${apiName}\0`).toString('hex') : '';
      if (!actual || actual.enabled !== 'O' || actual.type !== type || actual.args !== args
        || actual.function_schema !== 'public' || actual.function_name !== name
        || !actual.unconditional || !actual.all_columns || actual.deferrable) {
        differences.push(`Sync trigger ${table}.${name} differs from its migration definition`);
      }
    }
  }
  const clocks = await sql<{ id: number; cursor: string; generation: string }[]>`SELECT id, cursor, generation FROM sync_clock`;
  const [log] = await sql<{ maximum: string }[]>`SELECT COALESCE(max(cursor), 0)::text AS maximum FROM sync_changes`;
  if (clocks.length !== 1 || clocks[0].id !== 1 || BigInt(clocks[0].cursor) < 0n
    || BigInt(clocks[0].cursor) < BigInt(log.maximum) || !/^[a-f0-9-]{36}$/.test(clocks[0].generation)) {
    differences.push('Sync clock is missing or precedes committed changes');
  }
  return differences.sort();
}
