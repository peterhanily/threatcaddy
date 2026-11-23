/**
 * How push turns queued operations into outgoing changes, and which queued puts
 * it keeps on this device. Restore and offline-copy removal use the same rules
 * so they never delete a row whose only copy is a held put. Everything here
 * reads durable data only, so it also works while signed out.
 */
import { db } from '../db';
import i18n from '../i18n';
import type { SyncChange } from './server-api';
import { outgoingSyncData } from './sync-sanitize';
import { MAX_SYNC_REQUEST_NODES, outgoingRefusal, syncDataNodes, type OutgoingRefusal } from './sync-push-limits';
import { LEGACY_SYNC_TABLES, SYNC_TABLES, isSyncTable, revisionKey, suppressSyncInCurrentTransaction } from './sync-state';

export const MAX_PUSH_BYTES = 900_000; // Leave room beneath the server's 1 MiB body limit.
const MAX_ASSET_PUSH_BYTES = 15 * 1024 * 1024; // Dedicated 16 MiB sync route.
const encoder = new TextEncoder();
export const validVersion = (value: unknown): value is number => Number.isSafeInteger(value) && (value as number) >= 0;

export interface SyncQueueEntry extends SyncChange {
  seq?: number;
  folderId?: string;
  /** Sent only once this row's queued change is accepted (see holdSyncUntilAccepted). */
  after?: { table: string; entityId: string };
  /** What undoing the held change needs (a merge: the merged-away row, or connections before it). Encrypted at rest. */
  restore?: unknown;
}
/** 'oversized': too large for any upload request. 'unsupported': the team server does not sync its table. */
export type HeldReason = OutgoingRefusal | 'oversized' | 'unsupported';

/** The tables the team server syncs, as its latest pull reported them. Kept durably, so
 * restore and offline-copy removal know them while signed out. */
export const SERVER_TABLES_KEY = 'syncServerTablesV1';
/** A server that does not list its tables (2.0.4 and earlier) syncs the legacy set. */
export const serverTablesOf = (listed: unknown): ReadonlySet<string> =>
  new Set(Array.isArray(listed) && listed.every(name => typeof name === 'string') ? listed : LEGACY_SYNC_TABLES);
export async function serverSyncTables(): Promise<ReadonlySet<string>> {
  return serverTablesOf((await db.table('_syncMeta').get(SERVER_TABLES_KEY))?.value);
}

/**
 * Changes to a table the team server does not sync (identities on a 2.0.4 server) stay queued on
 * this device until it does. They are kept compact, so no earlier copy of an edited or deleted row,
 * private details included, lingers and every sync cycle stays cheap: one entry per entity (its
 * latest operation, keeping the first entry's clientVersion, as push would send it), and nothing at
 * all for an entity the server never stored that was then deleted. Call inside a read-write
 * transaction that includes _syncQueue and _syncMeta, with the workspace unlocked.
 */
export async function compactHeldQueue(serverTables: ReadonlySet<string>, only?: ReadonlyMap<string, ReadonlySet<string>>): Promise<void> {
  const held = SYNC_TABLES.filter(table => !serverTables.has(table) && (!only || only.get(table)?.size));
  if (!held.length) return;
  const heldTables = new Set<string>(held);
  // `only`: just these rows' entries, read by index.
  const entries = only
    ? (await db.table('_syncQueue').where('entityId').anyOf([...new Set(held.flatMap(table => [...only.get(table) ?? []]))]).toArray() as SyncQueueEntry[])
      .filter(entry => heldTables.has(entry.table) && (only.get(entry.table)?.has(entry.entityId) ?? false))
      .sort((a, b) => (a.seq ?? 0) - (b.seq ?? 0))
    : await db.table('_syncQueue').where('table').anyOf(held).sortBy('seq') as SyncQueueEntry[];
  const groups = new Map<string, SyncQueueEntry[]>();
  for (const entry of entries) {
    const key = JSON.stringify([entry.table, entry.entityId]);
    groups.set(key, [...(groups.get(key) ?? []), entry]);
  }
  for (const entries of groups.values()) {
    const first = entries[0], last = entries[entries.length - 1];
    const seqs = entries.map(entry => entry.seq).filter((seq): seq is number => seq !== undefined);
    // Whether the server ever stored it matters only for a delete (one read, only then).
    const stored = async () => (validVersion(first.clientVersion) && first.clientVersion > 0)
      || !!(await db.table('_syncMeta').get(revisionKey(last.table, last.entityId)))?.value;
    if (last.op === 'delete' && !await stored()) {
      await db.table('_syncQueue').bulkDelete(seqs);
    } else if (entries.length > 1) {
      await db.table('_syncQueue').bulkDelete(seqs.slice(0, -1));
      // A hold (a merge waiting for its kept identity) stays with the entry that is kept.
      const hold = entries.find(entry => entry.after);
      if (last.clientVersion !== first.clientVersion || (hold && !last.after)) {
        await db.table('_syncQueue').put({ ...last, clientVersion: first.clientVersion, ...(hold && !last.after ? { after: hold.after, restore: hold.restore } : {}) });
      }
    }
  }
}

/**
 * Compacts these rows' held changes at once, without waiting for a sync cycle (which runs only
 * after a successful pull), so a deletion or an edit made while the server is unreachable leaves
 * no earlier copy queued. `rows` maps table names to ids. Never fails the change it follows.
 */
export async function compactHeldChangesFor(rows: ReadonlyMap<string, ReadonlySet<string>>): Promise<void> {
  try {
    await db.transaction('rw', ['_syncQueue', '_syncMeta'], async () => {
      suppressSyncInCurrentTransaction();
      await compactHeldQueue(await serverSyncTables(), rows);
    });
  } catch { /* The change is saved; the next sync cycle compacts its entries. */ }
}

/** The server's assigneeId refers to users; an agent deployment id stays on this device. */
function withoutAgentAssignee(table: string, data: Record<string, unknown> | undefined, agents: ReadonlySet<string>) {
  if (table !== 'tasks' || typeof data?.assigneeId !== 'string' || !agents.has(data.assigneeId)) return data;
  const copy = { ...data };
  delete copy.assigneeId;
  return copy;
}

/** The change push sends for one entity's queued entries (in queue order), with the
 * values it batches by. `held` says why push keeps it queued on this device instead;
 * `asset` sends it alone on the dedicated asset route. */
export function outgoingChange(entries: readonly SyncQueueEntry[], agents: ReadonlySet<string>, serverTables: ReadonlySet<string>) {
  const first = entries[0], last = entries[entries.length - 1];
  const change: SyncChange = { table: last.table, entityId: last.entityId, op: last.op,
    data: withoutAgentAssignee(last.table, outgoingSyncData(last.table, last.data), agents),
    clientVersion: validVersion(first.clientVersion) ? first.clientVersion : 0 };
  // An older team server refuses a whole upload that names a table it does not know.
  if (!serverTables.has(change.table)) return { change, nodes: 0, size: 0, asset: false, held: 'unsupported' as const };
  // A change the server or other clients would refuse stays queued, so it cannot hold back the rest.
  const nodes = syncDataNodes(change.data);
  const refusal = change.op !== 'put' ? null : nodes > MAX_SYNC_REQUEST_NODES ? 'limits' : outgoingRefusal(change.table, change.entityId, change.data);
  if (refusal) return { change, nodes, size: 0, asset: false, held: refusal };
  const size = encoder.encode(JSON.stringify(change)).byteLength + 1;
  const hasAsset = (change.table === 'whiteboards' && typeof change.data?.files === 'string')
    || (change.table === 'evidenceItems' && typeof change.data?.imageData === 'string');
  const asset = hasAsset && size + 128 <= MAX_ASSET_PUSH_BYTES && size + 128 > MAX_PUSH_BYTES;
  const held: HeldReason | null = !asset && size + 15 > MAX_PUSH_BYTES ? 'oversized' : null;
  return { change, nodes, size, asset, held };
}

/** Agent deployments exist only on this device; their ids are never server user ids. */
export async function agentDeploymentIds(): Promise<Set<string>> {
  return new Set((await db.table('agentDeployments').toCollection().primaryKeys()).map(String));
}

/** Short label for a message: the local title, name or value, else the item type, plus the investigation. */
export async function syncItemLabel(table: string, id: string, folderId?: unknown) {
  const row = await db.table(table).get(id);
  const text = [row?.title, row?.name, row?.value].find((value): value is string => typeof value === 'string' && value.trim() !== '');
  const folder = table === 'folders' ? undefined : typeof folderId === 'string' ? folderId : row?.folderId;
  const investigation = typeof folder === 'string' ? (await db.table('folders').get(folder))?.name : undefined;
  const item = text ? text.slice(0, 80) : i18n.t(`syncStatus.itemType.${table}`, { ns: 'common' });
  return typeof investigation === 'string' && investigation ? `${item} (${investigation})` : item;
}

/** Labels of the first few entities, for a message. */
export async function syncItemLabels(entries: readonly SyncQueueEntry[]): Promise<string> {
  const labels: string[] = [];
  for (const entry of entries.slice(0, 5)) labels.push(await syncItemLabel(entry.table, entry.entityId, entry.folderId));
  return labels.join(', ');
}

/** The selected entities whose latest queued operation is a put, split into puts push
 * keeps on this device (`held`) and puts it would upload (`unsent`). Call inside a
 * transaction that includes the queue, _syncMeta, the synced tables and agentDeployments. */
export async function queuedPuts(selected: (entry: SyncQueueEntry) => boolean) {
  const groups = new Map<string, SyncQueueEntry[]>();
  for (const entry of await db.table('_syncQueue').toArray() as SyncQueueEntry[]) {
    if (!isSyncTable(entry.table)) continue; // push never sends unsupported legacy work
    const key = JSON.stringify([entry.table, entry.entityId]);
    groups.set(key, [...(groups.get(key) ?? []), entry]);
  }
  const agents = await agentDeploymentIds();
  const serverTables = await serverSyncTables();
  const held: SyncQueueEntry[] = [], unsent: SyncQueueEntry[] = [];
  for (const entries of groups.values()) {
    const last = entries[entries.length - 1];
    if (last.op !== 'put' || !entries.some(selected)) continue;
    (outgoingChange(entries, agents, serverTables).held ? held : unsent).push(last);
  }
  return { held, unsent };
}
