import { eq, and, gt, inArray, isNull, count } from 'drizzle-orm';
import type { PgTable } from 'drizzle-orm/pg-core';
import { db } from '../db/index.js';
import * as schema from '../db/schema.js';
import type { SyncChange, SyncResult } from '../types.js';
import { logger } from '../lib/logger.js';
import { emitEntityEvent } from '../bots/event-bus.js';

// Maps table names to Drizzle table references
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const TABLE_MAP: Record<string, PgTable<any>> = {
  notes: schema.notes,
  tasks: schema.tasks,
  folders: schema.folders,
  tags: schema.tags,
  timelineEvents: schema.timelineEvents,
  timelines: schema.timelines,
  whiteboards: schema.whiteboards,
  standaloneIOCs: schema.standaloneIOCs,
  chatThreads: schema.chatThreads,
};

// Fields managed exclusively by the server — never accept from client
const SERVER_MANAGED_FIELDS = new Set([
  'id', 'createdBy', 'updatedBy', 'version', 'createdAt', 'updatedAt', 'deletedAt',
  'localOnly', // client-only field — never store on server
]);

/** Max allowed size for string fields to prevent oversized payloads */
const MAX_STRING_LENGTH = 500_000; // 500KB — covers large note content
const MAX_ARRAY_LENGTH = 5_000;    // e.g. tags, linkedIds
const MAX_OBJECT_DEPTH = 5;

/**
 * Validate that a value is a safe, bounded primitive or structure.
 * Rejects functions, symbols, deeply nested objects, and oversized strings/arrays.
 */
function validateValue(value: unknown, depth = 0): boolean {
  if (value === null || value === undefined) return true;
  const t = typeof value;
  if (t === 'boolean' || t === 'number') return true;
  if (t === 'string') return (value as string).length <= MAX_STRING_LENGTH;
  if (t === 'function' || t === 'symbol' || t === 'bigint') return false;
  if (depth > MAX_OBJECT_DEPTH) return false;
  if (Array.isArray(value)) {
    return value.length <= MAX_ARRAY_LENGTH && value.every(v => validateValue(v, depth + 1));
  }
  if (t === 'object') {
    const entries = Object.entries(value as Record<string, unknown>);
    if (entries.length > 200) return false; // too many fields
    return entries.every(([, v]) => validateValue(v, depth + 1));
  }
  return false;
}

function stripServerFields(data: Record<string, unknown> | undefined): Record<string, unknown> {
  if (!data) return {};
  const clean: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(data)) {
    if (SERVER_MANAGED_FIELDS.has(key)) continue;
    // Reject unsafe or oversized values
    if (!validateValue(value)) {
      logger.warn('Sync: rejected invalid field value', { key, type: typeof value });
      continue;
    }
    clean[key] = value;
  }
  return clean;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function getTable(name: string): any {
  const table = TABLE_MAP[name];
  if (!table) throw new Error(`Unknown table: ${name}`);
  return table;
}

/**
 * Look up the folderId for an existing entity in the DB.
 * Returns undefined if the entity doesn't exist or the table has no folderId column.
 */
export async function lookupEntityFolderId(
  tableName: string,
  entityId: string,
): Promise<string | undefined> {
  const table = TABLE_MAP[tableName];
  if (!table) return undefined;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const t = table as any;
  if (!t.folderId) return undefined; // table has no folderId column
  try {
    const rows = await db
      .select({ folderId: t.folderId })
      .from(table)
      .where(eq(t.id, entityId))
      .limit(1);
    return rows.length > 0 ? (rows[0].folderId as string) : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Batch lookup folderId for multiple entities, grouped by table.
 * Returns a Map keyed by "table:entityId" → folderId.
 */
export async function bulkLookupEntityFolderIds(
  lookups: Array<{ table: string; entityId: string }>,
): Promise<Map<string, string | undefined>> {
  const result = new Map<string, string | undefined>();
  if (lookups.length === 0) return result;

  // Group by table to issue one query per table
  const byTable = new Map<string, string[]>();
  for (const { table: tableName, entityId } of lookups) {
    const existing = byTable.get(tableName);
    if (existing) {
      existing.push(entityId);
    } else {
      byTable.set(tableName, [entityId]);
    }
  }

  const queries: Array<{ tableName: string; promise: Promise<{ id: string; folderId: string }[]> }> = [];
  for (const [tableName, entityIds] of byTable) {
    const table = TABLE_MAP[tableName];
    if (!table) continue;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const t = table as any;
    if (!t.folderId) continue; // table has no folderId column
    queries.push({
      tableName,
      promise: db
        .select({ id: t.id, folderId: t.folderId })
        .from(table)
        .where(inArray(t.id, entityIds)) as Promise<{ id: string; folderId: string }[]>,
    });
  }

  const queryResults = await Promise.all(queries.map(q => q.promise));
  for (let i = 0; i < queries.length; i++) {
    const tableName = queries[i].tableName;
    for (const row of queryResults[i]) {
      result.set(`${tableName}:${row.id}`, row.folderId);
    }
  }

  return result;
}

export async function processPush(
  changes: SyncChange[],
  userId: string
): Promise<SyncResult[]> {
  // Wrap entire push in a transaction for atomicity
  return db.transaction(async (tx) => {
    const results: SyncResult[] = [];

    // Group changes by table for batch existence checks
    const byTable = new Map<string, Array<{ index: number; change: SyncChange }>>();
    for (let i = 0; i < changes.length; i++) {
      const change = changes[i];
      const group = byTable.get(change.table);
      if (group) {
        group.push({ index: i, change });
      } else {
        byTable.set(change.table, [{ index: i, change }]);
      }
    }

    // Pre-allocate results array
    results.length = changes.length;

    // Batch existence checks per table
    const existingEntities = new Map<string, Record<string, unknown>>();

    for (const [tableName, group] of byTable) {
      const table = getTable(tableName);
      const entityIds = group.map(g => g.change.entityId);
      try {
        const rows = await tx
          .select()
          .from(table)
          .where(inArray(table.id, entityIds));
        for (const row of rows) {
          const record = row as Record<string, unknown>;
          existingEntities.set(`${tableName}:${record.id}`, record);
        }
      } catch (err) {
        logger.error(`Batch existence check failed for ${tableName}`, { error: String(err) });
      }
    }

    // Process each change using the pre-fetched existence data
    for (let i = 0; i < changes.length; i++) {
      const change = changes[i];
      const table = getTable(change.table);
      const { entityId, op, data, clientVersion } = change;

      try {
        const existingKey = `${change.table}:${entityId}`;
        const existingRecord = existingEntities.get(existingKey);

        if (op === 'delete') {
          // Soft-delete: set deletedAt + bump version instead of hard-deleting.
          if (!existingRecord) {
            results[i] = { table: change.table, entityId, status: 'accepted' };
            continue;
          }
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const serverVersion = (existingRecord as any).version as number;
          const now = new Date();
          await tx
            .update(table)
            .set({
              deletedAt: now,
              updatedBy: userId,
              version: serverVersion + 1,
              updatedAt: now,
            })
            .where(eq(table.id, entityId));
          results[i] = { table: change.table, entityId, status: 'accepted', serverVersion: serverVersion + 1 };
          emitEntityEvent('delete', change.table, entityId, existingRecord.folderId as string | undefined, userId, false);
          continue;
        }

        // op === 'put'
        const cleanData = stripServerFields(data);

        if (!existingRecord) {
          // New entity — insert
          const now = new Date();
          const inserted = await tx.insert(table).values({
            ...cleanData,
            id: entityId,
            createdBy: userId,
            updatedBy: userId,
            version: 1,
            createdAt: now,
            updatedAt: now,
          }).returning();
          results[i] = { table: change.table, entityId, status: 'accepted', serverVersion: 1, serverRecord: inserted[0] as Record<string, unknown> };
          emitEntityEvent('put', change.table, entityId, cleanData.folderId as string | undefined, userId, true, cleanData);
        } else {
          // Existing — check version for conflict
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const serverVersion = (existingRecord as any).version as number;

          if (clientVersion !== undefined && clientVersion !== serverVersion) {
            // Conflict
            results[i] = {
              table: change.table,
              entityId,
              status: 'conflict',
              serverVersion,
              serverData: existingRecord,
            };
          } else {
            // Accept update — atomic version check to prevent concurrent overwrites
            const newVersion = serverVersion + 1;
            const now = new Date();
            const updated = await tx
              .update(table)
              .set({
                ...cleanData,
                updatedBy: userId,
                version: newVersion,
                updatedAt: now,
              })
              .where(and(eq(table.id, entityId), eq(table.version, serverVersion)))
              .returning();

            if (updated.length === 0) {
              // Concurrent modification — fetch current state
              const current = await tx.select().from(table).where(eq(table.id, entityId)).limit(1);
              if (current.length > 0) {
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                const currentVersion = (current[0] as any).version as number;
                results[i] = {
                  table: change.table,
                  entityId,
                  status: 'conflict',
                  serverVersion: currentVersion,
                  serverData: current[0] as Record<string, unknown>,
                };
              } else {
                results[i] = { table: change.table, entityId, status: 'conflict' };
              }
            } else {
              results[i] = { table: change.table, entityId, status: 'accepted', serverVersion: newVersion, serverRecord: updated[0] as Record<string, unknown> };
              emitEntityEvent('put', change.table, entityId, cleanData.folderId as string | undefined, userId, false, cleanData);
            }
          }
        }
      } catch (err) {
        logger.error(`Sync error for ${change.table}/${entityId}`, { error: String(err) });
        results[i] = { table: change.table, entityId, status: 'conflict' };
      }
    }

    return results;
  });
}

// P11: Heavy columns excluded in metadataOnly mode
const METADATA_EXCLUDED_COLUMNS = new Set(['content', 'messages', 'elements', 'iocAnalysis']);

export async function pullChanges(
  since: string,
  folderIds?: string[],
  opts?: { metadataOnly?: boolean },
): Promise<{ changes: Record<string, unknown>[]; serverTimestamp: string }> {
  const sinceDate = new Date(since);
  const changes: Record<string, unknown>[] = [];
  const metadataOnly = opts?.metadataOnly ?? false;

  // Build all queries up front, then execute in parallel
  const queries: { tableName: string; promise: Promise<unknown[]> }[] = [];

  for (const [tableName, table] of Object.entries(TABLE_MAP)) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const t = table as any;

    if (folderIds && folderIds.length > 0 && t.folderId) {
      // Scoped tables: only pull from accessible folders
      queries.push({
        tableName,
        promise: db
          .select()
          .from(table)
          .where(and(gt(t.updatedAt, sinceDate), inArray(t.folderId, folderIds))),
      });
    } else if (t.folderId) {
      // Table has folderId but no filter provided — skip (would leak data)
      continue;
    } else {
      // Global tables (tags, timelines, etc.)
      queries.push({
        tableName,
        promise: db.select().from(table).where(gt(t.updatedAt, sinceDate)),
      });
    }
  }

  const results = await Promise.all(queries.map(q => q.promise));

  for (let i = 0; i < queries.length; i++) {
    const tableName = queries[i].tableName;
    const rows = results[i];
    for (const row of rows) {
      const record = row as Record<string, unknown>;
      // If entity has been soft-deleted, send as a delete op so clients remove it
      if (record.deletedAt) {
        changes.push({ table: tableName, op: 'delete', id: record.id });
      } else if (metadataOnly) {
        // P11: Strip heavy columns when metadataOnly is requested
        const projected: Record<string, unknown> = { table: tableName, op: 'put' };
        for (const [key, value] of Object.entries(record)) {
          if (!METADATA_EXCLUDED_COLUMNS.has(key)) {
            projected[key] = value;
          }
        }
        changes.push(projected);
      } else {
        changes.push({ table: tableName, op: 'put', ...record });
      }
    }
  }

  return { changes, serverTimestamp: new Date().toISOString() };
}

export async function getSnapshot(folderId: string): Promise<Record<string, unknown[]>> {
  const snapshot: Record<string, unknown[]> = {};

  // Build all queries up front, then execute in parallel
  const queries: { tableName: string; promise: Promise<unknown[]> }[] = [];

  for (const [tableName, table] of Object.entries(TABLE_MAP)) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const t = table as any;
    if (t.folderId) {
      queries.push({
        tableName,
        promise: db.select().from(table).where(and(eq(t.folderId, folderId), isNull(t.deletedAt))),
      });
    }
  }

  // Include the folder itself
  queries.push({
    tableName: 'folders',
    promise: db.select().from(schema.folders).where(and(eq(schema.folders.id, folderId), isNull(schema.folders.deletedAt))),
  });

  const results = await Promise.all(queries.map(q => q.promise));
  for (let i = 0; i < queries.length; i++) {
    snapshot[queries[i].tableName] = results[i] as unknown[];
  }

  return snapshot;
}

// ─── Entity Count Helpers ────────────────────────────────────────

export interface EntityCounts {
  notes: number;
  tasks: number;
  iocs: number;
  events: number;
  whiteboards: number;
  chats: number;
}

const ENTITY_COUNT_TABLES = [
  { key: 'notes' as const, table: schema.notes, folderId: schema.notes.folderId, deletedAt: schema.notes.deletedAt },
  { key: 'tasks' as const, table: schema.tasks, folderId: schema.tasks.folderId, deletedAt: schema.tasks.deletedAt },
  { key: 'iocs' as const, table: schema.standaloneIOCs, folderId: schema.standaloneIOCs.folderId, deletedAt: schema.standaloneIOCs.deletedAt },
  { key: 'events' as const, table: schema.timelineEvents, folderId: schema.timelineEvents.folderId, deletedAt: schema.timelineEvents.deletedAt },
  { key: 'whiteboards' as const, table: schema.whiteboards, folderId: schema.whiteboards.folderId, deletedAt: schema.whiteboards.deletedAt },
  { key: 'chats' as const, table: schema.chatThreads, folderId: schema.chatThreads.folderId, deletedAt: schema.chatThreads.deletedAt },
] as const;

/**
 * Get entity counts for a single investigation folder.
 * Runs all count queries in parallel, only counting non-deleted entities.
 */
export async function getEntityCounts(folderId: string): Promise<EntityCounts> {
  const results = await Promise.all(
    ENTITY_COUNT_TABLES.map((entry) =>
      db
        .select({ count: count() })
        .from(entry.table)
        .where(and(eq(entry.folderId, folderId), isNull(entry.deletedAt)))
    )
  );

  const counts: EntityCounts = { notes: 0, tasks: 0, iocs: 0, events: 0, whiteboards: 0, chats: 0 };
  for (let i = 0; i < ENTITY_COUNT_TABLES.length; i++) {
    counts[ENTITY_COUNT_TABLES[i].key] = results[i][0]?.count ?? 0;
  }
  return counts;
}

/**
 * Get entity counts for multiple investigation folders in batch.
 * Issues one query per entity table with GROUP BY folderId, rather than N queries per folder.
 */
export async function getEntityCountsBatch(folderIds: string[]): Promise<Map<string, EntityCounts>> {
  const result = new Map<string, EntityCounts>();
  if (folderIds.length === 0) return result;

  // Initialize all folders with zero counts
  for (const folderId of folderIds) {
    result.set(folderId, { notes: 0, tasks: 0, iocs: 0, events: 0, whiteboards: 0, chats: 0 });
  }

  // Run one GROUP BY query per entity table in parallel
  const batchResults = await Promise.all(
    ENTITY_COUNT_TABLES.map((entry) =>
      db
        .select({
          folderId: entry.folderId,
          count: count(),
        })
        .from(entry.table)
        .where(and(inArray(entry.folderId, folderIds), isNull(entry.deletedAt)))
        .groupBy(entry.folderId)
    )
  );

  for (let i = 0; i < ENTITY_COUNT_TABLES.length; i++) {
    const key = ENTITY_COUNT_TABLES[i].key;
    for (const row of batchResults[i]) {
      const existing = result.get(row.folderId!);
      if (existing) {
        existing[key] = row.count;
      }
    }
  }

  return result;
}
