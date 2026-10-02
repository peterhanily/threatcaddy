export type SessionRevocation = { userId: string; family?: string } | { all: true };
const listeners = new Set<(event: SessionRevocation) => void>();

export function onSessionRevocation(listener: (event: SessionRevocation) => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Publish only after the database transaction commits. */
export function notifySessionRevocation(event: SessionRevocation): void {
  for (const listener of listeners) listener(event);
}
