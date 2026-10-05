import { db } from '../db';
import type { Note, NoteTemplate } from '../types';
import { getEffectiveClsLevels } from './classification';
import { getSessionKey } from './encryptionMiddleware';
import { getEncryptionMeta, isEncryptionEnabled } from './encryptionStore';
import {
  prepareProductComposerNote, PRODUCT_COMPOSER_LIMITS, ProductComposerValidationError,
  type ProductComposerSnapshot,
} from './product-composer';
import { getActiveWorkspaceId, workspaceStorageKey } from './workspace-profiles';

type ProductInput = Parameters<typeof prepareProductComposerNote>[0];
type SourceKey = Exclude<keyof ProductComposerSnapshot, 'folder'>;
const sourceKeys: SourceKey[] = ['notes', 'tasks', 'timelineEvents', 'iocs', 'evidence'];

function changed(message: string): never {
  throw new ProductComposerValidationError('selection', message);
}

function persistedClassificationLevels(): readonly string[] {
  try {
    const raw = localStorage.getItem(workspaceStorageKey('threatcaddy-settings'));
    const settings: unknown = raw ? JSON.parse(raw) : {};
    if (!settings || typeof settings !== 'object' || Array.isArray(settings)) throw new Error();
    const levels = (settings as { tiClsLevels?: unknown }).tiClsLevels;
    if (levels !== undefined && (!Array.isArray(levels)
      || levels.some(level => typeof level !== 'string' || !level.trim())
      || new Set(levels).size !== levels.length)) throw new Error();
    return getEffectiveClsLevels(levels as string[] | undefined);
  } catch {
    return changed('Classification settings could not be verified. Review the workspace settings before saving.');
  }
}

/**
 * Prepare a one-owner persistence boundary for the ordinary note-creation hook.
 * Every source read and the new note insert share one read/write transaction,
 * so another tab cannot reclassify a source between validation and commit.
 * Existing encryption and sync-outbox middleware remain on the write path.
 */
export function createProductComposerPersistence({ input, originSnapshot, originBaseline, effectiveLevels, assertCurrentScope }: {
  input: ProductInput;
  originSnapshot: ProductComposerSnapshot;
  originBaseline?: NoteTemplate;
  effectiveLevels: readonly string[];
  /** Synchronous: throw when the mounted composer no longer owns this save. */
  assertCurrentScope: () => void;
}): (note: Note) => Promise<void> {
  const draft = { ...input };
  const levels = [...effectiveLevels];
  // Retain the floor of the text actually offered to the analyst. A later
  // downgrade/declassification must not weaken already-staged source material.
  const patch = prepareProductComposerNote(draft, originSnapshot, originBaseline, levels);
  const folderId = originSnapshot.folder.id;
  const originIds = Object.fromEntries(sourceKeys.map(key => [key, originSnapshot[key].map(row => row.id)])) as Record<SourceKey, string[]>;
  const workspaceId = getActiveWorkspaceId();
  const sessionKey = getSessionKey();
  const encryptionMetadata = JSON.stringify(getEncryptionMeta());
  const hierarchy = JSON.stringify(levels);

  const assertOwner = () => {
    assertCurrentScope();
    const currentMetadata = getEncryptionMeta();
    if (getActiveWorkspaceId() !== workspaceId || getSessionKey() !== sessionKey
      || JSON.stringify(currentMetadata) !== encryptionMetadata
      || (isEncryptionEnabled() && (!sessionKey || !currentMetadata || currentMetadata.transition))) {
      changed('The workspace session changed. Unlock the workspace and review the draft before saving.');
    }
    if (JSON.stringify(persistedClassificationLevels()) !== hierarchy) {
      changed('Classification settings changed. Review the draft before saving.');
    }
  };
  assertOwner();

  return async note => {
    assertOwner();
    if (note.title !== patch.title || note.content !== patch.content || note.folderId !== folderId
      || note.clsLevel !== patch.clsLevel || JSON.stringify(note.tags) !== JSON.stringify(patch.tags)) {
      changed('The draft changed before it could be saved. Review the draft and try again.');
    }
    await db.transaction('rw', [db.notes, db.tasks, db.timelineEvents, db.standaloneIOCs,
      db.evidenceItems, db.folders, db.noteTemplates], async () => {
      assertOwner();
      const folder = await db.folders.get(folderId);
      if (!folder || folder.status === 'archived') {
        changed('The investigation is no longer available for composing. Review the draft before saving.');
      }
      const baseline = draft.baselineId ? await db.noteTemplates.get(draft.baselineId) : undefined;
      if (draft.baselineId && !baseline?.productBaseline) {
        changed('The selected baseline is no longer available. Review the draft before saving.');
      }
      // Bound the active result set of each investigation-indexed read (the
      // cursor may still examine inactive rows). The shared validator also
      // enforces the combined/embedded-IOC budget.
      const maximum = PRODUCT_COMPOSER_LIMITS.sourceItems + 1;
      const active = <T extends { archived: boolean; trashed: boolean }>(row: T) => !row.archived && !row.trashed;
      const [notes, tasks, timelineEvents, iocs, evidence] = await Promise.all([
        db.notes.where('folderId').equals(folderId).filter(row => active(row) && !row.tags.includes('product')).limit(maximum).toArray(),
        db.tasks.where('folderId').equals(folderId).filter(active).limit(maximum).toArray(),
        db.timelineEvents.where('folderId').equals(folderId).filter(active).limit(maximum).toArray(),
        db.standaloneIOCs.where('folderId').equals(folderId).filter(active).limit(maximum).toArray(),
        db.evidenceItems.where('folderId').equals(folderId).filter(active).limit(maximum).toArray(),
      ]);
      const current: ProductComposerSnapshot = { folder, notes, tasks, timelineEvents, iocs, evidence };
      // Includes newly added sources and current embedded indicator labels,
      // not just the cached React rows or the items explicitly staged so far.
      // Check the budget before interpreting any bounded result as complete.
      prepareProductComposerNote(draft, current, baseline, levels);
      for (const key of sourceKeys) {
        const available = new Set(current[key].map(row => row.id));
        if (originIds[key].some(id => !available.has(id))) {
          changed('A source was deleted, moved, or made unavailable. Review the draft and source selection before saving.');
        }
      }
      assertOwner();
      await db.notes.add(note);
      // Web Crypto/outbox writes may yield. Abort the whole transaction if the
      // composer lost ownership during the insert; never publish phantom UI state.
      assertOwner();
    });
  };
}
