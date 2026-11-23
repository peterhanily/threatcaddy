import Dexie from 'dexie';

export const SYNC_TABLES = ['notes', 'tasks', 'folders', 'tags', 'timelineEvents', 'timelines', 'whiteboards', 'standaloneIOCs', 'chatThreads', 'evidenceItems', 'identities'] as const;
export const isSyncTable = (name: string): boolean => (SYNC_TABLES as readonly string[]).includes(name);
/** The tables clients and servers synced before they began listing the tables they
 * support (2.0.4 and earlier). A server that lists none syncs only these, and a cursor
 * saved without a table list covers only these. Frozen: never add a table here. */
export const LEGACY_SYNC_TABLES: readonly string[] = ['notes', 'tasks', 'folders', 'tags', 'timelineEvents', 'timelines', 'whiteboards', 'standaloneIOCs', 'chatThreads', 'evidenceItems'];
export const revisionKey = (table: string, id: string): string => JSON.stringify(['revision', table, id]);

// Compatibility transport state only. Durable outbox capture must never depend
// on this flag: signed-out bound workspaces still record their local edits.
let enabled = false;
const localOnlyFolders = new Set<string>();
const suppressed = new WeakSet<object>();
const listeners = new Set<() => void>();

export function enableSync() { enabled = true; }
export function disableSync() { enabled = false; }
export function isSyncEnabled() { return enabled; }
export function markFolderLocalOnly(id: string, localOnly: boolean) {
  if (localOnly) localOnlyFolders.add(id);
  else localOnlyFolders.delete(id);
}
export function isLocalOnlyFolder(id: string) { return localOnlyFolders.has(id); }

/** Remote and maintenance writes suppress capture only in their own transaction. */
export function suppressSyncInCurrentTransaction() {
  const tx = Dexie.currentTransaction;
  if (!tx) throw new Error('Sync suppression requires a database transaction');
  suppressed.add(tx.idbtrans);
}
export function isSyncSuppressed(transaction: object) { return suppressed.has(transaction); }

/** Whether this sync session has completed a pull: until then, trash the server holds is not purged
 * (another device may have purged or restored it already; purging first only makes conflicts). */
let pulledThisSession = false;
const deferredTrashPurges = new Set<string>();
export function setSessionPulled(pulled: boolean) { pulledThisSession = pulled; }
export function hasPulledThisSession() { return pulledThisSession; }
/** A table whose expired trash waits for the first pull; the sync engine reloads it then. */
export function deferTrashPurge(table: string) { deferredTrashPurges.add(table); }
export function takeDeferredTrashPurges(): Set<string> {
  const tables = new Set(deferredTrashPurges);
  deferredTrashPurges.clear();
  return tables;
}

/** A change to several rows whose other rows' queued changes wait until one row's change is accepted. */
export interface SyncHold { after: { table: string; entityId: string }; restore: ReadonlyMap<string, unknown> }
const holds = new WeakMap<object, SyncHold>();
/**
 * Inside a write transaction: the changes queued in it for the rows in `restore` (ids) wait until
 * `table`/`entityId`'s queued change is accepted, each with its `restore` value kept (encrypted) for
 * undoing it. A merge uses it so its delete never reaches the server before the merged identity does.
 */
export function holdSyncUntilAccepted(table: string, entityId: string, restore: ReadonlyMap<string, unknown>) {
  const tx = Dexie.currentTransaction;
  if (!tx) throw new Error('A sync hold requires a database transaction');
  holds.set(tx.idbtrans, { after: { table, entityId }, restore });
}
export function syncHold(transaction: object): SyncHold | undefined { return holds.get(transaction); }
export function onOutboxCommit(listener: () => void) {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}
export function notifyOutboxCommit() {
  for (const listener of listeners) listener();
}
