import Dexie, { type EntityTable } from 'dexie';
import type { Note, Task, Folder, Tag, TimelineEvent, Timeline, Whiteboard, ActivityLogEntry, StandaloneIOC, EvidenceItem, ChatThread, NoteTemplate, PlaybookTemplate, Checkpoint, CustomSlashCommand, AgentAction, AgentProfile, AgentDeployment, AgentMeeting, EvidenceKind, EvidenceExtractionStatus } from './types';
import type { IntegrationTemplate, InstalledIntegration, IntegrationRun } from './types/integration-types';
import { getSessionKey, installEncryptionMiddleware } from './lib/encryptionMiddleware';
import { installSyncOutbox } from './lib/sync-outbox';
import { isEncryptionEnabled } from './lib/encryptionStore';
import { suppressSyncInCurrentTransaction } from './lib/sync-state';
import { getWorkspaceDatabaseName } from './lib/workspace-profiles';

const db = new Dexie(getWorkspaceDatabaseName()) as Dexie & {
  notes: EntityTable<Note, 'id'>;
  tasks: EntityTable<Task, 'id'>;
  folders: EntityTable<Folder, 'id'>;
  tags: EntityTable<Tag, 'id'>;
  timelineEvents: EntityTable<TimelineEvent, 'id'>;
  timelines: EntityTable<Timeline, 'id'>;
  whiteboards: EntityTable<Whiteboard, 'id'>;
  activityLog: EntityTable<ActivityLogEntry, 'id'>;
  standaloneIOCs: EntityTable<StandaloneIOC, 'id'>;
  evidenceItems: EntityTable<EvidenceItem, 'id'>;
  chatThreads: EntityTable<ChatThread, 'id'>;
  noteTemplates: EntityTable<NoteTemplate, 'id'>;
  playbookTemplates: EntityTable<PlaybookTemplate, 'id'>;
  integrationTemplates: EntityTable<IntegrationTemplate, 'id'>;
  installedIntegrations: EntityTable<InstalledIntegration, 'id'>;
  integrationRuns: EntityTable<IntegrationRun, 'id'>;
  checkpoints: EntityTable<Checkpoint, 'id'>;
  customSlashCommands: EntityTable<CustomSlashCommand, 'id'>;
  agentActions: EntityTable<AgentAction, 'id'>;
  agentProfiles: EntityTable<AgentProfile, 'id'>;
  agentDeployments: EntityTable<AgentDeployment, 'id'>;
  agentMeetings: EntityTable<AgentMeeting, 'id'>;
};

db.version(1).stores({
  notes: 'id, title, folderId, pinned, archived, trashed, createdAt, updatedAt, *tags',
  tasks: 'id, title, folderId, status, priority, completed, order, createdAt, updatedAt, *tags',
  folders: 'id, name, order',
  tags: 'id, name',
});

db.version(2).stores({
  notes: 'id, title, folderId, pinned, archived, trashed, createdAt, updatedAt, *tags, *iocTypes',
});

db.version(3).stores({
  tasks: 'id, title, folderId, status, priority, completed, order, createdAt, updatedAt, *tags, *iocTypes',
});

db.version(4).stores({
  timelineEvents: 'id, timestamp, eventType, source, starred, folderId, createdAt, updatedAt, *tags',
});

db.version(5).stores({
  timelines: 'id, name, order, createdAt',
  timelineEvents: 'id, timestamp, eventType, source, starred, folderId, timelineId, createdAt, updatedAt, *tags',
});

db.version(6).stores({
  whiteboards: 'id, name, folderId, order, createdAt, updatedAt, *tags',
});

db.version(7).stores({
  activityLog: 'id, category, action, timestamp',
});

db.version(8).stores({
  timelineEvents: 'id, timestamp, eventType, source, starred, folderId, timelineId, createdAt, updatedAt, *tags, *iocTypes',
});

// Version 9: entity linking fields (optional arrays, no index changes needed)
db.version(9).stores({});

// Version 10: clsLevel on notes, tasks, timeline events (optional, not indexed)
db.version(10).stores({});

// Version 11: Investigation metadata fields on folders (all optional, no index changes)
db.version(11).stores({});

// Version 12: Geolocation fields on timeline events (optional, not indexed)
db.version(12).stores({});

// Version 13: trash/archive for tasks, timeline events, whiteboards
db.version(13).stores({
  tasks: 'id, title, folderId, status, priority, completed, trashed, archived, order, createdAt, updatedAt, *tags, *iocTypes',
  timelineEvents: 'id, timestamp, eventType, source, starred, trashed, archived, folderId, timelineId, createdAt, updatedAt, *tags, *iocTypes',
  whiteboards: 'id, name, folderId, trashed, archived, order, createdAt, updatedAt, *tags',
});

// Version 14: standalone IOCs table
db.version(14).stores({
  standaloneIOCs: 'id, type, value, folderId, trashed, archived, createdAt, updatedAt, *tags',
});

// Version 15: Chat threads table
db.version(15).stores({
  chatThreads: 'id, title, folderId, trashed, archived, createdAt, updatedAt, *tags',
});

// Version 16: Team server sync support — createdBy indexes + sync tables
db.version(16).stores({
  notes: 'id, title, folderId, pinned, archived, trashed, createdAt, updatedAt, *tags, *iocTypes, createdBy',
  tasks: 'id, title, folderId, status, priority, completed, trashed, archived, order, createdAt, updatedAt, *tags, *iocTypes, createdBy',
  folders: 'id, name, order, createdBy',
  tags: 'id, name, createdBy',
  timelineEvents: 'id, timestamp, eventType, source, starred, trashed, archived, folderId, timelineId, createdAt, updatedAt, *tags, *iocTypes, createdBy',
  timelines: 'id, name, order, createdAt, createdBy',
  whiteboards: 'id, name, folderId, trashed, archived, order, createdAt, updatedAt, *tags, createdBy',
  standaloneIOCs: 'id, type, value, folderId, trashed, archived, createdAt, updatedAt, *tags, createdBy',
  chatThreads: 'id, title, folderId, trashed, archived, createdAt, updatedAt, *tags, createdBy',
  _syncQueue: '++seq, table, entityId, op',
  _syncMeta: 'key',
});

// Version 17: Task assignees
db.version(17).stores({
  tasks: 'id, title, folderId, status, priority, completed, trashed, archived, order, createdAt, updatedAt, *tags, *iocTypes, createdBy, assigneeId',
});

// Version 18: Note templates and playbook templates
db.version(18).stores({
  noteTemplates: 'id, name, category, source, createdAt, updatedAt',
  playbookTemplates: 'id, name, investigationType, source, createdAt, updatedAt',
});

// Version 19: Integration platform tables
db.version(19).stores({
  integrationTemplates: 'id, name, category, source, createdAt, updatedAt',
  installedIntegrations: 'id, templateId, enabled, createdAt, updatedAt',
  integrationRuns: 'id, integrationId, templateId, status, createdAt',
});

// Version 20: Composite indexes for common query patterns (performance)
db.version(20).stores({
  notes: 'id, title, folderId, pinned, archived, trashed, createdAt, updatedAt, *tags, *iocTypes, createdBy, [folderId+updatedAt]',
  tasks: 'id, title, folderId, status, priority, completed, trashed, archived, order, createdAt, updatedAt, *tags, *iocTypes, createdBy, assigneeId, [folderId+status], [folderId+updatedAt]',
  timelineEvents: 'id, timestamp, eventType, source, starred, trashed, archived, folderId, timelineId, createdAt, updatedAt, *tags, *iocTypes, createdBy, [folderId+timestamp]',
});

// Version 21: IOC assignee index
db.version(21).stores({
  standaloneIOCs: 'id, type, value, folderId, trashed, archived, createdAt, updatedAt, *tags, createdBy, assigneeId',
});

// Version 22: Checkpoints table for CaddyAI undo/restore
db.version(22).stores({
  checkpoints: 'id, threadId, messageId, createdAt',
});

// Version 23: Custom slash commands for CaddyAI
db.version(23).stores({
  customSlashCommands: 'id, name, createdAt',
});

// Version 24: CaddyAgent — agent actions approval queue
db.version(24).stores({
  agentActions: 'id, investigationId, threadId, status, createdAt, [investigationId+status], [investigationId+createdAt]',
});

// Version 25: Agent profiles, deployments, and meetings
db.version(25).stores({
  agentProfiles: 'id, name, role, source, createdAt',
  agentDeployments: 'id, investigationId, profileId, status, createdAt, [investigationId+status], [investigationId+order]',
  agentMeetings: 'id, investigationId, status, createdAt, [investigationId+createdAt]',
});

// Version 26: MultiEntry indexes for reverse-link lookups (eliminates N+1 on entity deletes)
db.version(26).stores({
  notes: 'id, title, folderId, pinned, archived, trashed, createdAt, updatedAt, *tags, *iocTypes, createdBy, [folderId+updatedAt], *linkedNoteIds, *linkedTaskIds, *linkedTimelineEventIds',
  tasks: 'id, title, folderId, status, priority, completed, trashed, archived, order, createdAt, updatedAt, *tags, *iocTypes, createdBy, assigneeId, [folderId+status], [folderId+updatedAt], *linkedNoteIds, *linkedTaskIds, *linkedTimelineEventIds',
  timelineEvents: 'id, timestamp, eventType, source, starred, trashed, archived, folderId, timelineId, createdAt, updatedAt, *tags, *iocTypes, createdBy, [folderId+timestamp], *linkedNoteIds, *linkedTaskIds',
});

// Version 27: Index parentNoteId for efficient nested note queries (eliminates full table scan)
db.version(27).stores({
  notes: 'id, title, folderId, pinned, archived, trashed, createdAt, updatedAt, *tags, *iocTypes, createdBy, [folderId+updatedAt], *linkedNoteIds, *linkedTaskIds, *linkedTimelineEventIds, parentNoteId',
});

// Version 28: Composite index on agentDeployments for ExecDashboard roll-ups
// that filter by running+active without loading the whole table.
db.version(28).stores({
  agentDeployments: 'id, investigationId, profileId, status, createdAt, [investigationId+status], [investigationId+order], [status+shift]',
});

// Version 29: first-class evidence repository.
// Older preview builds stored imported evidence as notes tagged with evidence/source:file.
// Promote those records into evidenceItems, but keep the original note records so
// migration never destroys analyst-authored data.
db.version(29).stores({
  evidenceItems: 'id, title, folderId, fileName, importedAt, createdAt, updatedAt, trashed, archived, *tags, [folderId+updatedAt]',
});

// Version 30: keep the notes-first evidence bridge non-destructive.
// Earlier handoff builds removed notes here; this migration only deduplicates
// evidenceItems where identity metadata is strong enough.
db.version(30).stores({
  evidenceItems: 'id, title, folderId, fileName, importedAt, createdAt, updatedAt, trashed, archived, *tags, [folderId+updatedAt]',
});

// Version 31 reruns the non-destructive cleanup for browsers that already
// reached the previous v30 bridge build.
db.version(31).stores({
  evidenceItems: 'id, title, folderId, fileName, importedAt, createdAt, updatedAt, trashed, archived, *tags, [folderId+updatedAt]',
});

// Version 32 is intentionally non-destructive. It restores ordinary analyst
// notes when possible but does not remove evidenceItems during migration.
db.version(32).stores({
  evidenceItems: 'id, title, folderId, fileName, importedAt, createdAt, updatedAt, trashed, archived, *tags, [folderId+updatedAt]',
});


/** Schema upgrades never inspect content or require an encryption key. */
db.version(33).stores({ _localMigrations: 'key' });

async function promoteLegacyEvidence(tx: Parameters<NonNullable<Parameters<ReturnType<typeof db.version>['upgrade']>[0]>>[0]) {
  const notesTable = tx.table('notes');
  const evidenceTable = tx.table('evidenceItems');
  const legacyNotes = await notesTable
    .filter((note: Partial<Note>) =>
      Array.isArray(note.tags) &&
      note.tags.includes('evidence') &&
      (note.tags.includes('source:file') || note.tags.some((tag) => tag.startsWith('extraction:'))),
    )
    .toArray();

  if (legacyNotes.length === 0) return;

  const now = Date.now();
  const evidenceItems: EvidenceItem[] = legacyNotes.map((note: Note) => {
    const fileName = note.sourceTitle || note.title.replace(/^Evidence -\s*/i, '').replace(/\s+\(\d+\s+of\s+\d+\)$/i, '');
    const extractionTag = note.tags.find((tag) => tag.startsWith('extraction:'));
    const extractionStatus = ((extractionTag?.slice('extraction:'.length) || 'partial') as EvidenceExtractionStatus);
    const fileTag = note.tags.find((tag) => tag.startsWith('file:'));
    const fileType = evidenceKindFromExtension(fileTag?.slice('file:'.length) || fileName);
    const partMatch = note.content.match(/\*\*Part:\*\*\s*(\d+)\s+of\s+(\d+)/i);

    return {
      id: note.id,
      title: note.title.replace(/^Evidence -\s*/i, ''),
      folderId: note.folderId,
      fileName,
      fileType,
      mimeType: undefined,
      size: 0,
      content: note.content,
      extractionStatus,
      importedAt: note.createdAt || now,
      chunkIndex: partMatch ? Number(partMatch[1]) || 1 : 1,
      chunkCount: partMatch ? Number(partMatch[2]) || 1 : 1,
      tags: note.tags.filter((tag) => tag !== 'evidence' && tag !== 'source:file'),
      clsLevel: note.clsLevel,
      linkedIOCIds: [],
      trashed: note.trashed,
      trashedAt: note.trashedAt,
      archived: note.archived,
      createdBy: note.createdBy,
      updatedBy: note.updatedBy,
      createdAt: note.createdAt || now,
      updatedAt: note.updatedAt || now,
    };
  });

  for (const item of evidenceItems) if (!(await evidenceTable.get(item.id))) await evidenceTable.add(item);
}

/** Content conversion is explicit, keyed, resumable and atomic after structural open. */
export async function runWorkspaceContentMigrations(): Promise<void> {
  if (isEncryptionEnabled() && !getSessionKey()) throw new Error('Unlock the workspace before converting stored content.');
  await db.transaction('rw', ['notes', 'tasks', 'timelineEvents', 'timelines', 'whiteboards', 'evidenceItems', '_localMigrations'], async tx => {
    suppressSyncInCurrentTransaction();
    const markers = tx.table('_localMigrations');
    if (await markers.get('content-v1')) return;
    for (const name of ['notes', 'tasks', 'timelineEvents']) {
      await tx.table(name).filter(row => !row.iocTypes).modify({ iocTypes: [] });
    }
    for (const name of ['tasks', 'timelineEvents', 'whiteboards']) {
      await tx.table(name).filter(row => row.trashed === undefined || row.archived === undefined)
        .modify(row => { row.trashed ??= false; row.archived ??= false; });
    }
    const unassigned = await tx.table('timelineEvents').filter(row => !row.timelineId).toArray();
    if (unassigned.length) {
      const timelines = tx.table('timelines');
      let timeline = await timelines.toCollection().first();
      if (!timeline) {
        timeline = { id: crypto.randomUUID(), name: 'Default', order: 0, createdAt: Date.now(), updatedAt: Date.now() };
        await timelines.add(timeline);
      }
      for (const event of unassigned) await tx.table('timelineEvents').update(event.id, { timelineId: timeline.id });
    }
    await promoteLegacyEvidence(tx);
    await cleanupEvidenceNoteCopies(tx);
    await restoreFalsePositiveEvidenceNotes(tx);
    await markers.add({ key: 'content-v1', completedAt: Date.now() });
  });
}

function evidenceKindFromExtension(value: string): EvidenceKind {
  const lower = value.toLowerCase();
  if (lower.endsWith('pdf')) return 'pdf';
  if (lower.endsWith('docx')) return 'docx';
  if (lower.endsWith('doc')) return 'doc';
  if (lower.endsWith('rtf') || lower.endsWith('rtfs')) return 'rtf';
  if (lower.endsWith('xlsx')) return 'xlsx';
  if (lower.endsWith('xls')) return 'xls';
  if (/\b(png|jpe?g|webp|gif|bmp|avif)\b/.test(lower)) return 'image';
  if (lower.endsWith('csv') || lower.endsWith('tsv')) return 'spreadsheet';
  if (/\b(txt|md|markdown|json|xml|yaml|yml|log)\b/.test(lower)) return 'text';
  return 'unknown';
}

interface EvidenceNoteCandidate extends Note {
  __fromEvidenceItem?: boolean;
  __fileName?: string;
  __chunkIndex?: number;
  __chunkCount?: number;
  __fileType?: EvidenceKind;
  __mimeType?: string;
  __size?: number;
  __lastModified?: number;
  __imageWidth?: number;
  __imageHeight?: number;
  __imageAspectRatio?: string;
  __imagePixelCount?: number;
  __imageData?: string;
  __imageDataMimeType?: string;
  __imageAnalysis?: string;
  __imageOcrText?: string;
  __extractionWarning?: string;
  __linkedIOCIds?: string[];
}

async function cleanupEvidenceNoteCopies(tx: Parameters<NonNullable<Parameters<ReturnType<typeof db.version>['upgrade']>[0]>>[0]): Promise<void> {
  const notesTable = tx.table('notes');
  const evidenceTable = tx.table('evidenceItems');

  const existingEvidenceNotes = await notesTable
    .filter((note: Partial<Note>) => isStoredEvidenceNote(note))
    .toArray() as EvidenceNoteCandidate[];
  const evidenceItems = await evidenceTable.toArray() as EvidenceItem[];
  if (existingEvidenceNotes.length === 0 && evidenceItems.length === 0) return;

  const existingNoteIds = new Set<string>();
  const existingItemIds = new Set(evidenceItems.map((item) => item.id));
  const candidates = [
    ...existingEvidenceNotes,
    ...evidenceItems.map(evidenceItemToNoteCandidate),
  ];
  const { itemsToPut, noteIdsToDelete, itemIdsToDelete } = combineEvidenceIntoItems(
    candidates,
    existingNoteIds,
    existingItemIds,
  );

  if (itemsToPut.length > 0) await evidenceTable.bulkPut(itemsToPut);
  void noteIdsToDelete;
  void itemIdsToDelete;
}

async function restoreFalsePositiveEvidenceNotes(tx: Parameters<NonNullable<Parameters<ReturnType<typeof db.version>['upgrade']>[0]>>[0]): Promise<void> {
  const notesTable = tx.table('notes');
  const evidenceTable = tx.table('evidenceItems');
  const evidenceItems = await evidenceTable.toArray() as EvidenceItem[];
  const falsePositiveItems = evidenceItems.filter(isFalsePositiveEvidenceNote);
  if (falsePositiveItems.length === 0) return;

  const notesToPut: Note[] = [];
  for (const item of falsePositiveItems) {
    const existingNote = await notesTable.get(item.id);
    if (existingNote) continue;
    notesToPut.push(evidenceItemToRecoveredNote(item));
  }

  if (notesToPut.length > 0) await notesTable.bulkPut(notesToPut);
  void falsePositiveItems;
}

function isStoredEvidenceNote(note: Partial<Note>): boolean {
  const tags = Array.isArray(note.tags) ? note.tags : [];
  const hasEvidenceFileTags = tags.includes('evidence') && tags.includes('source:file');
  const looksLikeImportedEvidence =
    typeof note.title === 'string' && /^Evidence\s*-/i.test(note.title) ||
    typeof note.content === 'string' && /^# Evidence:\s*.+$/m.test(note.content);

  return hasEvidenceFileTags && looksLikeImportedEvidence;
}

function isFalsePositiveEvidenceNote(item: EvidenceItem): boolean {
  if (item.size > 0 || item.mimeType || item.lastModified || item.chunkCount > 1 || item.chunkIndex > 1) return false;
  if (item.imageData || item.imageOcrText || item.imageAnalysis) return false;

  const metadata = extractEvidenceMetadata(item.content || '');
  const body = extractEvidenceBody(item.content || '').trim();
  const hasImportedEvidenceMetadata =
    /\*\*Imported:\*\*/i.test(metadata) ||
    /\*\*File type:\*\*/i.test(metadata) ||
    /\*\*Size:\*\*/i.test(metadata);
  if (hasImportedEvidenceMetadata) return false;

  return !body || /^No readable PDF text could be extracted/i.test(body) || /^No extracted text is available/i.test(body);
}

function evidenceItemToRecoveredNote(item: EvidenceItem): Note {
  return {
    id: item.id,
    title: item.title || item.fileName || 'Recovered Note',
    content: recoverNoteContentFromEvidenceItem(item),
    folderId: item.folderId,
    tags: recoverNoteTagsFromEvidenceItem(item.tags || []),
    pinned: false,
    archived: item.archived,
    trashed: item.trashed,
    trashedAt: item.trashedAt,
    clsLevel: item.clsLevel,
    iocTypes: [],
    linkedNoteIds: [],
    linkedTaskIds: [],
    linkedTimelineEventIds: [],
    createdBy: item.createdBy,
    updatedBy: item.updatedBy,
    createdAt: item.createdAt || item.importedAt || Date.now(),
    updatedAt: item.updatedAt || item.importedAt || Date.now(),
  };
}

function recoverNoteContentFromEvidenceItem(item: EvidenceItem): string {
  const fileName = item.fileName || item.title;
  const metadata = extractEvidenceMetadata(item.content || '');
  const lines = metadata
    .split('\n')
    .filter((line, index) => !(index === 0 && new RegExp(`^#\\s*Evidence:\\s*${escapeRegExp(fileName)}\\s*$`, 'i').test(line.trim())))
    .filter((line) => !/^\*\*Extraction:\*\*\s*metadata-only\s*$/i.test(line.trim()))
    .filter((line) => !/^\*\*Note:\*\*\s*No readable PDF text could be extracted/i.test(line.trim()));
  return lines.join('\n').trim() || item.title || 'Recovered note';
}

function recoverNoteTagsFromEvidenceItem(tags: string[]): string[] {
  return Array.from(new Set(tags.filter((tag) =>
    tag !== 'source:file' &&
    !tag.startsWith('extraction:') &&
    !tag.startsWith('file:')
  )));
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function evidenceItemToNoteCandidate(item: EvidenceItem): EvidenceNoteCandidate {
  const fileName = item.fileName || stripEvidenceTitle(item.title);
  const now = Date.now();
  return {
    id: item.id,
    title: normalizeEvidenceTitle(fileName),
    content: item.content,
    folderId: item.folderId,
    tags: normalizeEvidenceTags(item.tags, item.extractionStatus),
    pinned: false,
    archived: item.archived,
    trashed: item.trashed,
    trashedAt: item.trashedAt,
    sourceTitle: fileName,
    iocTypes: [],
    clsLevel: item.clsLevel,
    linkedNoteIds: [],
    linkedTaskIds: [],
    linkedTimelineEventIds: [],
    createdBy: item.createdBy,
    updatedBy: item.updatedBy,
    createdAt: item.createdAt || item.importedAt || now,
    updatedAt: item.updatedAt || item.importedAt || now,
    __fromEvidenceItem: true,
    __fileName: fileName,
    __chunkIndex: item.chunkIndex || 1,
    __chunkCount: item.chunkCount || 1,
    __fileType: item.fileType,
    __mimeType: item.mimeType,
    __size: item.size,
    __lastModified: item.lastModified,
    __imageWidth: item.imageWidth,
    __imageHeight: item.imageHeight,
    __imageAspectRatio: item.imageAspectRatio,
    __imagePixelCount: item.imagePixelCount,
    __imageData: item.imageData,
    __imageDataMimeType: item.imageDataMimeType,
    __imageAnalysis: item.imageAnalysis,
    __imageOcrText: item.imageOcrText,
    __extractionWarning: item.extractionWarning,
    __linkedIOCIds: item.linkedIOCIds,
  };
}

function combineEvidenceIntoItems(
  candidates: EvidenceNoteCandidate[],
  existingNoteIds: Set<string>,
  existingItemIds: Set<string>,
): { itemsToPut: EvidenceItem[]; noteIdsToDelete: string[]; itemIdsToDelete: string[] } {
  const groups = new Map<string, EvidenceNoteCandidate[]>();
  for (const candidate of candidates) {
    const fileName = getEvidenceFileName(candidate);
    const key = evidenceCandidateGroupKey(candidate, fileName);
    const group = groups.get(key) || [];
    group.push({ ...candidate, __fileName: fileName, ...getEvidencePart(candidate) });
    groups.set(key, group);
  }

  const itemsToPut: EvidenceItem[] = [];
  const noteIdsToDelete = new Set<string>();
  const itemIdsToDelete = new Set<string>();

  for (const group of groups.values()) {
    const sorted = group.sort((a, b) =>
      (a.__chunkIndex || 1) - (b.__chunkIndex || 1) ||
      (a.createdAt || 0) - (b.createdAt || 0)
    );
    const combinedNote = combineEvidenceGroup(sorted);
    const canonicalItem = sorted.find((note) => note.__fromEvidenceItem && existingItemIds.has(note.id));
    const item = evidenceGroupToItem(sorted, combinedNote, canonicalItem?.id || combinedNote.id);
    itemsToPut.push(item);

    for (const note of sorted) {
      if (!note.__fromEvidenceItem && existingNoteIds.has(note.id)) {
        noteIdsToDelete.add(note.id);
      }
      if (note.__fromEvidenceItem && existingItemIds.has(note.id) && note.id !== item.id) {
        itemIdsToDelete.add(note.id);
      }
    }
  }

  return {
    itemsToPut,
    noteIdsToDelete: Array.from(noteIdsToDelete),
    itemIdsToDelete: Array.from(itemIdsToDelete),
  };
}

function evidenceCandidateGroupKey(candidate: EvidenceNoteCandidate, fileName: string): string {
  const folderId = candidate.folderId || '';
  const normalizedName = fileName.toLowerCase();
  if (
    candidate.__fromEvidenceItem &&
    typeof candidate.__size === 'number' &&
    typeof candidate.__lastModified === 'number'
  ) {
    return [
      folderId,
      normalizedName,
      candidate.__size,
      candidate.__lastModified,
      candidate.__chunkCount || 1,
    ].join('::');
  }

  return [folderId, normalizedName, candidate.id].join('::');
}

function evidenceGroupToItem(group: EvidenceNoteCandidate[], combinedNote: Note, id: string): EvidenceItem {
  const fileName = getEvidenceFileName(combinedNote);
  const sourceItem = group.find((note) => note.__fromEvidenceItem);
  const extractionStatus = getBestExtractionStatus([combinedNote]);
  const timestamps = group.flatMap((note) => [note.createdAt, note.updatedAt]).filter((value) => typeof value === 'number');

  return {
    id,
    title: stripEvidenceTitle(combinedNote.title) || fileName,
    folderId: combinedNote.folderId,
    fileName,
    fileType: sourceItem?.__fileType || evidenceKindFromExtension(fileName),
    mimeType: sourceItem?.__mimeType,
    size: sourceItem?.__size || 0,
    lastModified: sourceItem?.__lastModified,
    imageWidth: sourceItem?.__imageWidth,
    imageHeight: sourceItem?.__imageHeight,
    imageAspectRatio: sourceItem?.__imageAspectRatio,
    imagePixelCount: sourceItem?.__imagePixelCount,
    imageData: sourceItem?.__imageData,
    imageDataMimeType: sourceItem?.__imageDataMimeType,
    imageAnalysis: sourceItem?.__imageAnalysis,
    imageOcrText: sourceItem?.__imageOcrText,
    content: combinedNote.content,
    extractionStatus,
    extractionWarning: sourceItem?.__extractionWarning,
    importedAt: combinedNote.createdAt || Date.now(),
    chunkIndex: 1,
    chunkCount: 1,
    tags: normalizeEvidenceTags(group.flatMap((note) => note.tags || []), extractionStatus),
    clsLevel: combinedNote.clsLevel,
    linkedIOCIds: Array.from(new Set(group.flatMap((note) => note.__linkedIOCIds || []))),
    trashed: group.every((note) => note.trashed),
    trashedAt: group.find((note) => note.trashedAt)?.trashedAt,
    archived: group.every((note) => note.archived),
    createdBy: combinedNote.createdBy,
    updatedBy: combinedNote.updatedBy,
    createdAt: Math.min(...timestamps, combinedNote.createdAt),
    updatedAt: Math.max(...timestamps, combinedNote.updatedAt),
  };
}

function combineEvidenceGroup(group: EvidenceNoteCandidate[]): Note {
  const canonical = group.find((note) => !note.__fromEvidenceItem) || group[0];
  const fileName = getEvidenceFileName(canonical);
  const metadata = normalizeEvidenceMetadata(extractEvidenceMetadata(group[0].content), fileName);
  const rawBody = dedupeEvidenceBodies(group.map((note) => extractEvidenceBody(note.content))).join('\n\n');
  const isPdf = /\.pdf$/i.test(fileName) || /\*\*File type:\*\*\s*PDF/i.test(metadata);
  const hasReadableBody = rawBody.trim() && (!isPdf || looksLikeReadableMigratedEvidenceText(rawBody));
  const body = hasReadableBody
    ? rawBody.trim()
    : 'No readable PDF text could be extracted. If this PDF is scanned or uses encoded fonts, import an OCR/text copy for AI analysis.';
  const finalMetadata = hasReadableBody ? metadata : markEvidenceMetadataUnreadable(metadata);
  const mergedTags = normalizeEvidenceTags(
    group.flatMap((note) => note.tags || []),
    hasReadableBody ? getBestExtractionStatus(group) : 'metadata-only',
  );
  const timestamps = group.flatMap((note) => [note.createdAt, note.updatedAt]).filter((value) => typeof value === 'number');

  return stripEvidenceCandidateFields({
    ...canonical,
    title: normalizeEvidenceTitle(fileName),
    content: `${finalMetadata}\n\n## Extracted Text\n\n${body}`,
    sourceTitle: fileName,
    tags: mergedTags,
    iocTypes: Array.from(new Set(group.flatMap((note) => note.iocTypes || []))),
    linkedNoteIds: Array.from(new Set(group.flatMap((note) => note.linkedNoteIds || []))),
    linkedTaskIds: Array.from(new Set(group.flatMap((note) => note.linkedTaskIds || []))),
    linkedTimelineEventIds: Array.from(new Set(group.flatMap((note) => note.linkedTimelineEventIds || []))),
    createdAt: Math.min(...timestamps, canonical.createdAt),
    updatedAt: Math.max(...timestamps, canonical.updatedAt),
  });
}

function stripEvidenceCandidateFields(note: EvidenceNoteCandidate): Note {
  const {
    __fromEvidenceItem,
    __fileName,
    __chunkIndex,
    __chunkCount,
    __fileType,
    __mimeType,
    __size,
    __lastModified,
    __imageWidth,
    __imageHeight,
    __imageAspectRatio,
    __imagePixelCount,
    __imageData,
    __imageDataMimeType,
    __imageAnalysis,
    __imageOcrText,
    __extractionWarning,
    __linkedIOCIds,
    ...clean
  } = note;
  void __fromEvidenceItem;
  void __fileName;
  void __chunkIndex;
  void __chunkCount;
  void __fileType;
  void __mimeType;
  void __size;
  void __lastModified;
  void __imageWidth;
  void __imageHeight;
  void __imageAspectRatio;
  void __imagePixelCount;
  void __imageData;
  void __imageDataMimeType;
  void __imageAnalysis;
  void __imageOcrText;
  void __extractionWarning;
  void __linkedIOCIds;
  return clean;
}

function getEvidenceFileName(note: EvidenceNoteCandidate): string {
  return (
    note.__fileName ||
    note.sourceTitle ||
    note.content.match(/^# Evidence:\s*(.+)$/m)?.[1] ||
    stripEvidenceTitle(note.title) ||
    note.id
  ).trim();
}

function stripEvidenceTitle(title: string): string {
  return title
    .replace(/^Evidence\s*-\s*/i, '')
    .replace(/\s+\(\d+\s+of\s+\d+\)$/i, '')
    .trim();
}

function normalizeEvidenceTitle(fileName: string): string {
  return `Evidence - ${fileName}`;
}

function getEvidencePart(note: EvidenceNoteCandidate): Partial<EvidenceNoteCandidate> {
  const contentPart = note.content.match(/\*\*Part:\*\*\s*(\d+)\s+of\s+(\d+)/i);
  const titlePart = note.title.match(/\((\d+)\s+of\s+(\d+)\)$/i);
  const part = contentPart || titlePart;
  return {
    __chunkIndex: part ? Number(part[1]) || 1 : note.__chunkIndex || 1,
    __chunkCount: part ? Number(part[2]) || 1 : note.__chunkCount || 1,
  };
}

function extractEvidenceMetadata(content: string): string {
  return (content.split(/\n## Extracted Text\b/i)[0] || content).trim();
}

function extractEvidenceBody(content: string): string {
  const parts = content.split(/\n## Extracted Text\b/i);
  if (parts.length < 2) return '';
  return parts.slice(1).join('\n## Extracted Text').trim();
}

function normalizeEvidenceMetadata(metadata: string, fileName: string): string {
  const lines = metadata
    .split('\n')
    .filter((line) => !/^\*\*Part:\*\*/i.test(line.trim()));
  if (!lines.some((line) => /^# Evidence:/i.test(line.trim()))) {
    lines.unshift(`# Evidence: ${fileName}`);
  }
  return lines.join('\n').trim();
}

function markEvidenceMetadataUnreadable(metadata: string): string {
  const lines = metadata.split('\n').filter((line) => !/^\*\*Note:\*\*/i.test(line.trim()));
  const extractionIndex = lines.findIndex((line) => /^\*\*Extraction:\*\*/i.test(line.trim()));
  if (extractionIndex >= 0) {
    lines[extractionIndex] = '**Extraction:** metadata-only';
  } else {
    lines.push('**Extraction:** metadata-only');
  }
  lines.push('**Note:** No readable PDF text could be extracted. If this PDF is scanned or uses encoded fonts, import an OCR/text copy for AI analysis.');
  return lines.join('\n').trim();
}

function dedupeEvidenceBodies(values: string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const value of values) {
    const trimmed = value.trim();
    if (!trimmed || /^No extracted text is available/i.test(trimmed)) continue;
    const key = trimmed.toLowerCase().replace(/\s+/g, ' ');
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(trimmed);
  }
  return result;
}

function normalizeEvidenceTags(tags: string[], status: EvidenceExtractionStatus): string[] {
  return Array.from(new Set([
    'evidence',
    'source:file',
    ...tags.filter((tag) => tag !== 'evidence' && tag !== 'source:file' && !tag.startsWith('extraction:')),
    `extraction:${status}`,
  ]));
}

function getBestExtractionStatus(group: EvidenceNoteCandidate[]): EvidenceExtractionStatus {
  const statuses = group.flatMap((note) => (note.tags || [])
    .filter((tag) => tag.startsWith('extraction:'))
    .map((tag) => tag.slice('extraction:'.length) as EvidenceExtractionStatus));
  if (statuses.includes('extracted')) return 'extracted';
  if (statuses.includes('partial')) return 'partial';
  return 'metadata-only';
}

function looksLikeReadableMigratedEvidenceText(value: string): boolean {
  const normalized = value.trim();
  if (!normalized) return false;

  const chars = Array.from(normalized);
  const readable = chars.filter((char) => /[\p{L}\p{N}\s.,;:!?()[\]{}'"@/#%&*+=_|<>$€£¥\\/\-–—]/u.test(char)).length;
  if (readable / chars.length < 0.9) return false;

  const words = normalized.toLowerCase().match(/[a-z][a-z'-]{1,}/g) || [];
  const iocLike = normalized.match(/\b(?:\d{1,3}\.){3}\d{1,3}\b|https?:\/\/|[a-z0-9.-]+\.[a-z]{2,}\b|\b[a-f0-9]{32,64}\b/gi)?.length || 0;
  if (chars.length > 120 && words.length < 8 && iocLike < 3) return false;

  const commonWords = new Set(['a', 'an', 'and', 'are', 'as', 'at', 'be', 'by', 'for', 'from', 'has', 'have', 'in', 'is', 'it', 'of', 'on', 'or', 'that', 'the', 'this', 'to', 'was', 'were', 'with']);
  const stopwordHits = words.filter((word) => commonWords.has(word)).length;
  const longWords = words.filter((word) => word.length >= 4).length;
  if (chars.length > 300 && stopwordHits < 3 && longWords < 20 && iocLike < 3) return false;

  const averageWordLength = words.length > 0
    ? words.reduce((sum, word) => sum + word.length, 0) / words.length
    : 0;
  return !(words.length >= 20 && averageWordLength > 14);
}

// Encryption-at-rest middleware (transparent to all CRUD hooks)
installEncryptionMiddleware(db);
installSyncOutbox(db);

export { db };
