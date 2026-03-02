import { db } from '../db';
import type { Dexie as DexieType } from 'dexie';
import { syncPush, syncPull, type SyncChange, type SyncResult } from './server-api';

// Cast db for dynamic table access (sync tables aren't in the typed schema)
const dynamicDb = db as unknown as DexieType;

const SYNC_INTERVAL = 30_000; // 30 seconds
const META_KEY_LAST_SYNC = 'lastSyncTimestamp';

interface SyncQueueEntry {
  seq?: number;
  table: string;
  entityId: string;
  op: 'put' | 'delete';
  data?: Record<string, unknown>;
}

export class SyncEngine {
  private running = false;
  private intervalId: ReturnType<typeof setInterval> | null = null;
  private onConflict: ((conflicts: SyncResult[]) => void) | null = null;
  private onRemoteChange: ((changes: Record<string, unknown>[]) => void) | null = null;

  setConflictHandler(handler: (conflicts: SyncResult[]) => void) {
    this.onConflict = handler;
  }

  setRemoteChangeHandler(handler: (changes: Record<string, unknown>[]) => void) {
    this.onRemoteChange = handler;
  }

  start() {
    if (this.running) return;
    this.running = true;
    // Initial sync
    this.sync();
    // Periodic sync
    this.intervalId = setInterval(() => this.sync(), SYNC_INTERVAL);
  }

  stop() {
    this.running = false;
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
  }

  async sync() {
    try {
      await this.push();
      await this.pull();
    } catch (err) {
      console.error('SyncEngine: sync error', err);
    }
  }

  // Push local changes to server
  private async push() {
    const queue: SyncQueueEntry[] = await dynamicDb.table('_syncQueue').toArray();
    if (queue.length === 0) return;

    // Batch into sync changes
    const changes: SyncChange[] = queue.map((entry) => ({
      table: entry.table,
      op: entry.op,
      entityId: entry.entityId,
      data: entry.data,
    }));

    try {
      const { results } = await syncPush(changes);

      // Remove accepted entries from queue
      const acceptedSeqs: number[] = [];
      const conflicts: SyncResult[] = [];

      for (let i = 0; i < results.length; i++) {
        if (results[i].status === 'accepted') {
          if (queue[i].seq) acceptedSeqs.push(queue[i].seq!);
        } else {
          conflicts.push(results[i]);
        }
      }

      if (acceptedSeqs.length > 0) {
        await dynamicDb.table('_syncQueue').bulkDelete(acceptedSeqs);
      }

      if (conflicts.length > 0 && this.onConflict) {
        this.onConflict(conflicts);
      }
    } catch (err) {
      console.error('SyncEngine: push error', err);
    }
  }

  // Pull remote changes from server
  private async pull() {
    const meta = await dynamicDb.table('_syncMeta').get(META_KEY_LAST_SYNC);
    const since = meta?.value || new Date(0).toISOString();

    try {
      const { changes, serverTimestamp } = await syncPull(since);

      if (changes && changes.length > 0) {
        // Apply remote changes to local Dexie
        for (const change of changes) {
          const { table: tableName, op, ...entityData } = change;
          const id = entityData.id as string;

          if (op === 'delete') {
            await dynamicDb.table(tableName).delete(id);
          } else {
            // Convert server timestamps to milliseconds for Dexie
            const localData = { ...entityData };
            if (localData.createdAt && typeof localData.createdAt === 'string') {
              localData.createdAt = new Date(localData.createdAt as string).getTime();
            }
            if (localData.updatedAt && typeof localData.updatedAt === 'string') {
              localData.updatedAt = new Date(localData.updatedAt as string).getTime();
            }

            await dynamicDb.table(tableName).put(localData);
          }
        }

        if (this.onRemoteChange) {
          this.onRemoteChange(changes);
        }
      }

      // Update last sync timestamp
      await dynamicDb.table('_syncMeta').put({ key: META_KEY_LAST_SYNC, value: serverTimestamp });
    } catch (err) {
      console.error('SyncEngine: pull error', err);
    }
  }

  // Manually enqueue a change (called by sync middleware)
  async enqueue(table: string, entityId: string, op: 'put' | 'delete', data?: Record<string, unknown>) {
    await dynamicDb.table('_syncQueue').add({
      table,
      entityId,
      op,
      data,
    });
  }
}

// Singleton instance
export const syncEngine = new SyncEngine();
