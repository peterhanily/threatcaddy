import { eq, and, gt, lte, inArray, isNull, count, or, sql, getTableColumns } from 'drizzle-orm';
import { nanoid } from 'nanoid';
import type { PgTable } from 'drizzle-orm/pg-core';
import { db } from '../db/index.js';
import * as schema from '../db/schema.js';
import type { SyncChange, SyncResult } from '../types.js';
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
  evidenceItems: schema.evidenceItems,
};

// These two catalogs are intentionally shared server-wide. Every other sync table is investigation-scoped.
const GLOBAL_SYNC_TABLES = new Set(['tags', 'timelines']);

// Fields managed exclusively by the server — never accept from client
const SERVER_MANAGED_FIELDS = new Set([
  'id', 'createdBy', 'updatedBy', 'version', 'createdAt', 'updatedAt', 'deletedAt',
  'localOnly', // client-only field — never store on server
]);

/** Max allowed size for string fields to prevent oversized payloads */
const MAX_STRING_LENGTH = 500_000; // 500KB — covers large note content
const MAX_ARRAY_LENGTH = 5_000;    // e.g. tags, linkedIds
const MAX_OBJECT_DEPTH = 5;

export class SyncWriteValidationError extends Error {}
const EVIDENCE_RASTER_MIME_TYPES = new Set(['image/png', 'image/jpeg', 'image/gif', 'image/webp']);

/** Validate the resulting PATCH state, not just fields present in this request.
 * Accepted preview bytes must survive the client's raster-only sanitizer. */
function validateEvidencePreview(clean: Record<string, unknown>, current?: Record<string, unknown>): void {
  const preview = Object.hasOwn(clean, 'imageData') ? clean.imageData : current?.imageData;
  const rawMime = Object.hasOwn(clean, 'imageDataMimeType') ? clean.imageDataMimeType : current?.imageDataMimeType;
  const mime = typeof rawMime === 'string' ? rawMime.toLowerCase().trim() : rawMime;
  if (mime !== undefined && mime !== null && (typeof mime !== 'string' || !EVIDENCE_RASTER_MIME_TYPES.has(mime))) {
    throw new SyncWriteValidationError('Evidence image MIME type must be image/png, image/jpeg, image/gif or image/webp');
  }
  if (preview !== undefined && preview !== null && (typeof preview !== 'string' || preview !== '' && !mime)) {
    throw new SyncWriteValidationError('Evidence image data requires a supported raster MIME type');
  }
  if (Object.hasOwn(clean, 'imageDataMimeType')) clean.imageDataMimeType = mime;
}

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

function stripServerFields(data: Record<string, unknown> | undefined, tableName: string): Record<string, unknown> {
  if (!data) return {};
  const clean: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(data)) {
    if (SERVER_MANAGED_FIELDS.has(key)) continue;
    if (typeof value === 'string' && ((tableName === 'evidenceItems' && key === 'imageData') || (tableName === 'whiteboards' && key === 'files'))) {
      const limit = key === 'files' ? 8 * 1024 * 1024 : 4_250_000;
      if (Buffer.byteLength(value) > limit) throw new SyncWriteValidationError(`Sync field "${key}" exceeds its supported asset limit`);
      if (key === 'files') {
        let parsed;
        try { parsed = JSON.parse(value); } catch { throw new SyncWriteValidationError('Whiteboard files must contain valid JSON'); }
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new SyncWriteValidationError('Whiteboard files must be an object');
      } else if (value && !/^[A-Za-z0-9+/]+={0,2}$/.test(value)) throw new SyncWriteValidationError('Evidence image data must be base64');
      clean[key] = value;
      continue;
    }
    // Reject unsafe or oversized values
    if (!validateValue(value)) {
      throw new SyncWriteValidationError(`Sync field "${key}" exceeds the supported value limits`);
    }
    const column = getTableColumns(getTable(tableName))?.[key];
    if (column?.dataType === 'date' && value !== null && value !== undefined) {
      const date = value instanceof Date ? value : typeof value === 'number' || typeof value === 'string' ? new Date(value) : null;
      if (!date || !Number.isFinite(date.getTime())) throw new SyncWriteValidationError(`Invalid timestamp field "${key}"`);
      clean[key] = date;
    } else clean[key] = value;
  }
  return clean;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function getTable(name: string): any {
  const table = Object.hasOwn(TABLE_MAP, name) ? TABLE_MAP[name] : undefined;
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
  userId: string,
  options: { authorize?: boolean; trustedInternal?: boolean; generation?: string } = {},
): Promise<SyncResult[]> {
  const identities = new Set<string>();
  for (const change of changes) {
    getTable(change.table);
    const key = JSON.stringify([change.table, change.entityId]);
    if (identities.has(key)) throw new Error('Duplicate sync entity in batch');
    identities.add(key);
  }
  const events: Parameters<typeof emitEntityEvent>[] = [];
  const results = await db.transaction(async (tx) => {
    // Match the database triggers' lock order before reading baselines. Every
    // accepted write and new folder membership commits or rolls back together.
    const clock = await tx.execute(sql`SELECT cursor, generation FROM sync_clock WHERE id = 1 FOR UPDATE`);
    if (options.generation !== undefined && clock[0]?.generation !== options.generation) {
      throw new SyncReadError('Server history changed; reconcile this workspace before uploading', 409, true);
    }
    const editorFolders = new Set<string>();
    if (options.authorize) {
      const [user] = await tx.select().from(schema.users).where(eq(schema.users.id, userId)).for('share');
      if (!user?.active || !['admin', 'analyst'].includes(user.role)) {
        return changes.map(change => ({ table: change.table, entityId: change.entityId, status: 'rejected' as const }));
      }
      const memberships = await tx.select().from(schema.investigationMembers)
        .where(eq(schema.investigationMembers.userId, userId)).for('share');
      for (const member of memberships) if (member.role === 'owner' || member.role === 'editor') editorFolders.add(member.folderId);
    }
    const result: SyncResult[] = new Array(changes.length);
    // Creating a folder first makes its ownership available to children in the
    // same batch regardless of their original ordering.
    const ordered = changes.map((change, index) => ({ change, index }))
      .sort((a, b) => Number(b.change.table === 'folders') - Number(a.change.table === 'folders'));
    for (const { change, index } of ordered) {
      const table = getTable(change.table);
      const { entityId, op } = change;
      const [existing] = await tx.select().from(table).where(eq(table.id, entityId)).limit(1);
      const current = existing as Record<string, unknown> | undefined;
      if (!current && op === 'delete') {
        // Idempotent deletion has no remaining object to authorize or mutate.
        // A zero revision explicitly acknowledges its already-absent state.
        result[index] = { table: change.table, entityId, status: 'accepted', serverVersion: 0 };
        continue;
      }
      const sourceFolder = change.table === 'folders' ? entityId : current?.folderId as string | undefined;
      const destinationFolder = change.table === 'folders' ? entityId :
        (Object.hasOwn(change.data ?? {}, 'folderId') ? change.data?.folderId : sourceFolder) as string | undefined;
      if (options.authorize && !GLOBAL_SYNC_TABLES.has(change.table)) {
        const isNewFolder = change.table === 'folders' && !current && op === 'put';
        const authorized = isNewFolder || (current
          ? !!sourceFolder && editorFolders.has(sourceFolder)
            && (op === 'delete' || !!destinationFolder && editorFolders.has(destinationFolder))
          : op === 'put' && !!destinationFolder && editorFolders.has(destinationFolder));
        if (!authorized) {
          result[index] = { table: change.table, entityId, status: 'rejected' };
          continue;
        }
      }
      const serverVersion = (current?.version as number | undefined) ?? 0;
      // Only internal PATCH callers may select a baseline while holding the
      // writer lock. The HTTP route never passes trustedInternal.
      const baseline = change.clientVersion ?? (options.trustedInternal ? serverVersion : undefined);
      if ((current && baseline !== serverVersion) || (!current && baseline !== undefined && baseline !== 0 && op === 'put')) {
        result[index] = { table: change.table, entityId, status: 'conflict', serverVersion, serverData: current };
        continue;
      }
      const cleanData = stripServerFields(change.data, change.table);
      if (change.table === 'evidenceItems' && op === 'put') validateEvidencePreview(cleanData, current);
      const now = new Date();
      let record: Record<string, unknown>;
      if (!current) {
        const [inserted] = await tx.insert(table).values({ ...cleanData, id: entityId, createdBy: userId, updatedBy: userId, version: 1, createdAt: now, updatedAt: now }).returning();
        record = inserted as Record<string, unknown>;
        if (change.table === 'folders') {
          await tx.insert(schema.investigationMembers).values({ id: nanoid(), folderId: entityId, userId, role: 'owner' }).onConflictDoNothing();
          editorFolders.add(entityId);
        }
      } else {
        const [updated] = await tx.update(table).set({
          // An explicitly authorized put against the current tombstone revision
          // restores the record. Stale edits still conflict before this point.
          ...(op === 'delete' ? { deletedAt: now } : { ...cleanData, deletedAt: null }),
          updatedBy: userId, version: serverVersion + 1, updatedAt: now,
        }).where(and(eq(table.id, entityId), eq(table.version, serverVersion))).returning();
        if (!updated) throw new Error('Sync revision changed while holding the writer lock');
        record = updated as Record<string, unknown>;
      }
      result[index] = { table: change.table, entityId, status: 'accepted', serverVersion: record.version as number, serverRecord: record,
        ...(sourceFolder && sourceFolder !== destinationFolder ? { previousFolderId: sourceFolder } : {}) };
      const eventFolder = (record.folderId as string | undefined) ?? (change.table === 'folders' ? entityId : undefined);
      events.push(op === 'put' ? [op, change.table, entityId, eventFolder, userId, !current, record]
        : [op, change.table, entityId, eventFolder, userId, false]);
    }
    return result;
  });
  // Transaction errors propagate: callers must retry the whole batch. No
  // accepted response or automation event escapes a rolled-back transaction.
  for (const event of events) emitEntityEvent(...event);
  return results;
}

// P11: Heavy columns excluded in metadataOnly mode
const METADATA_EXCLUDED_COLUMNS = new Set(['content', 'messages', 'elements', 'files', 'imageData', 'imageAnalysis', 'imageOcrText', 'iocAnalysis']);

export class SyncReadError extends Error {
  constructor(message: string, public readonly status: 400 | 403 | 409, public readonly resetRequired = false) { super(message); }
}

function logRecord(tableName: string, stored: Record<string, unknown>, metadataOnly: boolean): Record<string, unknown> {
  const columns = getTableColumns(getTable(tableName));
  const record: Record<string, unknown> = {};
  for (const [key, column] of Object.entries(columns)) {
    if (metadataOnly && METADATA_EXCLUDED_COLUMNS.has(key)) continue;
    record[key] = stored[(column as { name: string }).name];
  }
  return record;
}

/** Commit-ordered pagination; membership, watermark and log rows share a snapshot. */
export async function pullCursorChanges(
  cursor: string,
  userId: string,
  opts: { folderId?: string; metadataOnly?: boolean; limit?: number; generation?: string } = {},
): Promise<{ changes: Record<string, unknown>[]; cursor: string; generation: string; hasMore: boolean; serverTimestamp: string }> {
  if (!/^(0|[1-9][0-9]{0,18})$/.test(cursor) || BigInt(cursor) > 9223372036854775807n) throw new SyncReadError('Invalid sync cursor', 400);
  const limit = Math.min(Math.max(Math.trunc(opts.limit ?? 200), 1), 1000);
  return db.transaction(async tx => {
    const [user] = await tx.select({ active: schema.users.active }).from(schema.users).where(eq(schema.users.id, userId));
    if (!user?.active) throw new SyncReadError('Account is no longer authorized', 403);
    const memberships = await tx.select({ folderId: schema.investigationMembers.folderId }).from(schema.investigationMembers)
      .where(eq(schema.investigationMembers.userId, userId));
    const allowedFolders = memberships.map(member => member.folderId);
    if (opts.folderId && !allowedFolders.includes(opts.folderId)) throw new SyncReadError('No access to this investigation', 403);
    const folderIds = opts.folderId ? [opts.folderId] : allowedFolders;
    const [clock] = await tx.select().from(schema.syncClock).where(eq(schema.syncClock.id, 1));
    if (!clock) throw new Error('Sync clock is missing');
    if (opts.generation && opts.generation !== clock.generation) throw new SyncReadError('Server history generation changed; reconcile this workspace', 409, true);
    if (BigInt(cursor) > clock.cursor) throw new SyncReadError('Sync cursor belongs to a newer server state; restart synchronization', 409, true);
    const scopes = [inArray(schema.syncChanges.tableName, [...GLOBAL_SYNC_TABLES])];
    if (folderIds.length) scopes.push(inArray(schema.syncChanges.folderId, folderIds), inArray(schema.syncChanges.previousFolderId, folderIds));
    const predicate = and(
      gt(schema.syncChanges.cursor, BigInt(cursor)), lte(schema.syncChanges.cursor, clock.cursor), or(...scopes),
    );
    // The byte window is evaluated inside PostgreSQL, so large inline images
    // cannot multiply an ordinary page into hundreds of megabytes in Node.
    const rows = await tx.execute<{ cursor: string; tableName: string; entityId: string; folderId: string | null; previousFolderId: string | null; op: string; record: Record<string, unknown>; candidateCount: string }>(sql`
      WITH candidates AS (
        SELECT * FROM sync_changes WHERE ${predicate} ORDER BY cursor LIMIT ${limit + 1}
      ), bounded AS (
        SELECT *, sum(octet_length(record::text)) OVER (ORDER BY cursor) AS bytes,
          row_number() OVER (ORDER BY cursor) AS position, count(*) OVER () AS candidate_count FROM candidates
      )
      SELECT cursor::text AS cursor, table_name AS "tableName", entity_id AS "entityId",
        folder_id AS "folderId", previous_folder_id AS "previousFolderId", op, record, candidate_count AS "candidateCount"
      FROM bounded WHERE bytes <= ${16 * 1024 * 1024} OR position = 1 ORDER BY bounded.cursor`);
    const hasMore = rows.length > limit || (rows.length > 0 && rows.length < Number(rows[0].candidateCount));
    const page = rows.slice(0, limit);
    const latest = new Map<string, Record<string, unknown>>();
    for (const row of page) {
      const key = JSON.stringify([row.tableName, row.entityId]);
      const visible = GLOBAL_SYNC_TABLES.has(row.tableName) || !!row.folderId && folderIds.includes(row.folderId);
      if (!visible) {
        // A move out of an accessible investigation removes its local copy,
        // without disclosing the destination or the destination's record.
        latest.set(key, { table: row.tableName, op: 'delete', id: row.entityId, version: (row.record as Record<string, unknown>).version });
      } else if (row.op === 'delete') {
        latest.set(key, { table: row.tableName, op: 'delete', id: row.entityId, version: (row.record as Record<string, unknown>).version });
      } else {
        latest.set(key, { table: row.tableName, op: 'put', ...logRecord(row.tableName, row.record as Record<string, unknown>, opts.metadataOnly ?? false) });
      }
    }
    return { changes: [...latest.values()], cursor: (hasMore ? page[page.length - 1].cursor : clock.cursor).toString(), generation: clock.generation, hasMore, serverTimestamp: new Date().toISOString() };
  }, { isolationLevel: 'repeatable read', accessMode: 'read only' });
}

// Compatibility for clients that have not adopted durable cursors. Always send
// the complete visible state: an ISO wall-clock boundary cannot be lossless.
export async function pullChanges(
  _since: string,
  folderIds?: string[],
  opts?: { metadataOnly?: boolean },
): Promise<{ changes: Record<string, unknown>[]; serverTimestamp: string }> {
  const changes: Record<string, unknown>[] = [];
  const metadataOnly = opts?.metadataOnly ?? false;

  // Build all queries up front, then execute in parallel
  const queries: { tableName: string; promise: Promise<unknown[]> }[] = [];

  for (const [tableName, table] of Object.entries(TABLE_MAP)) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const t = table as any;

    const scopeColumn = tableName === 'folders' ? t.id : t.folderId;
    if (folderIds && folderIds.length > 0 && scopeColumn) {
      // Scoped tables: only pull from accessible folders
      queries.push({
        tableName,
        promise: db
          .select()
          .from(table)
          .where(inArray(scopeColumn, folderIds)),
      });
    } else if (!GLOBAL_SYNC_TABLES.has(tableName)) {
      // Table has folderId but no filter provided — skip (would leak data)
      continue;
    } else {
      // Explicit shared catalogs only; missing folderId never implies global visibility.
      queries.push({
        tableName,
        promise: db.select().from(table),
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
  evidence: number;
}

const ENTITY_COUNT_TABLES = [
  { key: 'evidence' as const, table: schema.evidenceItems, folderId: schema.evidenceItems.folderId, deletedAt: schema.evidenceItems.deletedAt },
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

  const counts: EntityCounts = { notes: 0, tasks: 0, iocs: 0, events: 0, whiteboards: 0, chats: 0, evidence: 0 };
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
    result.set(folderId, { notes: 0, tasks: 0, iocs: 0, events: 0, whiteboards: 0, chats: 0, evidence: 0 });
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
