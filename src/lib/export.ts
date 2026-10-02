import { db } from '../db';
import type { Note, Task, Folder, Tag, TimelineEvent, Timeline, Whiteboard, StandaloneIOC, EvidenceItem, ChatThread, ChatMessage, NoteTemplate, PlaybookTemplate, PlaybookStep, ExportData, TimelineExportData, TimelineEventType, ConfidenceLevel, IOCAnalysis, IOCEntry, IOCRelationship, TaskComment, NoteAnnotation, QuickLink, LLMProvider, IOCType, TemplateSource, PlaybookStepEntity, AgentAction, EvidenceExtractionStatus, EvidenceKind, ProductBaselineAsset, ProductBaselineMetadata, ProductBaselineSourceDocument, ProductBaselineTestFixture } from '../types';
import { TIMELINE_EVENT_TYPE_LABELS, CONFIDENCE_LEVELS, IOC_TYPE_LABELS } from '../types';
import { nanoid } from 'nanoid';
import { workspaceStorageKey } from './workspace-profiles';
import { ENTITY_RELATIONS, mapEntityReferences, type EntityRecord } from './entity-relations';
import { withEntityDraftBarrier } from './entity-drafts';

export async function exportJSON(): Promise<string> {
  // Load tables sequentially to reduce peak memory usage (avoids loading
  // all 15 tables into memory simultaneously on large datasets).
  const allNotes = collapseEvidenceNoteSeries(await db.notes.toArray());
  const notes = allNotes.filter((note) => !isBackupEvidenceNote(note));
  const tasks = await db.tasks.toArray();
  const folders = await db.folders.toArray();
  const tags = await db.tags.toArray();
  const timelineEvents = await db.timelineEvents.toArray();
  const timelines = await db.timelines.toArray();
  const whiteboards = await db.whiteboards.toArray();
  const standaloneIOCs = await db.standaloneIOCs.toArray();
  const evidenceItems = mergeEvidenceItemLists(await db.evidenceItems.toArray(), evidenceItemsFromNotes(allNotes));
  const chatThreads = await db.chatThreads.toArray();
  const noteTemplates = await db.noteTemplates.toArray();
  const playbookTemplates = await db.playbookTemplates.toArray();
  const agentActions = await db.agentActions.toArray();
  const agentProfiles = await db.agentProfiles.toArray();
  const agentDeployments = await db.agentDeployments.toArray();
  const agentMeetings = await db.agentMeetings.toArray();

  // Include quick links from settings if user has customized them
  let quickLinks: QuickLink[] | undefined;
  try {
    const stored = localStorage.getItem(workspaceStorageKey('threatcaddy-settings'));
    if (stored) {
      const s = JSON.parse(stored);
      if (Array.isArray(s.quickLinks)) quickLinks = s.quickLinks;
    }
  } catch { /* ignore */ }

  const data: ExportData = {
    version: 1,
    exportedAt: Date.now(),
    notes,
    tasks,
    folders,
    tags,
    timelineEvents,
    timelines,
    whiteboards,
    standaloneIOCs,
    evidenceItems: evidenceItems.length > 0 ? evidenceItems : undefined,
    chatThreads,
    agentActions: agentActions.length > 0 ? agentActions : undefined,
    agentProfiles: agentProfiles.length > 0 ? agentProfiles : undefined,
    agentDeployments: agentDeployments.length > 0 ? agentDeployments : undefined,
    agentMeetings: agentMeetings.length > 0 ? agentMeetings : undefined,
    quickLinks,
    noteTemplates: noteTemplates.length > 0 ? noteTemplates : undefined,
    playbookTemplates: playbookTemplates.length > 0 ? playbookTemplates : undefined,
  };

  return JSON.stringify(data, null, 2);
}

const MAX_IMPORT_SIZE = 50 * 1024 * 1024; // 50 MB
const MAX_ITEMS = 100_000;

/** Max string length for imported fields (matches server sync-service 500KB cap). */
const MAX_IMPORT_STRING = 500_000;
const MAX_IMPORT_IMAGE_DATA = 4_250_000;
export const MAX_WHITEBOARD_FILES_BYTES = 8 * 1024 * 1024;
const VALID_RASTER_IMAGE_MIME_TYPES = new Set([
  'image/png',
  'image/jpeg',
  'image/webp',
  'image/gif',
  'image/bmp',
  'image/avif',
]);
function str(v: unknown, fallback = ''): string {
  return typeof v === 'string' ? v.substring(0, MAX_IMPORT_STRING) : fallback;
}
function boundedStr(v: unknown, max: number): string | undefined {
  return typeof v === 'string' && v.length <= max ? v : undefined;
}
function rasterImageMime(v: unknown): string | undefined {
  if (typeof v !== 'string') return undefined;
  const mimeType = v.toLowerCase().trim();
  return VALID_RASTER_IMAGE_MIME_TYPES.has(mimeType) ? mimeType : undefined;
}
function num(v: unknown, fallback = 0): number {
  return typeof v === 'number' && isFinite(v) ? v : fallback;
}
function bool(v: unknown, fallback = false): boolean {
  return typeof v === 'boolean' ? v : fallback;
}
function strArr(v: unknown): string[] {
  return Array.isArray(v) ? v.filter((s): s is string => typeof s === 'string') : [];
}
function provenance(r: Record<string, unknown>): { createdBy?: string; updatedBy?: string } {
  return {
    createdBy: typeof r.createdBy === 'string' ? str(r.createdBy) : undefined,
    updatedBy: typeof r.updatedBy === 'string' ? str(r.updatedBy) : undefined,
  };
}

const VALID_IOC_TYPES = Object.keys(IOC_TYPE_LABELS) as string[];

function sanitizeIOCRelationship(raw: unknown): IOCRelationship | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  if (typeof r.targetIOCId !== 'string' || typeof r.relationshipType !== 'string') return null;
  return { targetIOCId: str(r.targetIOCId), relationshipType: str(r.relationshipType) };
}

function sanitizeIOCEntry(raw: unknown): IOCEntry | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const type = str(r.type);
  if (!VALID_IOC_TYPES.includes(type)) return null;
  return {
    id: str(r.id),
    type: type as IOCEntry['type'],
    value: str(r.value),
    confidence: (VALID_CONFIDENCE.includes(str(r.confidence)) ? str(r.confidence) : 'low') as ConfidenceLevel,
    analystNotes: r.analystNotes != null ? str(r.analystNotes) : undefined,
    attribution: r.attribution != null ? str(r.attribution) : undefined,
    firstSeen: num(r.firstSeen, Date.now()),
    dismissed: bool(r.dismissed),
    iocSubtype: r.iocSubtype != null ? str(r.iocSubtype) : undefined,
    iocStatus: r.iocStatus != null ? str(r.iocStatus) : undefined,
    clsLevel: r.clsLevel != null ? str(r.clsLevel) : undefined,
    // Preserved for backward-compat import of legacy exports; deprecated in favor of relationships[]
    relatedId: r.relatedId != null ? str(r.relatedId) : undefined,
    relationshipType: r.relationshipType != null ? str(r.relationshipType) : undefined,
    relationships: Array.isArray(r.relationships)
      ? (r.relationships as unknown[]).map(sanitizeIOCRelationship).filter((rel): rel is IOCRelationship => rel !== null)
      : undefined,
    enrichment: sanitizeStandaloneIOCEnrichment(r.enrichment, num(r.firstSeen, Date.now())),
  };
}

function sanitizeIOCAnalysis(raw: unknown): IOCAnalysis | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const r = raw as Record<string, unknown>;
  const iocs = Array.isArray(r.iocs)
    ? r.iocs.map(sanitizeIOCEntry).filter((e): e is IOCEntry => e !== null)
    : [];
  return {
    extractedAt: num(r.extractedAt, Date.now()),
    iocs,
    analysisSummary: r.analysisSummary != null ? str(r.analysisSummary) : undefined,
    lastPushedAt: r.lastPushedAt != null ? num(r.lastPushedAt) : undefined,
  };
}

function sanitizeComment(raw: unknown): TaskComment | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  if (typeof r.id !== 'string' || typeof r.text !== 'string') return null;
  return {
    id: str(r.id),
    text: str(r.text),
    createdAt: num(r.createdAt, Date.now()),
  };
}

function sanitizeAnnotation(raw: unknown): NoteAnnotation | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  if (typeof r.id !== 'string' || typeof r.text !== 'string') return null;
  return {
    id: str(r.id),
    text: str(r.text),
    createdAt: num(r.createdAt, Date.now()),
  };
}

export function sanitizeNote(raw: unknown): Note | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  return {
    ...provenance(r),
    id: str(r.id),
    title: str(r.title),
    content: str(r.content),
    folderId: r.folderId != null ? str(r.folderId) : undefined,
    tags: strArr(r.tags),
    pinned: bool(r.pinned),
    archived: bool(r.archived),
    trashed: bool(r.trashed),
    trashedAt: r.trashedAt != null ? num(r.trashedAt) : undefined,
    sourceUrl: r.sourceUrl != null ? str(r.sourceUrl) : undefined,
    sourceTitle: r.sourceTitle != null ? str(r.sourceTitle) : undefined,
    color: r.color != null ? str(r.color) : undefined,
    iocAnalysis: sanitizeIOCAnalysis(r.iocAnalysis),
    iocTypes: Array.isArray(r.iocTypes) ? strArr(r.iocTypes).filter((t) => VALID_IOC_TYPES.includes(t)) as Note['iocTypes'] : undefined,
    parentNoteId: r.parentNoteId != null ? str(r.parentNoteId) : undefined,
    isFolder: r.isFolder === true ? true : undefined,
    reviewRequired: r.reviewRequired === true ? true : undefined,
    clsLevel: r.clsLevel != null ? str(r.clsLevel) : undefined,
    linkedNoteIds: Array.isArray(r.linkedNoteIds) ? strArr(r.linkedNoteIds) : undefined,
    linkedTaskIds: Array.isArray(r.linkedTaskIds) ? strArr(r.linkedTaskIds) : undefined,
    linkedTimelineEventIds: Array.isArray(r.linkedTimelineEventIds) ? strArr(r.linkedTimelineEventIds) : undefined,
    annotations: Array.isArray(r.annotations)
      ? (r.annotations as unknown[]).map(sanitizeAnnotation).filter((a): a is NoteAnnotation => a !== null)
      : undefined,
    createdAt: num(r.createdAt, Date.now()),
    updatedAt: num(r.updatedAt, Date.now()),
  };
}

export function sanitizeTask(raw: unknown): Task | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  return {
    ...provenance(r),
    id: str(r.id),
    title: str(r.title),
    description: r.description != null ? str(r.description) : undefined,
    completed: bool(r.completed),
    priority: (['none', 'low', 'medium', 'high'].includes(str(r.priority)) ? str(r.priority) : 'none') as Task['priority'],
    dueDate: r.dueDate != null ? str(r.dueDate) : undefined,
    folderId: r.folderId != null ? str(r.folderId) : undefined,
    tags: strArr(r.tags),
    status: (['todo', 'in-progress', 'done'].includes(str(r.status)) ? str(r.status) : 'todo') as Task['status'],
    order: num(r.order),
    iocAnalysis: sanitizeIOCAnalysis(r.iocAnalysis),
    iocTypes: Array.isArray(r.iocTypes) ? strArr(r.iocTypes).filter((t) => VALID_IOC_TYPES.includes(t)) as Task['iocTypes'] : undefined,
    comments: Array.isArray(r.comments)
      ? (r.comments as unknown[]).map(sanitizeComment).filter((c): c is TaskComment => c !== null)
      : undefined,
    clsLevel: r.clsLevel != null ? str(r.clsLevel) : undefined,
    linkedNoteIds: Array.isArray(r.linkedNoteIds) ? strArr(r.linkedNoteIds) : undefined,
    linkedTaskIds: Array.isArray(r.linkedTaskIds) ? strArr(r.linkedTaskIds) : undefined,
    linkedTimelineEventIds: Array.isArray(r.linkedTimelineEventIds) ? strArr(r.linkedTimelineEventIds) : undefined,
    createdAt: num(r.createdAt, Date.now()),
    updatedAt: num(r.updatedAt, Date.now()),
    trashed: bool(r.trashed),
    trashedAt: r.trashedAt != null ? num(r.trashedAt) : undefined,
    archived: bool(r.archived),
    completedAt: r.completedAt != null ? num(r.completedAt) : undefined,
    assigneeId: r.assigneeId != null ? str(r.assigneeId) : undefined,
    rejectionCount: r.rejectionCount != null ? num(r.rejectionCount) : undefined,
    rejectionHistory: Array.isArray(r.rejectionHistory)
      ? (r.rejectionHistory as unknown[]).map((rh) => {
          if (!rh || typeof rh !== 'object') return null;
          const h = rh as Record<string, unknown>;
          const quality = str(h.quality);
          if (quality !== 'needs-redo' && quality !== 'serious-failure') return null;
          return {
            at: num(h.at, Date.now()),
            byAgentId: h.byAgentId != null ? str(h.byAgentId) : undefined,
            quality: quality as 'needs-redo' | 'serious-failure',
            reason: str(h.reason),
            requestedDelta: str(h.requestedDelta),
          };
        }).filter((x): x is NonNullable<typeof x> => x !== null)
      : undefined,
    escalated: r.escalated === true ? true : undefined,
  };
}

const VALID_INVESTIGATION_STATUS = ['active', 'closed', 'archived'];
const VALID_CLOSURE_RESOLUTIONS = ['resolved', 'false-positive', 'escalated', 'duplicate', 'inconclusive'];
const VALID_EVIDENCE_KINDS: EvidenceKind[] = ['pdf', 'docx', 'doc', 'rtf', 'xlsx', 'xls', 'image', 'text', 'spreadsheet', 'unknown'];
const VALID_EVIDENCE_STATUSES: EvidenceExtractionStatus[] = ['extracted', 'partial', 'metadata-only'];

export function sanitizeFolder(raw: unknown): Folder | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  return {
    ...provenance(r),
    localOnly: r.localOnly === true ? true : undefined,
    agentEnabled: typeof r.agentEnabled === 'boolean' ? r.agentEnabled : undefined,
    agentPolicy: r.agentPolicy && typeof r.agentPolicy === 'object' && !Array.isArray(r.agentPolicy) ? r.agentPolicy as Folder['agentPolicy'] : undefined,
    agentThreadId: typeof r.agentThreadId === 'string' ? str(r.agentThreadId) : undefined,
    agentLastRunAt: typeof r.agentLastRunAt === 'number' ? num(r.agentLastRunAt) : undefined,
    agentStatus: ['idle', 'running', 'waiting', 'paused', 'error'].includes(str(r.agentStatus)) ? str(r.agentStatus) as Folder['agentStatus'] : undefined,
    playbookExecution: r.playbookExecution && typeof r.playbookExecution === 'object' && !Array.isArray(r.playbookExecution) ? r.playbookExecution as Folder['playbookExecution'] : undefined,
    id: str(r.id),
    name: str(r.name),
    icon: r.icon != null ? str(r.icon) : undefined,
    color: r.color != null ? str(r.color) : undefined,
    order: num(r.order),
    createdAt: num(r.createdAt, Date.now()),
    description: r.description != null ? str(r.description) : undefined,
    status: r.status != null && VALID_INVESTIGATION_STATUS.includes(str(r.status))
      ? str(r.status) as Folder['status']
      : undefined,
    clsLevel: r.clsLevel != null ? str(r.clsLevel) : undefined,
    papLevel: r.papLevel != null ? str(r.papLevel) : undefined,
    updatedAt: r.updatedAt != null ? num(r.updatedAt) : undefined,
    tags: Array.isArray(r.tags) ? strArr(r.tags) : undefined,
    noteTemplateIds: Array.isArray(r.noteTemplateIds) ? strArr(r.noteTemplateIds) : undefined,
    timelineId: r.timelineId != null ? str(r.timelineId) : undefined,
    closureResolution: r.closureResolution != null && VALID_CLOSURE_RESOLUTIONS.includes(str(r.closureResolution))
      ? str(r.closureResolution) as Folder['closureResolution']
      : undefined,
    closedReason: r.closedReason != null ? str(r.closedReason) : undefined,
    closedAt: r.closedAt != null ? num(r.closedAt) : undefined,
  };
}

export function sanitizeTag(raw: unknown): Tag | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  return {
    ...provenance(r),
    id: str(r.id),
    name: str(r.name),
    color: str(r.color, '#6366f1'),
  };
}

const VALID_EVENT_TYPES = Object.keys(TIMELINE_EVENT_TYPE_LABELS) as string[];
const VALID_CONFIDENCE = Object.keys(CONFIDENCE_LEVELS) as string[];

export function sanitizeTimelineEvent(raw: unknown): TimelineEvent | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  return {
    ...provenance(r),
    id: str(r.id),
    timestamp: num(r.timestamp, Date.now()),
    timestampEnd: r.timestampEnd != null ? num(r.timestampEnd) : undefined,
    title: str(r.title),
    description: r.description != null ? str(r.description) : undefined,
    eventType: (VALID_EVENT_TYPES.includes(str(r.eventType)) ? str(r.eventType) : 'other') as TimelineEventType,
    source: str(r.source),
    confidence: (VALID_CONFIDENCE.includes(str(r.confidence)) ? str(r.confidence) : 'low') as ConfidenceLevel,
    linkedIOCIds: strArr(r.linkedIOCIds),
    linkedNoteIds: strArr(r.linkedNoteIds),
    linkedTaskIds: strArr(r.linkedTaskIds),
    mitreAttackIds: strArr(r.mitreAttackIds),
    actor: r.actor != null ? str(r.actor) : undefined,
    assets: strArr(r.assets),
    tags: strArr(r.tags),
    rawData: r.rawData != null ? str(r.rawData) : undefined,
    starred: bool(r.starred),
    folderId: r.folderId != null ? str(r.folderId) : undefined,
    timelineId: str(r.timelineId),
    clsLevel: r.clsLevel != null ? str(r.clsLevel) : undefined,
    iocAnalysis: sanitizeIOCAnalysis(r.iocAnalysis),
    iocTypes: Array.isArray(r.iocTypes) ? strArr(r.iocTypes).filter((t) => VALID_IOC_TYPES.includes(t)) as TimelineEvent['iocTypes'] : undefined,
    latitude: typeof r.latitude === 'number' && isFinite(r.latitude) && r.latitude >= -90 && r.latitude <= 90 ? r.latitude : undefined,
    longitude: typeof r.longitude === 'number' && isFinite(r.longitude) && r.longitude >= -180 && r.longitude <= 180 ? r.longitude : undefined,
    comments: Array.isArray(r.comments) ? (r.comments as unknown[]).map(sanitizeComment).filter((c): c is TaskComment => c !== null) as unknown as TimelineEvent['comments'] : undefined,
    trashed: bool(r.trashed),
    trashedAt: r.trashedAt != null ? num(r.trashedAt) : undefined,
    archived: bool(r.archived),
    createdAt: num(r.createdAt, Date.now()),
    updatedAt: num(r.updatedAt, Date.now()),
  };
}

export function sanitizeTimeline(raw: unknown): Timeline | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  return {
    id: str(r.id),
    name: str(r.name),
    description: r.description != null ? str(r.description) : undefined,
    color: r.color != null ? str(r.color) : undefined,
    order: num(r.order),
    createdAt: num(r.createdAt, Date.now()),
    updatedAt: num(r.updatedAt, Date.now()),
  };
}

export function sanitizeWhiteboard(raw: unknown): Whiteboard | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  return {
    ...provenance(r),
    id: str(r.id),
    name: str(r.name),
    elements: whiteboardJSON(r.elements ?? '[]', 'elements', MAX_IMPORT_STRING, true),
    appState: r.appState != null ? whiteboardJSON(r.appState, 'appState', MAX_IMPORT_STRING) : undefined,
    files: r.files != null ? whiteboardJSON(r.files, 'files', MAX_WHITEBOARD_FILES_BYTES) : undefined,
    folderId: r.folderId != null ? str(r.folderId) : undefined,
    tags: strArr(r.tags),
    clsLevel: r.clsLevel != null ? str(r.clsLevel) : undefined,
    trashed: bool(r.trashed),
    trashedAt: r.trashedAt != null ? num(r.trashedAt) : undefined,
    archived: bool(r.archived),
    order: num(r.order),
    createdAt: num(r.createdAt, Date.now()),
    updatedAt: num(r.updatedAt, Date.now()),
  };
}

function whiteboardJSON(value: unknown, field: string, limit: number, array = false): string {
  if (typeof value !== 'string' || new TextEncoder().encode(value).byteLength > limit) {
    throw new Error(`Whiteboard ${field} exceeds its supported size or is not serialized JSON; nothing was imported.`);
  }
  let parsed: unknown;
  try { parsed = JSON.parse(value); } catch { throw new Error(`Whiteboard ${field} contains invalid JSON.`); }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed) !== array) throw new Error(`Whiteboard ${field} has an invalid JSON shape.`);
  return value;
}

const VALID_LLM_PROVIDERS = ['anthropic', 'openai', 'gemini', 'mistral', 'local'];

export function sanitizeStandaloneIOC(raw: unknown): StandaloneIOC | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const type = str(r.type);
  if (!VALID_IOC_TYPES.includes(type)) return null;
  return {
    id: str(r.id),
    type: type as IOCType,
    value: str(r.value),
    confidence: (VALID_CONFIDENCE.includes(str(r.confidence)) ? str(r.confidence) : 'low') as ConfidenceLevel,
    analystNotes: r.analystNotes != null ? str(r.analystNotes) : undefined,
    attribution: r.attribution != null ? str(r.attribution) : undefined,
    iocSubtype: r.iocSubtype != null ? str(r.iocSubtype) : undefined,
    iocStatus: r.iocStatus != null ? str(r.iocStatus) : undefined,
    clsLevel: r.clsLevel != null ? str(r.clsLevel) : undefined,
    folderId: r.folderId != null ? str(r.folderId) : undefined,
    tags: strArr(r.tags),
    relationships: Array.isArray(r.relationships)
      ? (r.relationships as unknown[]).map(sanitizeIOCRelationship).filter((rel): rel is IOCRelationship => rel !== null)
      : undefined,
    linkedNoteIds: Array.isArray(r.linkedNoteIds) ? strArr(r.linkedNoteIds) : undefined,
    linkedTaskIds: Array.isArray(r.linkedTaskIds) ? strArr(r.linkedTaskIds) : undefined,
    linkedTimelineEventIds: Array.isArray(r.linkedTimelineEventIds) ? strArr(r.linkedTimelineEventIds) : undefined,
    linkedEvidenceIds: Array.isArray(r.linkedEvidenceIds) ? strArr(r.linkedEvidenceIds) : undefined,
    comments: Array.isArray(r.comments) ? (r.comments as unknown[]).map(sanitizeComment).filter((c): c is TaskComment => c !== null) as unknown as StandaloneIOC['comments'] : undefined,
    enrichment: sanitizeStandaloneIOCEnrichment(r.enrichment, num(r.updatedAt, Date.now())),
    firstSeen: r.firstSeen != null ? num(r.firstSeen) : undefined,
    lastSeen: r.lastSeen != null ? num(r.lastSeen) : undefined,
    assigneeId: r.assigneeId != null ? str(r.assigneeId) : undefined,
    assigneeName: r.assigneeName != null ? str(r.assigneeName) : undefined,
    trashed: bool(r.trashed),
    trashedAt: r.trashedAt != null ? num(r.trashedAt) : undefined,
    archived: bool(r.archived),
    createdAt: num(r.createdAt, Date.now()),
    updatedAt: num(r.updatedAt, Date.now()),
  };
}

function sanitizeStandaloneIOCEnrichment(raw: unknown, timestamp: number): StandaloneIOC['enrichment'] | undefined {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return undefined;
  const enrichment: Record<string, Array<Record<string, unknown>>> = {};

  for (const [source, value] of Object.entries(raw as Record<string, unknown>).slice(0, 25)) {
    const sourceKey = str(source);
    if (!sourceKey) continue;
    const records = Array.isArray(value) ? value : [value];
    const sanitizedRecords = records
      .map((record) => sanitizeStandaloneIOCEnrichmentRecord(record, timestamp))
      .filter((record): record is Record<string, unknown> => record !== null)
      .slice(0, 25);
    if (sanitizedRecords.length > 0) enrichment[sourceKey] = sanitizedRecords;
  }

  return Object.keys(enrichment).length > 0 ? enrichment : undefined;
}

function sanitizeStandaloneIOCEnrichmentRecord(raw: unknown, timestamp: number): Record<string, unknown> | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const record: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(raw as Record<string, unknown>).slice(0, 100)) {
    if (typeof value === 'string') {
      if (value.length > MAX_IMPORT_STRING) throw new Error('IOC provenance exceeds the supported import size; keep the original export.');
      record[key] = value;
    }
    else if (typeof value === 'number' && isFinite(value)) record[key] = value;
    else if (typeof value === 'boolean') record[key] = value;
    else if (value == null) record[key] = value;
  }

  return {
    ...record,
    ts: typeof record.ts === 'number' ? record.ts : timestamp,
    source: typeof record.source === 'string' ? record.source : 'import',
  };
}

export function sanitizeEvidenceItem(raw: unknown): EvidenceItem | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const fileType = str(r.fileType, 'unknown');
  const extractionStatus = str(r.extractionStatus, 'metadata-only');
  const imageData = boundedStr(r.imageData, MAX_IMPORT_IMAGE_DATA);
  const imageDataMimeType = rasterImageMime(r.imageDataMimeType);
  return {
    id: str(r.id),
    title: str(r.title),
    folderId: r.folderId != null ? str(r.folderId) : undefined,
    fileName: str(r.fileName, str(r.title, 'unknown')),
    fileType: (VALID_EVIDENCE_KINDS.includes(fileType as EvidenceKind) ? fileType : 'unknown') as EvidenceKind,
    mimeType: r.mimeType != null ? str(r.mimeType) : undefined,
    size: num(r.size),
    lastModified: r.lastModified != null ? num(r.lastModified) : undefined,
    imageWidth: r.imageWidth != null ? num(r.imageWidth) : undefined,
    imageHeight: r.imageHeight != null ? num(r.imageHeight) : undefined,
    imageAspectRatio: r.imageAspectRatio != null ? str(r.imageAspectRatio) : undefined,
    imagePixelCount: r.imagePixelCount != null ? num(r.imagePixelCount) : undefined,
    imageData: imageData && imageDataMimeType && /^[A-Za-z0-9+/]+={0,2}$/.test(imageData) ? imageData : undefined,
    imageDataMimeType: imageData && imageDataMimeType ? imageDataMimeType : undefined,
    imageAnalysis: r.imageAnalysis != null ? str(r.imageAnalysis) : undefined,
    imageOcrText: r.imageOcrText != null ? str(r.imageOcrText) : undefined,
    content: str(r.content),
    extractionStatus: (VALID_EVIDENCE_STATUSES.includes(extractionStatus as EvidenceExtractionStatus) ? extractionStatus : 'metadata-only') as EvidenceExtractionStatus,
    extractionWarning: r.extractionWarning != null ? str(r.extractionWarning) : undefined,
    importedAt: num(r.importedAt, num(r.createdAt, Date.now())),
    chunkIndex: num(r.chunkIndex, 1),
    chunkCount: num(r.chunkCount, 1),
    tags: strArr(r.tags),
    linkedIOCIds: Array.isArray(r.linkedIOCIds) ? strArr(r.linkedIOCIds) : undefined,
    clsLevel: r.clsLevel != null ? str(r.clsLevel) : undefined,
    trashed: bool(r.trashed),
    trashedAt: r.trashedAt != null ? num(r.trashedAt) : undefined,
    archived: bool(r.archived),
    createdBy: r.createdBy != null ? str(r.createdBy) : undefined,
    updatedBy: r.updatedBy != null ? str(r.updatedBy) : undefined,
    createdAt: num(r.createdAt, Date.now()),
    updatedAt: num(r.updatedAt, Date.now()),
  };
}

function evidenceItemsFromNotes(notes: Note[]): EvidenceItem[] {
  return collapseEvidenceNoteSeries(notes)
    .filter(isBackupEvidenceNote)
    .map((note) => {
      const extractionTag = note.tags.find((tag) => tag.startsWith('extraction:'));
      const extractionStatus = extractionTag?.slice('extraction:'.length) as EvidenceExtractionStatus | undefined;
      const fileName = getBackupEvidenceFileName(note);
      return {
        id: `evidence_${note.id}`,
        title: stripBackupEvidenceTitle(note.title),
        folderId: note.folderId,
        fileName,
        fileType: evidenceKindFromBackupFileName(fileName),
        size: 0,
        content: note.content,
        extractionStatus: extractionStatus && VALID_EVIDENCE_STATUSES.includes(extractionStatus) ? extractionStatus : 'partial',
        importedAt: note.createdAt,
        chunkIndex: 1,
        chunkCount: 1,
        tags: note.tags.filter((tag) => tag !== 'evidence' && tag !== 'source:file'),
        clsLevel: note.clsLevel,
        linkedIOCIds: [],
        trashed: note.trashed,
        trashedAt: note.trashedAt,
        archived: note.archived,
        createdBy: note.createdBy,
        updatedBy: note.updatedBy,
        createdAt: note.createdAt,
        updatedAt: note.updatedAt,
      };
    });
}

function mergeEvidenceItemLists(...lists: EvidenceItem[][]): EvidenceItem[] {
  return collapseEvidenceItems(lists.flat());
}

function collapseEvidenceItems(items: EvidenceItem[]): EvidenceItem[] {
  const groups = new Map<string, EvidenceItem[]>();
  for (const item of items) {
    if (!item.id) continue;
    const key = evidenceItemGroupKey(item);
    const group = groups.get(key) || [];
    group.push(item);
    groups.set(key, group);
  }

  const collapsed: EvidenceItem[] = [];
  for (const group of groups.values()) {
    if (group.length === 1 && (group[0].chunkCount || 1) <= 1) {
      collapsed.push(group[0]);
      continue;
    }

    const sorted = [...group].sort((a, b) =>
      (a.chunkIndex || 1) - (b.chunkIndex || 1) ||
      (a.createdAt || 0) - (b.createdAt || 0)
    );
    const first = sorted[0];
    const metadata = extractBackupEvidenceMetadata(first.content)
      .split('\n')
      .filter((line) => !/^\*\*Part:\*\*/i.test(line.trim()))
      .join('\n')
      .trim();
    const bodies = sorted
      .map((item) => extractBackupEvidenceBody(item.content))
      .filter(Boolean);
    const content = `${metadata}\n\n## Extracted Text\n\n${dedupeBackupEvidenceBodies(bodies).join('\n\n') || 'No extracted text is available for this file.'}`;

    collapsed.push({
      ...first,
      title: stripBackupEvidenceTitle(first.title) || first.fileName,
      content,
      extractionStatus: getBestBackupEvidenceStatus(sorted.map((item) => item.extractionStatus)),
      chunkIndex: 1,
      chunkCount: 1,
      tags: Array.from(new Set(sorted.flatMap((item) => item.tags))),
      linkedIOCIds: Array.from(new Set(sorted.flatMap((item) => item.linkedIOCIds || []))),
      trashed: sorted.every((item) => item.trashed),
      archived: sorted.every((item) => item.archived),
      createdAt: Math.min(...sorted.map((item) => item.createdAt)),
      updatedAt: Math.max(...sorted.map((item) => item.updatedAt)),
    });
  }

  return collapsed;
}

function evidenceItemGroupKey(item: EvidenceItem): string {
  const folderId = item.folderId || '';
  const fileName = (item.fileName || item.title).toLowerCase();
  if (typeof item.size === 'number' && typeof item.lastModified === 'number') {
    return [folderId, fileName, item.size, item.lastModified, item.chunkCount || 1].join('::');
  }
  const contentHash = stableEvidenceContentHash(item.content);
  if (contentHash) {
    return [folderId, fileName, contentHash, item.chunkCount || 1].join('::');
  }
  return [folderId, fileName, item.id].join('::');
}

function stableEvidenceContentHash(content: string): string {
  const normalized = content.trim();
  if (!normalized) return '';
  let hash = 2166136261;
  for (let index = 0; index < normalized.length; index += 1) {
    hash ^= normalized.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}

function collapseEvidenceNoteSeries(notes: Note[]): Note[] {
  const passthrough: Note[] = [];
  const groups = new Map<string, Note[]>();

  for (const note of notes) {
    if (!isBackupEvidenceNote(note)) {
      passthrough.push(note);
      continue;
    }
    const key = backupEvidenceNoteGroupKey(note);
    const group = groups.get(key) || [];
    group.push(note);
    groups.set(key, group);
  }

  for (const group of groups.values()) {
    if (group.length === 1) {
      passthrough.push(group[0]);
    } else {
      passthrough.push(combineBackupEvidenceNotes(group));
    }
  }

  return passthrough;
}

function dedupeBackupEvidenceBodies(values: string[]): string[] {
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

function getBestBackupEvidenceStatus(statuses: EvidenceExtractionStatus[]): EvidenceExtractionStatus {
  if (statuses.includes('extracted')) return 'extracted';
  if (statuses.includes('partial')) return 'partial';
  return 'metadata-only';
}

function combineBackupEvidenceNotes(group: Note[]): Note {
  const sorted = [...group].sort((a, b) => getBackupEvidencePart(a) - getBackupEvidencePart(b));
  const canonical = sorted[0];
  const fileName = getBackupEvidenceFileName(canonical);
  const metadata = extractBackupEvidenceMetadata(canonical.content)
    .split('\n')
    .filter((line) => !/^\*\*Part:\*\*/i.test(line.trim()))
    .join('\n')
    .trim();
  const body = sorted
    .map((note) => extractBackupEvidenceBody(note.content))
    .filter(Boolean)
    .join('\n\n')
    .trim() || 'No extracted text is available for this file.';

  return {
    ...canonical,
    title: canonical.title.replace(/\s+\(\d+\s+of\s+\d+\)$/i, ''),
    content: `${metadata}\n\n## Extracted Text\n\n${body}`,
    sourceTitle: fileName,
    tags: Array.from(new Set(group.flatMap((note) => note.tags))),
    iocTypes: Array.from(new Set(group.flatMap((note) => note.iocTypes || []))),
    linkedNoteIds: Array.from(new Set(group.flatMap((note) => note.linkedNoteIds || []))),
    linkedTaskIds: Array.from(new Set(group.flatMap((note) => note.linkedTaskIds || []))),
    linkedTimelineEventIds: Array.from(new Set(group.flatMap((note) => note.linkedTimelineEventIds || []))),
    createdAt: Math.min(...group.map((note) => note.createdAt)),
    updatedAt: Math.max(...group.map((note) => note.updatedAt)),
  };
}

function isBackupEvidenceNote(note: Note): boolean {
  const hasEvidenceFileTags = note.tags.includes('evidence') && note.tags.includes('source:file');
  const looksLikeImportedEvidence =
    /^Evidence\s*-/i.test(note.title) ||
    /^# Evidence:\s*.+$/m.test(note.content);

  return hasEvidenceFileTags && looksLikeImportedEvidence;
}

function getBackupEvidenceFileName(note: Note): string {
  return (
    note.sourceTitle ||
    note.content.match(/^# Evidence:\s*(.+)$/m)?.[1] ||
    stripBackupEvidenceTitle(note.title) ||
    note.id
  ).trim();
}

function stripBackupEvidenceTitle(title: string): string {
  return title
    .replace(/^Evidence\s*-\s*/i, '')
    .replace(/\s+\(\d+\s+of\s+\d+\)$/i, '')
    .trim();
}

function getBackupEvidencePart(note: Note): number {
  const contentPart = note.content.match(/\*\*Part:\*\*\s*(\d+)\s+of\s+\d+/i);
  const titlePart = note.title.match(/\((\d+)\s+of\s+\d+\)$/i);
  return Number(contentPart?.[1] || titlePart?.[1] || 1);
}

function getBackupEvidencePartCount(note: Note): number {
  const contentPart = note.content.match(/\*\*Part:\*\*\s*\d+\s+of\s+(\d+)/i);
  const titlePart = note.title.match(/\(\d+\s+of\s+(\d+)\)$/i);
  return Number(contentPart?.[1] || titlePart?.[1] || 1);
}

function getBackupEvidenceImportedAt(note: Note): string | undefined {
  return note.content.match(/\*\*Imported:\*\*\s*(.+)$/mi)?.[1]?.trim();
}

function backupEvidenceNoteGroupKey(note: Note): string {
  const partCount = getBackupEvidencePartCount(note);
  const importedAt = getBackupEvidenceImportedAt(note);
  if (partCount > 1 && importedAt) {
    return [
      note.folderId || '',
      getBackupEvidenceFileName(note).toLowerCase(),
      partCount,
      importedAt,
    ].join('::');
  }
  return [note.folderId || '', getBackupEvidenceFileName(note).toLowerCase(), note.id].join('::');
}

function extractBackupEvidenceMetadata(content: string): string {
  return (content.split(/\n## Extracted Text\b/i)[0] || content).trim();
}

function extractBackupEvidenceBody(content: string): string {
  const parts = content.split(/\n## Extracted Text\b/i);
  return parts.length > 1 ? parts.slice(1).join('\n## Extracted Text').trim() : '';
}

function evidenceKindFromBackupFileName(fileName: string): EvidenceKind {
  const lower = fileName.toLowerCase();
  if (lower.endsWith('.pdf')) return 'pdf';
  if (lower.endsWith('.docx')) return 'docx';
  if (lower.endsWith('.doc')) return 'doc';
  if (lower.endsWith('.rtf') || lower.endsWith('.rtfs')) return 'rtf';
  if (lower.endsWith('.xlsx')) return 'xlsx';
  if (lower.endsWith('.xls')) return 'xls';
  if (/\.(png|jpe?g|webp|gif|bmp|avif)$/i.test(lower)) return 'image';
  if (lower.endsWith('.csv') || lower.endsWith('.tsv')) return 'spreadsheet';
  if (/\.(txt|md|markdown|json|xml|yaml|yml|log)$/i.test(lower)) return 'text';
  return 'unknown';
}

function sanitizeChatMessage(raw: unknown): ChatMessage | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const role = str(r.role);
  if (role !== 'user' && role !== 'assistant') return null;
  return {
    id: str(r.id),
    role: role as 'user' | 'assistant',
    content: str(r.content),
    model: r.model != null ? str(r.model) : undefined,
    createdAt: num(r.createdAt, Date.now()),
  };
}

export function sanitizeChatThread(raw: unknown): ChatThread | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const provider = str(r.provider, 'anthropic');
  return {
    ...provenance(r),
    id: str(r.id),
    title: str(r.title),
    messages: Array.isArray(r.messages)
      ? (r.messages as unknown[]).map(sanitizeChatMessage).filter((m): m is ChatMessage => m !== null)
      : [],
    model: str(r.model, 'claude-sonnet-4-6'),
    provider: (VALID_LLM_PROVIDERS.includes(provider) ? provider : 'anthropic') as LLMProvider,
    folderId: r.folderId != null ? str(r.folderId) : undefined,
    tags: strArr(r.tags),
    parentThreadId: r.parentThreadId != null ? str(r.parentThreadId) : undefined,
    isFolder: r.isFolder === true ? true : undefined,
    trashed: bool(r.trashed),
    trashedAt: r.trashedAt != null ? num(r.trashedAt) : undefined,
    archived: bool(r.archived),
    createdAt: num(r.createdAt, Date.now()),
    updatedAt: num(r.updatedAt, Date.now()),
  };
}

const VALID_AGENT_ACTION_STATUSES = ['pending', 'approved', 'rejected', 'executed', 'failed'];
const VALID_AGENT_SEVERITIES = ['info', 'warning', 'critical'];

function sanitizeAgentAction(raw: unknown): AgentAction | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const status = str(r.status, 'pending');
  return {
    id: str(r.id),
    investigationId: str(r.investigationId),
    threadId: str(r.threadId),
    agentConfigId: r.agentConfigId != null ? str(r.agentConfigId) : undefined,
    toolName: str(r.toolName),
    toolBinding: r.toolBinding != null ? str(r.toolBinding) : undefined,
    toolInput: (r.toolInput && typeof r.toolInput === 'object' ? r.toolInput : {}) as Record<string, unknown>,
    rationale: str(r.rationale),
    status: (VALID_AGENT_ACTION_STATUSES.includes(status) ? status : 'pending') as AgentAction['status'],
    resultSummary: r.resultSummary != null ? str(r.resultSummary) : undefined,
    severity: r.severity != null && VALID_AGENT_SEVERITIES.includes(str(r.severity)) ? str(r.severity) as AgentAction['severity'] : undefined,
    idempotencyKey: r.idempotencyKey != null ? str(r.idempotencyKey) : undefined,
    createdAt: num(r.createdAt, Date.now()),
    executedAt: r.executedAt != null ? num(r.executedAt) : undefined,
    reviewedAt: r.reviewedAt != null ? num(r.reviewedAt) : undefined,
    reviewedBy: r.reviewedBy != null ? str(r.reviewedBy) : undefined,
  };
}

const VALID_PROFILE_ROLES = ['executive', 'lead', 'specialist', 'observer'];
const VALID_AGENT_STATUSES = ['idle', 'running', 'waiting', 'paused', 'error'];
const VALID_MEETING_STATUSES = ['in-progress', 'completed', 'failed'];

function sanitizeAgentSoul(r: Record<string, unknown>): Record<string, unknown> {
  return {
    identity: typeof r.identity === 'string' ? r.identity.substring(0, 500) : '',
    lessons: Array.isArray(r.lessons) ? r.lessons.filter((l: unknown) => typeof l === 'string').slice(0, 50).map((l: string) => l.substring(0, 500)) : [],
    strengths: Array.isArray(r.strengths) ? r.strengths.filter((s: unknown) => typeof s === 'string').slice(0, 20) : [],
    weaknesses: Array.isArray(r.weaknesses) ? r.weaknesses.filter((w: unknown) => typeof w === 'string').slice(0, 20) : [],
    lifetimeMetrics: r.lifetimeMetrics && typeof r.lifetimeMetrics === 'object' ? {
      investigationsWorked: typeof (r.lifetimeMetrics as Record<string, unknown>).investigationsWorked === 'number' ? (r.lifetimeMetrics as Record<string, unknown>).investigationsWorked : 0,
      totalCycles: typeof (r.lifetimeMetrics as Record<string, unknown>).totalCycles === 'number' ? (r.lifetimeMetrics as Record<string, unknown>).totalCycles : 0,
      totalToolCalls: typeof (r.lifetimeMetrics as Record<string, unknown>).totalToolCalls === 'number' ? (r.lifetimeMetrics as Record<string, unknown>).totalToolCalls : 0,
      tasksCompleted: typeof (r.lifetimeMetrics as Record<string, unknown>).tasksCompleted === 'number' ? (r.lifetimeMetrics as Record<string, unknown>).tasksCompleted : 0,
      tasksRejected: typeof (r.lifetimeMetrics as Record<string, unknown>).tasksRejected === 'number' ? (r.lifetimeMetrics as Record<string, unknown>).tasksRejected : 0,
      meetingsAttended: typeof (r.lifetimeMetrics as Record<string, unknown>).meetingsAttended === 'number' ? (r.lifetimeMetrics as Record<string, unknown>).meetingsAttended : 0,
      performanceScore: typeof (r.lifetimeMetrics as Record<string, unknown>).performanceScore === 'number' ? (r.lifetimeMetrics as Record<string, unknown>).performanceScore : 50,
    } : { investigationsWorked: 0, totalCycles: 0, totalToolCalls: 0, tasksCompleted: 0, tasksRejected: 0, meetingsAttended: 0, performanceScore: 50 },
    updatedAt: typeof r.updatedAt === 'number' ? r.updatedAt : Date.now(),
  };
}

function sanitizeAgentProfile(raw: unknown): Record<string, unknown> | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  if (typeof r.id !== 'string' || typeof r.name !== 'string') return null;
  const role = str(r.role, 'specialist');
  return {
    id: str(r.id), name: str(r.name), description: r.description != null ? str(r.description) : undefined,
    icon: r.icon != null ? str(r.icon) : undefined,
    role: VALID_PROFILE_ROLES.includes(role) ? role : 'specialist',
    systemPrompt: str(r.systemPrompt, ''),
    allowedTools: Array.isArray(r.allowedTools) ? r.allowedTools.filter((t: unknown) => typeof t === 'string') : undefined,
    readOnlyEntityTypes: Array.isArray(r.readOnlyEntityTypes) ? r.readOnlyEntityTypes.filter((t: unknown) => typeof t === 'string') : undefined,
    policy: r.policy && typeof r.policy === 'object' ? r.policy : { autoApproveReads: true, autoApproveEnrich: true, autoApproveFetch: true, autoApproveCreate: false, autoApproveModify: false, intervalMinutes: 5 },
    model: r.model != null ? str(r.model) : undefined,
    priority: r.priority != null ? num(r.priority, 10) : undefined,
    soul: r.soul && typeof r.soul === 'object' ? sanitizeAgentSoul(r.soul as Record<string, unknown>) : undefined,
    source: str(r.source, 'user'),
    createdAt: num(r.createdAt, Date.now()), updatedAt: num(r.updatedAt, Date.now()),
  };
}

const VALID_HANDOFF_STATES = ['client', 'handoff-pending', 'server', 'reclaim-pending'];

function sanitizeHandoffReconciliation(raw: unknown): Record<string, unknown> | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const r = raw as Record<string, unknown>;
  const ids = Array.isArray(r.serverActionIds) ? r.serverActionIds.filter((i): i is string => typeof i === 'string') : [];
  const hist = (r.toolHistogram && typeof r.toolHistogram === 'object' && !Array.isArray(r.toolHistogram))
    ? Object.fromEntries(
        Object.entries(r.toolHistogram as Record<string, unknown>)
          .filter(([, v]) => typeof v === 'number')
      )
    : {};
  return {
    at: num(r.at, Date.now()),
    serverActionCount: num(r.serverActionCount, ids.length),
    serverActionIds: ids,
    toolHistogram: hist,
    acknowledged: r.acknowledged === true,
  };
}

function sanitizeAgentDeployment(raw: unknown): Record<string, unknown> | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  if (typeof r.id !== 'string' || typeof r.investigationId !== 'string' || typeof r.profileId !== 'string') return null;
  const status = str(r.status, 'idle');
  const handoffState = r.handoffState != null ? str(r.handoffState) : undefined;
  return {
    policyOverrides: r.policyOverrides && typeof r.policyOverrides === 'object' ? r.policyOverrides : undefined,
    metrics: r.metrics && typeof r.metrics === 'object' ? r.metrics : undefined,
    serverBotConfigId: typeof r.serverBotConfigId === 'string' ? str(r.serverBotConfigId) : undefined,
    serverSideEnabled: typeof r.serverSideEnabled === 'boolean' ? r.serverSideEnabled : undefined,
    competitiveness: ['cooperative', 'competitive', 'independent'].includes(str(r.competitiveness)) ? str(r.competitiveness) : undefined,
    shift: ['active', 'resting'].includes(str(r.shift)) ? str(r.shift) : undefined,
    shiftStartedAt: typeof r.shiftStartedAt === 'number' ? num(r.shiftStartedAt) : undefined,
    id: str(r.id), investigationId: str(r.investigationId), profileId: str(r.profileId),
    supervisorDeploymentId: r.supervisorDeploymentId != null ? str(r.supervisorDeploymentId) : undefined,
    threadId: r.threadId != null ? str(r.threadId) : undefined,
    status: VALID_AGENT_STATUSES.includes(status) ? status : 'idle',
    lastRunAt: r.lastRunAt != null ? num(r.lastRunAt) : undefined,
    order: num(r.order, 0),
    handoffState: handoffState && VALID_HANDOFF_STATES.includes(handoffState) ? handoffState : undefined,
    lastReconciledAt: r.lastReconciledAt != null ? num(r.lastReconciledAt) : undefined,
    lastHandoffReconciliation: sanitizeHandoffReconciliation(r.lastHandoffReconciliation),
    createdAt: num(r.createdAt, Date.now()), updatedAt: num(r.updatedAt, Date.now()),
  };
}

const VALID_MEETING_PURPOSES = ['redTeamReview', 'dissentSynthesis', 'signOff', 'freeform'];

function sanitizeAgentMeeting(raw: unknown): Record<string, unknown> | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  if (typeof r.id !== 'string' || typeof r.investigationId !== 'string') return null;
  const status = str(r.status, 'completed');
  const purpose = str(r.purpose, 'freeform');
  const participantConfidence = (r.participantConfidence && typeof r.participantConfidence === 'object' && !Array.isArray(r.participantConfidence))
    ? Object.fromEntries(
        Object.entries(r.participantConfidence as Record<string, unknown>)
          .filter(([, v]) => typeof v === 'number')
          .map(([k, v]) => [k, Math.max(1, Math.min(5, Number(v)))])
      )
    : undefined;
  return {
    id: str(r.id), investigationId: str(r.investigationId),
    participantDeploymentIds: Array.isArray(r.participantDeploymentIds) ? r.participantDeploymentIds.filter((d: unknown) => typeof d === 'string') : [],
    threadId: str(r.threadId, ''), agenda: str(r.agenda, ''),
    minutesNoteId: r.minutesNoteId != null ? str(r.minutesNoteId) : undefined,
    status: VALID_MEETING_STATUSES.includes(status) ? status : 'completed',
    roundsCompleted: num(r.roundsCompleted, 0), maxRounds: num(r.maxRounds, 2),
    purpose: VALID_MEETING_PURPOSES.includes(purpose) ? purpose : 'freeform',
    // structuredOutput: trust-but-carry — the shape depends on purpose and is
    // produced by a synthesizer LLM, so we round-trip it as an opaque object.
    structuredOutput: (r.structuredOutput && typeof r.structuredOutput === 'object') ? r.structuredOutput : undefined,
    participantConfidence,
    createdAt: num(r.createdAt, Date.now()), completedAt: r.completedAt != null ? num(r.completedAt) : undefined,
  };
}

const VALID_TEMPLATE_SOURCES = ['builtin', 'user', 'team'];
const VALID_PLAYBOOK_STEP_ENTITIES = ['task', 'note'];

function sanitizeNoteTemplate(raw: unknown): NoteTemplate | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const source = str(r.source, 'user');
  const productBaseline = sanitizeProductBaselineMetadata(r.productBaseline);
  return {
    id: str(r.id),
    name: str(r.name),
    description: r.description != null ? str(r.description) : undefined,
    icon: r.icon != null ? str(r.icon) : undefined,
    content: str(r.content),
    category: str(r.category, 'Custom'),
    tags: Array.isArray(r.tags) ? strArr(r.tags) : undefined,
    clsLevel: r.clsLevel != null ? str(r.clsLevel) : undefined,
    source: (VALID_TEMPLATE_SOURCES.includes(source) ? source : 'user') as TemplateSource,
    productBaseline,
    createdAt: num(r.createdAt, Date.now()),
    updatedAt: num(r.updatedAt, Date.now()),
  };
}

function sanitizeProductBaselineMetadata(raw: unknown): ProductBaselineMetadata | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const r = raw as Record<string, unknown>;
  const kind = str(r.kind);
  const productType = str(r.productType);
  const renderer = str(r.renderer);
  const visualFidelity = str(r.visualFidelity);
  return {
    schemaVersion: 1,
    kind: kind === 'docx-template' ? 'docx-template' : 'markdown',
    productType: ['analysis-report', 'intel-note', 'executive-brief', 'custom'].includes(productType)
      ? productType as ProductBaselineMetadata['productType']
      : 'custom',
    importedAt: num(r.importedAt, Date.now()),
    importedFrom: r.importedFrom != null ? str(r.importedFrom) : undefined,
    renderer: renderer === 'docx-template' ? 'docx-template' : 'markdown',
    visualFidelity: ['placeholder', 'structural', 'word-template'].includes(visualFidelity)
      ? visualFidelity as ProductBaselineMetadata['visualFidelity']
      : 'placeholder',
    sourceDocuments: sanitizeProductBaselineDocs(r.sourceDocuments),
    testFixtures: sanitizeProductBaselineFixtures(r.testFixtures),
    assets: sanitizeProductBaselineAssets(r.assets),
    layoutNotes: Array.isArray(r.layoutNotes) ? strArr(r.layoutNotes) : undefined,
    sourceNoteRules: Array.isArray(r.sourceNoteRules) ? strArr(r.sourceNoteRules) : undefined,
    requiredFields: Array.isArray(r.requiredFields) ? strArr(r.requiredFields) : undefined,
  };
}

function sanitizeProductBaselineDocs(raw: unknown): ProductBaselineSourceDocument[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  const docs = raw.flatMap((item): ProductBaselineSourceDocument[] => {
    if (!item || typeof item !== 'object') return [];
    const r = item as Record<string, unknown>;
    const name = str(r.name).trim();
    if (!name) return [];
    const type = str(r.type);
    return [{
      name,
      type: ['docx', 'pdf', 'markdown', 'json', 'other'].includes(type) ? type as ProductBaselineSourceDocument['type'] : undefined,
      path: r.path != null ? str(r.path) : undefined,
      sha256: r.sha256 != null ? str(r.sha256) : undefined,
      role: r.role != null ? str(r.role) : undefined,
      notes: r.notes != null ? str(r.notes).slice(0, 2000) : undefined,
    }];
  });
  return docs.length > 0 ? docs : undefined;
}

function sanitizeProductBaselineFixtures(raw: unknown): ProductBaselineTestFixture[] | undefined {
  return sanitizeProductBaselineDocs(raw) as ProductBaselineTestFixture[] | undefined;
}

function sanitizeProductBaselineAssets(raw: unknown): ProductBaselineAsset[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  const assets = raw.flatMap((item): ProductBaselineAsset[] => {
    if (!item || typeof item !== 'object') return [];
    const r = item as Record<string, unknown>;
    const name = str(r.name).trim();
    if (!name) return [];
    const role = str(r.role);
    return [{
      name,
      role: ['docx-template', 'preview', 'image', 'context', 'other'].includes(role) ? role as ProductBaselineAsset['role'] : undefined,
      mimeType: r.mimeType != null ? str(r.mimeType) : undefined,
      data: typeof r.data === 'string' ? r.data.slice(0, 20_000_000) : undefined,
      path: r.path != null ? str(r.path) : undefined,
      notes: r.notes != null ? str(r.notes).slice(0, 2000) : undefined,
    }];
  });
  return assets.length > 0 ? assets : undefined;
}

function sanitizePlaybookStep(raw: unknown): PlaybookStep | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const entityType = str(r.entityType);
  if (!VALID_PLAYBOOK_STEP_ENTITIES.includes(entityType)) return null;
  return {
    order: num(r.order),
    entityType: entityType as PlaybookStepEntity,
    title: str(r.title),
    content: str(r.content),
    priority: r.priority != null && ['none', 'low', 'medium', 'high'].includes(str(r.priority)) ? str(r.priority) as PlaybookStep['priority'] : undefined,
    status: r.status != null && ['todo', 'in-progress', 'done'].includes(str(r.status)) ? str(r.status) as PlaybookStep['status'] : undefined,
    tags: Array.isArray(r.tags) ? strArr(r.tags) : undefined,
    noteTemplateId: r.noteTemplateId != null ? str(r.noteTemplateId) : undefined,
    phase: r.phase != null ? str(r.phase) : undefined,
  };
}

function sanitizePlaybookTemplate(raw: unknown): PlaybookTemplate | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const source = str(r.source, 'user');
  return {
    id: str(r.id),
    name: str(r.name),
    description: r.description != null ? str(r.description) : undefined,
    icon: r.icon != null ? str(r.icon) : undefined,
    investigationType: str(r.investigationType, 'custom'),
    defaultTags: Array.isArray(r.defaultTags) ? strArr(r.defaultTags) : undefined,
    defaultClsLevel: r.defaultClsLevel != null ? str(r.defaultClsLevel) : undefined,
    defaultPapLevel: r.defaultPapLevel != null ? str(r.defaultPapLevel) : undefined,
    steps: Array.isArray(r.steps)
      ? (r.steps as unknown[]).map(sanitizePlaybookStep).filter((s): s is PlaybookStep => s !== null)
      : [],
    source: (VALID_TEMPLATE_SOURCES.includes(source) ? source : 'user') as TemplateSource,
    createdAt: num(r.createdAt, Date.now()),
    updatedAt: num(r.updatedAt, Date.now()),
  };
}

function sanitizeQuickLink(raw: unknown): QuickLink | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  if (typeof r.id !== 'string' || typeof r.title !== 'string' || typeof r.url !== 'string') return null;
  // Reject non-http(s) URLs to prevent javascript: injection from malicious imports
  try { const u = new URL(str(r.url)); if (u.protocol !== 'http:' && u.protocol !== 'https:') return null; } catch { return null; }
  return {
    id: str(r.id),
    title: str(r.title),
    url: str(r.url),
    description: r.description != null ? str(r.description) : undefined,
    color: r.color != null ? str(r.color) : undefined,
    icon: r.icon != null ? str(r.icon) : undefined,
  };
}

export async function importJSON(json: string): Promise<{ notes: number; tasks: number; folders: number; tags: number; timelineEvents: number; timelines: number; whiteboards: number; standaloneIOCs: number; evidenceItems: number; chatThreads: number; noteTemplates: number; playbookTemplates: number; agentActions: number; agentProfiles: number; agentDeployments: number; agentMeetings: number }> {
  if (json.length > MAX_IMPORT_SIZE) {
    throw new Error(`Backup file too large (max ${MAX_IMPORT_SIZE / 1024 / 1024} MB)`);
  }

  const data = JSON.parse(json);

  if (!data || typeof data !== 'object' || !Array.isArray(data.notes) || !Array.isArray(data.tasks) || !Array.isArray(data.folders) || !Array.isArray(data.tags)) {
    throw new Error('Invalid backup file format');
  }

  if (data.notes.length > MAX_ITEMS || data.tasks.length > MAX_ITEMS) {
    throw new Error(`Too many items (max ${MAX_ITEMS.toLocaleString()} per type)`);
  }

  // Sanitize all imported objects through allowlisted field extractors
  const allNotes = collapseEvidenceNoteSeries(data.notes.map(sanitizeNote).filter((n: Note | null): n is Note => n !== null && !!n.id));
  const notes = allNotes.filter((note) => !isBackupEvidenceNote(note));
  const tasks = data.tasks.map(sanitizeTask).filter((t: Task | null): t is Task => t !== null && !!t.id);
  const folders = (Array.isArray(data.folders) ? data.folders : [])
    .map(sanitizeFolder).filter((f: Folder | null): f is Folder => f !== null && !!f.id);
  const tags = data.tags.map(sanitizeTag).filter((t: Tag | null): t is Tag => t !== null && !!t.id);
  const timelineEvents = (Array.isArray(data.timelineEvents) ? data.timelineEvents : [])
    .map(sanitizeTimelineEvent)
    .filter((e: TimelineEvent | null): e is TimelineEvent => e !== null && !!e.id);
  let timelines = (Array.isArray(data.timelines) ? data.timelines : [])
    .map(sanitizeTimeline)
    .filter((t: Timeline | null): t is Timeline => t !== null && !!t.id);

  const whiteboards = (Array.isArray(data.whiteboards) ? data.whiteboards : [])
    .map(sanitizeWhiteboard)
    .filter((w: Whiteboard | null): w is Whiteboard => w !== null && !!w.id);

  const standaloneIOCs = (Array.isArray(data.standaloneIOCs) ? data.standaloneIOCs : [])
    .map(sanitizeStandaloneIOC)
    .filter((i: StandaloneIOC | null): i is StandaloneIOC => i !== null && !!i.id);

  const importedEvidenceItems = (Array.isArray(data.evidenceItems) ? data.evidenceItems : [])
    .map(sanitizeEvidenceItem)
    .filter((item: EvidenceItem | null): item is EvidenceItem => item !== null && !!item.id);
  const evidenceItems = mergeEvidenceItemLists(importedEvidenceItems, evidenceItemsFromNotes(allNotes));

  const chatThreads = (Array.isArray(data.chatThreads) ? data.chatThreads : [])
    .map(sanitizeChatThread)
    .filter((c: ChatThread | null): c is ChatThread => c !== null && !!c.id);

  const agentActions = (Array.isArray(data.agentActions) ? data.agentActions : [])
    .map(sanitizeAgentAction)
    .filter((a: AgentAction | null): a is AgentAction => a !== null && !!a.id);

  const noteTemplatesRaw = (Array.isArray(data.noteTemplates) ? data.noteTemplates : [])
    .map(sanitizeNoteTemplate)
    .filter((t: NoteTemplate | null): t is NoteTemplate => t !== null && !!t.id);

  const playbookTemplatesRaw = (Array.isArray(data.playbookTemplates) ? data.playbookTemplates : [])
    .map(sanitizePlaybookTemplate)
    .filter((p: PlaybookTemplate | null): p is PlaybookTemplate => p !== null && !!p.id);

  // If we have timeline events but no timelines, create a Default and assign all events
  if (timelineEvents.length > 0 && timelines.length === 0) {
    const defaultId = nanoid();
    const now = Date.now();
    timelines = [{ id: defaultId, name: 'Default', order: 0, createdAt: now, updatedAt: now }];
    for (const ev of timelineEvents) {
      if (!ev.timelineId) ev.timelineId = defaultId;
    }
  }

  // Sanitize quickLinks if present
  const quickLinks = (Array.isArray(data.quickLinks) ? data.quickLinks : [])
    .map(sanitizeQuickLink)
    .filter((l: QuickLink | null): l is QuickLink => l !== null && !!l.id);

  // Agent profiles/deployments/meetings are imported with basic ID validation
  const importedProfiles = (Array.isArray(data.agentProfiles) ? data.agentProfiles : []).map(sanitizeAgentProfile).filter(Boolean);
  const importedDeployments = (Array.isArray(data.agentDeployments) ? data.agentDeployments : []).map(sanitizeAgentDeployment).filter(Boolean);
  const importedMeetings = (Array.isArray(data.agentMeetings) ? data.agentMeetings : []).map(sanitizeAgentMeeting).filter(Boolean);

  await db.transaction('rw', [db.notes, db.tasks, db.folders, db.tags, db.timelineEvents, db.timelines, db.whiteboards, db.standaloneIOCs, db.evidenceItems, db.chatThreads, db.noteTemplates, db.playbookTemplates, db.agentActions, db.agentProfiles, db.agentDeployments, db.agentMeetings], async () => {
    await db.notes.clear();
    await db.tasks.clear();
    await db.folders.clear();
    await db.tags.clear();
    await db.timelineEvents.clear();
    await db.timelines.clear();
    await db.whiteboards.clear();
    await db.standaloneIOCs.clear();
    await db.evidenceItems.clear();
    await db.chatThreads.clear();
    await db.noteTemplates.clear();
    await db.playbookTemplates.clear();
    await db.agentActions.clear();
    await db.agentProfiles.clear();
    await db.agentDeployments.clear();
    await db.agentMeetings.clear();

    await db.notes.bulkAdd(notes);
    await db.tasks.bulkAdd(tasks);
    await db.folders.bulkAdd(folders);
    await db.tags.bulkAdd(tags);
    await db.timelineEvents.bulkAdd(timelineEvents);
    await db.timelines.bulkAdd(timelines);
    await db.whiteboards.bulkAdd(whiteboards);
    await db.standaloneIOCs.bulkAdd(standaloneIOCs);
    if (evidenceItems.length > 0) await db.evidenceItems.bulkAdd(evidenceItems);
    await db.chatThreads.bulkAdd(chatThreads);
    if (noteTemplatesRaw.length > 0) await db.noteTemplates.bulkAdd(noteTemplatesRaw);
    if (playbookTemplatesRaw.length > 0) await db.playbookTemplates.bulkAdd(playbookTemplatesRaw);
    if (agentActions.length > 0) await db.agentActions.bulkAdd(agentActions);
    if (importedProfiles.length > 0) await db.agentProfiles.bulkAdd(importedProfiles);
    if (importedDeployments.length > 0) await db.agentDeployments.bulkAdd(importedDeployments);
    if (importedMeetings.length > 0) await db.agentMeetings.bulkAdd(importedMeetings);
  });

  // Restore quick links to settings if present in backup
  if (quickLinks.length > 0) {
    try {
      const stored = localStorage.getItem(workspaceStorageKey('threatcaddy-settings'));
      const settings = stored ? JSON.parse(stored) : {};
      settings.quickLinks = quickLinks;
      localStorage.setItem(workspaceStorageKey('threatcaddy-settings'), JSON.stringify(settings));
    } catch { /* ignore */ }
  }

  return {
    notes: notes.length,
    tasks: tasks.length,
    folders: folders.length,
    tags: tags.length,
    timelineEvents: timelineEvents.length,
    timelines: timelines.length,
    whiteboards: whiteboards.length,
    standaloneIOCs: standaloneIOCs.length,
    evidenceItems: evidenceItems.length,
    chatThreads: chatThreads.length,
    noteTemplates: noteTemplatesRaw.length,
    playbookTemplates: playbookTemplatesRaw.length,
    agentActions: agentActions.length,
    agentProfiles: importedProfiles.length,
    agentDeployments: importedDeployments.length,
    agentMeetings: importedMeetings.length,
  };
}

export async function exportInvestigationJSON(folderId: string): Promise<string> {
  return db.transaction('r', [...Object.keys(ENTITY_RELATIONS).map(name => db.table(name)), db.tags], async () => {
  const [folder, allNotes, allTasks, allTags, allEvents, allTimelines, allWhiteboards, allIOCs, allEvidenceItems, allChats, allAgentActions, allAgentDeployments, allAgentMeetings, allAgentProfiles] = await Promise.all([
    db.folders.get(folderId),
    db.notes.where('folderId').equals(folderId).toArray(),
    db.tasks.where('folderId').equals(folderId).toArray(),
    db.tags.toArray(),
    db.timelineEvents.where('folderId').equals(folderId).toArray(),
    db.timelines.toArray(),
    db.whiteboards.where('folderId').equals(folderId).toArray(),
    db.standaloneIOCs.where('folderId').equals(folderId).toArray(),
    db.evidenceItems.where('folderId').equals(folderId).toArray(),
    db.chatThreads.where('folderId').equals(folderId).toArray(),
    db.agentActions.where('investigationId').equals(folderId).toArray(),
    db.agentDeployments.where('investigationId').equals(folderId).toArray(),
    db.agentMeetings.where('investigationId').equals(folderId).toArray(),
    db.agentProfiles.toArray(),
  ]);

  if (!folder) throw new Error('Investigation not found');
  const collapsedNotes = collapseEvidenceNoteSeries(allNotes);
  const notes = collapsedNotes.filter((note) => !isBackupEvidenceNote(note));
  const evidenceItems = mergeEvidenceItemLists(allEvidenceItems, evidenceItemsFromNotes(collapsedNotes));

  // Collect all tag names used in this investigation's entities
  const usedTagNames = new Set<string>();
  for (const n of notes) n.tags.forEach((t) => usedTagNames.add(t));
  for (const t of allTasks) t.tags.forEach((tg) => usedTagNames.add(tg));
  for (const e of allEvents) e.tags.forEach((tg) => usedTagNames.add(tg));
  for (const w of allWhiteboards) w.tags.forEach((tg) => usedTagNames.add(tg));
  for (const i of allIOCs) i.tags.forEach((tg) => usedTagNames.add(tg));
  for (const evidence of evidenceItems) evidence.tags.forEach((tg) => usedTagNames.add(tg));
  for (const c of allChats) c.tags.forEach((tg) => usedTagNames.add(tg));
  if (folder.tags) folder.tags.forEach((t) => usedTagNames.add(t));

  const tags = allTags.filter((t) => usedTagNames.has(t.name));

  // Include linked timelines
  const timelineIds = new Set(allEvents.map((e) => e.timelineId));
  if (folder.timelineId) timelineIds.add(folder.timelineId);
  const timelines = allTimelines.filter((t) => timelineIds.has(t.id));

  const data: ExportData = {
    version: 1,
    exportedAt: Date.now(),
    notes,
    tasks: allTasks,
    folders: [folder],
    tags,
    timelineEvents: allEvents,
    timelines,
    whiteboards: allWhiteboards,
    standaloneIOCs: allIOCs,
    evidenceItems: evidenceItems.length > 0 ? evidenceItems : undefined,
    chatThreads: allChats,
    agentActions: allAgentActions.length > 0 ? allAgentActions : undefined,
    agentDeployments: allAgentDeployments.length > 0 ? allAgentDeployments : undefined,
    agentMeetings: allAgentMeetings.length > 0 ? allAgentMeetings : undefined,
    agentProfiles: allAgentProfiles.filter(profile => allAgentDeployments.some(deployment => deployment.profileId === profile.id)),
  };

  return JSON.stringify(data, null, 2);
  });
}

export function exportNotesMarkdown(notes: Note[]): string {
  return notes
    .map((note) => {
      let md = `# ${note.title}\n\n`;
      if (note.tags.length > 0) {
        md += `Tags: ${note.tags.join(', ')}\n`;
      }
      md += `Created: ${new Date(note.createdAt).toISOString()}\n`;
      md += `Modified: ${new Date(note.updatedAt).toISOString()}\n\n`;
      md += `---\n\n${note.content}\n`;
      return md;
    })
    .join('\n\n---\n\n');
}

// --- Standalone timeline export/import ---

export async function exportTimelineJSON(timelineId: string): Promise<string> {
  const timeline = await db.timelines.get(timelineId);
  if (!timeline) throw new Error('Timeline not found');
  const events = await db.timelineEvents.where('timelineId').equals(timelineId).toArray();
  const data: TimelineExportData = {
    format: 'threatcaddy-timeline',
    version: 1,
    exportedAt: Date.now(),
    timeline: { name: timeline.name, description: timeline.description, color: timeline.color },
    events,
  };
  return JSON.stringify(data, null, 2);
}

export function exportEventsJSON(events: TimelineEvent[], timelineMeta?: { name?: string; description?: string; color?: string }): string {
  const data: TimelineExportData = {
    format: 'threatcaddy-timeline',
    version: 1,
    exportedAt: Date.now(),
    timeline: { name: timelineMeta?.name ?? 'All Events', description: timelineMeta?.description, color: timelineMeta?.color },
    events,
  };
  return JSON.stringify(data, null, 2);
}

function eventFingerprint(e: TimelineEvent): string {
  return `${e.timestamp}|${e.title}|${e.eventType}|${e.source}`;
}

export function parseTimelineImport(json: string): TimelineExportData {
  if (json.length > MAX_IMPORT_SIZE) {
    throw new Error(`File too large (max ${MAX_IMPORT_SIZE / 1024 / 1024} MB)`);
  }
  const data = JSON.parse(json);
  if (!data || typeof data !== 'object' || (data.format !== 'threatcaddy-timeline' && data.format !== 'browsernotes-timeline')) {
    throw new Error('Invalid timeline export file');
  }
  const events = (Array.isArray(data.events) ? data.events : [])
    .map(sanitizeTimelineEvent)
    .filter((e: TimelineEvent | null): e is TimelineEvent => e !== null && !!e.id);
  if (events.length > MAX_ITEMS) {
    throw new Error(`Too many events (max ${MAX_ITEMS.toLocaleString()})`);
  }
  const tl = data.timeline && typeof data.timeline === 'object' ? data.timeline as Record<string, unknown> : {};
  return {
    format: 'threatcaddy-timeline',
    version: 1,
    exportedAt: num(data.exportedAt, Date.now()),
    timeline: {
      name: str(tl.name, 'Imported Timeline'),
      description: tl.description != null ? str(tl.description) : undefined,
      color: tl.color != null ? str(tl.color) : undefined,
    },
    events,
  };
}

export async function importTimelineAsNew(parsed: TimelineExportData): Promise<{ timelineId: string; eventCount: number }> {
  const newTimelineId = nanoid();
  const now = Date.now();
  const maxOrder = (await db.timelines.toArray()).reduce((max, t) => Math.max(max, t.order), 0);
  const timeline: Timeline = {
    id: newTimelineId,
    name: parsed.timeline.name,
    description: parsed.timeline.description,
    color: parsed.timeline.color,
    order: maxOrder + 1,
    createdAt: now,
    updatedAt: now,
  };
  const events = parsed.events.map((e) => ({
    ...e,
    id: nanoid(),
    timelineId: newTimelineId,
  }));
  await db.transaction('rw', [db.timelines, db.timelineEvents], async () => {
    await db.timelines.add(timeline);
    await db.timelineEvents.bulkAdd(events);
  });
  return { timelineId: newTimelineId, eventCount: events.length };
}

export async function mergeTimelineInto(parsed: TimelineExportData, targetTimelineId: string): Promise<{ added: number; updated: number; skipped: number }> {
  const existing = await db.timelineEvents.where('timelineId').equals(targetTimelineId).toArray();
  const existingById = new Map(existing.map((e) => [e.id, e]));
  const existingByFingerprint = new Map(existing.map((e) => [eventFingerprint(e), e]));

  let added = 0;
  let updated = 0;
  let skipped = 0;
  const toAdd: TimelineEvent[] = [];
  const toUpdate: { id: string; changes: Partial<TimelineEvent> }[] = [];

  for (const incoming of parsed.events) {
    const match = existingById.get(incoming.id) ?? existingByFingerprint.get(eventFingerprint(incoming));
    if (match) {
      if (incoming.updatedAt > match.updatedAt) {
        toUpdate.push({ id: match.id, changes: { ...incoming, id: match.id, timelineId: targetTimelineId } });
        updated++;
      } else {
        skipped++;
      }
    } else {
      toAdd.push({ ...incoming, id: nanoid(), timelineId: targetTimelineId });
      added++;
    }
  }

  await db.transaction('rw', db.timelineEvents, async () => {
    if (toAdd.length > 0) await db.timelineEvents.bulkAdd(toAdd);
    for (const { id, changes } of toUpdate) {
      await db.timelineEvents.update(id, changes);
    }
  });

  return { added, updated, skipped };
}

// --- Merge / Investigation import ---

export async function importInvestigationJSON(json: string): Promise<{ folderId: string; notes: number; tasks: number; timelineEvents: number; standaloneIOCs: number; evidenceItems: number; warnings: string[] }> {
  if (json.length > MAX_IMPORT_SIZE) throw new Error('File too large for an investigation import');
  const data = JSON.parse(json);
  if (!data || typeof data !== 'object' || !Array.isArray(data.folders) || data.folders.length !== 1) throw new Error('An investigation export must contain exactly one folder');
  const oldFolder = sanitizeFolder(data.folders[0]);
  if (!oldFolder?.id) throw new Error('Invalid folder data');
  const rows = (name: string, sanitize: (raw: unknown) => unknown): EntityRecord[] => {
    if (data[name] !== undefined && !Array.isArray(data[name])) throw new Error('Invalid entity collection: ' + name);
    return (data[name] ?? []).map(sanitize).filter((row: unknown): row is EntityRecord => !!row && typeof row === 'object' && typeof (row as EntityRecord).id === 'string' && !!(row as EntityRecord).id);
  };
  const allNotes = collapseEvidenceNoteSeries(rows('notes', sanitizeNote) as unknown as Note[]);
  const collections: Record<string, EntityRecord[]> = {
    folders: [oldFolder as unknown as EntityRecord],
    notes: allNotes.filter(note => !isBackupEvidenceNote(note)) as unknown as EntityRecord[],
    tasks: rows('tasks', sanitizeTask), timelineEvents: rows('timelineEvents', sanitizeTimelineEvent),
    timelines: rows('timelines', sanitizeTimeline), whiteboards: rows('whiteboards', sanitizeWhiteboard),
    standaloneIOCs: rows('standaloneIOCs', sanitizeStandaloneIOC),
    evidenceItems: mergeEvidenceItemLists(rows('evidenceItems', sanitizeEvidenceItem) as unknown as EvidenceItem[], evidenceItemsFromNotes(allNotes)) as unknown as EntityRecord[],
    chatThreads: rows('chatThreads', sanitizeChatThread), agentActions: rows('agentActions', sanitizeAgentAction),
    agentProfiles: rows('agentProfiles', sanitizeAgentProfile), agentDeployments: rows('agentDeployments', sanitizeAgentDeployment),
    agentMeetings: rows('agentMeetings', sanitizeAgentMeeting),
  };
  const maps = new Map<string, Map<string, string>>();
  for (const [table, entities] of Object.entries(collections)) {
    const map = new Map<string, string>();
    for (const entity of entities) {
      if (map.has(entity.id)) throw new Error('Duplicate ' + table + ' ID in investigation export');
      map.set(entity.id, nanoid());
      if (table !== 'folders' && (entity.folderId && entity.folderId !== oldFolder.id || entity.investigationId && entity.investigationId !== oldFolder.id)) throw new Error('Investigation export contains a record from another investigation');
    }
    maps.set(table, map);
  }
  const iocMap = new Map(maps.get('standaloneIOCs'));
  for (const table of ['notes', 'tasks', 'timelineEvents']) for (const entity of collections[table]) {
    const analysis = entity.iocAnalysis as IOCAnalysis | undefined;
    for (const ioc of analysis?.iocs ?? []) if (!iocMap.has(ioc.id)) iocMap.set(ioc.id, nanoid());
  }
  maps.set('iocs', iocMap);
  maps.set('playbookEntities', new Map([...maps.get('notes') ?? [], ...maps.get('tasks') ?? []]));
  const folderId = maps.get('folders')?.get(oldFolder.id);
  if (!folderId) throw new Error('Folder mapping missing');
  const warnings = new Set<string>();
  for (const [table, entities] of Object.entries(collections)) collections[table] = entities.map(entity => {
    const row = mapEntityReferences(table, entity, (target, id, path) => {
      const mapped = maps.get(target)?.get(id);
      if (mapped) return mapped;
      warnings.add('External reference retained unchanged: ' + table + '.' + path + ' → ' + id);
      return id; // No invented IDs for records that are not in the export.
    });
    row.id = maps.get(table)?.get(entity.id) ?? entity.id;
    if (['notes', 'tasks', 'timelineEvents', 'whiteboards', 'standaloneIOCs', 'evidenceItems', 'chatThreads'].includes(table)) row.folderId = folderId;
    const analysis = row.iocAnalysis as IOCAnalysis | undefined;
    if (analysis) for (const ioc of analysis.iocs) ioc.id = iocMap.get(ioc.id) ?? ioc.id;
    if (table === 'folders') {
      row.name = String(row.name) + ' (imported)';
      row.agentEnabled = false;
      row.agentStatus = 'idle';
    }
    if (table === 'agentDeployments') {
      row.status = 'idle'; row.shift = 'resting'; row.serverSideEnabled = false; row.handoffState = 'client';
      delete row.serverBotConfigId;
    }
    if (table === 'agentActions' && ['approved', 'pending'].includes(String(row.status))) {
      row.resultSummary = '[Portable import: original status ' + row.status + '; review and propose a new action before execution.] ' + (row.resultSummary ?? '');
      row.status = 'rejected'; delete row.toolBinding; delete row.idempotencyKey;
    }
    if (table === 'agentMeetings' && row.participantConfidence && typeof row.participantConfidence === 'object') {
      row.participantConfidence = Object.fromEntries(Object.entries(row.participantConfidence).map(([id, value]) => [maps.get('agentDeployments')?.get(id) ?? id, value]));
    }
    return row;
  });
  const tags = rows('tags', sanitizeTag);
  await withEntityDraftBarrier(async () => db.transaction('rw', [...Object.keys(collections).map(name => db.table(name)), db.tags], async () => {
    for (const [table, entities] of Object.entries(collections)) if (entities.length) await db.table(table).bulkAdd(entities);
    for (const tag of tags) {
      const existing = await db.tags.filter(candidate => candidate.name === tag.name).first();
      if (!existing) await db.tags.add({ ...tag, id: nanoid() } as unknown as Tag);
    }
  }));
  return { folderId, notes: collections.notes.length, tasks: collections.tasks.length, timelineEvents: collections.timelineEvents.length,
    standaloneIOCs: collections.standaloneIOCs.length, evidenceItems: collections.evidenceItems.length, warnings: [...warnings] };
}

export interface MergeImportTableResult {
  incoming: number;
  added: number;
  updated: number;
  skipped: number;
}

export interface MergeImportInvestigationNoteSummary {
  folderId?: string;
  folderName: string;
  notes: number;
  activeNotes: number;
}

export interface MergeImportResult {
  added: number;
  skipped: number;
  updated: number;
  tables: Record<string, MergeImportTableResult>;
  noteInvestigations: MergeImportInvestigationNoteSummary[];
}

function countImportedNotesByInvestigation(
  notes: Note[],
  folders: Folder[],
): MergeImportInvestigationNoteSummary[] {
  const folderNames = new Map(folders.map((folder) => [folder.id, folder.name]));
  const counts = new Map<string, MergeImportInvestigationNoteSummary>();

  for (const note of notes) {
    const key = note.folderId || '__unfiled__';
    const existing = counts.get(key) || {
      folderId: note.folderId,
      folderName: note.folderId ? folderNames.get(note.folderId) || 'Unknown investigation' : 'No investigation',
      notes: 0,
      activeNotes: 0,
    };
    existing.notes += 1;
    if (!note.trashed && !note.archived) existing.activeNotes += 1;
    counts.set(key, existing);
  }

  return Array.from(counts.values()).sort((a, b) => b.notes - a.notes || a.folderName.localeCompare(b.folderName));
}

export async function mergeImportJSON(json: string): Promise<MergeImportResult> {
  if (json.length > MAX_IMPORT_SIZE) {
    throw new Error(`Backup file too large (max ${MAX_IMPORT_SIZE / 1024 / 1024} MB)`);
  }

  const data = JSON.parse(json);
  if (!data || typeof data !== 'object' || !Array.isArray(data.notes) || !Array.isArray(data.tasks)) {
    throw new Error('Invalid backup file format');
  }

  let added = 0;
  let skipped = 0;
  let updated = 0;
  const tables: Record<string, MergeImportTableResult> = {};

  async function mergeTable(
    name: string,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    table: { get: (id: string) => Promise<any>; add: (item: any) => Promise<unknown>; update: (id: string, changes: any) => Promise<number> },
    items: { id: string; updatedAt?: number }[],
  ) {
    const tableResult: MergeImportTableResult = { incoming: items.length, added: 0, updated: 0, skipped: 0 };
    for (const item of items) {
      if (!item.id) { skipped++; tableResult.skipped++; continue; }
      const existing = await table.get(item.id);
      if (existing) {
        if (item.updatedAt && existing.updatedAt && item.updatedAt > existing.updatedAt) {
          await table.update(item.id, item);
          updated++;
          tableResult.updated++;
        } else {
          skipped++;
          tableResult.skipped++;
        }
      } else {
        try {
          await table.add(item);
          added++;
          tableResult.added++;
        } catch {
          skipped++;
          tableResult.skipped++;
        }
      }
    }
    tables[name] = tableResult;
  }

  const allNotes = collapseEvidenceNoteSeries(data.notes.map(sanitizeNote).filter((n: Note | null): n is Note => n !== null && !!n.id));
  const notes = allNotes.filter((note) => !isBackupEvidenceNote(note));
  const tasks = data.tasks.map(sanitizeTask).filter((t: Task | null): t is Task => t !== null && !!t.id);
  const folders = (Array.isArray(data.folders) ? data.folders : [])
    .map(sanitizeFolder).filter((f: Folder | null): f is Folder => f !== null && !!f.id);
  const tags = (Array.isArray(data.tags) ? data.tags : [])
    .map(sanitizeTag).filter((t: Tag | null): t is Tag => t !== null && !!t.id);
  const timelineEvents = (Array.isArray(data.timelineEvents) ? data.timelineEvents : [])
    .map(sanitizeTimelineEvent).filter((e: TimelineEvent | null): e is TimelineEvent => e !== null && !!e.id);
  const timelines = (Array.isArray(data.timelines) ? data.timelines : [])
    .map(sanitizeTimeline).filter((t: Timeline | null): t is Timeline => t !== null && !!t.id);
  const whiteboards = (Array.isArray(data.whiteboards) ? data.whiteboards : [])
    .map(sanitizeWhiteboard).filter((w: Whiteboard | null): w is Whiteboard => w !== null && !!w.id);
  const standaloneIOCs = (Array.isArray(data.standaloneIOCs) ? data.standaloneIOCs : [])
    .map(sanitizeStandaloneIOC).filter((i: StandaloneIOC | null): i is StandaloneIOC => i !== null && !!i.id);
  const importedEvidenceItems = (Array.isArray(data.evidenceItems) ? data.evidenceItems : [])
    .map(sanitizeEvidenceItem).filter((item: EvidenceItem | null): item is EvidenceItem => item !== null && !!item.id);
  const evidenceItems = mergeEvidenceItemLists(importedEvidenceItems, evidenceItemsFromNotes(allNotes));
  const chatThreads = (Array.isArray(data.chatThreads) ? data.chatThreads : [])
    .map(sanitizeChatThread).filter((c: ChatThread | null): c is ChatThread => c !== null && !!c.id);

  const noteInvestigations = countImportedNotesByInvestigation(notes, folders);

  await db.transaction('rw', [db.notes, db.tasks, db.folders, db.tags, db.timelineEvents, db.timelines, db.whiteboards, db.standaloneIOCs, db.evidenceItems, db.chatThreads], async () => {
    await mergeTable('folders', db.folders, folders);
    await mergeTable('tags', db.tags, tags);
    await mergeTable('notes', db.notes, notes);
    await mergeTable('tasks', db.tasks, tasks);
    await mergeTable('timelineEvents', db.timelineEvents, timelineEvents);
    await mergeTable('timelines', db.timelines, timelines);
    await mergeTable('whiteboards', db.whiteboards, whiteboards);
    await mergeTable('standaloneIOCs', db.standaloneIOCs, standaloneIOCs);
    await mergeTable('evidenceItems', db.evidenceItems, evidenceItems);
    await mergeTable('chatThreads', db.chatThreads, chatThreads);
  });

  return { added, skipped, updated, tables, noteInvestigations };
}

export function downloadFile(content: string, filename: string, type: string) {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
