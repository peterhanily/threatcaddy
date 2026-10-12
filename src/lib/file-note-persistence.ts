import { db } from '../db';
import type { NotePersistence } from '../hooks/useNotes';
import { getSessionKey } from './encryptionMiddleware';
import { isEncryptionEnabled } from './encryptionStore';

/** Abort the actual write, not only the UI's awaiting promise. A resolved
 * persistence means committed and must never be retried as an unacknowledged file. */
export function fileNotePersistence(signal: AbortSignal): NotePersistence {
  return async note => {
    signal.throwIfAborted();
    if (isEncryptionEnabled() && !getSessionKey()) throw new Error('Unlock the workspace before importing a file.');
    let abort: (() => void) | undefined;
    try {
      await db.transaction('rw', db.notes, db.folders, async transaction => {
        abort = () => { try { transaction.abort(); } catch { /* Already completed. */ } };
        signal.addEventListener('abort', abort, { once: true });
        signal.throwIfAborted();
        if (note.folderId) {
          const folder = await db.folders.get(note.folderId);
          if (!folder) throw new Error('The destination investigation no longer exists. Reopen the file in an existing investigation.');
          // Startup React state can still be loading, or a peer may have
          // reclassified the folder. Resolve the current label in this write.
          note.clsLevel = folder.clsLevel;
        }
        signal.throwIfAborted();
        await db.notes.add(note);
        signal.throwIfAborted();
      });
    } finally { if (abort) signal.removeEventListener('abort', abort); }
  };
}
