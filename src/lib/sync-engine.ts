import { db } from '../db';
import type { Dexie as DexieType } from 'dexie';
import { syncPush, syncPull, type SyncChange, type SyncResult } from './server-api';
import { sanitizeSyncEntity } from './sync-sanitize';
import { SYNC_TABLES, isSyncTable, onOutboxCommit, revisionKey, suppressSyncInCurrentTransaction } from './sync-state';
import type { WSClient } from './ws-client';
import { ensureSyncWorkspace } from './sync-workspace';
import { uncachedFolderKey, cacheOperationKey, rotateCacheOperation, CACHE_REPLAY_CANCELLED } from './sync-cache';

const dynamicDb = db as unknown as DexieType;
const CURSOR_KEY = 'syncCursorV2';
const INITIAL_KEY = 'initialPushDoneV2';
const RECOVERY_KEY = 'syncRecoveryRequiredV2';
const HISTORY_KEY = 'syncHistoryGenerationV1';
const MAX_PUSH_BYTES = 900_000; // Leave room beneath the server's 1 MiB body limit.
const MAX_ASSET_PUSH_BYTES = 15 * 1024 * 1024; // Dedicated 16 MiB sync route.
const RECOVERY_MESSAGE = 'Sync paused because the server history changed. Your local edits are retained. Coordinate with the server administrator, then use Settings → General → Sync history recovery to download a verified archive and review conflicts before resuming.';
const entityKey = (table: string, id: string) => JSON.stringify([table, id]);
const validVersion = (value: unknown): value is number => Number.isSafeInteger(value) && (value as number) >= 0;

interface SyncQueueEntry extends SyncChange { seq?: number; folderId?: string }
type RemoteChange = Record<string, unknown> & { table: string; op: 'put' | 'delete'; id: string };

/** Local mutations and their outgoing operations commit together. Only accepted
 * operations are acknowledged; concurrent local edits remain durable. */
export class SyncEngine {
  private running = false;
  private epoch = 0;
  private timer: ReturnType<typeof setInterval> | null = null;
  private pushTimer: ReturnType<typeof setTimeout> | null = null;
  private syncing: Promise<void> | null = null;
  private rerunRequested = false;
  private replayGeneration = 0;
  private unsubscribe: (() => void) | null = null;
  private onConflict: ((conflicts: SyncResult[]) => void) | null = null;
  private onRemoteChange: ((changes: Record<string, unknown>[], tables: Set<string>) => void) | null = null;
  private onReady: (() => void) | null = null;
  private onError: ((message: string | null) => void) | null = null;
  private workspace: { serverUrl: string; userId: string } | null = null;

  setConflictHandler(handler: (conflicts: SyncResult[]) => void) { this.onConflict = handler; }
  setRemoteChangeHandler(handler: (changes: Record<string, unknown>[], tables: Set<string>) => void) { this.onRemoteChange = handler; }
  // Retained API: clients no longer send optimistic entity mutations over WS.
  setWSClient(ws: WSClient | null) { void ws; /* committed notifications trigger a pull */ }
  setReadyHandler(handler: () => void) { this.onReady = handler; }
  setErrorHandler(handler: (message: string | null) => void) { this.onError = handler; }
  setWorkspaceIdentity(serverUrl: string, userId: string) {
    if (this.workspace?.serverUrl !== serverUrl || this.workspace?.userId !== userId) this.stop();
    this.workspace = { serverUrl, userId };
  }

  private async ensureWorkspace() {
    if (!this.workspace) throw new Error('Sync paused: no verified server/account identity. Local edits are retained.');
    await ensureSyncWorkspace(this.workspace.serverUrl, this.workspace.userId);
  }

  start() {
    if (this.running) return;
    this.running = true;
    const epoch = ++this.epoch;
    this.unsubscribe = onOutboxCommit(() => this.scheduleSync());
    queueMicrotask(() => { if (this.epoch === epoch) this.onReady?.(); });
    this.initialSync(epoch).then(() => {
      if (this.epoch === epoch) return this.sync();
    }).catch(error => {
      if (this.epoch === epoch) this.onError?.(error instanceof Error ? error.message : 'Sync initialization failed; local edits are retained.');
      console.warn('[sync] Initial sync failed:', error);
    });
    this.timer = setInterval(() => { void this.sync(); }, 30_000);
  }

  stop() {
    this.running = false;
    ++this.epoch;
    this.unsubscribe?.();
    this.unsubscribe = null;
    if (this.timer) clearInterval(this.timer);
    if (this.pushTimer) clearTimeout(this.pushTimer);
    this.timer = this.pushTimer = null;
    this.syncing = null;
    this.rerunRequested = false;
  }

  private scheduleSync() {
    if (!this.running || this.pushTimer) return;
    // A single timer bounds latency even during continuous editing.
    this.pushTimer = setTimeout(() => {
      this.pushTimer = null;
      void this.sync();
    }, 50);
  }

  async sync() {
    if (this.syncing) { this.rerunRequested = true; return this.syncing; }
    const epoch = this.epoch;
    const work = (async () => {
      try {
        await this.ensureWorkspace();
        if ((await dynamicDb.table('_syncMeta').get(RECOVERY_KEY))?.value) {
          if (epoch === this.epoch) this.onError?.(RECOVERY_MESSAGE);
          return;
        }
        if (epoch !== this.epoch) return;
        this.onError?.(null);
        // Check an existing history before uploading into a possibly restored
        // server. A reset is a reconciliation decision, not a cursor rewind.
        await this.pull(epoch);
        if (epoch !== this.epoch) return;
        await this.push(epoch);
        if (epoch === this.epoch) await this.pull(epoch);
      } catch (error) {
        if (epoch === this.epoch && (error as { code?: string }).code === 'SYNC_CURSOR_RESET') {
          await dynamicDb.table('_syncMeta').put({ key: RECOVERY_KEY, value: true });
        }
        if (epoch === this.epoch) this.onError?.(error instanceof Error ? error.message : 'Sync failed; local edits are retained.');
        if (!(error instanceof Error && error.message.includes('Not connected'))) console.warn('[sync] Synchronization failed:', error);
      }
    })();
    this.syncing = work;
    try { await work; }
    finally {
      if (this.syncing === work) {
        this.syncing = null;
        if (this.rerunRequested) { this.rerunRequested = false; this.scheduleSync(); }
      }
    }
  }

  private async initialSync(epoch: number) {
    await this.ensureWorkspace();
    if (epoch !== this.epoch) return;
    if ((await dynamicDb.table('_syncMeta').get(INITIAL_KEY))?.value) return;
    await dynamicDb.transaction('rw', [...SYNC_TABLES, '_syncMeta', '_syncQueue'], async () => {
      if (epoch !== this.epoch) return;
      suppressSyncInCurrentTransaction();
      const folders = await dynamicDb.table('folders').toArray();
      const folderIds = new Set(folders.filter(f => !f.localOnly && !f.trashed).map(f => f.id));
      const queued: SyncQueueEntry[] = await dynamicDb.table('_syncQueue').toArray();
      const pending = new Set(queued.map(e => entityKey(e.table, e.entityId)));
      for (const table of SYNC_TABLES) {
        for (const row of await dynamicDb.table(table).toArray()) {
          if (row.trashed || row.localOnly) continue;
          if (table === 'folders' ? !folderIds.has(row.id) : !['tags', 'timelines'].includes(table) && !folderIds.has(row.folderId)) continue;
          if (pending.has(entityKey(table, row.id))) continue;
          if ((await dynamicDb.table('_syncMeta').get(revisionKey(table, row.id)))?.value) continue;
          await dynamicDb.table('_syncQueue').add({ table, entityId: row.id, op: 'put', data: row, clientVersion: 0 });
        }
      }
      await dynamicDb.table('_syncMeta').put({ key: INITIAL_KEY, value: true });
    });
  }

  private async push(epoch: number) {
    const history = (await dynamicDb.table('_syncMeta').get(HISTORY_KEY))?.value;
    if (typeof history !== 'string') throw new Error('Server history has not been verified; pending edits were retained.');
    const queue: SyncQueueEntry[] = await dynamicDb.table('_syncQueue').toArray();
    if (epoch !== this.epoch) return;
    const groups = new Map<string, SyncQueueEntry[]>();
    for (const entry of queue) {
      if (!isSyncTable(entry.table)) continue; // retain unsupported legacy work
      if (await this.isLocalOnly(entry.table, entry.entityId, entry.data, entry.folderId, true)) continue;
      const key = entityKey(entry.table, entry.entityId);
      groups.set(key, [...(groups.get(key) ?? []), entry]);
    }
    // Parents are accepted before their child entities.
    const ordered = [...groups.values()].sort((a, b) => Number(b[0].table === 'folders') - Number(a[0].table === 'folders'));
    const conflicts: SyncResult[] = [];
    const encoder = new TextEncoder();
    const batches: Array<{ entries: SyncQueueEntry[]; change: SyncChange }[]> = [];
    let current: { entries: SyncQueueEntry[]; change: SyncChange }[] = [];
    let bytes = encoder.encode('{"changes":[]}').byteLength;
    for (const entries of ordered) {
      const first = entries[0], last = entries[entries.length - 1];
      const change: SyncChange = { table: last.table, entityId: last.entityId, op: last.op, data: last.data,
        clientVersion: validVersion(first.clientVersion) ? first.clientVersion : 0 };
      const size = encoder.encode(JSON.stringify(change)).byteLength + 1;
      const hasAsset = (change.table === 'whiteboards' && typeof change.data?.files === 'string')
        || (change.table === 'evidenceItems' && typeof change.data?.imageData === 'string');
      if (hasAsset && size + 128 <= MAX_ASSET_PUSH_BYTES && size + 128 > MAX_PUSH_BYTES) {
        if (current.length) { batches.push(current); current = []; bytes = 128; }
        batches.push([{ entries, change }]);
        continue;
      }
      if (size + 15 > MAX_PUSH_BYTES) {
        this.onError?.('Some local changes are too large to sync and remain saved on this device. Reduce their size or export them separately.');
        continue;
      }
      if (current.length && (current.length === 100 || bytes + size > MAX_PUSH_BYTES)) {
        batches.push(current); current = []; bytes = 15;
      }
      current.push({ entries, change }); bytes += size;
    }
    if (current.length) batches.push(current);
    for (const items of batches) {
      if (epoch !== this.epoch) return;
      const deliverable = [];
      for (const item of items) {
        if (!await this.isLocalOnly(item.change.table, item.change.entityId, item.change.data, item.entries[item.entries.length - 1].folderId, true)) deliverable.push(item);
      }
      if (!deliverable.length) continue;
      const batch = deliverable.map(item => item.entries);
      const changes = deliverable.map(item => item.change);
      const { results } = await syncPush(changes, history);
      if (epoch !== this.epoch) return;
      await dynamicDb.transaction('rw', '_syncQueue', '_syncMeta', async () => {
        if (epoch !== this.epoch) return;
        for (let i = 0; i < changes.length; i++) {
          const sent = changes[i], result = results[i];
          if (!result || result.entityId !== sent.entityId || (result.table && result.table !== sent.table)) continue;
          if (result.status !== 'accepted') {
            conflicts.push({ ...result, table: sent.table, localData: sent.data });
            continue;
          }
          if (!validVersion(result.serverVersion)) continue; // do not lose work on malformed acknowledgements
          const sentSeqs = batch[i].map(e => e.seq).filter((seq): seq is number => seq !== undefined);
          await dynamicDb.table('_syncQueue').bulkDelete(sentSeqs);
          await dynamicDb.table('_syncMeta').put({ key: revisionKey(sent.table, sent.entityId), value: result.serverVersion });
          // Edits made while this request was in flight continue from our own
          // accepted revision, never from a concurrent peer's unreviewed version.
          const remaining: SyncQueueEntry[] = await dynamicDb.table('_syncQueue').toArray();
          for (const pending of remaining) {
            if (pending.table === sent.table && pending.entityId === sent.entityId &&
                (pending.clientVersion ?? 0) === sent.clientVersion) {
              await dynamicDb.table('_syncQueue').put({ ...pending, clientVersion: result.serverVersion });
            }
          }
        }
      });
    }
    if (epoch === this.epoch && conflicts.length) this.onConflict?.(conflicts);
  }

  private async pull(epoch: number) {
    let cursor = (await dynamicDb.table('_syncMeta').get(CURSOR_KEY))?.value ?? '0';
    while (epoch === this.epoch) {
      const generation = this.replayGeneration;
      let page;
      try {
        const history = (await dynamicDb.table('_syncMeta').get(HISTORY_KEY))?.value;
        if (cursor !== '0' && !history) {
          await dynamicDb.table('_syncMeta').put({ key: RECOVERY_KEY, value: true });
          throw new Error(RECOVERY_MESSAGE);
        }
        page = await syncPull(new Date(0).toISOString(), undefined, cursor, history);
        if (typeof page.generation !== 'string' || !/^[a-f\d]{8}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{12}$/.test(page.generation)) throw new Error('Server does not support sync history generations; pending edits were retained.');
        if (history && page.generation !== history) throw Object.assign(new Error(RECOVERY_MESSAGE), { code: 'SYNC_CURSOR_RESET' });
      } catch (error) {
        if (epoch === this.epoch && (error as { code?: string }).code === 'SYNC_CURSOR_RESET') {
          await dynamicDb.table('_syncMeta').put({ key: RECOVERY_KEY, value: true });
          throw new Error(RECOVERY_MESSAGE);
        }
        throw error;
      }
      if (epoch !== this.epoch) return;
      if (generation !== this.replayGeneration) { cursor = '0'; continue; }
      if (typeof page.cursor !== 'string' || !/^\d+$/.test(page.cursor)) {
        throw new Error('Server does not support reliable sync cursors; pending edits were retained');
      }
      if (BigInt(page.cursor) < BigInt(cursor)) {
        await dynamicDb.table('_syncMeta').put({ key: RECOVERY_KEY, value: true });
        throw new Error(RECOVERY_MESSAGE);
      }
      if (page.hasMore && page.cursor === cursor) throw new Error('Server sync cursor did not advance');
      const applied = await this.applyChanges(page.changes, epoch, page.cursor, generation, cursor, page.generation);
      if (generation !== this.replayGeneration) { cursor = '0'; continue; }
      if (!applied) { cursor = (await dynamicDb.table('_syncMeta').get(CURSOR_KEY))?.value ?? '0'; continue; }
      cursor = page.cursor;
      if (!page.hasMore) return;
    }
  }

  private async applyChanges(changes: RemoteChange[], epoch: number, cursor?: string, generation?: number, expectedCursor?: string, history?: string, cacheFolder?: string, cacheOperation?: string) {
    const affected = new Set<string>();
    const applied = await dynamicDb.transaction('rw', [...SYNC_TABLES, '_syncQueue', '_syncMeta'], async () => {
      if (epoch !== this.epoch) return false;
      if (generation !== undefined && generation !== this.replayGeneration) return false;
      if (expectedCursor !== undefined && ((await dynamicDb.table('_syncMeta').get(CURSOR_KEY))?.value ?? '0') !== expectedCursor) return false;
      suppressSyncInCurrentTransaction();
      if (cacheFolder) {
        if (!cacheOperation || (await dynamicDb.table('_syncMeta').get(cacheOperationKey(cacheFolder)))?.value !== cacheOperation) {
          throw new Error(CACHE_REPLAY_CANCELLED);
        }
        if ((await dynamicDb.table('folders').get(cacheFolder))?.localOnly
          || (await dynamicDb.table('_syncMeta').get(JSON.stringify(['localOnly', cacheFolder])))?.value) {
          throw new Error('This investigation is local-only; its offline copy was not replaced.');
        }
        await dynamicDb.table('_syncMeta').delete(uncachedFolderKey(cacheFolder));
      }
      const queue: SyncQueueEntry[] = await dynamicDb.table('_syncQueue').toArray();
      const pending = new Set(queue.map(e => entityKey(e.table, e.entityId)));
      for (const change of changes) {
        const { table, op, id } = change;
        if (!isSyncTable(table) || typeof id !== 'string' || !['put', 'delete'].includes(op)) throw new Error('Invalid sync entity');
        if (await this.isLocalOnly(table, id, change)) continue;
        if (pending.has(entityKey(table, id))) continue;
        const version = change.version;
        if (!validVersion(version) || version === 0) throw new Error('Sync entity has no server revision');
        const known = (await dynamicDb.table('_syncMeta').get(revisionKey(table, id)))?.value ?? 0;
        if (version < known) continue;
        if (op === 'delete') {
          await dynamicDb.table(table).delete(id);
        } else {
          const record = sanitizeSyncEntity(table, change);
          if (!record || record.id !== id) throw new Error('Invalid sync record');
          await dynamicDb.table(table).put(record);
        }
        await dynamicDb.table('_syncMeta').put({ key: revisionKey(table, id), value: version });
        affected.add(table);
      }
      if (cursor !== undefined && generation === this.replayGeneration) await dynamicDb.table('_syncMeta').put({ key: CURSOR_KEY, value: cursor });
      if (history !== undefined) await dynamicDb.table('_syncMeta').put({ key: HISTORY_KEY, value: history });
      return true;
    });
    if (epoch === this.epoch && affected.size) this.onRemoteChange?.(changes, affected);
    return applied;
  }

  /** WS messages are invalidations, never a source of durable entity data. */
  async applyRemoteChange(table: string, op: 'put' | 'delete', id: string, data?: Record<string, unknown>) {
    void op; void id; void data;
    if (!isSyncTable(table)) return;
    await this.sync();
  }

  async resolveConflicts(conflicts: Array<{ table?: string; entityId: string; serverVersion?: number; serverData?: Record<string, unknown> }>, choice: 'mine' | 'theirs') {
    if (choice === 'theirs') ++this.replayGeneration;
    const affected = new Set<string>();
    await dynamicDb.transaction('rw', [...SYNC_TABLES, '_syncQueue', '_syncMeta'], async () => {
      suppressSyncInCurrentTransaction();
      for (const conflict of conflicts) {
        const table = conflict.table;
        const version = conflict.serverVersion ?? conflict.serverData?.version;
        if (!table || !isSyncTable(table) || !validVersion(version)) throw new Error('Conflict has no usable server revision');
        if (await this.isLocalOnly(table, conflict.entityId, conflict.serverData)) throw new Error('This investigation is local-only; its sync conflict was retained.');
        const queue: SyncQueueEntry[] = await dynamicDb.table('_syncQueue').toArray();
        const entries = queue.filter(e => e.table === table && e.entityId === conflict.entityId);
        if (!entries.length) continue;
        if (choice === 'mine') {
          // Keep the newest local operation; retry it against the version the
          // analyst explicitly reviewed. A newer server change conflicts again.
          const latest = entries[entries.length - 1];
          await dynamicDb.table('_syncQueue').bulkDelete(entries.slice(0, -1).map(e => e.seq!));
          await dynamicDb.table('_syncQueue').put({ ...latest, clientVersion: version });
        } else {
          if (!conflict.serverData || conflict.serverData.deletedAt) {
            await dynamicDb.table(table).delete(conflict.entityId);
          } else {
            const record = sanitizeSyncEntity(table, conflict.serverData);
            if (!record || record.id !== conflict.entityId) throw new Error('Invalid conflict record');
            await dynamicDb.table(table).put(record);
          }
          await dynamicDb.table('_syncQueue').bulkDelete(entries.map(e => e.seq!));
          // A pull may have skipped a newer revision while this entity was
          // pending. Replay the committed log after accepting the reviewed
          // version, so that skipped updates cannot remain invisible forever.
          await dynamicDb.table('_syncMeta').put({ key: CURSOR_KEY, value: '0' });
          affected.add(table);
        }
        await dynamicDb.table('_syncMeta').put({ key: revisionKey(table, conflict.entityId), value: version });
      }
    });
    if (affected.size) this.onRemoteChange?.([], affected);
    this.scheduleSync();
  }

  async enqueue(table: string, entityId: string, op: 'put' | 'delete', data?: Record<string, unknown>) {
    if (!isSyncTable(table)) throw new Error('Unsupported sync table');
    await dynamicDb.transaction('rw', '_syncQueue', '_syncMeta', async () => {
      const known = await dynamicDb.table('_syncMeta').get(revisionKey(table, entityId));
      await dynamicDb.table('_syncQueue').add({ table, entityId, op, data, clientVersion: known?.value ?? 0 });
    });
    this.scheduleSync();
  }

  async pullFolder(folderId: string) {
    const epoch = this.epoch;
    await this.ensureWorkspace();
    if (epoch !== this.epoch) return;
    if ((await dynamicDb.table('_syncMeta').get(RECOVERY_KEY))?.value) throw new Error(RECOVERY_MESSAGE);
    // Claim before any network wait. A later eviction or explicit recache in
    // this or another tab supersedes every page of this operation.
    const cacheOperation = await rotateCacheOperation(folderId);
    // Verify the history before rebuilding a cache. A plain snapshot has no
    // generation identity and can silently mix rows across a server restore.
    await this.pull(epoch);
    const history = (await dynamicDb.table('_syncMeta').get(HISTORY_KEY))?.value;
    let cursor = '0';
    while (epoch === this.epoch) {
      try {
        const page = await syncPull(new Date(0).toISOString(), folderId, cursor, history);
        if (epoch !== this.epoch) return;
        if (page.generation !== history) throw Object.assign(new Error(RECOVERY_MESSAGE), { code: 'SYNC_CURSOR_RESET' });
        if (typeof page.cursor !== 'string' || !/^\d+$/.test(page.cursor) || BigInt(page.cursor) < BigInt(cursor)
          || (page.hasMore && page.cursor === cursor)) throw new Error('Invalid investigation sync cursor');
        // Cache intent and each bounded page commit together. Never advance the
        // global cursor from a folder-filtered replay.
        await this.applyChanges(page.changes, epoch, undefined, undefined, undefined, undefined, folderId, cacheOperation);
        cursor = page.cursor;
        if (!page.hasMore) return;
      } catch (error) {
        if (epoch === this.epoch && error instanceof Error && error.message === CACHE_REPLAY_CANCELLED) this.onError?.(error.message);
        if (epoch === this.epoch && (error as { code?: string }).code === 'SYNC_CURSOR_RESET') {
          await dynamicDb.table('_syncMeta').put({ key: RECOVERY_KEY, value: true });
          throw new Error(RECOVERY_MESSAGE);
        }
        throw error;
      }
    }
  }

  async syncFolder(folderId: string) {
    await this.ensureWorkspace();
    const folder = await dynamicDb.table('folders').get(folderId);
    if (!folder || folder.localOnly) return;
    await dynamicDb.transaction('rw', [...SYNC_TABLES, '_syncMeta', '_syncQueue'], async () => {
      suppressSyncInCurrentTransaction();
      // Replay changes skipped while this investigation was local-only. Local
      // rows are queued first, so differing remote content requires review.
      ++this.replayGeneration;
      await rotateCacheOperation(folderId);
      await dynamicDb.table('_syncMeta').delete(uncachedFolderKey(folderId));
      await dynamicDb.table('_syncMeta').put({ key: CURSOR_KEY, value: '0' });
      const queue: SyncQueueEntry[] = await dynamicDb.table('_syncQueue').toArray();
      const pending = new Set(queue.map(e => entityKey(e.table, e.entityId)));
      for (const table of SYNC_TABLES) {
        if (['tags', 'timelines'].includes(table)) continue;
        const rows = table === 'folders' ? [folder] : await dynamicDb.table(table).where('folderId').equals(folderId).toArray();
        for (const row of rows) {
          if (row.trashed || pending.has(entityKey(table, row.id))) continue;
          const revision = await dynamicDb.table('_syncMeta').get(revisionKey(table, row.id));
          await dynamicDb.table('_syncQueue').add({ table, entityId: row.id, op: 'put', data: row, clientVersion: revision?.value ?? 0 });
        }
      }
    });
    await this.sync();
  }

  private async isLocalOnly(table: string, id: string, incoming?: Record<string, unknown>, queuedFolderId?: string, outgoing = false): Promise<boolean> {
    if (table === 'folders') return !!(await dynamicDb.table('folders').get(id))?.localOnly
      || !!(await dynamicDb.table('_syncMeta').get(JSON.stringify(['localOnly', id])))?.value
      || !!(await dynamicDb.table('_syncMeta').get(uncachedFolderKey(id)))?.value;
    const existing = await dynamicDb.table(table).get(id);
    if (outgoing && !['tags', 'timelines'].includes(table)
      && ![existing?.folderId, incoming?.folderId, queuedFolderId].some(value => typeof value === 'string' && value.length > 0)) {
      this.onError?.('A queued legacy change has no verified investigation scope and was retained for recovery.');
      return true;
    }
    for (const folderId of [existing?.folderId, incoming?.folderId, queuedFolderId]) {
      if (typeof folderId === 'string' && ((await dynamicDb.table('folders').get(folderId))?.localOnly
        || (await dynamicDb.table('_syncMeta').get(JSON.stringify(['localOnly', folderId])))?.value
        || (await dynamicDb.table('_syncMeta').get(uncachedFolderKey(folderId)))?.value)) return true;
    }
    return false;
  }
}

export const syncEngine = new SyncEngine();
