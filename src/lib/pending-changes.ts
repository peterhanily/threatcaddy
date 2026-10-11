/**
 * One token per owner of unsaved work. Repeated edits and cleanup are
 * idempotent; one editor cannot clear another editor's outstanding write.
 * Tokens stay registered until persistence succeeds, including failed writes.
 */
const pending = new Set<symbol>();

/** A reversible refusal, distinct from persistence or lifecycle failures. */
export class PendingChangesError extends Error {
  constructor(message: string) { super(message); this.name = 'PendingChangesError'; }
}

export function markPending(owner: symbol) { pending.add(owner); }
export function clearPending(owner: symbol) { pending.delete(owner); }
export function hasPendingChanges() { return pending.size > 0; }

// Also covers launched-file handles waiting before App mounts or while locked.
if (typeof window !== 'undefined') window.addEventListener('beforeunload', event => {
  if (hasPendingChanges()) event.preventDefault();
});
