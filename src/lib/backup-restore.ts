/**
 * Restore logic for encrypted backups — full replace or merge mode.
 */

import { db } from '../db';
import type { BackupPayload } from './backup-crypto';

export interface RestoreResult {
  added: number;
  updated: number;
  deleted: number;
  tables: string[];
}

function isQuotaError(err: unknown): boolean {
  if (err instanceof DOMException && (err.name === 'QuotaExceededError' || err.code === 22)) return true;
  const msg = String(err);
  return msg.includes('QuotaExceeded') || msg.includes('storage quota');
}

const SYNCED_TABLES = ['notes', 'tasks', 'folders', 'tags', 'timelineEvents', 'timelines', 'whiteboards', 'standaloneIOCs', 'chatThreads', 'agentActions'] as const;

// Helper: get a Dexie table by name, returning an untyped handle for dynamic access
/* eslint-disable @typescript-eslint/no-explicit-any */
function getTable(name: string): any {
  return (db as any)[name];
}
/* eslint-enable @typescript-eslint/no-explicit-any */

export async function restoreFullReplace(payload: BackupPayload): Promise<RestoreResult> {
  let added = 0;
  const tables: string[] = [];

  const dexieTables = SYNCED_TABLES.map((t) => db[t]);

  try {
    await db.transaction('rw', dexieTables, async () => {
      for (const tableName of SYNCED_TABLES) {
        const items = payload.data[tableName as keyof BackupPayload['data']];
        if (!items || items.length === 0) continue;

        const table = getTable(tableName);
        await table.clear();
        await table.bulkAdd(items);
        added += items.length;
        tables.push(tableName);
      }
    });
  } catch (err) {
    if (isQuotaError(err)) throw new Error('Storage quota exceeded. Free up space by deleting old data or clearing browser storage.');
    throw err;
  }

  return { added, updated: 0, deleted: 0, tables };
}

export async function restoreMerge(payload: BackupPayload): Promise<RestoreResult> {
  let added = 0;
  let updated = 0;
  let deleted = 0;
  const tables: string[] = [];

  const dexieTables = SYNCED_TABLES.map((t) => db[t]);

  try {
    await db.transaction('rw', dexieTables, async () => {
      for (const tableName of SYNCED_TABLES) {
        const items = payload.data[tableName as keyof BackupPayload['data']];
        if (!items || items.length === 0) {
          // Still check for deletedIds
          if (payload.deletedIds?.[tableName]?.length) {
            const table = getTable(tableName);
            await table.bulkDelete(payload.deletedIds[tableName]);
            deleted += payload.deletedIds[tableName].length;
            if (!tables.includes(tableName)) tables.push(tableName);
          }
          continue;
        }

        const table = getTable(tableName);
        if (!tables.includes(tableName)) tables.push(tableName);

        for (const item of items) {
          const record = item as unknown as { id: string; updatedAt?: number };
          const id = record.id;
          if (!id) continue;

          const existing = await table.get(id) as { updatedAt?: number } | undefined;
          if (!existing) {
            await table.add(item);
            added++;
          } else {
            if (record.updatedAt && existing.updatedAt && record.updatedAt > existing.updatedAt) {
              await table.put(item);
              updated++;
            }
          }
        }

        // Apply tombstone deletes
        if (payload.deletedIds?.[tableName]?.length) {
          await table.bulkDelete(payload.deletedIds[tableName]);
          deleted += payload.deletedIds[tableName].length;
        }
      }
    });
  } catch (err) {
    if (isQuotaError(err)) throw new Error('Storage quota exceeded. Free up space by deleting old data or clearing browser storage.');
    throw err;
  }

  return { added, updated, deleted, tables };
}
