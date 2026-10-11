import { describe, expect, it } from 'vitest';
import { PgDialect } from 'drizzle-orm/pg-core';
import type { SQL } from 'drizzle-orm';
import { notes, syncClock } from '../db/schema.js';
import { INVESTIGATION_CONTENT_TABLES, publishInvestigationVisibility, type InvestigationTransaction } from '../services/investigation-lifecycle.js';

describe('investigation visibility publication', () => {
  it('publishes bounded minimal child tombstones without recopying retained content or changing children', async () => {
    const rows = Array.from({ length: 201 }, (_, index) => ({ id: `note-${index}`, version: 7, content: 'Retained synthetic evidence' }));
    const batches: Array<Array<Record<string, unknown>>> = [];
    const updates: unknown[] = [];
    const tx = {
      select: () => ({ from: (table: unknown) => ({ where: async () => table === notes ? rows : [] }) }),
      update: (table: unknown) => { updates.push(table); return { set: () => ({ where: () => ({ returning: async () => [{ cursor: 301n }] }) }) }; },
      insert: () => ({ values: async (batch: Array<Record<string, unknown>>) => { batches.push(batch); } }),
    } as unknown as InvestigationTransaction;
    await publishInvestigationVisibility(tx, 'case', true);
    expect(updates).toEqual([syncClock]);
    expect(batches.map(batch => batch.length)).toEqual([200, 1]);
    const entries = batches.flat();
    expect(entries[0]).toEqual({ cursor: 101n, tableName: 'notes', entityId: 'note-0', folderId: 'case', op: 'delete', record: { id: 'note-0', version: 7 } });
    expect(entries.at(-1)?.cursor).toBe(301n);
    expect(JSON.stringify(entries.map(row => row.record))).not.toContain('Retained synthetic evidence');
  });

  it('republishes only live children on restoration without removing their independent tombstones', async () => {
    const updates: Array<{ table: unknown; data: Record<string, unknown>; predicate: SQL }> = [];
    const tx = { update: (table: unknown) => ({ set: (data: Record<string, unknown>) => ({ where: async (predicate: SQL) => {
      updates.push({ table, data, predicate });
    } }) }) } as unknown as InvestigationTransaction;
    await publishInvestigationVisibility(tx, 'case', false);
    expect(updates.map(update => update.table)).toEqual(INVESTIGATION_CONTENT_TABLES.map(([, table]) => table));
    for (const update of updates) {
      expect(Object.keys(update.data)).toEqual(['updatedAt']);
      const query = new PgDialect().sqlToQuery(update.predicate);
      expect(query.sql).toContain('"deleted_at" is null');
      expect(query.params).toContain('case');
    }
  });
});
