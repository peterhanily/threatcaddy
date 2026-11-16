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
import { isSyncTable } from './sync-state';

export const MAX_PUSH_BYTES = 900_000; // Leave room beneath the server's 1 MiB body limit.
const MAX_ASSET_PUSH_BYTES = 15 * 1024 * 1024; // Dedicated 16 MiB sync route.
const encoder = new TextEncoder();
export const validVersion = (value: unknown): value is number => Number.isSafeInteger(value) && (value as number) >= 0;

export interface SyncQueueEntry extends SyncChange { seq?: number; folderId?: string }
/** 'oversized': too large for any upload request. */
export type HeldReason = OutgoingRefusal | 'oversized';

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
export function outgoingChange(entries: readonly SyncQueueEntry[], agents: ReadonlySet<string>) {
  const first = entries[0], last = entries[entries.length - 1];
  const change: SyncChange = { table: last.table, entityId: last.entityId, op: last.op,
    data: withoutAgentAssignee(last.table, outgoingSyncData(last.table, last.data), agents),
    clientVersion: validVersion(first.clientVersion) ? first.clientVersion : 0 };
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
 * transaction that includes the queue, the synced tables and agentDeployments. */
export async function queuedPuts(selected: (entry: SyncQueueEntry) => boolean) {
  const groups = new Map<string, SyncQueueEntry[]>();
  for (const entry of await db.table('_syncQueue').toArray() as SyncQueueEntry[]) {
    if (!isSyncTable(entry.table)) continue; // push never sends unsupported legacy work
    const key = JSON.stringify([entry.table, entry.entityId]);
    groups.set(key, [...(groups.get(key) ?? []), entry]);
  }
  const agents = await agentDeploymentIds();
  const held: SyncQueueEntry[] = [], unsent: SyncQueueEntry[] = [];
  for (const entries of groups.values()) {
    const last = entries[entries.length - 1];
    if (last.op !== 'put' || !entries.some(selected)) continue;
    (outgoingChange(entries, agents).held ? held : unsent).push(last);
  }
  return { held, unsent };
}
