import { eq, and, gt } from 'drizzle-orm';
import type { PgTable } from 'drizzle-orm/pg-core';
import { db } from '../db/index.js';
import * as schema from '../db/schema.js';
import type { SyncChange, SyncResult } from '../types.js';

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

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function getTable(name: string): any {
  const table = TABLE_MAP[name];
  if (!table) throw new Error(`Unknown table: ${name}`);
  return table;
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
        await db.delete(table).where(eq(table.id, entityId));
        results.push({ entityId, status: 'accepted' });
        continue;
      }

      // op === 'put'
      const existing = await db.select().from(table).where(eq(table.id, entityId)).limit(1);

      if (existing.length === 0) {
        // New entity — insert
        const now = new Date();
        await db.insert(table).values({
          ...data,
          id: entityId,
          createdBy: userId,
          updatedBy: userId,
          version: 1,
          createdAt: data?.createdAt ? new Date(data.createdAt as number) : now,
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
          // Accept update
          const newVersion = serverVersion + 1;
          const now = new Date();
          await db
            .update(table)
            .set({
              ...data,
              updatedBy: userId,
              version: newVersion,
              updatedAt: now,
            })
            .where(eq(table.id, entityId));
          results.push({ entityId, status: 'accepted', serverVersion: newVersion });
        }
      }
    } catch (err) {
      console.error(`Sync error for ${change.table}/${entityId}:`, err);
      results.push({ entityId, status: 'conflict' });
    }
  }

  return results;
}

export async function pullChanges(
  since: string,
  folderId?: string
): Promise<{ changes: Record<string, unknown>[]; serverTimestamp: string }> {
  const sinceDate = new Date(since);
  const changes: Record<string, unknown>[] = [];

  for (const [tableName, table] of Object.entries(TABLE_MAP)) {
    let query;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const t = table as any;

    if (folderId && t.folderId) {
      query = db
        .select()
        .from(table)
        .where(and(gt(t.updatedAt, sinceDate), eq(t.folderId, folderId)));
    } else {
      query = db.select().from(table).where(gt(t.updatedAt, sinceDate));
    }

    const rows = await query;
    for (const row of rows) {
      changes.push({ table: tableName, op: 'put', ...(row as Record<string, unknown>) });
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
      snapshot[tableName] = await db.select().from(table).where(eq(t.folderId, folderId));
    }
  }

  // Also include the folder itself
  snapshot.folders = await db.select().from(schema.folders).where(eq(schema.folders.id, folderId));

  return snapshot;
}
