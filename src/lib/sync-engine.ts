import { db } from '../db';
import i18n from '../i18n';
import type { Dexie as DexieType } from 'dexie';
import { syncPush, syncPull, type SyncChange, type SyncResult } from './server-api';
import { SERVER_UNREPRESENTED_FIELDS, preserveUnsyncedFields, readableSyncRecord } from './sync-sanitize';
import { MAX_SYNC_REQUEST_NODES } from './sync-push-limits';
import { deleteCheckpointsFor } from './checkpoints';
import { forgetIgnoredNames } from './ignored-names';
import { distinctConnections, mergeIdentityRows, retarget, undoRetarget } from './identity-merge';
import type { Identity, IdentityConnection } from '../types';
import { MAX_PUSH_BYTES, SERVER_TABLES_KEY, agentDeploymentIds, compactHeldQueue, outgoingChange, serverSyncTables, serverTablesOf, syncItemLabel, validVersion,
  type HeldReason, type SyncQueueEntry } from './sync-outgoing';
import { LEGACY_SYNC_TABLES, SYNC_TABLES, isSyncTable, onOutboxCommit, revisionKey, suppressSyncInCurrentTransaction, setSessionPulled, hasPulledThisSession, takeDeferredTrashPurges } from './sync-state';
import type { WSClient } from './ws-client';
import { ensureSyncWorkspace, type SyncWorkspacePause } from './sync-workspace';
import { assertSyncCaptureReady, ensureSyncCaptureCoverage, normalizeSyncWorkspaceIdentity, isSyncWorkspaceIdentity,
  isSampleGlobalRecord, SYNC_WORKSPACE_KEY, SYNC_RECOVERY_KEY, SYNC_HISTORY_MESSAGE } from './sync-capture-policy';
import { uncachedFolderKey, cacheOperationKey, rotateCacheOperation, CACHE_REPLAY_CANCELLED } from './sync-cache';
import { getSessionGeneration, getSessionKey } from './encryptionMiddleware';
import { isEncryptionEnabled } from './encryptionStore';

const dynamicDb = db as unknown as DexieType;
const CURSOR_KEY = 'syncCursorV2';
/** The tables the saved cursor has received changes for. Builds before identities saved none. */
const CURSOR_TABLES_KEY = 'syncCursorTablesV1';
const INITIAL_KEY = 'initialPushDoneV2';
const RECOVERY_KEY = SYNC_RECOVERY_KEY;
const HISTORY_KEY = 'syncHistoryGenerationV1';
const RECOVERY_MESSAGE = SYNC_HISTORY_MESSAGE;
const entityKey = (table: string, id: string) => JSON.stringify([table, id]);
const isRecord = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
/** The names of identities merged into this one whose changes wait for it (its conflict says so). */
const mergedNames = (queue: SyncQueueEntry[], table: string, entityId: string) => queue
  .filter(entry => entry.after?.table === table && entry.after.entityId === entityId && entry.op === 'delete')
  .flatMap(entry => isRecord(entry.restore) && typeof entry.restore.name === 'string' ? [entry.restore.name] : []);
/** Server rows this client could not read: { version, folderId } only, never their content. */
const skippedKey = (table: string, id: string) => JSON.stringify(['syncSkipped', table, id]);
const SKIPPED_PREFIX = '["syncSkipped",';
const HELD_NOTICES: Readonly<Record<Exclude<HeldReason, 'oversized'>, string>> = {
  limits: 'syncStatus.oversizedOutgoing', unreadable: 'syncStatus.unreadableOutgoing', previewType: 'syncStatus.previewTypeOutgoing',
  unsupported: 'syncStatus.unsupportedOutgoing',
};
/** A newer server may sync tables this client does not know: their changes are skipped, and
 * a later build that syncs them catches up. A table the server does not list is invalid. */
const withoutNewerTables = (changes: RemoteChange[], serverTables: ReadonlySet<string>) =>
  changes.filter(change => isSyncTable(change.table) || !serverTables.has(change.table));
const WORKSPACE_NOTICES: Readonly<Record<SyncWorkspacePause, string>> = {
  workspaceMismatch: 'syncStatus.pausedWorkspaceMismatch', unboundHistory: 'syncStatus.pausedUnboundHistory',
};
/** A workspace binding pause reads in the interface language; any other failure keeps its message. */
function failureNotice(error: unknown, fallback: string): string {
  const code = (error as { code?: unknown } | null)?.code;
  if (code === 'workspaceMismatch' || code === 'unboundHistory') return i18n.t(WORKSPACE_NOTICES[code], { ns: 'common' });
  return error instanceof Error ? error.message : fallback;
}

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
  /** The last push's held-back notice, repeated at the next cycle start so the banner does not flicker. */
  private heldNotice: string | null = null;
  private workspace: { serverUrl: string; userId: string } | null = null;

  setConflictHandler(handler: (conflicts: SyncResult[]) => void) { this.onConflict = handler; }
  setRemoteChangeHandler(handler: (changes: Record<string, unknown>[], tables: Set<string>) => void) { this.onRemoteChange = handler; }
  // Retained API: clients no longer send optimistic entity mutations over WS.
  /** Only its connection id is read, for pushes; committed notifications trigger a pull. */
  private wsClient: WSClient | null = null;
  setWSClient(ws: WSClient | null) { this.wsClient = ws; }
  setReadyHandler(handler: () => void) { this.onReady = handler; }
  setErrorHandler(handler: (message: string | null) => void) { this.onError = handler; }
  setWorkspaceIdentity(serverUrl: string, userId: string) {
    if (this.workspace?.serverUrl !== serverUrl || this.workspace?.userId !== userId) this.stop();
    this.workspace = { serverUrl, userId };
  }

  private async ensureWorkspace(epoch: number) {
    const workspace = this.workspace;
    if (!workspace) throw new Error('Sync paused: no verified server/account identity. Local edits are retained.');
    const assertCurrent = () => {
      if (epoch !== this.epoch || workspace !== this.workspace) throw new Error('Sync session changed; local edits were retained.');
    };
    assertCurrent();
    await ensureSyncCaptureCoverage(dynamicDb);
    assertCurrent();
    await ensureSyncWorkspace(workspace.serverUrl, workspace.userId, assertCurrent);
    await this.assertCurrentWorkspace(epoch);
  }

  /** Recheck after async work and inside committing transactions. A valid
   * account at request start is not permission to mutate a later session. */
  private async assertCurrentWorkspace(epoch: number) {
    const workspace = this.workspace;
    if (!workspace || epoch !== this.epoch) throw new Error('Sync session changed; local edits were retained.');
    const identity = normalizeSyncWorkspaceIdentity(workspace.serverUrl, workspace.userId);
    const saved = (await dynamicDb.table('_syncMeta').get(SYNC_WORKSPACE_KEY))?.value;
    if (!isSyncWorkspaceIdentity(saved) || saved.serverUrl !== identity.serverUrl || saved.userId !== identity.userId) {
      throw new Error('Sync paused: the durable server/account binding changed. Local edits were retained.');
    }
    await assertSyncCaptureReady(dynamicDb);
    if (epoch !== this.epoch || workspace !== this.workspace) throw new Error('Sync session changed; local edits were retained.');
  }

  start() {
    if (this.running) return;
    this.running = true;
    setSessionPulled(false);
    const epoch = ++this.epoch;
    this.unsubscribe = onOutboxCommit(() => this.scheduleSync());
    queueMicrotask(() => { if (this.epoch === epoch) this.onReady?.(); });
    this.initialSync(epoch).then(() => {
      if (this.epoch === epoch) return this.sync();
    }).catch(error => {
      if (this.epoch === epoch) this.onError?.(failureNotice(error, 'Sync initialization failed; local edits are retained.'));
      console.warn('[sync] Initial sync failed:', error);
    });
    this.timer = setInterval(() => { void this.sync(); }, 30_000);
  }

  stop() {
    this.running = false;
    setSessionPulled(false);
    ++this.epoch;
    this.unsubscribe?.();
    this.unsubscribe = null;
    if (this.timer) clearInterval(this.timer);
    if (this.pushTimer) clearTimeout(this.pushTimer);
    this.timer = this.pushTimer = null;
    this.syncing = null;
    this.rerunRequested = false;
    this.heldNotice = null;
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
        await this.ensureWorkspace(epoch);
        if ((await dynamicDb.table('_syncMeta').get(RECOVERY_KEY))?.value) {
          if (epoch === this.epoch) this.onError?.(RECOVERY_MESSAGE);
          return;
        }
        if (epoch !== this.epoch) return;
        this.onError?.(this.heldNotice ?? await this.skippedNotice());
        // Check an existing history before uploading into a possibly restored
        // server. A reset is a reconciliation decision, not a cursor rewind.
        await this.pull(epoch);
        if (epoch !== this.epoch) return;
        if (!hasPulledThisSession()) {
          // Trash this device could not purge before pulling (the server holds it) is purged now.
          setSessionPulled(true);
          const deferred = takeDeferredTrashPurges();
          if (deferred.size) this.onRemoteChange?.([], deferred);
        }
        await this.push(epoch);
        if (epoch === this.epoch) await this.pull(epoch);
      } catch (error) {
        if (epoch === this.epoch && (error as { code?: string }).code === 'SYNC_CURSOR_RESET') {
          await dynamicDb.table('_syncMeta').put({ key: RECOVERY_KEY, value: true });
        }
        if (epoch === this.epoch) this.onError?.(failureNotice(error, 'Sync failed; local edits are retained.'));
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
    await this.ensureWorkspace(epoch);
    if (epoch !== this.epoch) return;
    if ((await dynamicDb.table('_syncMeta').get(INITIAL_KEY))?.value) return;
    await dynamicDb.transaction('rw', [...SYNC_TABLES, '_syncMeta', '_syncQueue', '_localMigrations'], async () => {
      if (epoch !== this.epoch) return;
      await this.assertCurrentWorkspace(epoch);
      suppressSyncInCurrentTransaction();
      const folders = await dynamicDb.table('folders').toArray();
      const folderIds = new Set(folders.filter(f => !f.localOnly && !f.trashed).map(f => f.id));
      const queued: SyncQueueEntry[] = await dynamicDb.table('_syncQueue').toArray();
      const pending = new Set(queued.map(e => entityKey(e.table, e.entityId)));
      for (const table of SYNC_TABLES) {
        for (const row of await dynamicDb.table(table).toArray()) {
          if (row.trashed || row.localOnly || isSampleGlobalRecord(table, row.id)) continue;
          if (table === 'folders' ? !folderIds.has(row.id) : !['tags', 'timelines'].includes(table) && !folderIds.has(row.folderId)) continue;
          if (pending.has(entityKey(table, row.id))) continue;
          if ((await dynamicDb.table('_syncMeta').get(revisionKey(table, row.id)))?.value) continue;
          await dynamicDb.table('_syncQueue').add({ table, entityId: row.id, op: 'put', data: row, clientVersion: 0 });
        }
      }
      await dynamicDb.table('_syncMeta').put({ key: INITIAL_KEY, value: true });
      await this.assertCurrentWorkspace(epoch);
    });
  }

  private async push(epoch: number) {
    // While locked, queued rows read back as ciphertext envelopes and an
    // accepted push could not be acknowledged, so nothing is sent. A real lock
    // stops the engine; enabling encryption stores metadata before the key, so
    // the push waits quietly for the next interval instead of reporting a lock.
    const session = getSessionGeneration();
    const locked = () => isEncryptionEnabled() && !getSessionKey();
    if (locked()) return;
    const history = (await dynamicDb.table('_syncMeta').get(HISTORY_KEY))?.value;
    if (typeof history !== 'string') throw new Error('Server history has not been verified; pending edits were retained.');
    const serverTables = await serverSyncTables();
    // Changes the server cannot take yet stay on this device, one entry per entity (see compactHeldQueue).
    await dynamicDb.transaction('rw', '_syncQueue', '_syncMeta', '_localMigrations', async () => {
      await this.assertCurrentWorkspace(epoch);
      suppressSyncInCurrentTransaction();
      await compactHeldQueue(serverTables);
    });
    const queue: SyncQueueEntry[] = await dynamicDb.table('_syncQueue').toArray();
    if (epoch !== this.epoch) return;
    const groups = new Map<string, SyncQueueEntry[]>();
    const samples: SyncQueueEntry[] = [];
    // Held entries are checked once per investigation, not once per entry.
    const localOnlyFolders = new Map<string, boolean>();
    for (const entry of queue) {
      if (!isSyncTable(entry.table)) continue; // retain unsupported legacy work
      // Older builds queued demo tags and timelines; like capture, keep them on this device unless the server holds them.
      if (entry.op === 'put' && isSampleGlobalRecord(entry.table, entry.entityId)
        && !(await dynamicDb.table('_syncMeta').get(revisionKey(entry.table, entry.entityId)))?.value) { samples.push(entry); continue; }
      if (serverTables.has(entry.table)) {
        if (await this.isLocalOnly(entry.table, entry.entityId, entry.data, entry.folderId, true)) continue;
      } else {
        // Held (the server does not sync its table): only whether its investigation is local-only
        // matters for the held notice, so that is read once per investigation.
        const folder = typeof entry.folderId === 'string' ? entry.folderId : typeof entry.data?.folderId === 'string' ? entry.data.folderId : undefined;
        if (!folder) continue;
        if (!localOnlyFolders.has(folder)) localOnlyFolders.set(folder, await this.isLocalOnly(entry.table, entry.entityId, entry.data, folder, true));
        if (localOnlyFolders.get(folder)) continue;
      }
      const key = entityKey(entry.table, entry.entityId);
      groups.set(key, [...(groups.get(key) ?? []), entry]);
    }
    // A change that waits for another row's change (a merge waits for the kept identity) stays queued
    // while that row has anything queued. An investigation's queued delete covers its items' deletes:
    // they are not sent, and are dropped once it is accepted (the server publishes them to everyone).
    const queuedKeys = new Set(queue.map(entry => entityKey(entry.table, entry.entityId)));
    const waitedOn = new Set<string>();
    const deletedFolders = new Set([...groups.values()]
      .filter(entries => entries[0].table === 'folders' && entries[entries.length - 1].op === 'delete').map(entries => entries[0].entityId));
    const covered = new Map<string, SyncQueueEntry[]>();
    const afterOf = new Map<string, string>();
    for (const [key, entries] of groups) {
      const after = entries.find(entry => entry.after)?.after;
      if (after) afterOf.set(key, entityKey(after.table, after.entityId));
    }
    // Rows that wait on each other in a circle (merges chained back onto each other) go now.
    const waits = (key: string) => {
      const target = afterOf.get(key);
      if (!target || !queuedKeys.has(target)) return false;
      const seen = new Set([key]);
      for (let next: string | undefined = target; next; next = afterOf.get(next)) {
        if (seen.has(next)) return false;
        seen.add(next);
      }
      return true;
    };
    for (const [key, entries] of [...groups]) {
      const last = entries[entries.length - 1];
      const after = afterOf.get(key);
      if (after && waits(key)) {
        waitedOn.add(after);
        groups.delete(key);
      } else if (last.table !== 'folders' && entries.every(entry => entry.op === 'delete') && typeof last.folderId === 'string' && deletedFolders.has(last.folderId)) {
        // Only rows whose queued changes are all deletes: an unsent move into the investigation must still
        // reach the server, so that row's delete is sent as usual.
        covered.set(last.folderId, [...covered.get(last.folderId) ?? [], ...entries]);
        groups.delete(key);
      }
    }
    if (samples.length) {
      await dynamicDb.transaction('rw', '_syncQueue', '_syncMeta', '_localMigrations', async () => {
        await this.assertCurrentWorkspace(epoch);
        suppressSyncInCurrentTransaction();
        await dynamicDb.table('_syncQueue').bulkDelete(samples.map(entry => entry.seq).filter((seq): seq is number => seq !== undefined));
      });
    }
    // Parents are accepted before their child entities.
    const ordered = [...groups.values()].sort((a, b) => Number(b[0].table === 'folders') - Number(a[0].table === 'folders'));
    const conflicts: SyncResult[] = [];
    const folds: Array<{ conflict: SyncResult; keepId: string; serverData: Record<string, unknown>; serverVersion: number }> = [];
    let released = false;
    const encoder = new TextEncoder();
    const agents = await agentDeploymentIds();
    const refused: Array<{ table: string; entityId: string; refusal: Exclude<HeldReason, 'oversized'> }> = [];
    const batches: Array<{ entries: SyncQueueEntry[]; change: SyncChange }[]> = [];
    let current: { entries: SyncQueueEntry[]; change: SyncChange }[] = [];
    let bytes = encoder.encode('{"changes":[]}').byteLength;
    let nodes = 0;
    let oversized = false;
    for (const entries of ordered) {
      const { change, nodes: changeNodes, size, asset, held: refusal } = outgoingChange(entries, agents, serverTables);
      if (refusal === 'oversized') {
        this.onError?.('Some local changes are too large to sync and remain saved on this device. Reduce their size or export them separately.');
        oversized = true;
        continue;
      }
      if (refusal) {
        refused.push({ table: change.table, entityId: change.entityId, refusal });
        continue;
      }
      if (asset) {
        if (current.length) { batches.push(current); current = []; bytes = 128; nodes = 0; }
        batches.push([{ entries, change }]);
        continue;
      }
      if (current.length && (current.length === 100 || bytes + size > MAX_PUSH_BYTES || nodes + changeNodes > MAX_SYNC_REQUEST_NODES)) {
        batches.push(current); current = []; bytes = 15; nodes = 0;
      }
      current.push({ entries, change }); bytes += size; nodes += changeNodes;
    }
    if (current.length) batches.push(current);
    const [held] = refused;
    const notice = held ? i18n.t(HELD_NOTICES[held.refusal],
      { ns: 'common', item: await syncItemLabel(held.table, held.entityId), total: refused.length }) : null;
    if (epoch === this.epoch) {
      // The same notice every cycle leaves the banner untouched. Clear an earlier one only when nothing replaced it.
      const previous = this.heldNotice;
      this.heldNotice = notice;
      if (notice || (previous && !oversized)) this.onError?.(notice ?? await this.skippedNotice());
    }
    for (const items of batches) {
      if (epoch !== this.epoch) return;
      const deliverable = [];
      for (const item of items) {
        if (!await this.isLocalOnly(item.change.table, item.change.entityId, item.change.data, item.entries[item.entries.length - 1].folderId, true)) deliverable.push(item);
      }
      if (!deliverable.length) continue;
      const batch = deliverable.map(item => item.entries);
      const changes = deliverable.map(item => item.change);
      await this.assertCurrentWorkspace(epoch);
      if (locked()) return;
      // A re-key (passphrase change, enabling encryption) is not a lock, but the
      // queue was read under the previous session: read it again shortly.
      if (isEncryptionEnabled() && session !== getSessionGeneration()) { this.scheduleSync(); return; }
      const { results } = await syncPush(changes, history, this.wsClient?.connectionId);
      if (epoch !== this.epoch) return;
      await dynamicDb.transaction('rw', '_syncQueue', '_syncMeta', '_localMigrations', async () => {
        if (epoch !== this.epoch) return;
        await this.assertCurrentWorkspace(epoch);
        for (let i = 0; i < changes.length; i++) {
          const sent = changes[i], result = results[i];
          if (!result || result.entityId !== sent.entityId || (result.table && result.table !== sent.table)) continue;
          if (result.status !== 'accepted') {
            const merge = batch[i].find(entry => entry.after && isRecord(entry.restore) && typeof entry.restore.id === 'string');
            // A merged-away identity a teammate changed meanwhile: their version is merged too (below).
            if (merge?.after && result.status === 'conflict' && sent.op === 'delete' && sent.table === 'identities' && result.serverData && !result.serverData.deletedAt && validVersion(result.serverVersion)) {
              folds.push({ conflict: { ...result, table: sent.table, localData: sent.data }, keepId: merge.after.entityId, serverData: result.serverData, serverVersion: result.serverVersion });
              continue;
            }
            const mergedFrom = mergedNames(queue, sent.table, sent.entityId);
            conflicts.push({ ...result, table: sent.table, localData: sent.data, ...(mergedFrom.length ? { mergedFrom } : {}) });
            continue;
          }
          if (!validVersion(result.serverVersion)) continue; // do not lose work on malformed acknowledgements
          const sentSeqs = batch[i].map(e => e.seq).filter((seq): seq is number => seq !== undefined);
          await dynamicDb.table('_syncQueue').bulkDelete(sentSeqs);
          // The server merged this change with a teammate's changes to other fields, which this device
          // has not seen. Its baseline stays the revision it edited, so a later edit is merged the same
          // way instead of overwriting those fields with the values held here; the pull brings the
          // merged record and its revision.
          if (result.merged) {
            if (waitedOn.has(entityKey(sent.table, sent.entityId))) released = true;
            continue;
          }
          await dynamicDb.table('_syncMeta').put({ key: revisionKey(sent.table, sent.entityId), value: result.serverVersion });
          // Edits made while this request was in flight continue from our own
          // accepted revision, never from a concurrent peer's unreviewed version.
          // Only this entity's entries (indexed), not the whole queue for each accepted change.
          const remaining: SyncQueueEntry[] = await dynamicDb.table('_syncQueue').where('entityId').equals(sent.entityId).toArray();
          for (const pending of remaining) {
            if (pending.table === sent.table && (pending.clientVersion ?? 0) === sent.clientVersion) {
              await dynamicDb.table('_syncQueue').put({ ...pending, clientVersion: result.serverVersion });
            }
          }
          if (sent.table === 'folders' && sent.op === 'delete') {
            await dynamicDb.table('_syncQueue').bulkDelete((covered.get(sent.entityId) ?? []).map(entry => entry.seq).filter((seq): seq is number => seq !== undefined));
          }
          if (waitedOn.has(entityKey(sent.table, sent.entityId)) && !remaining.some(pending => pending.table === sent.table)) released = true;
        }
        await this.assertCurrentWorkspace(epoch);
      });
    }
    for (const fold of folds) {
      if (epoch !== this.epoch) return;
      if (!await this.foldMergedIdentity(epoch, fold)) conflicts.push(fold.conflict);
    }
    if (epoch === this.epoch && conflicts.length) this.onConflict?.(conflicts);
    // What waited for an accepted change goes now, not at the next interval.
    if (epoch === this.epoch && released) this.scheduleSync();
  }

  /**
   * Cancels the changes held behind a row whose own change was given up ("Keep theirs"): a merge's
   * merged-away identity comes back as it was, and identities the merge reconnected point at it again
   * (queued as a new change). Runs inside resolveConflicts' transaction, with capture suppressed;
   * `queue` is the queue as that transaction read it for this conflict.
   */
  private async cancelHeldBehind(table: string, entityId: string, queue: SyncQueueEntry[]): Promise<boolean> {
    const held = queue.filter(entry => entry.after?.table === table && entry.after.entityId === entityId);
    const groups = new Map<string, SyncQueueEntry[]>();
    for (const entry of held) groups.set(entityKey(entry.table, entry.entityId), [...groups.get(entityKey(entry.table, entry.entityId)) ?? [], entry]);
    for (const entries of groups.values()) {
      // The merge's (held) entries go. Compaction may have folded other changes of the row into them, so
      // what the row needs now is queued again: whatever stays queued besides comes first.
      const { table: name, entityId: id } = entries[0];
      const earliest = queue.find(entry => entry.table === name && entry.entityId === id);
      const restore = entries.find(entry => entry.restore !== undefined)?.restore;
      await dynamicDb.table('_syncQueue').bulkDelete(entries.map(entry => entry.seq).filter((seq): seq is number => seq !== undefined));
      if (name !== 'identities' || !isRecord(restore)) continue;
      const requeue = async (op: 'put' | 'delete', data?: Identity) => dynamicDb.table('_syncQueue').add({ table: name, entityId: id,
        folderId: data?.folderId ?? earliest?.folderId, op, ...(data ? { data } : {}), clientVersion: earliest?.clientVersion ?? 0 });
      const current = await dynamicDb.table(name).get(id) as Identity | undefined;
      if (typeof restore.id === 'string') {
        // The merged-away identity comes back as it was merged, edits made before the merge included
        // (the server never received its delete, and may not have those edits).
        if (!current) {
          await dynamicDb.table(name).put(restore);
          await requeue('put', restore as unknown as Identity);
        }
        continue;
      }
      if (!current) {
        // Deleted here since the merge: its delete is queued.
        await requeue('delete');
        continue;
      }
      if (!Array.isArray(restore.connections) || typeof restore.mergedFrom !== 'string') continue;
      const reconnected = { ...current, connections: undoRetarget(current.connections, restore.connections as IdentityConnection[], entityId, restore.mergedFrom, id), updatedAt: Date.now() };
      await dynamicDb.table(name).put(reconnected);
      await requeue('put', reconnected);
    }
    return groups.size > 0;
  }

  /**
   * A merge's delete conflicted because a teammate changed the merged-away identity: their version is
   * merged into the kept identity too, and the delete retries against it once that is accepted. False
   * (shown as a conflict) when the kept identity is gone or their version cannot be read here.
   */
  private async foldMergedIdentity(epoch: number, fold: { conflict: SyncResult; keepId: string; serverData: Record<string, unknown>; serverVersion: number }): Promise<boolean> {
    const goneId = fold.conflict.entityId;
    return dynamicDb.transaction('rw', ['identities', '_syncQueue', '_syncMeta', '_localMigrations'], async () => {
      await this.assertCurrentWorkspace(epoch);
      const kept = await dynamicDb.table('identities').get(fold.keepId) as Identity | undefined;
      const theirs = readableSyncRecord('identities', fold.serverData, goneId) as Identity | null;
      // Moved to another investigation meanwhile: merging it would copy it across investigations.
      if (!kept || !theirs || theirs.folderId !== kept.folderId) return false;
      // Not suppressed: these new versions are queued as any edit is.
      const now = Date.now();
      await dynamicDb.table('identities').put(mergeIdentityRows(kept, theirs, now));
      // Connections a teammate made to it since (pulled here) point at the kept identity, as merge does.
      const pointing = (kept.folderId ? await dynamicDb.table('identities').where('folderId').equals(kept.folderId).toArray() as Identity[] : [])
        .filter(row => row.id !== fold.keepId && row.connections.some(edge => edge.targetId === goneId));
      for (const row of pointing) {
        await dynamicDb.table('identities').put({ ...row, connections: distinctConnections(retarget(row.connections, goneId, fold.keepId), row.id), updatedAt: now });
      }
      // Its delete now answers the teammate's revision; "Theirs" on the kept identity brings it back as
      // the teammate has it (their edit included), not as this device had it before the merge.
      for (const entry of await dynamicDb.table('_syncQueue').where('entityId').equals(goneId).toArray() as SyncQueueEntry[]) {
        if (entry.table === 'identities') await dynamicDb.table('_syncQueue').put({ ...entry, clientVersion: fold.serverVersion, ...(entry.restore !== undefined ? { restore: theirs } : {}) });
      }
      return true;
    });
  }

  private async pull(epoch: number) {
    let cursor = (await dynamicDb.table('_syncMeta').get(CURSOR_KEY))?.value ?? '0';
    let uncovered = await this.uncoveredTables();
    while (epoch === this.epoch) {
      const generation = this.replayGeneration;
      let page;
      try {
        const history = (await dynamicDb.table('_syncMeta').get(HISTORY_KEY))?.value;
        if (cursor !== '0' && !history) {
          await dynamicDb.table('_syncMeta').put({ key: RECOVERY_KEY, value: true });
          throw new Error(RECOVERY_MESSAGE);
        }
        await this.assertCurrentWorkspace(epoch);
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
      const serverTables = serverTablesOf(page.tables);
      await this.recordServerTables(epoch, serverTables);
      if (uncovered.length) {
        // The server has accepted the saved cursor and history. A server without the
        // missed tables has no history for them, and a fresh cursor misses nothing.
        const missed = cursor === '0' ? [] : uncovered.filter(name => serverTables.has(name));
        if (missed.length && !await this.catchUp(epoch, missed, page.generation)) return;
        await this.recordCursorTables(epoch);
        uncovered = [];
      }
      const applied = await this.applyChanges(withoutNewerTables(page.changes, serverTables), epoch, page.cursor, generation, cursor, page.generation);
      if (generation !== this.replayGeneration) { cursor = '0'; continue; }
      if (!applied) { cursor = (await dynamicDb.table('_syncMeta').get(CURSOR_KEY))?.value ?? '0'; continue; }
      cursor = page.cursor;
      if (!page.hasMore) return;
    }
  }

  /** The tables this client syncs whose changes the saved cursor has not received. */
  private async uncoveredTables(): Promise<string[]> {
    const saved: unknown = (await dynamicDb.table('_syncMeta').get(CURSOR_TABLES_KEY))?.value;
    const covered: readonly unknown[] = Array.isArray(saved) ? saved : LEGACY_SYNC_TABLES;
    return SYNC_TABLES.filter(name => !covered.includes(name));
  }

  private async recordCursorTables(epoch: number) {
    await dynamicDb.transaction('rw', '_syncMeta', '_localMigrations', async () => {
      await this.assertCurrentWorkspace(epoch);
      await dynamicDb.table('_syncMeta').put({ key: CURSOR_TABLES_KEY, value: [...SYNC_TABLES] });
    });
  }

  /** Kept durably, so restore and offline-copy removal know them while signed out. */
  private async recordServerTables(epoch: number, tables: ReadonlySet<string>) {
    const value = [...tables].sort();
    if (JSON.stringify((await dynamicDb.table('_syncMeta').get(SERVER_TABLES_KEY))?.value) === JSON.stringify(value)) return;
    await dynamicDb.transaction('rw', '_syncMeta', '_localMigrations', async () => {
      await this.assertCurrentWorkspace(epoch);
      await dynamicDb.table('_syncMeta').put({ key: SERVER_TABLES_KEY, value });
    });
  }

  /** Pulls, from the start of the log, only the tables the saved cursor never received.
   * The saved cursor stays: pulls now include these tables, and this reaches at least as
   * far. Revisions older than those already applied are skipped. Returns whether it finished. */
  private async catchUp(epoch: number, tables: string[], history: string): Promise<boolean> {
    let cursor = '0';
    while (epoch === this.epoch) {
      await this.assertCurrentWorkspace(epoch);
      const page = await syncPull(new Date(0).toISOString(), undefined, cursor, history, tables);
      if (epoch !== this.epoch) return false;
      if (page.generation !== history) throw Object.assign(new Error(RECOVERY_MESSAGE), { code: 'SYNC_CURSOR_RESET' });
      if (typeof page.cursor !== 'string' || !/^\d+$/.test(page.cursor) || BigInt(page.cursor) < BigInt(cursor)
        || (page.hasMore && page.cursor === cursor)) throw new Error('Invalid sync catch-up cursor');
      if (!await this.applyChanges(withoutNewerTables(page.changes, serverTablesOf(page.tables)), epoch)) return false;
      cursor = page.cursor;
      if (!page.hasMore) return true;
    }
    return false;
  }

  private async applyChanges(changes: RemoteChange[], epoch: number, cursor?: string, generation?: number, expectedCursor?: string, history?: string, cacheFolder?: string, cacheOperation?: string) {
    const affected = new Set<string>();
    const agents = await agentDeploymentIds();
    let skippedChanged = false;
    // Rows a newer remote revision changed or deleted: their AI undo checkpoints can no longer apply,
    // and a deleted row's copy must not outlive it (PRIV-1); deleted investigations' ignored names too.
    const replaced = new Map<string, Set<string>>();
    const deletedFolders: string[] = [];
    const applied = await dynamicDb.transaction('rw', [...SYNC_TABLES, 'checkpoints', '_syncQueue', '_syncMeta', '_localMigrations'], async () => {
      if (epoch !== this.epoch) return false;
      await this.assertCurrentWorkspace(epoch);
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
      const skipped = new Set(await dynamicDb.table('_syncMeta').where('key').startsWith(SKIPPED_PREFIX).primaryKeys());
      for (const change of changes) {
        const { table, op, id } = change;
        if (!isSyncTable(table) || typeof id !== 'string' || !['put', 'delete'].includes(op)) throw new Error('Invalid sync entity');
        if (await this.isLocalOnly(table, id, change)) continue;
        if (pending.has(entityKey(table, id))) continue;
        const version = change.version;
        if (!validVersion(version) || version === 0) throw new Error('Sync entity has no server revision');
        const known = (await dynamicDb.table('_syncMeta').get(revisionKey(table, id)))?.value ?? 0;
        if (version < known) continue;
        const skipKey = skippedKey(table, id);
        // A deleted row, or an identity a newer revision changed (not the echo of this device's own
        // accepted change): its checkpoints could no longer apply, and may hold removed details.
        if (op === 'delete' || (table === 'identities' && version > known)) replaced.set(table, (replaced.get(table) ?? new Set()).add(id));
        if (op === 'delete') {
          await dynamicDb.table(table).delete(id);
          if (table === 'folders') deletedFolders.push(id);
        } else {
          const record = readableSyncRecord(table, change, id);
          if (!record) {
            // Keep any local copy and leave its revision unrecorded, so a local edit still
            // conflicts with this version. The item is named until a readable revision arrives.
            await dynamicDb.table('_syncMeta').put({ key: skipKey, value: { version, folderId: typeof change.folderId === 'string' ? change.folderId : undefined } });
            skippedChanged = true;
            continue;
          }
          await dynamicDb.table(table).put(await this.withLocalFields(table, change, record, id, agents));
        }
        await dynamicDb.table('_syncMeta').put({ key: revisionKey(table, id), value: version });
        // A replay that brings the unreadable version back skips it again.
        if (skipped.has(skipKey)) {
          await dynamicDb.table('_syncMeta').delete(skipKey);
          skippedChanged = true;
        }
        affected.add(table);
      }
      if (replaced.size) await deleteCheckpointsFor(replaced);
      if (cursor !== undefined && generation === this.replayGeneration) await dynamicDb.table('_syncMeta').put({ key: CURSOR_KEY, value: cursor });
      if (history !== undefined) await dynamicDb.table('_syncMeta').put({ key: HISTORY_KEY, value: history });
      await this.assertCurrentWorkspace(epoch);
      return true;
    });
    if (applied && deletedFolders.length) await forgetIgnoredNames(deletedFolders);
    if (epoch === this.epoch && affected.size) this.onRemoteChange?.(changes, affected);
    if (epoch === this.epoch && skippedChanged) this.onError?.(await this.skippedNotice());
    return applied;
  }

  /** Only tables with fields the server cannot store need the local row. */
  private async withLocalFields(table: string, incoming: Record<string, unknown>, record: Record<string, unknown>, id: string, agents: ReadonlySet<string>) {
    if (!SERVER_UNREPRESENTED_FIELDS[table]) return record;
    const local = await dynamicDb.table(table).get(id);
    const merged = preserveUnsyncedFields(table, incoming, record, local);
    // Older delegations stored the agent deployment in assigneeId, which never reaches the
    // server. Keep it in the device-only field rather than letting the echo erase it.
    if (table === 'tasks' && merged.assigneeId == null && merged.assignedDeploymentId == null
      && typeof local?.assigneeId === 'string' && agents.has(local.assigneeId)) merged.assignedDeploymentId = local.assigneeId;
    return merged;
  }

  /** Names the first server row this client skipped, while any remain; otherwise null. */
  private async skippedNotice(): Promise<string | null> {
    const skipped: Array<{ table: string; id: string; folderId?: unknown }> = [];
    for (const entry of await dynamicDb.table('_syncMeta').where('key').startsWith(SKIPPED_PREFIX).toArray()) {
      const [, table, id] = JSON.parse(entry.key) as [string, string, string];
      const folderId = entry.value?.folderId;
      if (!await this.isLocalOnly(table, id, { folderId })) skipped.push({ table, id, folderId });
    }
    if (!skipped.length) return null;
    return i18n.t('syncStatus.skippedIncoming', { ns: 'common', item: await syncItemLabel(skipped[0].table, skipped[0].id, skipped[0].folderId), total: skipped.length });
  }

  /** Access to an investigation was revoked: the server no longer sends its rows, so a skipped one can never be corrected. */
  async forgetSkippedFolder(folderId: string) {
    const epoch = this.epoch;
    let forgotten = false;
    await dynamicDb.transaction('rw', '_syncMeta', '_localMigrations', async () => {
      await this.assertCurrentWorkspace(epoch);
      const keys = (await dynamicDb.table('_syncMeta').where('key').startsWith(SKIPPED_PREFIX).toArray())
        .filter(entry => entry.value?.folderId === folderId).map(entry => entry.key);
      await dynamicDb.table('_syncMeta').bulkDelete(keys);
      forgotten = keys.length > 0;
    });
    if (forgotten && epoch === this.epoch) this.onError?.(this.heldNotice ?? await this.skippedNotice());
  }

  /** WS messages are invalidations, never a source of durable entity data. */
  /** Investigations the server holds a revision of: the ones whose changes it can announce to this device. */
  async serverFolderIds(): Promise<string[]> {
    const folders = (await dynamicDb.table('folders').toArray()).filter(folder => !folder.localOnly);
    const revisions = await dynamicDb.table('_syncMeta').bulkGet(folders.map(folder => revisionKey('folders', folder.id)));
    return folders.filter((_, index) => revisions[index]?.value).map(folder => folder.id);
  }

  async applyRemoteChange(table: string, op: 'put' | 'delete', id: string, data?: Record<string, unknown>) {
    void op; void id; void data;
    if (!isSyncTable(table)) return;
    await this.sync();
  }

  async resolveConflicts(conflicts: Array<{ table?: string; entityId: string; serverVersion?: number; serverData?: Record<string, unknown> }>, choice: 'mine' | 'theirs') {
    const epoch = this.epoch;
    await this.ensureWorkspace(epoch);
    if (choice === 'theirs') ++this.replayGeneration;
    const affected = new Set<string>();
    const agents = await agentDeploymentIds();
    let skippedChanged = false;
    const replaced = new Map<string, Set<string>>();
    const deletedFolders: string[] = [];
    await dynamicDb.transaction('rw', [...SYNC_TABLES, 'checkpoints', '_syncQueue', '_syncMeta', '_localMigrations'], async () => {
      await this.assertCurrentWorkspace(epoch);
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
          // Their version replaces this device's row: its AI undo checkpoints can no longer apply.
          const replace = () => replaced.set(table, (replaced.get(table) ?? new Set()).add(conflict.entityId));
          if (!conflict.serverData || conflict.serverData.deletedAt) {
            await dynamicDb.table(table).delete(conflict.entityId);
            replace();
            if (table === 'folders') deletedFolders.push(conflict.entityId);
          } else {
            const record = readableSyncRecord(table, conflict.serverData, conflict.entityId);
            if (!record) {
              // This client cannot read their version: keep the local row and its queued edit.
              const folderId = conflict.serverData.folderId;
              await dynamicDb.table('_syncMeta').put({ key: skippedKey(table, conflict.entityId), value: { version, folderId: typeof folderId === 'string' ? folderId : undefined } });
              skippedChanged = true;
              continue;
            }
            await dynamicDb.table(table).put(await this.withLocalFields(table, conflict.serverData, record, conflict.entityId, agents));
            replace();
          }
          await dynamicDb.table('_syncQueue').bulkDelete(entries.map(e => e.seq!));
          // Keeping their version of a merge's kept identity cancels the merge (DATA-1).
          if (await this.cancelHeldBehind(table, conflict.entityId, queue)) affected.add(table);
          // Keeping their investigation (its delete was not taken) keeps its items: their deletes, which
          // that delete covered, go too, and the replay below brings the items back (DATA-3).
          if (table === 'folders' && entries.some(entry => entry.op === 'delete')) {
            const items = new Map<string, SyncQueueEntry[]>();
            for (const entry of queue) {
              if (entry.table !== 'folders' && entry.folderId === conflict.entityId) items.set(entityKey(entry.table, entry.entityId), [...items.get(entityKey(entry.table, entry.entityId)) ?? [], entry]);
            }
            const covered = [...items.values()].filter(group => group.every(entry => entry.op === 'delete')).flat();
            await dynamicDb.table('_syncQueue').bulkDelete(covered.map(entry => entry.seq).filter((seq): seq is number => seq !== undefined));
          }
          // A pull may have skipped a newer revision while this entity was
          // pending. Replay the committed log after accepting the reviewed
          // version, so that skipped updates cannot remain invisible forever.
          await dynamicDb.table('_syncMeta').put({ key: CURSOR_KEY, value: '0' });
          affected.add(table);
        }
        await dynamicDb.table('_syncMeta').put({ key: revisionKey(table, conflict.entityId), value: version });
      }
      await this.assertCurrentWorkspace(epoch);
      if (replaced.size) await deleteCheckpointsFor(replaced);
    });
    if (deletedFolders.length) await forgetIgnoredNames(deletedFolders);
    if (epoch === this.epoch && affected.size) this.onRemoteChange?.([], affected);
    if (epoch === this.epoch && skippedChanged) this.onError?.(await this.skippedNotice());
    this.scheduleSync();
  }

  async enqueue(table: string, entityId: string, op: 'put' | 'delete', data?: Record<string, unknown>) {
    if (!isSyncTable(table)) throw new Error('Unsupported sync table');
    const epoch = this.epoch;
    await this.ensureWorkspace(epoch);
    await dynamicDb.transaction('rw', '_syncQueue', '_syncMeta', '_localMigrations', async () => {
      await this.assertCurrentWorkspace(epoch);
      const known = await dynamicDb.table('_syncMeta').get(revisionKey(table, entityId));
      await dynamicDb.table('_syncQueue').add({ table, entityId, op, data, clientVersion: known?.value ?? 0 });
      await this.assertCurrentWorkspace(epoch);
    });
    this.scheduleSync();
  }

  async pullFolder(folderId: string) {
    const epoch = this.epoch;
    await this.ensureWorkspace(epoch);
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
        await this.assertCurrentWorkspace(epoch);
        const page = await syncPull(new Date(0).toISOString(), folderId, cursor, history);
        if (epoch !== this.epoch) return;
        if (page.generation !== history) throw Object.assign(new Error(RECOVERY_MESSAGE), { code: 'SYNC_CURSOR_RESET' });
        if (typeof page.cursor !== 'string' || !/^\d+$/.test(page.cursor) || BigInt(page.cursor) < BigInt(cursor)
          || (page.hasMore && page.cursor === cursor)) throw new Error('Invalid investigation sync cursor');
        // Cache intent and each bounded page commit together. Never advance the
        // global cursor from a folder-filtered replay.
        await this.applyChanges(withoutNewerTables(page.changes, serverTablesOf(page.tables)), epoch, undefined, undefined, undefined, undefined, folderId, cacheOperation);
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
    const epoch = this.epoch;
    await this.ensureWorkspace(epoch);
    const folder = await dynamicDb.table('folders').get(folderId);
    if (!folder || folder.localOnly) return;
    await dynamicDb.transaction('rw', [...SYNC_TABLES, '_syncMeta', '_syncQueue', '_localMigrations'], async () => {
      await this.assertCurrentWorkspace(epoch);
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
      await this.assertCurrentWorkspace(epoch);
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
// Stop when the key is revoked, not when React later unmounts the workspace.
// The remounted workspace starts sync again after unlock.
if (typeof window !== 'undefined') window.addEventListener('workspace-will-lock', () => syncEngine.stop());
