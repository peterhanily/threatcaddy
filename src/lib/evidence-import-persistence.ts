import { nanoid } from 'nanoid';
import { db } from '../db';
import type { EvidenceItem } from '../types';
import type { EvidenceItemDraft } from './evidence-import';
import { getSessionGeneration, getSessionKey } from './encryptionMiddleware';
import { getEncryptionMeta, isEncryptionEnabled } from './encryptionStore';
import { getActiveWorkspaceId } from './workspace-profiles';
import { getCurrentUserName } from './utils';

/** Capture ownership before parsing. All drafts commit together through the
 * existing encryption/outbox middleware, or the transaction rolls back. */
export function createEvidenceImportPersistence({ folderId, signal, assertCurrentScope }: {
  folderId?: string;
  signal: AbortSignal;
  assertCurrentScope: () => void;
}): (drafts: EvidenceItemDraft[]) => Promise<EvidenceItem[]> {
  const workspace = getActiveWorkspaceId();
  const key = getSessionKey();
  const generation = getSessionGeneration();
  const metadata = JSON.stringify(getEncryptionMeta());
  const assertOwner = () => {
    signal.throwIfAborted();
    assertCurrentScope();
    const currentMetadata = getEncryptionMeta();
    if (workspace !== getActiveWorkspaceId() || key !== getSessionKey()
      || generation !== getSessionGeneration() || metadata !== JSON.stringify(currentMetadata)
      || (isEncryptionEnabled() && (!key || !currentMetadata || currentMetadata.transition))) {
      throw new Error('The workspace session changed. Unlock the workspace and import the files again.');
    }
  };
  assertOwner();

  return async drafts => {
    assertOwner();
    const now = Date.now();
    const createdBy = getCurrentUserName();
    const items: EvidenceItem[] = drafts.map(draft => ({
      ...draft, id: nanoid(), folderId, trashed: false, archived: false,
      createdAt: now, updatedAt: now, createdBy,
    }));
    let abort: (() => void) | undefined;
    try {
      await db.transaction('rw', db.evidenceItems, db.folders, async transaction => {
        abort = () => { try { transaction.abort(); } catch { /* Already settled. */ } };
        signal.addEventListener('abort', abort, { once: true });
        assertOwner();
        if (folderId) {
          const folder = await db.folders.get(folderId);
          if (!folder || folder.status === 'archived') {
            throw new Error('The destination investigation is no longer available. Select an active investigation and import again.');
          }
          // A peer may have reclassified the folder while the worker ran.
          for (const item of items) item.clsLevel = folder.clsLevel;
        }
        assertOwner();
        await db.evidenceItems.bulkAdd(items);
        // Crypto and durable outbox writes may yield; validate before commit.
        assertOwner();
      });
      // Once committed, a later cancellation must not report a failed import.
      return items;
    } finally {
      if (abort) signal.removeEventListener('abort', abort);
    }
  };
}
