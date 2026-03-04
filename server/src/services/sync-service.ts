import { eq, and, gt, inArray, isNull } from 'drizzle-orm';
import type { PgTable } from 'drizzle-orm/pg-core';
import { db } from '../db/index.js';
import * as schema from '../db/schema.js';
import type { SyncChange, SyncResult } from '../types.js';
import { logger } from '../lib/logger.js';

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
]);

function stripServerFields(data: Record<string, unknown> | undefined): Record<string, unknown> {
  if (!data) return {};
  const clean: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(data)) {
    if (!SERVER_MANAGED_FIELDS.has(key)) {
      clean[key] = value;
    }
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

export async function processPush(
  changes: SyncChange[],
  userId: string
): Promise<SyncResult[]> {
  const results: SyncResult[] = [];

  for (const change of changes) {
    const table = getTable(change.table);
    const { entityId, op, data, clientVersion } = change;

    try {
      if (op === 'delete') {
        // Soft-delete: set deletedAt + bump version instead of hard-deleting.
        // This lets other clients discover the deletion on their next pull.
        const existing = await db.select().from(table).where(eq(table.id, entityId)).limit(1);
        if (existing.length === 0) {
          results.push({ entityId, status: 'accepted' });
          continue;
        }
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const serverVersion = (existing[0] as any).version as number;
        const now = new Date();
        await db
          .update(table)
          .set({
            deletedAt: now,
            updatedBy: userId,
            version: serverVersion + 1,
            updatedAt: now,
          })
          .where(eq(table.id, entityId));
        results.push({ entityId, status: 'accepted', serverVersion: serverVersion + 1 });
        continue;
      }

      // op === 'put'
      const existing = await db.select().from(table).where(eq(table.id, entityId)).limit(1);
      const cleanData = stripServerFields(data);

      if (existing.length === 0) {
        // New entity — insert
        const now = new Date();
        await db.insert(table).values({
          ...cleanData,
          id: entityId,
          createdBy: userId,
          updatedBy: userId,
          version: 1,
          createdAt: now,
          updatedAt: now,
        });
        results.push({ entityId, status: 'accepted', serverVersion: 1 });
      } else {
        // Existing — check version for conflict
        const serverEntity = existing[0];
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const serverVersion = (serverEntity as any).version as number;

        if (clientVersion !== undefined && clientVersion !== serverVersion) {
          // Conflict
          results.push({
            entityId,
            status: 'conflict',
            serverVersion,
            serverData: serverEntity as Record<string, unknown>,
          });
        } else {
          // Accept update — atomic version check to prevent concurrent overwrites
          const newVersion = serverVersion + 1;
          const now = new Date();
          const updated = await db
            .update(table)
            .set({
              ...cleanData,
              deletedAt: null, // Clear tombstone if entity is being re-created/updated
              updatedBy: userId,
              version: newVersion,
              updatedAt: now,
            })
            .where(and(eq(table.id, entityId), eq(table.version, serverVersion)))
            .returning({ id: table.id });

          if (updated.length === 0) {
            // Concurrent modification — fetch current state
            const current = await db.select().from(table).where(eq(table.id, entityId)).limit(1);
            if (current.length > 0) {
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              const currentVersion = (current[0] as any).version as number;
              results.push({
                entityId,
                status: 'conflict',
                serverVersion: currentVersion,
                serverData: current[0] as Record<string, unknown>,
              });
            } else {
              results.push({ entityId, status: 'conflict' });
            }
          } else {
            results.push({ entityId, status: 'accepted', serverVersion: newVersion });
          }
        }
      }
    } catch (err) {
      logger.error(`Sync error for ${change.table}/${entityId}`, { error: String(err) });
      results.push({ entityId, status: 'conflict' });
    }
  }

  return results;
}

export async function pullChanges(
  since: string,
  folderIds?: string[],
): Promise<{ changes: Record<string, unknown>[]; serverTimestamp: string }> {
  const sinceDate = new Date(since);
  const changes: Record<string, unknown>[] = [];

  for (const [tableName, table] of Object.entries(TABLE_MAP)) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const t = table as any;

    let query;
    if (folderIds && folderIds.length > 0 && t.folderId) {
      // Scoped tables: only pull from accessible folders
      query = db
        .select()
        .from(table)
        .where(and(gt(t.updatedAt, sinceDate), inArray(t.folderId, folderIds)));
    } else if (t.folderId) {
      // Table has folderId but no filter provided — skip (would leak data)
      continue;
    } else {
      // Global tables (tags, timelines, etc.)
      query = db.select().from(table).where(gt(t.updatedAt, sinceDate));
    }

    const rows = await query;
    for (const row of rows) {
      const record = row as Record<string, unknown>;
      // If entity has been soft-deleted, send as a delete op so clients remove it
      if (record.deletedAt) {
        changes.push({ table: tableName, op: 'delete', id: record.id });
      } else {
        changes.push({ table: tableName, op: 'put', ...record });
      }
    }
  }

  return { changes, serverTimestamp: new Date().toISOString() };
}

export async function getSnapshot(folderId: string): Promise<Record<string, unknown[]>> {
  const snapshot: Record<string, unknown[]> = {};

  for (const [tableName, table] of Object.entries(TABLE_MAP)) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const t = table as any;
    if (t.folderId) {
      // Only include non-deleted entities in snapshots
      snapshot[tableName] = await db
        .select()
        .from(table)
        .where(and(eq(t.folderId, folderId), isNull(t.deletedAt)));
    }
  }

  // Also include the folder itself (if not deleted)
  snapshot.folders = await db
    .select()
    .from(schema.folders)
    .where(and(eq(schema.folders.id, folderId), isNull(schema.folders.deletedAt)));

  return snapshot;
}
