import { logger } from '../lib/logger.js';

export type SessionRevocation = { userId: string; family?: string } | { all: true };
type Listener = (event: SessionRevocation) => void | Promise<void>;
const listeners = new Set<Listener>();

export function onSessionRevocation(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Publish only after the database transaction commits. */
export function notifySessionRevocation(event: SessionRevocation): void {
  const failed = () => logger.error('A session revocation listener failed');
  for (const listener of listeners) {
    try { void Promise.resolve(listener(event)).catch(failed); }
    catch { failed(); }
  }
}
