import { db } from '../db';
import type { Note, Task, Folder, Tag, TimelineEvent, Timeline, Whiteboard, StandaloneIOC, ChatThread, ChatMessage, NoteTemplate, PlaybookTemplate, PlaybookStep, ExportData, TimelineExportData, TimelineEventType, ConfidenceLevel, IOCAnalysis, IOCEntry, IOCRelationship, TaskComment, NoteAnnotation, QuickLink, LLMProvider, IOCType, TemplateSource, PlaybookStepEntity } from '../types';
import { TIMELINE_EVENT_TYPE_LABELS, CONFIDENCE_LEVELS, IOC_TYPE_LABELS } from '../types';
import { nanoid } from 'nanoid';

export async function exportJSON(): Promise<string> {
  const [notes, tasks, folders, tags, timelineEvents, timelines, whiteboards, standaloneIOCs, chatThreads, noteTemplates, playbookTemplates] = await Promise.all([
    db.notes.toArray(),
    db.tasks.toArray(),
    db.folders.toArray(),
    db.tags.toArray(),
    db.timelineEvents.toArray(),
    db.timelines.toArray(),
    db.whiteboards.toArray(),
    db.standaloneIOCs.toArray(),
    db.chatThreads.toArray(),
    db.noteTemplates.toArray(),
    db.playbookTemplates.toArray(),
  ]);

  // Include quick links from settings if user has customized them
  let quickLinks: QuickLink[] | undefined;
  try {
    const stored = localStorage.getItem('threatcaddy-settings');
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
    chatThreads,
    quickLinks,
    noteTemplates: noteTemplates.length > 0 ? noteTemplates : undefined,
    playbookTemplates: playbookTemplates.length > 0 ? playbookTemplates : undefined,
  };

  return JSON.stringify(data, null, 2);
}

const MAX_IMPORT_SIZE = 50 * 1024 * 1024; // 50 MB
const MAX_ITEMS = 100_000;

function str(v: unknown, fallback = ''): string {
  return typeof v === 'string' ? v : fallback;
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

function sanitizeTask(raw: unknown): Task | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  return {
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
    archived: bool(r.archived),
    completedAt: r.completedAt != null ? num(r.completedAt) : undefined,
    assigneeId: r.assigneeId != null ? str(r.assigneeId) : undefined,
  };
}

const VALID_INVESTIGATION_STATUS = ['active', 'closed', 'archived'];
const VALID_CLOSURE_RESOLUTIONS = ['resolved', 'false-positive', 'escalated', 'duplicate', 'inconclusive'];

function sanitizeFolder(raw: unknown): Folder | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  return {
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
    timelineId: r.timelineId != null ? str(r.timelineId) : undefined,
    closureResolution: r.closureResolution != null && VALID_CLOSURE_RESOLUTIONS.includes(str(r.closureResolution))
      ? str(r.closureResolution) as Folder['closureResolution']
      : undefined,
    closedReason: r.closedReason != null ? str(r.closedReason) : undefined,
    closedAt: r.closedAt != null ? num(r.closedAt) : undefined,
  };
}

function sanitizeTag(raw: unknown): Tag | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  return {
    id: str(r.id),
    name: str(r.name),
    color: str(r.color, '#6366f1'),
  };
}

const VALID_EVENT_TYPES = Object.keys(TIMELINE_EVENT_TYPE_LABELS) as string[];
const VALID_CONFIDENCE = Object.keys(CONFIDENCE_LEVELS) as string[];

function sanitizeTimelineEvent(raw: unknown): TimelineEvent | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  return {
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
    comments: Array.isArray(r.comments) ? r.comments as TimelineEvent['comments'] : undefined,
    trashed: bool(r.trashed),
    archived: bool(r.archived),
    createdAt: num(r.createdAt, Date.now()),
    updatedAt: num(r.updatedAt, Date.now()),
  };
}

function sanitizeTimeline(raw: unknown): Timeline | null {
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

function sanitizeWhiteboard(raw: unknown): Whiteboard | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  return {
    id: str(r.id),
    name: str(r.name),
    elements: str(r.elements, '[]'),
    appState: r.appState != null ? str(r.appState) : undefined,
    folderId: r.folderId != null ? str(r.folderId) : undefined,
    tags: strArr(r.tags),
    trashed: bool(r.trashed),
    archived: bool(r.archived),
    order: num(r.order),
    createdAt: num(r.createdAt, Date.now()),
    updatedAt: num(r.updatedAt, Date.now()),
  };
}

const VALID_LLM_PROVIDERS = ['anthropic', 'openai', 'gemini', 'mistral', 'local'];

function sanitizeStandaloneIOC(raw: unknown): StandaloneIOC | null {
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
    comments: Array.isArray(r.comments) ? r.comments as StandaloneIOC['comments'] : undefined,
    assigneeId: r.assigneeId != null ? str(r.assigneeId) : undefined,
    assigneeName: r.assigneeName != null ? str(r.assigneeName) : undefined,
    trashed: bool(r.trashed),
    trashedAt: r.trashedAt != null ? num(r.trashedAt) : undefined,
    archived: bool(r.archived),
    createdAt: num(r.createdAt, Date.now()),
    updatedAt: num(r.updatedAt, Date.now()),
  };
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

function sanitizeChatThread(raw: unknown): ChatThread | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const provider = str(r.provider, 'anthropic');
  return {
    id: str(r.id),
    title: str(r.title),
    messages: Array.isArray(r.messages)
      ? (r.messages as unknown[]).map(sanitizeChatMessage).filter((m): m is ChatMessage => m !== null)
      : [],
    model: str(r.model, 'claude-sonnet-4-6'),
    provider: (VALID_LLM_PROVIDERS.includes(provider) ? provider : 'anthropic') as LLMProvider,
    folderId: r.folderId != null ? str(r.folderId) : undefined,
    tags: strArr(r.tags),
    trashed: bool(r.trashed),
    trashedAt: r.trashedAt != null ? num(r.trashedAt) : undefined,
    archived: bool(r.archived),
    createdAt: num(r.createdAt, Date.now()),
    updatedAt: num(r.updatedAt, Date.now()),
  };
}

const VALID_TEMPLATE_SOURCES = ['builtin', 'user', 'team'];
const VALID_PLAYBOOK_STEP_ENTITIES = ['task', 'note'];

function sanitizeNoteTemplate(raw: unknown): NoteTemplate | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const source = str(r.source, 'user');
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
    createdAt: num(r.createdAt, Date.now()),
    updatedAt: num(r.updatedAt, Date.now()),
  };
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
  return {
    id: str(r.id),
    title: str(r.title),
    url: str(r.url),
    description: r.description != null ? str(r.description) : undefined,
    color: r.color != null ? str(r.color) : undefined,
    icon: r.icon != null ? str(r.icon) : undefined,
  };
}

export async function importJSON(json: string): Promise<{ notes: number; tasks: number; folders: number; tags: number; timelineEvents: number; timelines: number; whiteboards: number; standaloneIOCs: number; chatThreads: number; noteTemplates: number; playbookTemplates: number }> {
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
  const notes = data.notes.map(sanitizeNote).filter((n: Note | null): n is Note => n !== null && !!n.id);
  const tasks = data.tasks.map(sanitizeTask).filter((t: Task | null): t is Task => t !== null && !!t.id);
  const folders = data.folders.map(sanitizeFolder).filter((f: Folder | null): f is Folder => f !== null && !!f.id);
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

  const chatThreads = (Array.isArray(data.chatThreads) ? data.chatThreads : [])
    .map(sanitizeChatThread)
    .filter((c: ChatThread | null): c is ChatThread => c !== null && !!c.id);

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

  await db.transaction('rw', [db.notes, db.tasks, db.folders, db.tags, db.timelineEvents, db.timelines, db.whiteboards, db.standaloneIOCs, db.chatThreads, db.noteTemplates, db.playbookTemplates], async () => {
    await db.notes.clear();
    await db.tasks.clear();
    await db.folders.clear();
    await db.tags.clear();
    await db.timelineEvents.clear();
    await db.timelines.clear();
    await db.whiteboards.clear();
    await db.standaloneIOCs.clear();
    await db.chatThreads.clear();
    await db.noteTemplates.clear();
    await db.playbookTemplates.clear();

    await db.notes.bulkAdd(notes);
    await db.tasks.bulkAdd(tasks);
    await db.folders.bulkAdd(folders);
    await db.tags.bulkAdd(tags);
    await db.timelineEvents.bulkAdd(timelineEvents);
    await db.timelines.bulkAdd(timelines);
    await db.whiteboards.bulkAdd(whiteboards);
    await db.standaloneIOCs.bulkAdd(standaloneIOCs);
    await db.chatThreads.bulkAdd(chatThreads);
    if (noteTemplatesRaw.length > 0) await db.noteTemplates.bulkAdd(noteTemplatesRaw);
    if (playbookTemplatesRaw.length > 0) await db.playbookTemplates.bulkAdd(playbookTemplatesRaw);
  });

  // Restore quick links to settings if present in backup
  if (quickLinks.length > 0) {
    try {
      const stored = localStorage.getItem('threatcaddy-settings');
      const settings = stored ? JSON.parse(stored) : {};
      settings.quickLinks = quickLinks;
      localStorage.setItem('threatcaddy-settings', JSON.stringify(settings));
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
    chatThreads: chatThreads.length,
    noteTemplates: noteTemplatesRaw.length,
    playbookTemplates: playbookTemplatesRaw.length,
  };
}

export async function exportInvestigationJSON(folderId: string): Promise<string> {
  const [folder, allNotes, allTasks, allTags, allEvents, allTimelines, allWhiteboards, allIOCs, allChats] = await Promise.all([
    db.folders.get(folderId),
    db.notes.where('folderId').equals(folderId).toArray(),
    db.tasks.where('folderId').equals(folderId).toArray(),
    db.tags.toArray(),
    db.timelineEvents.where('folderId').equals(folderId).toArray(),
    db.timelines.toArray(),
    db.whiteboards.where('folderId').equals(folderId).toArray(),
    db.standaloneIOCs.where('folderId').equals(folderId).toArray(),
    db.chatThreads.where('folderId').equals(folderId).toArray(),
  ]);

  if (!folder) throw new Error('Investigation not found');

  // Collect all tag names used in this investigation's entities
  const usedTagNames = new Set<string>();
  for (const n of allNotes) n.tags.forEach((t) => usedTagNames.add(t));
  for (const t of allTasks) t.tags.forEach((tg) => usedTagNames.add(tg));
  for (const e of allEvents) e.tags.forEach((tg) => usedTagNames.add(tg));
  for (const w of allWhiteboards) w.tags.forEach((tg) => usedTagNames.add(tg));
  for (const i of allIOCs) i.tags.forEach((tg) => usedTagNames.add(tg));
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
    notes: allNotes,
    tasks: allTasks,
    folders: [folder],
    tags,
    timelineEvents: allEvents,
    timelines,
    whiteboards: allWhiteboards,
    standaloneIOCs: allIOCs,
    chatThreads: allChats,
  };

  return JSON.stringify(data, null, 2);
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

export function downloadFile(content: string, filename: string, type: string) {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
