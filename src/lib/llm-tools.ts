import { nanoid } from 'nanoid';
import { db } from '../db';
import { extractIOCs } from './ioc-extractor';
import type {
  Folder, IOCType, ConfidenceLevel, TimelineEventType, Priority, TaskStatus,
  ToolUseBlock,
} from '../types';

// ── Tool Definitions (Anthropic format) ────────────────────────────────

export const TOOL_DEFINITIONS = [
  // ── Read tools ─────────────────────────────────────────────────
  {
    name: 'search_notes',
    description: 'Search notes by keyword. Returns titles, snippets, and IDs of matching notes in the current investigation.',
    input_schema: {
      type: 'object' as const,
      properties: {
        query: { type: 'string', description: 'Search keyword or phrase' },
        limit: { type: 'number', description: 'Max results to return (default 10)' },
      },
      required: ['query'],
    },
  },
  {
    name: 'read_note',
    description: 'Get the full content of a specific note by its ID or title.',
    input_schema: {
      type: 'object' as const,
      properties: {
        id: { type: 'string', description: 'Note ID' },
        title: { type: 'string', description: 'Note title (exact or partial match). Used if id is not provided.' },
      },
      required: [],
    },
  },
  {
    name: 'list_tasks',
    description: 'List tasks in the current investigation, optionally filtered by status.',
    input_schema: {
      type: 'object' as const,
      properties: {
        status: { type: 'string', enum: ['todo', 'in-progress', 'done'], description: 'Filter by task status' },
        limit: { type: 'number', description: 'Max results (default 20)' },
      },
      required: [],
    },
  },
  {
    name: 'list_iocs',
    description: 'List standalone IOCs (indicators of compromise) in the current investigation.',
    input_schema: {
      type: 'object' as const,
      properties: {
        type: { type: 'string', description: 'Filter by IOC type (e.g. ipv4, domain, sha256)' },
        limit: { type: 'number', description: 'Max results (default 30)' },
      },
      required: [],
    },
  },
  {
    name: 'list_timeline_events',
    description: 'List timeline events in the current investigation with optional filters.',
    input_schema: {
      type: 'object' as const,
      properties: {
        eventType: { type: 'string', description: 'Filter by event type (e.g. initial-access, execution, detection)' },
        limit: { type: 'number', description: 'Max results (default 20)' },
      },
      required: [],
    },
  },
  {
    name: 'get_investigation_summary',
    description: 'Get entity counts and metadata for the current investigation.',
    input_schema: {
      type: 'object' as const,
      properties: {},
      required: [],
    },
  },

  // ── Write tools ────────────────────────────────────────────────
  {
    name: 'create_note',
    description: 'Create a new note in the current investigation.',
    input_schema: {
      type: 'object' as const,
      properties: {
        title: { type: 'string', description: 'Note title' },
        content: { type: 'string', description: 'Note content (markdown supported)' },
        tags: { type: 'array', items: { type: 'string' }, description: 'Optional tags' },
      },
      required: ['title', 'content'],
    },
  },
  {
    name: 'create_task',
    description: 'Create a new task in the current investigation.',
    input_schema: {
      type: 'object' as const,
      properties: {
        title: { type: 'string', description: 'Task title' },
        description: { type: 'string', description: 'Task description' },
        priority: { type: 'string', enum: ['none', 'low', 'medium', 'high'], description: 'Priority level (default: none)' },
        status: { type: 'string', enum: ['todo', 'in-progress', 'done'], description: 'Status (default: todo)' },
      },
      required: ['title'],
    },
  },
  {
    name: 'create_ioc',
    description: 'Create a standalone IOC (indicator of compromise) in the current investigation.',
    input_schema: {
      type: 'object' as const,
      properties: {
        type: { type: 'string', enum: ['ipv4','ipv6','domain','url','email','md5','sha1','sha256','cve','mitre-attack','yara-rule','sigma-rule','file-path'], description: 'IOC type' },
        value: { type: 'string', description: 'IOC value' },
        confidence: { type: 'string', enum: ['low', 'medium', 'high', 'confirmed'], description: 'Confidence level (default: medium)' },
        analystNotes: { type: 'string', description: 'Optional analyst notes' },
      },
      required: ['type', 'value'],
    },
  },
  {
    name: 'create_timeline_event',
    description: 'Create a new timeline event in the current investigation.',
    input_schema: {
      type: 'object' as const,
      properties: {
        title: { type: 'string', description: 'Event title' },
        description: { type: 'string', description: 'Event description' },
        timestamp: { type: 'string', description: 'ISO 8601 date string (e.g. 2025-01-15T14:30:00Z)' },
        eventType: { type: 'string', enum: [
          'initial-access','execution','persistence','privilege-escalation',
          'defense-evasion','credential-access','discovery','lateral-movement',
          'collection','exfiltration','command-and-control','impact',
          'detection','containment','eradication','recovery',
          'communication','evidence','other'
        ], description: 'Event type (default: other)' },
        source: { type: 'string', description: 'Source of the event' },
        latitude: { type: 'number', description: 'WGS84 latitude (-90 to 90)' },
        longitude: { type: 'number', description: 'WGS84 longitude (-180 to 180)' },
      },
      required: ['title', 'timestamp'],
    },
  },

  // ── Web tools ────────────────────────────────────────────────
  {
    name: 'fetch_url',
    description: 'Fetch and extract readable text content from a URL. Returns the page title and content converted to markdown. Use this when the user provides a URL and wants you to read, summarize, or extract information from it.',
    input_schema: {
      type: 'object' as const,
      properties: {
        url: { type: 'string', description: 'The URL to fetch (must be http or https)' },
      },
      required: ['url'],
    },
  },

  // ── Analysis tools ─────────────────────────────────────────────
  {
    name: 'extract_iocs',
    description: 'Run IOC (indicator of compromise) extraction on the given text. Extracts IPs, domains, URLs, hashes, CVEs, MITRE ATT&CK IDs, etc.',
    input_schema: {
      type: 'object' as const,
      properties: {
        text: { type: 'string', description: 'Text to extract IOCs from' },
      },
      required: ['text'],
    },
  },
];

// ── System Prompt Builder ──────────────────────────────────────────────

export async function buildSystemPrompt(folder?: Folder): Promise<string> {
  let prompt = `You are ThreatCaddy AI, an investigation-aware security assistant. You have tools to read and create investigation entities (notes, tasks, IOCs, timeline events). You can also fetch and read web pages by URL. Use your tools when the user asks about their investigation data, wants to create new entities, or asks you to read a URL.

When creating entities, confirm what you created. When searching, summarize findings concisely. When fetching URLs, summarize the content and offer to create notes or extract IOCs from it.`;

  if (folder) {
    prompt += `\n\nCurrent investigation: "${folder.name}"`;
    if (folder.description) prompt += `\nDescription: ${folder.description}`;
    if (folder.status) prompt += `\nStatus: ${folder.status}`;

    // Add entity counts for context
    const [noteCount, taskCount, iocCount, eventCount] = await Promise.all([
      db.notes.where('folderId').equals(folder.id).and(n => !n.trashed).count(),
      db.tasks.where('folderId').equals(folder.id).and(t => !t.trashed).count(),
      db.standaloneIOCs.where('folderId').equals(folder.id).and(i => !i.trashed).count(),
      db.timelineEvents.where('folderId').equals(folder.id).and(e => !e.trashed).count(),
    ]);

    prompt += `\n\nInvestigation entities: ${noteCount} notes, ${taskCount} tasks, ${iocCount} IOCs, ${eventCount} timeline events`;
  }

  return prompt;
}

// ── Tool Executors ─────────────────────────────────────────────────────

const MAX_SNIPPET = 200;
const MAX_CONTENT = 8000;

function snippet(text: string, maxLen = MAX_SNIPPET): string {
  if (text.length <= maxLen) return text;
  return text.slice(0, maxLen) + '…';
}

async function executeSearchNotes(input: Record<string, unknown>, folderId?: string): Promise<string> {
  const query = String(input.query || '').toLowerCase();
  const limit = Math.min(Number(input.limit) || 10, 30);
  if (!query) return JSON.stringify({ error: 'query is required' });

  let notes = await db.notes.where('folderId').equals(folderId || '').and(n => !n.trashed).toArray();
  if (!folderId) {
    notes = await db.notes.filter(n => !n.trashed).toArray();
  }

  const matches = notes
    .filter(n => n.title.toLowerCase().includes(query) || n.content.toLowerCase().includes(query))
    .slice(0, limit)
    .map(n => ({ id: n.id, title: n.title, snippet: snippet(n.content), tags: n.tags }));

  return JSON.stringify({ count: matches.length, notes: matches });
}

async function executeReadNote(input: Record<string, unknown>, folderId?: string): Promise<string> {
  const id = String(input.id || '');
  const title = String(input.title || '');

  let note;
  if (id) {
    note = await db.notes.get(id);
  } else if (title) {
    const lower = title.toLowerCase();
    const all = folderId
      ? await db.notes.where('folderId').equals(folderId).and(n => !n.trashed).toArray()
      : await db.notes.filter(n => !n.trashed).toArray();
    note = all.find(n => n.title.toLowerCase() === lower)
      || all.find(n => n.title.toLowerCase().includes(lower));
  }

  if (!note) return JSON.stringify({ error: 'Note not found' });

  const content = note.content.length > MAX_CONTENT
    ? note.content.slice(0, MAX_CONTENT) + '\n…(truncated)'
    : note.content;

  return JSON.stringify({ id: note.id, title: note.title, content, tags: note.tags, createdAt: note.createdAt, updatedAt: note.updatedAt });
}

async function executeListTasks(input: Record<string, unknown>, folderId?: string): Promise<string> {
  const statusFilter = input.status as TaskStatus | undefined;
  const limit = Math.min(Number(input.limit) || 20, 50);

  let tasks = folderId
    ? await db.tasks.where('folderId').equals(folderId).and(t => !t.trashed).toArray()
    : await db.tasks.filter(t => !t.trashed).toArray();

  if (statusFilter) tasks = tasks.filter(t => t.status === statusFilter);
  tasks = tasks.slice(0, limit);

  const result = tasks.map(t => ({
    id: t.id, title: t.title, status: t.status, priority: t.priority,
    description: snippet(t.description || ''), completed: t.completed,
  }));

  return JSON.stringify({ count: result.length, tasks: result });
}

async function executeListIOCs(input: Record<string, unknown>, folderId?: string): Promise<string> {
  const typeFilter = input.type as IOCType | undefined;
  const limit = Math.min(Number(input.limit) || 30, 100);

  let iocs = folderId
    ? await db.standaloneIOCs.where('folderId').equals(folderId).and(i => !i.trashed).toArray()
    : await db.standaloneIOCs.filter(i => !i.trashed).toArray();

  if (typeFilter) iocs = iocs.filter(i => i.type === typeFilter);
  iocs = iocs.slice(0, limit);

  const result = iocs.map(i => ({
    id: i.id, type: i.type, value: i.value, confidence: i.confidence,
    analystNotes: snippet(i.analystNotes || ''),
  }));

  return JSON.stringify({ count: result.length, iocs: result });
}

async function executeListTimelineEvents(input: Record<string, unknown>, folderId?: string): Promise<string> {
  const eventTypeFilter = input.eventType as TimelineEventType | undefined;
  const limit = Math.min(Number(input.limit) || 20, 50);

  let events = folderId
    ? await db.timelineEvents.where('folderId').equals(folderId).and(e => !e.trashed).toArray()
    : await db.timelineEvents.filter(e => !e.trashed).toArray();

  if (eventTypeFilter) events = events.filter(e => e.eventType === eventTypeFilter);
  events.sort((a, b) => a.timestamp - b.timestamp);
  events = events.slice(0, limit);

  const result = events.map(e => ({
    id: e.id, title: e.title, timestamp: new Date(e.timestamp).toISOString(),
    eventType: e.eventType, description: snippet(e.description || ''),
    source: e.source,
  }));

  return JSON.stringify({ count: result.length, events: result });
}

async function executeGetInvestigationSummary(_input: Record<string, unknown>, folderId?: string): Promise<string> {
  if (!folderId) {
    return JSON.stringify({ error: 'No investigation selected. Select an investigation folder first.' });
  }

  const folder = await db.folders.get(folderId);
  if (!folder) return JSON.stringify({ error: 'Investigation not found' });

  const [noteCount, taskCount, iocCount, eventCount] = await Promise.all([
    db.notes.where('folderId').equals(folderId).and(n => !n.trashed).count(),
    db.tasks.where('folderId').equals(folderId).and(t => !t.trashed).count(),
    db.standaloneIOCs.where('folderId').equals(folderId).and(i => !i.trashed).count(),
    db.timelineEvents.where('folderId').equals(folderId).and(e => !e.trashed).count(),
  ]);

  // Task breakdown
  const tasks = await db.tasks.where('folderId').equals(folderId).and(t => !t.trashed).toArray();
  const tasksByStatus = { todo: 0, 'in-progress': 0, done: 0 };
  tasks.forEach(t => { tasksByStatus[t.status] = (tasksByStatus[t.status] || 0) + 1; });

  return JSON.stringify({
    name: folder.name,
    description: folder.description || '',
    status: folder.status || 'active',
    counts: { notes: noteCount, tasks: taskCount, iocs: iocCount, timelineEvents: eventCount },
    tasksByStatus,
    createdAt: new Date(folder.createdAt).toISOString(),
  });
}

async function executeCreateNote(input: Record<string, unknown>, folderId?: string): Promise<string> {
  const now = Date.now();
  const note = {
    id: nanoid(),
    title: String(input.title || 'Untitled'),
    content: String(input.content || ''),
    folderId: folderId || undefined,
    tags: Array.isArray(input.tags) ? input.tags.map(String) : [],
    pinned: false,
    archived: false,
    trashed: false,
    createdAt: now,
    updatedAt: now,
  };
  await db.notes.add(note);
  return JSON.stringify({ success: true, id: note.id, title: note.title });
}

async function executeCreateTask(input: Record<string, unknown>, folderId?: string): Promise<string> {
  const now = Date.now();
  const count = folderId
    ? await db.tasks.where('folderId').equals(folderId).count()
    : await db.tasks.count();

  const task = {
    id: nanoid(),
    title: String(input.title || 'Untitled Task'),
    description: input.description ? String(input.description) : undefined,
    completed: false,
    priority: (input.priority as Priority) || 'none',
    status: (input.status as TaskStatus) || 'todo',
    order: count,
    folderId: folderId || undefined,
    tags: [],
    trashed: false,
    archived: false,
    createdAt: now,
    updatedAt: now,
  };
  await db.tasks.add(task);
  return JSON.stringify({ success: true, id: task.id, title: task.title });
}

async function executeCreateIOC(input: Record<string, unknown>, folderId?: string): Promise<string> {
  const now = Date.now();
  const ioc = {
    id: nanoid(),
    type: (input.type as IOCType) || 'domain',
    value: String(input.value || ''),
    confidence: (input.confidence as ConfidenceLevel) || 'medium',
    analystNotes: input.analystNotes ? String(input.analystNotes) : undefined,
    folderId: folderId || undefined,
    tags: [],
    trashed: false,
    archived: false,
    createdAt: now,
    updatedAt: now,
  };
  await db.standaloneIOCs.add(ioc);
  return JSON.stringify({ success: true, id: ioc.id, type: ioc.type, value: ioc.value });
}

async function executeCreateTimelineEvent(input: Record<string, unknown>, folderId?: string): Promise<string> {
  const now = Date.now();
  let timestamp = now;
  if (input.timestamp) {
    const parsed = new Date(String(input.timestamp)).getTime();
    if (!isNaN(parsed)) timestamp = parsed;
  }

  // Get the folder's default timeline
  let timelineId = '';
  if (folderId) {
    const folder = await db.folders.get(folderId);
    if (folder?.timelineId) {
      timelineId = folder.timelineId;
    }
  }
  // Fallback: use first timeline
  if (!timelineId) {
    const first = await db.timelines.orderBy('order').first();
    if (first) timelineId = first.id;
  }

  // Validate geo coordinates if provided
  const lat = typeof input.latitude === 'number' ? input.latitude : undefined;
  const lng = typeof input.longitude === 'number' ? input.longitude : undefined;
  const hasGeo = lat !== undefined && lng !== undefined
    && lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180;

  const event = {
    id: nanoid(),
    timestamp,
    title: String(input.title || 'Untitled Event'),
    description: input.description ? String(input.description) : undefined,
    eventType: (input.eventType as TimelineEventType) || 'other',
    source: input.source ? String(input.source) : 'AI Chat',
    confidence: 'medium' as const,
    linkedIOCIds: [],
    linkedNoteIds: [],
    linkedTaskIds: [],
    mitreAttackIds: [],
    assets: [],
    tags: [],
    starred: false,
    folderId: folderId || undefined,
    timelineId,
    ...(hasGeo ? { latitude: lat, longitude: lng } : {}),
    trashed: false,
    archived: false,
    createdAt: now,
    updatedAt: now,
  };
  await db.timelineEvents.add(event);
  return JSON.stringify({ success: true, id: event.id, title: event.title, timestamp: new Date(timestamp).toISOString() });
}

function executeExtractIOCs(input: Record<string, unknown>): string {
  const text = String(input.text || '');
  if (!text) return JSON.stringify({ error: 'text is required' });

  const iocs = extractIOCs(text);
  const grouped: Record<string, string[]> = {};
  for (const ioc of iocs) {
    if (!grouped[ioc.type]) grouped[ioc.type] = [];
    grouped[ioc.type].push(ioc.value);
  }

  return JSON.stringify({ totalFound: iocs.length, byType: grouped });
}

export function fetchViaExtensionBridge(url: string): Promise<{ success: boolean; title?: string; content?: string; error?: string }> {
  const requestId = Math.random().toString(36).slice(2);
  return new Promise((resolve) => {
    const timeout = setTimeout(() => {
      window.removeEventListener('message', handler);
      resolve({ success: false, error: 'Extension bridge timed out. Make sure the ThreatCaddy extension is installed and the page has been reloaded after installation.' });
    }, 20000);

    function handler(event: MessageEvent) {
      if (event.data?.type !== 'TC_FETCH_URL_RESULT') return;
      if (event.data.requestId !== requestId) return;
      window.removeEventListener('message', handler);
      clearTimeout(timeout);
      resolve({
        success: !!event.data.success,
        title: event.data.title,
        content: event.data.content,
        error: event.data.error,
      });
    }

    window.addEventListener('message', handler);
    window.postMessage({ type: 'TC_FETCH_URL', requestId, url }, '*');
  });
}

async function executeFetchUrl(input: Record<string, unknown>): Promise<string> {
  const url = String(input.url || '');
  if (!url) return JSON.stringify({ error: 'url is required' });

  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return JSON.stringify({ error: 'Invalid URL' });
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return JSON.stringify({ error: 'Only http and https URLs are supported' });
  }

  // Use extension bridge — background SW bypasses CORS
  const result = await fetchViaExtensionBridge(url);
  if (result.success) {
    // Cap content to ~12KB to keep context window manageable for the LLM
    let content = result.content || '';
    if (content.length > 12000) {
      content = content.substring(0, 12000) + '\n\n...(truncated to fit context window)';
    }
    return JSON.stringify({ title: result.title || '', content, url });
  }
  return JSON.stringify({ error: result.error || 'Failed to fetch URL' });
}

// ── Dispatcher ─────────────────────────────────────────────────────────

const WRITE_TOOLS = new Set(['create_note', 'create_task', 'create_ioc', 'create_timeline_event']);

export function isWriteTool(name: string): boolean {
  return WRITE_TOOLS.has(name);
}

export async function executeTool(
  toolUse: ToolUseBlock,
  folderId?: string,
): Promise<{ result: string; isError: boolean }> {
  const { name, input } = toolUse;
  const inp = input as Record<string, unknown>;

  try {
    let result: string;
    switch (name) {
      case 'search_notes':            result = await executeSearchNotes(inp, folderId); break;
      case 'read_note':               result = await executeReadNote(inp, folderId); break;
      case 'list_tasks':              result = await executeListTasks(inp, folderId); break;
      case 'list_iocs':               result = await executeListIOCs(inp, folderId); break;
      case 'list_timeline_events':    result = await executeListTimelineEvents(inp, folderId); break;
      case 'get_investigation_summary': result = await executeGetInvestigationSummary(inp, folderId); break;
      case 'create_note':             result = await executeCreateNote(inp, folderId); break;
      case 'create_task':             result = await executeCreateTask(inp, folderId); break;
      case 'create_ioc':              result = await executeCreateIOC(inp, folderId); break;
      case 'create_timeline_event':   result = await executeCreateTimelineEvent(inp, folderId); break;
      case 'extract_iocs':            result = executeExtractIOCs(inp); break;
      case 'fetch_url':               result = await executeFetchUrl(inp); break;
      default: result = JSON.stringify({ error: `Unknown tool: ${name}` });
    }
    return { result, isError: false };
  } catch (err) {
    return { result: JSON.stringify({ error: String((err as Error).message || err) }), isError: true };
  }
}
