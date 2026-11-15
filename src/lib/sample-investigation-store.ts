import { db } from '../db';
import type { Folder } from '../types';
import type { SampleInvestigationKind } from './sample-investigation-realistic';
import { deleteEntitiesWithReferences } from './entity-relations';
import { getSessionGeneration, getSessionKey } from './encryptionMiddleware';
import { getEncryptionMeta, isEncryptionEnabled } from './encryptionStore';
import { integrationWrite } from './integration-cancellation';
import { clearPending, markPending } from './pending-changes';
import { cancellableRequest } from './request-cancellation';
import { getActiveWorkspaceId } from './workspace-profiles';

export type { SampleInvestigationKind } from './sample-investigation-realistic';
export const getSampleFolderId = (kind: SampleInvestigationKind) =>
  kind === 'realistic' ? 'sample-realistic-investigation' : 'sample-investigation';

export interface SampleInvestigationResult { folder: Folder; firstNoteId?: string; created: boolean }

function currentSession() {
  if (isEncryptionEnabled() && !getSessionKey()) throw new Error('Unlock the workspace before changing sample data.');
  const generation = getSessionGeneration();
  const workspaceId = getActiveWorkspaceId();
  const encryptionMetadata = JSON.stringify(getEncryptionMeta());
  return () => {
    if ((isEncryptionEnabled() && !getSessionKey()) || getSessionGeneration() !== generation
      || getActiveWorkspaceId() !== workspaceId || JSON.stringify(getEncryptionMeta()) !== encryptionMetadata) {
      throw new Error('The workspace session changed. Retry the sample action after unlocking.');
    }
  };
}

/** Load only on demand. One transaction serializes competing clicks/tabs and
 * never overwrites an existing case or an edited/moved sample record. */
export async function loadSampleInvestigation(kind: SampleInvestigationKind, signal?: AbortSignal): Promise<SampleInvestigationResult> {
  const request = cancellableRequest(signal);
  const pending = Symbol('load sample');
  markPending(pending);
  try {
    const assertSession = currentSession();
    request.signal.throwIfAborted();
    const data = kind === 'realistic'
      ? (await import('./sample-investigation-realistic')).generateRealisticInvestigation()
      : (await import('./sample-investigation')).generateSampleInvestigation();
    request.signal.throwIfAborted();
    assertSession();
    const tables = [db.folders, db.timelines, db.tags, db.notes, db.tasks, db.timelineEvents,
      db.standaloneIOCs, db.evidenceItems, db.noteTemplates, db.whiteboards, db.chatThreads];
    return await integrationWrite(tables, request.signal, async () => {
      assertSession();
      const existing = await db.folders.get(getSampleFolderId(kind));
      if (existing) {
        const candidates = await db.notes.where('folderId').equals(existing.id).filter(note => !note.trashed).toArray();
        assertSession();
        return { folder: existing, firstNoteId: candidates.find(note => note.id === data.notes[0]?.id)?.id ?? candidates[0]?.id, created: false };
      }
      const folder = { ...data.folder, localOnly: true };
      await db.folders.add(folder);
      // Global reusable templates/tags survive case removal; preserve any edits.
      for (const tag of data.tags) if (!await db.tags.get(tag.id)) await db.tags.add(tag);
      for (const template of data.noteTemplates) if (!await db.noteTemplates.get(template.id)) await db.noteTemplates.add(template);
      if (!await db.timelines.get(data.timeline.id)) await db.timelines.add(data.timeline);
      await db.notes.bulkAdd(data.notes);
      await db.tasks.bulkAdd(data.tasks);
      await db.timelineEvents.bulkAdd(data.timelineEvents);
      await db.standaloneIOCs.bulkAdd(data.standaloneIOCs);
      await db.evidenceItems.bulkAdd(data.evidenceItems);
      await db.whiteboards.add(data.whiteboard);
      await db.chatThreads.bulkAdd(data.chatThreads);
      assertSession();
      return { folder, firstNoteId: data.notes[0]?.id, created: true };
    });
  } finally {
    clearPending(pending);
    request.dispose();
  }
}

/** Delete the selected case's current contents and reverse references. Items
 * moved elsewhere and reusable global tags/templates remain user-owned. */
export async function deleteSampleInvestigation(kind: SampleInvestigationKind, signal?: AbortSignal): Promise<void> {
  const request = cancellableRequest(signal);
  try {
    const assertSession = currentSession();
    request.signal.throwIfAborted();
    const folderId = getSampleFolderId(kind);
    // The real folder cascade also removes user-created contents and agents.
    // Keep global timelines: another case or moved event may now use them.
    await deleteEntitiesWithReferences({ folders: [folderId] }, folderId, undefined, request.signal, assertSession);
  } finally { request.dispose(); }
}
