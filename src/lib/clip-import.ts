import type Dexie from 'dexie';
import { nanoid } from 'nanoid';
import { db } from '../db';
import type { ActivityLogEntry, Folder, Note, Task, Timeline, TimelineEvent } from '../types';
import { getSessionKey, installEncryptionMiddleware } from './encryptionMiddleware';
import { isEncryptionEnabled } from './encryptionStore';
import { extractIOCs, mergeIOCAnalysis } from './ioc-extractor';
import { getCurrentUserName } from './utils';
import { installSyncOutbox } from './sync-outbox';
import { getActiveWorkspaceId, getWorkspaceDatabaseName } from './workspace-profiles';
import { CLIP_LIMITS, clipReceiptKey, failedClipResult, serializeClipContent, validateClip,
  validateClipContent, validateClipIdentifier, type ClipImportResult, type ClipReceipt,
  type ClipRevision } from './clip-protocol';

export interface ClipImportOptions {
  sourceId: string;
  workspaceId: string;
  enabledIOCTypes?: string[];
  defaultConfidence?: string;
  createdBy?: string;
  defaultTimelineId?: string;
  signal?: AbortSignal;
}

const STORES = ['folders', 'notes', 'tasks', 'timelineEvents', 'timelines', 'activityLog', '_clipReceipts'];
const ENTITY_STORES = { note: 'notes', task: 'tasks', 'timeline-event': 'timelineEvents' } as const;
class ClipImportError extends Error {}

function checkScope(connection: Dexie, options: ClipImportOptions): void {
  if (options.signal?.aborted) throw new ClipImportError('Clip import was cancelled. Retry from the selected workspace.');
  if (options.workspaceId !== getActiveWorkspaceId() || connection.name !== getWorkspaceDatabaseName()) {
    throw new ClipImportError('The selected workspace no longer matches this app. Prepare delivery again.');
  }
  if (isEncryptionEnabled() && !getSessionKey()) throw new ClipImportError('Unlock this workspace before importing clips.');
}

function storageError(error: unknown): string {
  if (error instanceof ClipImportError) return error.message;
  if (error instanceof Error && error.name === 'QuotaExceededError') return 'Storage is full. Free space and retry; this clip was not imported.';
  // Database diagnostics can contain record values. Do not send them back to the extension.
  return 'The clip could not be saved. No partial import was retained; retry after checking workspace storage.';
}

async function persistClip(connection: Dexie, clip: ClipRevision, options: ClipImportOptions): Promise<ClipImportResult> {
  checkScope(connection, options);
  const receiptKey = clipReceiptKey(options.sourceId, clip);
  let abortTransaction: (() => void) | undefined;
  const result = await connection.transaction('rw', STORES.map(name => connection.table(name)), async transaction => {
    abortTransaction = () => { try { transaction.abort(); } catch { /* Already committed/aborted. */ } };
    options.signal?.addEventListener('abort', abortTransaction, { once: true });
    checkScope(connection, options);
    const receipts = connection.table<ClipReceipt>('_clipReceipts');
    const prior = await receipts.get(receiptKey);
    if (prior) {
      if (prior.fingerprint !== clip.fingerprint) throw new ClipImportError('This clip revision was already imported with different content. Save a new revision before retrying.');
      if (prior.sourceId !== options.sourceId || prior.clipId !== clip.id || prior.revision !== clip.revision
        || prior.entityType !== clip.entityType || !prior.entityId) throw new ClipImportError('The stored clip receipt is inconsistent. Review this clip before retrying.');
      const existing = await connection.table<Note | Task | TimelineEvent>(ENTITY_STORES[prior.entityType]).get(prior.entityId);
      if (!existing) throw new ClipImportError('This clip was imported previously, but its saved item was removed. Save a new clip revision to import it again.');
      checkScope(connection, options);
      return { id: clip.id, revision: clip.revision, fingerprint: clip.fingerprint,
        status: 'duplicate' as const, entityType: prior.entityType, entityId: prior.entityId,
        folderId: existing.folderId };
    }

    const now = Date.now();
    const folderName = clip.folderName.trim() || 'Clips';
    const folders = connection.table<Folder>('folders');
    // Folder names may be encrypted at rest, so use decrypted rows, not the name index.
    const allFolders = await folders.toArray();
    let folder = allFolders.filter(item => item.name === folderName).sort((a, b) => a.order - b.order || a.id.localeCompare(b.id))[0];
    if (!folder) {
      folder = { id: nanoid(), name: folderName, order: allFolders.reduce((max, item) => Math.max(max, item.order), 0) + 1,
        createdAt: now, updatedAt: now, status: 'active' };
      await folders.add(folder);
    }
    checkScope(connection, options);
    const id = nanoid();
    const createdBy = options.createdBy ?? getCurrentUserName();
    const description = `*Clipped ${new Date(clip.createdAt).toLocaleString()}*\n\n${clip.content}`;
    const analysis = mergeIOCAnalysis(undefined, extractIOCs(clip.content, {
      enabledTypes: options.enabledIOCTypes, defaultConfidence: options.defaultConfidence,
    }));
    const shared = { id, folderId: folder.id, tags: [], trashed: false, archived: false,
      createdBy, createdAt: now, updatedAt: now, clsLevel: clip.clsLevel || folder.clsLevel,
      iocAnalysis: analysis, iocTypes: [...new Set(analysis.iocs.filter(ioc => !ioc.dismissed).map(ioc => ioc.type))] };
    if (clip.entityType === 'note') {
      const note: Note = { ...shared, title: clip.sourceUrl || clip.title || clip.content.substring(0, 80) || 'Clip',
        content: description, pinned: false, sourceUrl: clip.sourceUrl, sourceTitle: clip.sourceTitle, createdAt: clip.createdAt };
      await connection.table<Note>('notes').add(note);
    } else if (clip.entityType === 'task') {
      const tasks = connection.table<Task>('tasks');
      const last = await tasks.orderBy('order').last();
      const task: Task = { ...shared, title: clip.title || clip.content.substring(0, 80) || 'Clip Task',
        description, completed: false, status: 'todo', priority: 'none', order: Math.max(0, last?.order ?? 0) + 1 };
      await tasks.add(task);
    } else {
      const timelines = connection.table<Timeline>('timelines');
      let timeline = options.defaultTimelineId ? await timelines.get(options.defaultTimelineId) : undefined;
      if (!timeline && folder.timelineId) timeline = await timelines.get(folder.timelineId);
      if (!timeline) timeline = (await timelines.toArray()).sort((a, b) => a.order - b.order || a.id.localeCompare(b.id))[0];
      if (!timeline) {
        timeline = { id: nanoid(), name: 'Clips', order: 1, createdAt: now, updatedAt: now };
        await timelines.add(timeline);
      }
      const event: TimelineEvent = { ...shared, title: clip.title || clip.content.substring(0, 80) || 'Clip Event',
        description, timestamp: now, eventType: 'evidence', source: clip.sourceUrl || 'Extension clip',
        confidence: 'medium', timelineId: timeline.id, starred: false, linkedIOCIds: [], linkedNoteIds: [],
        linkedTaskIds: [], mitreAttackIds: [], assets: [] };
      await connection.table<TimelineEvent>('timelineEvents').add(event);
    }
    checkScope(connection, options);
    await connection.table<ActivityLogEntry>('activityLog').add({ id: nanoid(), action: 'create',
      category: clip.entityType === 'timeline-event' ? 'timeline' : clip.entityType,
      detail: `Imported extension clip as ${clip.entityType}`, itemId: id, timestamp: now });
    await receipts.add({ key: receiptKey, sourceId: options.sourceId, clipId: clip.id,
      revision: clip.revision, fingerprint: clip.fingerprint, entityType: clip.entityType,
      entityId: id, folderId: folder.id, committedAt: now });
    checkScope(connection, options);
    return { id: clip.id, revision: clip.revision, fingerprint: clip.fingerprint, status: 'imported' as const,
      entityType: clip.entityType, entityId: id, folderId: folder.id };
  }).finally(() => { if (abortTransaction) options.signal?.removeEventListener('abort', abortTransaction); });
  // The transaction promise resolves only after IndexedDB's durable commit event.
  return result;
}

/** Separate connections (tabs) serialize on the receipt store in the same write transaction. */
export function createClipImportService(connection: Dexie) {
  // Any secondary connection must retain the same encryption/outbox boundaries as the app DB.
  if (connection !== db && connection.name === getWorkspaceDatabaseName()) {
    installEncryptionMiddleware(connection);
    installSyncOutbox(connection);
  }
  return async (input: unknown, suppliedOptions: ClipImportOptions): Promise<ClipImportResult[]> => {
    const options = { ...suppliedOptions, enabledIOCTypes: suppliedOptions.enabledIOCTypes?.slice() };
    validateClipIdentifier(options.sourceId, 'Clip source');
    if (!Array.isArray(input) || input.length > CLIP_LIMITS.batchCount) throw new Error(`Clip delivery must contain at most ${CLIP_LIMITS.batchCount} clips.`);
    // Snapshot every row synchronously before hashing, so a caller cannot change a later row mid-import.
    let bytes = 2;
    const prepared = input.map(value => {
      try {
        const content = validateClipContent(value);
        const fingerprint = (value as Record<string, unknown>).fingerprint;
        const snapshot = { ...content, fingerprint };
        bytes += new TextEncoder().encode(serializeClipContent(content)).byteLength + 100;
        return { snapshot, failure: undefined };
      } catch (error) {
        return { snapshot: undefined, failure: failedClipResult(value, error instanceof Error ? error.message : 'Invalid clip.') };
      }
    });
    if (bytes > CLIP_LIMITS.batchBytes) throw new Error('Clip delivery exceeds the batch size limit. Send fewer clips.');
    const results: ClipImportResult[] = [];
    for (const item of prepared) {
      if (item.failure) { results.push(item.failure); continue; }
      try {
        checkScope(connection, options);
      } catch (error) {
        results.push(failedClipResult(item.snapshot, storageError(error)));
        continue;
      }
      let clip: ClipRevision;
      try { clip = await validateClip(item.snapshot); }
      catch (error) {
        results.push(failedClipResult(item.snapshot, error instanceof Error ? error.message : 'Invalid clip.'));
        continue;
      }
      try { results.push(await persistClip(connection, clip, options)); }
      catch (error) { results.push(failedClipResult(clip, storageError(error))); }
    }
    return results;
  };
}

export const importClipBatch = createClipImportService(db);
