import { nanoid } from 'nanoid';
import { db } from '../db';
import type { Folder } from '../types';
import type { SampleInvestigationKind } from './sample-investigation-realistic';
import { deleteEntitiesWithReferences, FOLDER_CONTENT_TABLES, TAGGED_TABLES } from './entity-relations';
import { getSessionGeneration, getSessionKey } from './encryptionMiddleware';
import { getEncryptionMeta, isEncryptionEnabled } from './encryptionStore';
import { integrationWrite } from './integration-cancellation';
import { clearPending, markPending } from './pending-changes';
import { cancellableRequest } from './request-cancellation';
import { getActiveWorkspaceId } from './workspace-profiles';

export type { SampleInvestigationKind } from './sample-investigation-realistic';
export const getSampleFolderId = (kind: SampleInvestigationKind) =>
  kind === 'realistic' ? 'sample-realistic-investigation' : 'sample-investigation';

/** Records seeded by one demo. Anything else in its case was added by the user. */
export function isSampleEntityForKind(id: string, kind: SampleInvestigationKind): boolean {
  return kind === 'realistic'
    ? id.startsWith('sample-realistic-')
    : id.startsWith('sample-') && !id.startsWith('sample-realistic-');
}

/** `code` selects the translated message; `message` stays English for logs. */
export class SampleActionError extends Error {
  readonly code: 'locked' | 'sessionChanged';
  constructor(code: 'locked' | 'sessionChanged', message: string) {
    super(message);
    this.name = 'SampleActionError';
    this.code = code;
  }
}

export interface SampleInvestigationResult { folder: Folder; firstNoteId?: string; created: boolean }

function currentSession() {
  if (isEncryptionEnabled() && !getSessionKey()) throw new SampleActionError('locked', 'Unlock the workspace before changing sample data.');
  const generation = getSessionGeneration();
  const workspaceId = getActiveWorkspaceId();
  const encryptionMetadata = JSON.stringify(getEncryptionMeta());
  return () => {
    if ((isEncryptionEnabled() && !getSessionKey()) || getSessionGeneration() !== generation
      || getActiveWorkspaceId() !== workspaceId || JSON.stringify(getEncryptionMeta()) !== encryptionMetadata) {
      throw new SampleActionError('sessionChanged', 'The workspace session changed. Retry the sample action after unlocking.');
    }
  };
}

const generateSample = async (kind: SampleInvestigationKind) => kind === 'realistic'
  ? (await import('./sample-investigation-realistic')).generateRealisticInvestigation()
  : (await import('./sample-investigation')).generateSampleInvestigation();

/** Rows whose seeded id survives elsewhere (moved, imported) are left where they are. */
async function absent<T extends { id: string }>(table: { bulkGet(keys: string[]): Promise<(T | undefined)[]> }, rows: T[]): Promise<T[]> {
  const existing = await table.bulkGet(rows.map(row => row.id));
  return rows.filter((_, i) => !existing[i]);
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
    const data = await generateSample(kind);
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
      // Tags are referenced by name: never add a second row for a name the user already has.
      const tagNames = new Set((await db.tags.toArray()).map(tag => tag.name.toLowerCase()));
      for (const tag of data.tags) if (!tagNames.has(tag.name.toLowerCase()) && !await db.tags.get(tag.id)) await db.tags.add(tag);
      for (const template of data.noteTemplates) if (!await db.noteTemplates.get(template.id)) await db.noteTemplates.add(template);
      if (!await db.timelines.get(data.timeline.id)) await db.timelines.add(data.timeline);
      const notes = await absent(db.notes, data.notes);
      await db.notes.bulkAdd(notes);
      await db.tasks.bulkAdd(await absent(db.tasks, data.tasks));
      await db.timelineEvents.bulkAdd(await absent(db.timelineEvents, data.timelineEvents));
      await db.standaloneIOCs.bulkAdd(await absent(db.standaloneIOCs, data.standaloneIOCs));
      await db.evidenceItems.bulkAdd(await absent(db.evidenceItems, data.evidenceItems));
      await db.whiteboards.bulkAdd(await absent(db.whiteboards, [data.whiteboard]));
      await db.chatThreads.bulkAdd(await absent(db.chatThreads, data.chatThreads));
      assertSession();
      return { folder, firstNoteId: notes[0]?.id, created: true };
    });
  } finally {
    clearPending(pending);
    request.dispose();
  }
}

interface SampleSeed { createdAt: number; updatedAt: Map<string, number> }
async function sampleSeed(kind: SampleInvestigationKind): Promise<SampleSeed> {
  const data = await generateSample(kind);
  const rows = [...data.notes, ...data.tasks, ...data.timelineEvents, ...data.standaloneIOCs, ...data.evidenceItems,
    data.whiteboard, ...data.chatThreads];
  return { createdAt: data.folder.createdAt, updatedAt: new Map(rows.map(row => [row.id, row.updatedAt])) };
}

/** Items the user added to a demo case, and seeded items they changed: every
 * edit stamps updatedAt, while seeded stamps are fixed (realistic) or relative
 * to loading (parody), so shift the fresh seed onto the stored case. */
async function userItemIds(kind: SampleInvestigationKind, seed: SampleSeed): Promise<Record<string, string[]>> {
  const folderId = getSampleFolderId(kind);
  const shift = ((await db.folders.get(folderId))?.createdAt ?? seed.createdAt) - seed.createdAt;
  const ids: Record<string, string[]> = {};
  for (const name of FOLDER_CONTENT_TABLES) {
    const rows: Array<{ id: string; updatedAt?: number }> = await db.table(name).where('folderId').equals(folderId).toArray();
    ids[name] = rows.filter(row => !isSampleEntityForKind(row.id, kind)
      || row.updatedAt !== (seed.updatedAt.get(row.id) ?? NaN) + shift).map(row => row.id);
  }
  return ids;
}

/** What a removal confirmation must name: the case and how many items the user added or changed in it. */
export async function getSampleRemovalSummary(kind: SampleInvestigationKind): Promise<{ name: string; userItems: number } | undefined> {
  const assertSession = currentSession();
  const seed = await sampleSeed(kind);
  return db.transaction('r', [db.folders, ...FOLDER_CONTENT_TABLES.map(name => db.table(name))], async () => {
    const folder = await db.folders.get(getSampleFolderId(kind));
    if (!folder) return undefined;
    const userItems = Object.values(await userItemIds(kind, seed)).reduce((total, ids) => total + ids.length, 0);
    assertSession();
    return { name: folder.name, userItems };
  });
}

/** Delete the selected case's current contents and reverse references. Items
 * moved elsewhere and reusable templates remain user-owned. With
 * `keepUserItemsIn`, items the user added or changed first move to a new
 * local-only case of that name. Demo tags and timelines go once nothing uses them. */
export async function deleteSampleInvestigation(kind: SampleInvestigationKind, signal?: AbortSignal,
  options: { keepUserItemsIn?: string } = {}): Promise<{ keptFolder?: Folder }> {
  const request = cancellableRequest(signal);
  try {
    const assertSession = currentSession();
    request.signal.throwIfAborted();
    const folderId = getSampleFolderId(kind);
    const name = options.keepUserItemsIn;
    const seed = name === undefined ? undefined : await sampleSeed(kind);
    request.signal.throwIfAborted();
    let keptFolder: Folder | undefined;
    // Kept items move in the cascade's own transaction, behind its draft barrier,
    // so a refused or failed removal moves nothing.
    const keepUserItems = seed && name !== undefined ? async () => {
      const sample = await db.folders.get(folderId);
      const items = await userItemIds(kind, seed);
      if (!sample || !Object.values(items).some(ids => ids.length)) return;
      const now = Date.now();
      const order = (await db.folders.toArray()).reduce((max, folder) => Math.max(max, folder.order), 0) + 1;
      // The sample case never synced; keep the user's items just as private.
      const folder: Folder = { id: nanoid(), name, order, status: 'active', localOnly: true, createdAt: now, updatedAt: now,
        ...(sample.clsLevel ? { clsLevel: sample.clsLevel } : {}), ...(sample.papLevel ? { papLevel: sample.papLevel } : {}) };
      await db.folders.add(folder);
      for (const [table, ids] of Object.entries(items)) {
        if (ids.length) await db.table(table).where(':id').anyOf(ids).modify({ folderId: folder.id, updatedAt: now });
      }
      // Agents work on behalf of the user's case, not the seeded demo records.
      for (const table of ['agentActions', 'agentDeployments', 'agentMeetings']) {
        await db.table(table).where('investigationId').equals(folderId).modify({ investigationId: folder.id });
      }
      keptFolder = folder;
    } : undefined;
    // The real folder cascade also removes user-created contents and agents.
    await deleteEntitiesWithReferences({ folders: [folderId] }, folderId, undefined, request.signal, assertSession, keepUserItems);
    await integrationWrite([db.tags, db.timelines, ...TAGGED_TABLES.map(table => db.table(table))], request.signal, async () => {
      assertSession();
      const tags = await db.tags.filter(tag => isSampleEntityForKind(tag.id, kind)).toArray();
      if (tags.length) {
        // Records reference tags by name; keep any demo tag a remaining record still uses.
        const usedTags = new Set<string>();
        for (const table of TAGGED_TABLES) {
          for (const row of await db.table(table).toArray()) for (const tag of row.tags ?? []) usedTags.add(tag);
        }
        await db.tags.bulkDelete(tags.filter(tag => !usedTags.has(tag.name)).map(tag => tag.id));
      }
      // Never delete a timeline still holding events: deleting it elsewhere deletes them too.
      for (const timeline of await db.timelines.filter(timeline => isSampleEntityForKind(timeline.id, kind)).toArray()) {
        if (await db.timelineEvents.where('timelineId').equals(timeline.id).count()) continue;
        if (await db.folders.filter(folder => folder.timelineId === timeline.id).count()) continue;
        await db.timelines.delete(timeline.id);
      }
      assertSession();
    });
    return { keptFolder };
  } finally { request.dispose(); }
}
