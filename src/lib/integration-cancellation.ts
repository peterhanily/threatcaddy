import type { Table, Transaction } from 'dexie';

/** Stop waiting even when a token provider or an older transport ignores abort. */
export function awaitIntegrationResult<T>(result: Promise<T>, signal: AbortSignal): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const abort = () => reject(signal.reason);
    if (signal.aborted) abort();
    else signal.addEventListener('abort', abort, { once: true });
    result.then(resolve, reject).finally(() => signal.removeEventListener('abort', abort));
  });
}

export function integrationDelay(ms: number, signal?: AbortSignal): Promise<void> {
  signal?.throwIfAborted();
  return new Promise((resolve, reject) => {
    const abort = () => { clearTimeout(timer); reject(signal?.reason); };
    const timer = setTimeout(() => { signal?.removeEventListener('abort', abort); resolve(); }, ms);
    signal?.addEventListener('abort', abort, { once: true });
  });
}

/** Only wrap known IndexedDB writes, never network calls or arbitrary UI callbacks. */
export async function integrationWrite<T>(tables: Table[], signal: AbortSignal | undefined, write: () => Promise<T>): Promise<T> {
  signal?.throwIfAborted();
  let active: Transaction | undefined;
  const abort = () => {
    if (!active?.active) return;
    try { active.abort(); }
    catch (error) {
      // Native commit can precede Dexie's completion bookkeeping. It is too
      // late to abort then; the resolved transaction remains acknowledged.
      if (!(error && typeof error === 'object' && 'name' in error && error.name === 'InvalidStateError')) throw error;
    }
  };
  signal?.addEventListener('abort', abort, { once: true });
  try {
    const result = await tables[0].db.transaction('rw', tables, async transaction => {
      active = transaction;
      signal?.throwIfAborted();
      const result = await write();
      signal?.throwIfAborted();
      return result;
    });
    // The transaction has committed. A later abort can stop subsequent work,
    // but cannot turn this acknowledgement into a rollback or failed write.
    return result;
  } finally {
    signal?.removeEventListener('abort', abort);
  }
}
