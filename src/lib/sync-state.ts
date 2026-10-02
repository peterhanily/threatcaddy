import Dexie from 'dexie';

export const SYNC_TABLES = ['notes', 'tasks', 'folders', 'tags', 'timelineEvents', 'timelines', 'whiteboards', 'standaloneIOCs', 'chatThreads', 'evidenceItems'] as const;
export const isSyncTable = (name: string): boolean => (SYNC_TABLES as readonly string[]).includes(name);
export const revisionKey = (table: string, id: string): string => JSON.stringify(['revision', table, id]);

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
export function onOutboxCommit(listener: () => void) {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}
export function notifyOutboxCommit() {
  for (const listener of listeners) listener();
}
