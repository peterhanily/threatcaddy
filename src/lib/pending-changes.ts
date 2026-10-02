/**
 * One token per owner of unsaved work. Repeated edits and cleanup are
 * idempotent; one editor cannot clear another editor's outstanding write.
 * Tokens stay registered until persistence succeeds, including failed writes.
 */
const pending = new Set<symbol>();

export function markPending(owner: symbol) { pending.add(owner); }
export function clearPending(owner: symbol) { pending.delete(owner); }
export function hasPendingChanges() { return pending.size > 0; }
