import { db } from '../db';
import type { Dexie as DexieType } from 'dexie';
import { syncPush, syncPull, type SyncChange, type SyncResult } from './server-api';
import { disableSync, enableSync } from './sync-middleware';
import type { WSClient } from './ws-client';

// Cast db for dynamic table access (sync tables aren't in the typed schema)
const dynamicDb = db as unknown as DexieType;

const SYNC_INTERVAL = 30_000; // 30 seconds — safety-net full sync
const PUSH_DEBOUNCE = 50;     // 50ms — fast debounce for near real-time sync
const PUSH_MAX_WAIT = 300;    // 300ms — max time before forcing a push during continuous typing
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
  private pushTimer: ReturnType<typeof setTimeout> | null = null;
  private pushing = false;
  private firstPendingAt: number | null = null;
  private wsClient: WSClient | null = null;
  private onConflict: ((conflicts: SyncResult[]) => void) | null = null;
  private onRemoteChange: ((changes: Record<string, unknown>[], tables: Set<string>) => void) | null = null;

  setConflictHandler(handler: (conflicts: SyncResult[]) => void) {
    this.onConflict = handler;
  }

  setRemoteChangeHandler(handler: (changes: Record<string, unknown>[], tables: Set<string>) => void) {
    this.onRemoteChange = handler;
  }

  setWSClient(ws: WSClient | null) {
    this.wsClient = ws;
  }

  start() {
    if (this.running) return;
    this.running = true;
    // Initial sync
    this.sync();
    // Periodic full sync as safety net
    this.intervalId = setInterval(() => this.sync(), SYNC_INTERVAL);
  }

  stop() {
    this.running = false;
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
    if (this.pushTimer) {
      clearTimeout(this.pushTimer);
      this.pushTimer = null;
    }
  }

  async sync() {
    try {
      // Cancel any pending debounced push — we're doing a full sync now
      if (this.pushTimer) {
        clearTimeout(this.pushTimer);
        this.pushTimer = null;
      }
      await this.push();
      await this.pull();
    } catch (err) {
      if (err instanceof Error && err.message.includes('Not connected')) return;
      console.error('SyncEngine: sync error', err);
    }
  }

  // Schedule a debounced push — coalesces rapid edits into a single push
  // Uses maxWait to guarantee pushes happen even during continuous typing
  private schedulePush() {
    if (!this.running) return;
    if (this.firstPendingAt === null) {
      this.firstPendingAt = Date.now();
    }
    // If we've waited long enough since the first pending change, push immediately
    if (Date.now() - this.firstPendingAt >= PUSH_MAX_WAIT) {
      if (this.pushTimer) { clearTimeout(this.pushTimer); this.pushTimer = null; }
      this.push().catch((err) => console.error('SyncEngine: maxWait push error', err));
      return;
    }
    if (this.pushTimer) clearTimeout(this.pushTimer);
    this.pushTimer = setTimeout(() => {
      this.pushTimer = null;
      if (this.running) {
        this.push().catch((err) => console.error('SyncEngine: immediate push error', err));
      }
    }, PUSH_DEBOUNCE);
  }

  // Push local changes to server
  private async push() {
    if (this.pushing) return;
    this.pushing = true;
    try {
      const queue: SyncQueueEntry[] = await dynamicDb.table('_syncQueue').toArray();
      if (queue.length === 0) return;

      // Batch into sync changes
      const changes: SyncChange[] = queue.map((entry) => ({
        table: entry.table,
        op: entry.op,
        entityId: entry.entityId,
        data: entry.data,
      }));

      const { results } = await syncPush(changes);

      // Remove accepted AND rejected entries from queue (only conflicts stay)
      const seqsToRemove: number[] = [];
      const conflicts: SyncResult[] = [];

      for (let i = 0; i < results.length; i++) {
        const status = results[i].status;
        if (status === 'accepted' || status === 'rejected') {
          if (queue[i].seq) seqsToRemove.push(queue[i].seq!);
        } else {
          conflicts.push(results[i]);
        }
      }

      if (seqsToRemove.length > 0) {
        await dynamicDb.table('_syncQueue').bulkDelete(seqsToRemove);
      }

      if (conflicts.length > 0 && this.onConflict) {
        this.onConflict(conflicts);
      }
    } catch (err) {
      // "Not connected" is expected when server is temporarily unreachable — don't spam console
      if (err instanceof Error && err.message.includes('Not connected')) return;
      console.error('SyncEngine: push error', err);
    } finally {
      this.pushing = false;
      this.firstPendingAt = null;
    }
  }

  // Pull remote changes from server
  private async pull() {
    const meta = await dynamicDb.table('_syncMeta').get(META_KEY_LAST_SYNC);
    const since = meta?.value || new Date(0).toISOString();

    try {
      const { changes, serverTimestamp } = await syncPull(since);

      if (changes && changes.length > 0) {
        const affectedTables = new Set<string>();

        // Apply remote changes to local Dexie
        for (const change of changes) {
          const { table: tableName, op, ...entityData } = change;
          const id = entityData.id as string;
          affectedTables.add(tableName);

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
          this.onRemoteChange(changes, affectedTables);
        }
      }

      // Update last sync timestamp
      await dynamicDb.table('_syncMeta').put({ key: META_KEY_LAST_SYNC, value: serverTimestamp });
    } catch (err) {
      // "Not connected" is expected when server is temporarily unreachable — don't spam console
      if (err instanceof Error && err.message.includes('Not connected')) return;
      console.error('SyncEngine: pull error', err);
    }
  }

  /**
   * Fast-path: apply a single entity change from a WebSocket broadcast
   * directly to Dexie, bypassing sync hooks so we don't re-push it.
   */
  async applyRemoteChange(
    tableName: string,
    op: 'put' | 'delete',
    entityId: string,
    data?: Record<string, unknown>,
  ) {
    disableSync();
    try {
      if (op === 'delete') {
        await dynamicDb.table(tableName).delete(entityId);
      } else if (data) {
        // Normalize ISO timestamp strings to ms for Dexie
        const localData = { ...data };
        for (const key of ['createdAt', 'updatedAt', 'trashedAt', 'completedAt', 'closedAt'] as const) {
          if (localData[key] && typeof localData[key] === 'string') {
            localData[key] = new Date(localData[key] as string).getTime();
          }
        }
        await dynamicDb.table(tableName).put(localData);
      }
      if (this.onRemoteChange) {
        this.onRemoteChange([{ table: tableName, op, id: entityId, ...data }], new Set([tableName]));
      }
    } finally {
      enableSync();
    }
  }

  /**
   * Resolve sync conflicts by clearing them from the queue.
   * If choice is 'theirs', also applies server data to local Dexie.
   */
  async resolveConflicts(
    conflicts: Array<{ table?: string; entityId: string; serverData?: Record<string, unknown> }>,
    choice: 'mine' | 'theirs',
  ) {
    const entityIds = new Set(conflicts.map((c) => c.entityId));

    // Remove matching entries from the sync queue
    const queue: SyncQueueEntry[] = await dynamicDb.table('_syncQueue').toArray();
    const seqsToDelete = queue.filter((e) => entityIds.has(e.entityId)).map((e) => e.seq!).filter(Boolean);
    if (seqsToDelete.length > 0) {
      await dynamicDb.table('_syncQueue').bulkDelete(seqsToDelete);
    }

    // If accepting theirs, overwrite local data with server version
    if (choice === 'theirs') {
      disableSync();
      try {
        for (const conflict of conflicts) {
          if (!conflict.table || !conflict.serverData) continue;
          const localData = { ...conflict.serverData };
          // Normalize ISO timestamps to ms for Dexie
          for (const key of ['createdAt', 'updatedAt', 'trashedAt', 'completedAt', 'closedAt'] as const) {
            if (localData[key] && typeof localData[key] === 'string') {
              localData[key] = new Date(localData[key] as string).getTime();
            }
          }
          await dynamicDb.table(conflict.table).put(localData);
        }
      } finally {
        enableSync();
      }
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
    // Optimistic WS broadcast for instant relay to other clients
    if (this.wsClient) {
      this.wsClient.send({ type: 'entity-change-preview', table, entityId, op, data });
    }
    // Trigger a debounced push so changes sync within ~300ms max
    this.schedulePush();
  }

  // Push an entire folder and all its scoped content to the server.
  // Used when a folder was created locally before sync was active.
  async syncFolder(folderId: string) {
    const FOLDER_SCOPED_TABLES = ['notes', 'tasks', 'timelineEvents', 'whiteboards', 'standaloneIOCs', 'chatThreads'];

    const changes: SyncChange[] = [];

    // Push the folder itself
    const folder = await dynamicDb.table('folders').get(folderId);
    if (folder) {
      changes.push({ table: 'folders', op: 'put', entityId: folderId, data: folder });
    }

    // Push all scoped entities
    for (const tableName of FOLDER_SCOPED_TABLES) {
      try {
        const rows = await dynamicDb.table(tableName).where('folderId').equals(folderId).toArray();
        for (const row of rows) {
          if (row.trashed) continue;
          changes.push({ table: tableName, op: 'put', entityId: row.id, data: row });
        }
      } catch {
        // Table may not have folderId index — skip
      }
    }

    if (changes.length === 0) return;

    const { results } = await syncPush(changes);
    const conflicts = results.filter((r) => r.status === 'conflict');
    if (conflicts.length > 0 && this.onConflict) {
      this.onConflict(conflicts);
    }
  }
}

// Singleton instance
export const syncEngine = new SyncEngine();
