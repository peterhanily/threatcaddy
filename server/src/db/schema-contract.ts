import { getTableName, is, SQL } from 'drizzle-orm';
import { getTableConfig, PgDialect, PgTable } from 'drizzle-orm/pg-core';
import * as schema from './schema.js';
import type { Sql, TransactionSql } from 'postgres';

const deleteActions: Record<string, string> = { a: 'no action', r: 'restrict', c: 'cascade', n: 'set null', d: 'set default' };
// PostgreSQL rewrites IN to ANY when deparsing a check. Compare these small,
// explicitly supported invariants rather than guessing SQL equivalence.
const checkContracts: Record<string, { source: string; catalog: string }> = {
  sync_clock_singleton: { source: '"sync_clock"."id"=1', catalog: 'CHECK((id=1))' },
  sync_changes_op_check: { source: '"sync_changes"."op"IN(\'put\',\'delete\')', catalog: "CHECK((op=ANY(ARRAY['put'::text,'delete'::text])))" },
};

/** Fail-closed catalog validation used before adopting an unjournaled installation. */
export async function schemaDifferences(sql: Sql | TransactionSql): Promise<string[]> {
  const columns = await sql<{ table_name: string; column_name: string; type: string; nullable: boolean; has_default: boolean; default_expression: string | null }[]>`
    SELECT c.relname AS table_name, a.attname AS column_name,
           pg_catalog.format_type(a.atttypid, a.atttypmod) AS type,
           NOT a.attnotnull AS nullable, d.adbin IS NOT NULL AS has_default,
           pg_get_expr(d.adbin, d.adrelid) AS default_expression
    FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
    JOIN pg_attribute a ON a.attrelid = c.oid
    LEFT JOIN pg_attrdef d ON d.adrelid = c.oid AND d.adnum = a.attnum
    WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p') AND a.attnum > 0 AND NOT a.attisdropped
    ORDER BY c.relname, a.attnum`;
  const indexes = await sql<{ table_name: string; name: string; columns: string[]; unique: boolean; valid: boolean; method: string; predicate: string | null }[]>`
    SELECT t.relname AS table_name, i.relname AS name, ix.indisunique AS unique, ix.indisvalid AS valid,
           am.amname AS method, pg_get_expr(ix.indpred, ix.indrelid) AS predicate,
           ARRAY(SELECT a.attname FROM unnest(ix.indkey) WITH ORDINALITY k(attnum, position)
                 JOIN pg_attribute a ON a.attrelid = t.oid AND a.attnum = k.attnum ORDER BY k.position) AS columns
    FROM pg_index ix JOIN pg_class t ON t.oid = ix.indrelid JOIN pg_class i ON i.oid = ix.indexrelid
    JOIN pg_namespace n ON n.oid = t.relnamespace JOIN pg_am am ON am.oid = i.relam
    WHERE n.nspname = 'public'`;
  const constraints = await sql<{ table_name: string; name: string; definition: string; type: string; columns: string[]; foreign_table: string | null; foreign_schema: string | null; foreign_columns: string[]; on_delete: string; on_update: string; valid: boolean }[]>`
    SELECT t.relname AS table_name, con.conname AS name, pg_get_constraintdef(con.oid) AS definition,
           con.contype AS type, f.relname AS foreign_table, fn.nspname AS foreign_schema,
           con.confdeltype AS on_delete, con.confupdtype AS on_update, con.convalidated AS valid,
           ARRAY(SELECT a.attname FROM unnest(con.conkey) WITH ORDINALITY k(attnum, position)
                 JOIN pg_attribute a ON a.attrelid = t.oid AND a.attnum = k.attnum ORDER BY k.position) AS columns,
           ARRAY(SELECT a.attname FROM unnest(con.confkey) WITH ORDINALITY k(attnum, position)
                 JOIN pg_attribute a ON a.attrelid = f.oid AND a.attnum = k.attnum ORDER BY k.position) AS foreign_columns
    FROM pg_constraint con JOIN pg_class t ON t.oid = con.conrelid JOIN pg_namespace n ON n.oid = t.relnamespace
    LEFT JOIN pg_class f ON f.oid = con.confrelid LEFT JOIN pg_namespace fn ON fn.oid = f.relnamespace
    WHERE n.nspname = 'public' AND con.contype IN ('p', 'u', 'f', 'c')`;

  const differences: string[] = [];
  const expectedTables = Object.values(schema).filter(value => is(value, PgTable)).map(table => ({ table, config: getTableConfig(table) }));
  const actualTableNames = new Set(columns.map(column => column.table_name));
  for (const { table, config } of expectedTables) {
    const name = getTableName(table);
    if (!actualTableNames.has(name)) {
      differences.push(`Missing table ${name}`);
      continue;
    }
    for (const expected of config.columns) {
      const actual = columns.find(column => column.table_name === name && column.column_name === expected.name);
      const label = `${name}.${expected.name}`;
      if (!actual) { differences.push(`Missing column ${label}`); continue; }
      if (actual.type !== expected.getSQLType()) differences.push(`Column ${label}: type ${actual.type}, expected ${expected.getSQLType()}`);
      if (actual.nullable === expected.notNull) differences.push(`Column ${label}: nullable ${actual.nullable}, expected ${!expected.notNull}`);
      if (actual.has_default !== expected.hasDefault) differences.push(`Column ${label}: database default ${actual.has_default}, expected ${expected.hasDefault}`);

      if (actual.has_default && expected.hasDefault && expected.default !== undefined) {
        const value = expected.default;
        const expression = is(value, SQL) ? new PgDialect().sqlToQuery(value).sql
          : typeof value === 'string' ? `'${value.replaceAll("'", "''")}'`
          : typeof value === 'object' ? `'${JSON.stringify(value).replaceAll("'", "''")}'`
          : String(value);
        const normalize = (value: string) => value.trim().replace(/::(?:text|jsonb|integer|bigint|boolean)$/, '');
        if (normalize(actual.default_expression ?? '') !== normalize(expression)) differences.push(`Column ${label}: default expression differs from its runtime definition`);
      }
      if (expected.primary && !constraints.some(constraint => constraint.table_name === name && constraint.type === 'p' && constraint.columns.join(',') === expected.name)) differences.push(`Missing primary key ${label}`);
      if (expected.isUnique && !constraints.some(constraint => constraint.table_name === name && constraint.type === 'u' && constraint.columns.join(',') === expected.name)) differences.push(`Missing unique constraint ${label}`);
    }
    for (const actual of columns.filter(column => column.table_name === name)) {
      if (!config.columns.some(column => column.name === actual.column_name)) differences.push(`Unexpected column ${name}.${actual.column_name}`);
    }
    for (const { config: expected } of config.indexes) {
      const actual = indexes.find(index => index.table_name === name && index.name === expected.name);
      if (!actual) { differences.push(`Missing index ${name}.${expected.name}`); continue; }
      const expectedColumns = expected.columns.map(column => 'name' in column ? column.name : undefined);
      if (expectedColumns.some(column => !column) || expected.where) {
        throw new Error(`Schema parity requires an explicit comparator for expression/partial index ${expected.name}`);
      }
      if (!actual.valid || actual.unique !== expected.unique || actual.method !== (expected.method ?? 'btree')
        || actual.columns.join(',') !== expectedColumns.join(',') || actual.predicate !== null) differences.push(`Index ${name}.${expected.name} differs from its runtime definition`);
    }
    for (const expected of config.uniqueConstraints) {
      const expectedColumns = expected.columns.map(column => column.name).join(',');
      if (!constraints.some(constraint => constraint.table_name === name && constraint.type === 'u' && constraint.columns.join(',') === expectedColumns)) differences.push(`Missing unique constraint ${name}(${expectedColumns})`);
    }
    for (const expected of config.foreignKeys) {
      const reference = expected.reference();
      const expectedColumns = reference.columns.map(column => column.name).join(',');
      const actual = constraints.find(constraint => constraint.table_name === name && constraint.type === 'f' && constraint.columns.join(',') === expectedColumns);
      if (!actual || !actual.valid || actual.foreign_schema !== 'public' || actual.foreign_table !== getTableName(reference.foreignTable)
        || actual.foreign_columns.join(',') !== reference.foreignColumns.map(column => column.name).join(',')
        || deleteActions[actual.on_delete] !== (expected.onDelete ?? 'no action')
        || deleteActions[actual.on_update] !== (expected.onUpdate ?? 'no action')) differences.push(`Foreign key ${name}(${expectedColumns}) differs from its runtime definition`);
    }
    for (const actual of constraints.filter(constraint => constraint.table_name === name && constraint.type === 'f')) {
      if (!config.foreignKeys.some(expected => {
        const reference = expected.reference();
        return reference.columns.map(column => column.name).join(',') === actual.columns.join(',')
          && getTableName(reference.foreignTable) === actual.foreign_table
          && reference.foreignColumns.map(column => column.name).join(',') === actual.foreign_columns.join(',');
      })) differences.push(`Unexpected foreign key ${name}(${actual.columns.join(',')})`);
    }
    for (const expected of config.checks) {
      const contract = checkContracts[expected.name];
      const source = new PgDialect().sqlToQuery(expected.value).sql.replace(/\s+/g, '');
      if (!contract || source !== contract.source) throw new Error(`An explicit catalog comparator is required for check ${expected.name}`);
      const actual = constraints.find(constraint => constraint.table_name === name && constraint.type === 'c' && constraint.name === expected.name);
      if (!actual || !actual.valid || actual.definition.replace(/\s+/g, '') !== contract.catalog) differences.push(`Check ${name}.${expected.name} differs from its runtime definition`);
    }
    for (const actual of constraints.filter(constraint => constraint.table_name === name && constraint.type === 'c')) {
      if (!config.checks.some(expected => expected.name === actual.name)) differences.push(`Unexpected check ${name}.${actual.name}`);
    }
  }
  for (const actual of actualTableNames) {
    if (!expectedTables.some(({ config }) => config.name === actual)) differences.push(`Unexpected table ${actual}`);
  }
  return differences.sort();
}
