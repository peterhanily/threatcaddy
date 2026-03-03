import { nanoid } from 'nanoid';
import { db } from '../db';
import { extractIOCs } from './ioc-extractor';
import { buildGraphData } from './graph-data';
import type {
  Folder, IOCType, ConfidenceLevel, TimelineEventType, Priority, TaskStatus,
  ToolUseBlock, Note, Task,
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
    name: 'search_all',
    description: 'Search across all entity types (notes, tasks, IOCs, timeline events) simultaneously. Returns matching entities grouped by type.',
    input_schema: {
      type: 'object' as const,
      properties: {
        query: { type: 'string', description: 'Search keyword or phrase' },
        limit: { type: 'number', description: 'Max results per entity type (default 10)' },
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
  {
    name: 'analyze_graph',
    description: 'Analyze the entity relationship graph for the current investigation. Returns node/edge counts, most connected entities, IOC clusters, and optionally the shortest path between two entities.',
    input_schema: {
      type: 'object' as const,
      properties: {
        pathFrom: { type: 'string', description: 'Entity ID to find path from (optional). Use format like "note:ID", "task:ID", or "ioc:type:value".' },
        pathTo: { type: 'string', description: 'Entity ID to find path to (optional). Same format as pathFrom.' },
      },
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
    name: 'update_note',
    description: 'Update an existing note by ID. Only the provided fields are modified.',
    input_schema: {
      type: 'object' as const,
      properties: {
        id: { type: 'string', description: 'Note ID to update' },
        title: { type: 'string', description: 'New title (optional)' },
        content: { type: 'string', description: 'New content (optional, replaces entire content)' },
        appendContent: { type: 'string', description: 'Text to append to existing content (optional, alternative to content)' },
        tags: { type: 'array', items: { type: 'string' }, description: 'New tags (optional, replaces all tags)' },
      },
      required: ['id'],
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
    name: 'update_task',
    description: 'Update an existing task by ID. Only the provided fields are modified.',
    input_schema: {
      type: 'object' as const,
      properties: {
        id: { type: 'string', description: 'Task ID to update' },
        title: { type: 'string', description: 'New title (optional)' },
        description: { type: 'string', description: 'New description (optional)' },
        status: { type: 'string', enum: ['todo', 'in-progress', 'done'], description: 'New status (optional)' },
        priority: { type: 'string', enum: ['none', 'low', 'medium', 'high'], description: 'New priority (optional)' },
      },
      required: ['id'],
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
    name: 'bulk_create_iocs',
    description: 'Create multiple standalone IOCs at once. Useful when processing threat reports or bulk indicator lists.',
    input_schema: {
      type: 'object' as const,
      properties: {
        iocs: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              type: { type: 'string', description: 'IOC type' },
              value: { type: 'string', description: 'IOC value' },
              confidence: { type: 'string', description: 'Confidence level (default: medium)' },
              analystNotes: { type: 'string', description: 'Optional analyst notes' },
            },
            required: ['type', 'value'],
          },
          description: 'Array of IOCs to create',
        },
      },
      required: ['iocs'],
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
  {
    name: 'link_entities',
    description: 'Create cross-references between entities. Links are bidirectional where applicable.',
    input_schema: {
      type: 'object' as const,
      properties: {
        links: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              sourceType: { type: 'string', enum: ['note', 'task', 'timeline-event'], description: 'Source entity type' },
              sourceId: { type: 'string', description: 'Source entity ID' },
              targetType: { type: 'string', enum: ['note', 'task', 'timeline-event'], description: 'Target entity type' },
              targetId: { type: 'string', description: 'Target entity ID' },
            },
            required: ['sourceType', 'sourceId', 'targetType', 'targetId'],
          },
          description: 'Array of entity links to create',
        },
      },
      required: ['links'],
    },
  },
  {
    name: 'generate_report',
    description: 'Generate a structured investigation report as a new note. Includes executive summary, key findings, IOC table, timeline summary, and recommendations.',
    input_schema: {
      type: 'object' as const,
      properties: {
        title: { type: 'string', description: 'Report title (default: "Investigation Report")' },
        includeIOCTable: { type: 'boolean', description: 'Include IOC summary table (default: true)' },
        includeTimeline: { type: 'boolean', description: 'Include timeline summary (default: true)' },
        includeTaskStatus: { type: 'boolean', description: 'Include task status summary (default: true)' },
        executiveSummary: { type: 'string', description: 'Executive summary text (AI should write this based on investigation context)' },
        findings: { type: 'string', description: 'Key findings section (markdown)' },
        recommendations: { type: 'string', description: 'Recommendations section (markdown)' },
      },
      required: ['executiveSummary', 'findings'],
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
  let prompt = `You are ThreatCaddy AI, an investigation-aware security assistant. You have tools to read, create, update, and link investigation entities (notes, tasks, IOCs, timeline events). You can also analyze the entity relationship graph, generate reports, fetch web pages, and extract IOCs from text.

When creating or updating entities, confirm what you did. When searching, summarize findings concisely. When fetching URLs, summarize the content and offer to create notes or extract IOCs from it.

When you reference entities in your response, use this format so they become clickable links:
- Notes: [note:ID:Title]
- Tasks: [task:ID:Title]
- IOCs: [ioc:TYPE:VALUE]
- Timeline events: [event:ID:Title]

At the end of responses where you used search or analysis tools, add a line with suggested follow-up questions the user might want to ask. Format them as:
<!-- suggestions: Question 1 | Question 2 | Question 3 -->`;

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

async function executeSearchAll(input: Record<string, unknown>, folderId?: string): Promise<string> {
  const query = String(input.query || '').toLowerCase();
  const limit = Math.min(Number(input.limit) || 10, 30);
  if (!query) return JSON.stringify({ error: 'query is required' });

  const [notes, tasks, iocs, events] = await Promise.all([
    folderId
      ? db.notes.where('folderId').equals(folderId).and(n => !n.trashed).toArray()
      : db.notes.filter(n => !n.trashed).toArray(),
    folderId
      ? db.tasks.where('folderId').equals(folderId).and(t => !t.trashed).toArray()
      : db.tasks.filter(t => !t.trashed).toArray(),
    folderId
      ? db.standaloneIOCs.where('folderId').equals(folderId).and(i => !i.trashed).toArray()
      : db.standaloneIOCs.filter(i => !i.trashed).toArray(),
    folderId
      ? db.timelineEvents.where('folderId').equals(folderId).and(e => !e.trashed).toArray()
      : db.timelineEvents.filter(e => !e.trashed).toArray(),
  ]);

  const matchedNotes = notes
    .filter(n => n.title.toLowerCase().includes(query) || n.content.toLowerCase().includes(query))
    .slice(0, limit)
    .map(n => ({ id: n.id, title: n.title, snippet: snippet(n.content) }));

  const matchedTasks = tasks
    .filter(t => t.title.toLowerCase().includes(query) || (t.description || '').toLowerCase().includes(query))
    .slice(0, limit)
    .map(t => ({ id: t.id, title: t.title, status: t.status, priority: t.priority }));

  const matchedIOCs = iocs
    .filter(i => i.value.toLowerCase().includes(query) || (i.analystNotes || '').toLowerCase().includes(query))
    .slice(0, limit)
    .map(i => ({ id: i.id, type: i.type, value: i.value, confidence: i.confidence }));

  const matchedEvents = events
    .filter(e => e.title.toLowerCase().includes(query) || (e.description || '').toLowerCase().includes(query))
    .slice(0, limit)
    .map(e => ({ id: e.id, title: e.title, eventType: e.eventType, timestamp: new Date(e.timestamp).toISOString() }));

  return JSON.stringify({
    notes: { count: matchedNotes.length, results: matchedNotes },
    tasks: { count: matchedTasks.length, results: matchedTasks },
    iocs: { count: matchedIOCs.length, results: matchedIOCs },
    events: { count: matchedEvents.length, results: matchedEvents },
    totalMatches: matchedNotes.length + matchedTasks.length + matchedIOCs.length + matchedEvents.length,
  });
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

async function executeAnalyzeGraph(input: Record<string, unknown>, folderId?: string): Promise<string> {
  if (!folderId) {
    return JSON.stringify({ error: 'No investigation selected.' });
  }

  const [notes, tasks, events] = await Promise.all([
    db.notes.where('folderId').equals(folderId).and(n => !n.trashed).toArray(),
    db.tasks.where('folderId').equals(folderId).and(t => !t.trashed).toArray(),
    db.timelineEvents.where('folderId').equals(folderId).and(e => !e.trashed).toArray(),
  ]);

  const graph = buildGraphData(notes, tasks, events);

  // Compute degree for each node
  const degree = new Map<string, number>();
  for (const node of graph.nodes) degree.set(node.id, 0);
  for (const edge of graph.edges) {
    degree.set(edge.source, (degree.get(edge.source) || 0) + 1);
    degree.set(edge.target, (degree.get(edge.target) || 0) + 1);
  }

  // Top connected nodes
  const topNodes = [...degree.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([id, deg]) => {
      const node = graph.nodes.find(n => n.id === id);
      return { id, label: node?.label || id, type: node?.type, connections: deg };
    });

  // Node type breakdown
  const typeBreakdown: Record<string, number> = {};
  for (const node of graph.nodes) {
    typeBreakdown[node.type] = (typeBreakdown[node.type] || 0) + 1;
  }

  // Edge type breakdown
  const edgeBreakdown: Record<string, number> = {};
  for (const edge of graph.edges) {
    edgeBreakdown[edge.type] = (edgeBreakdown[edge.type] || 0) + 1;
  }

  // Isolated nodes (no connections)
  const isolated = graph.nodes.filter(n => (degree.get(n.id) || 0) === 0).length;

  // BFS shortest path if requested
  let path: { found: boolean; path?: string[]; length?: number } | undefined;
  if (input.pathFrom && input.pathTo) {
    const from = String(input.pathFrom);
    const to = String(input.pathTo);
    path = bfsPath(graph, from, to);
  }

  return JSON.stringify({
    totalNodes: graph.nodes.length,
    totalEdges: graph.edges.length,
    nodesByType: typeBreakdown,
    edgesByType: edgeBreakdown,
    isolatedNodes: isolated,
    topConnected: topNodes,
    ...(path ? { shortestPath: path } : {}),
  });
}

function bfsPath(graph: { nodes: { id: string; label: string }[]; edges: { source: string; target: string }[] }, from: string, to: string) {
  const adj = new Map<string, string[]>();
  for (const edge of graph.edges) {
    if (!adj.has(edge.source)) adj.set(edge.source, []);
    if (!adj.has(edge.target)) adj.set(edge.target, []);
    adj.get(edge.source)!.push(edge.target); // eslint-disable-line @typescript-eslint/no-non-null-assertion
    adj.get(edge.target)!.push(edge.source); // eslint-disable-line @typescript-eslint/no-non-null-assertion
  }

  const visited = new Set<string>();
  const queue: { node: string; path: string[] }[] = [{ node: from, path: [from] }];
  visited.add(from);

  while (queue.length > 0) {
    const current = queue.shift()!; // eslint-disable-line @typescript-eslint/no-non-null-assertion
    if (current.node === to) {
      const labels = current.path.map(id => {
        const n = graph.nodes.find(node => node.id === id);
        return n ? `${n.label} (${id})` : id;
      });
      return { found: true, path: labels, length: current.path.length - 1 };
    }
    for (const neighbor of adj.get(current.node) || []) {
      if (!visited.has(neighbor)) {
        visited.add(neighbor);
        queue.push({ node: neighbor, path: [...current.path, neighbor] });
      }
    }
  }
  return { found: false };
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

async function executeUpdateNote(input: Record<string, unknown>): Promise<string> {
  const id = String(input.id || '');
  if (!id) return JSON.stringify({ error: 'id is required' });

  const note = await db.notes.get(id);
  if (!note) return JSON.stringify({ error: 'Note not found' });

  const updates: Partial<Note> = { updatedAt: Date.now() };
  if (input.title !== undefined) updates.title = String(input.title);
  if (input.content !== undefined) updates.content = String(input.content);
  if (input.appendContent !== undefined) updates.content = note.content + '\n' + String(input.appendContent);
  if (input.tags !== undefined && Array.isArray(input.tags)) updates.tags = input.tags.map(String);

  await db.notes.update(id, updates);
  return JSON.stringify({ success: true, id, title: updates.title || note.title });
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

async function executeUpdateTask(input: Record<string, unknown>): Promise<string> {
  const id = String(input.id || '');
  if (!id) return JSON.stringify({ error: 'id is required' });

  const task = await db.tasks.get(id);
  if (!task) return JSON.stringify({ error: 'Task not found' });

  const updates: Partial<Task> = { updatedAt: Date.now() };
  if (input.title !== undefined) updates.title = String(input.title);
  if (input.description !== undefined) updates.description = String(input.description);
  if (input.status !== undefined) {
    updates.status = input.status as TaskStatus;
    updates.completed = input.status === 'done';
  }
  if (input.priority !== undefined) updates.priority = input.priority as Priority;

  await db.tasks.update(id, updates);
  return JSON.stringify({ success: true, id, title: updates.title || task.title });
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

async function executeBulkCreateIOCs(input: Record<string, unknown>, folderId?: string): Promise<string> {
  const iocInputs = input.iocs as Array<Record<string, unknown>>;
  if (!Array.isArray(iocInputs) || iocInputs.length === 0) {
    return JSON.stringify({ error: 'iocs array is required and must not be empty' });
  }

  const now = Date.now();
  const created: { id: string; type: string; value: string }[] = [];

  for (const iocInput of iocInputs) {
    const ioc = {
      id: nanoid(),
      type: (iocInput.type as IOCType) || 'domain',
      value: String(iocInput.value || ''),
      confidence: (iocInput.confidence as ConfidenceLevel) || 'medium',
      analystNotes: iocInput.analystNotes ? String(iocInput.analystNotes) : undefined,
      folderId: folderId || undefined,
      tags: [],
      trashed: false,
      archived: false,
      createdAt: now,
      updatedAt: now,
    };
    await db.standaloneIOCs.add(ioc);
    created.push({ id: ioc.id, type: ioc.type, value: ioc.value });
  }

  return JSON.stringify({ success: true, count: created.length, iocs: created });
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

async function executeLinkEntities(input: Record<string, unknown>): Promise<string> {
  const links = input.links as Array<Record<string, string>>;
  if (!Array.isArray(links) || links.length === 0) {
    return JSON.stringify({ error: 'links array is required' });
  }

  let linked = 0;
  const errors: string[] = [];

  for (const link of links) {
    const { sourceType, sourceId, targetType, targetId } = link;
    try {
      await addLink(sourceType, sourceId, targetType, targetId);
      linked++;
    } catch (err) {
      errors.push(`${sourceType}:${sourceId} → ${targetType}:${targetId}: ${(err as Error).message}`);
    }
  }

  return JSON.stringify({ success: true, linked, errors: errors.length > 0 ? errors : undefined });
}

async function addLink(sourceType: string, sourceId: string, targetType: string, targetId: string) {
  const linkField = targetType === 'note' ? 'linkedNoteIds'
    : targetType === 'task' ? 'linkedTaskIds'
    : targetType === 'timeline-event' ? 'linkedTimelineEventIds'
    : null;
  if (!linkField) throw new Error(`Unknown target type: ${targetType}`);

  const table = sourceType === 'note' ? db.notes
    : sourceType === 'task' ? db.tasks
    : sourceType === 'timeline-event' ? db.timelineEvents
    : null;
  if (!table) throw new Error(`Unknown source type: ${sourceType}`);

  const entity = await table.get(sourceId);
  if (!entity) throw new Error(`${sourceType} ${sourceId} not found`);

  const existing: string[] = (entity as unknown as Record<string, unknown>)[linkField] as string[] || [];
  if (!existing.includes(targetId)) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- dynamic link field update across union table types
    await (table as any).update(sourceId, { [linkField]: [...existing, targetId], updatedAt: Date.now() });
  }
}

async function executeGenerateReport(input: Record<string, unknown>, folderId?: string): Promise<string> {
  if (!folderId) {
    return JSON.stringify({ error: 'No investigation selected.' });
  }

  const folder = await db.folders.get(folderId);
  if (!folder) return JSON.stringify({ error: 'Investigation not found' });

  const includeIOCTable = input.includeIOCTable !== false;
  const includeTimeline = input.includeTimeline !== false;
  const includeTaskStatus = input.includeTaskStatus !== false;

  let report = `# ${input.title || 'Investigation Report'}\n\n`;
  report += `**Investigation:** ${folder.name}\n`;
  report += `**Generated:** ${new Date().toISOString().split('T')[0]}\n`;
  if (folder.status) report += `**Status:** ${folder.status}\n`;
  report += '\n---\n\n';

  // Executive Summary
  report += `## Executive Summary\n\n${input.executiveSummary || ''}\n\n`;

  // Key Findings
  report += `## Key Findings\n\n${input.findings || ''}\n\n`;

  // IOC Table
  if (includeIOCTable) {
    const iocs = await db.standaloneIOCs.where('folderId').equals(folderId).and(i => !i.trashed).toArray();
    if (iocs.length > 0) {
      report += '## Indicators of Compromise\n\n';
      report += '| Type | Value | Confidence | Notes |\n|------|-------|-----------|-------|\n';
      for (const ioc of iocs.slice(0, 50)) {
        report += `| ${ioc.type} | \`${ioc.value}\` | ${ioc.confidence} | ${snippet(ioc.analystNotes || '', 60)} |\n`;
      }
      if (iocs.length > 50) report += `\n*...and ${iocs.length - 50} more IOCs*\n`;
      report += '\n';
    }
  }

  // Timeline Summary
  if (includeTimeline) {
    const events = await db.timelineEvents.where('folderId').equals(folderId).and(e => !e.trashed).toArray();
    events.sort((a, b) => a.timestamp - b.timestamp);
    if (events.length > 0) {
      report += '## Timeline\n\n';
      for (const e of events.slice(0, 30)) {
        report += `- **${new Date(e.timestamp).toISOString().split('T')[0]}** — ${e.title}`;
        if (e.eventType !== 'other') report += ` *(${e.eventType})*`;
        report += '\n';
      }
      if (events.length > 30) report += `\n*...and ${events.length - 30} more events*\n`;
      report += '\n';
    }
  }

  // Task Status
  if (includeTaskStatus) {
    const tasks = await db.tasks.where('folderId').equals(folderId).and(t => !t.trashed).toArray();
    if (tasks.length > 0) {
      const todo = tasks.filter(t => t.status === 'todo').length;
      const inProgress = tasks.filter(t => t.status === 'in-progress').length;
      const done = tasks.filter(t => t.status === 'done').length;
      report += `## Task Status\n\n`;
      report += `- **Todo:** ${todo}\n- **In Progress:** ${inProgress}\n- **Done:** ${done}\n\n`;
    }
  }

  // Recommendations
  if (input.recommendations) {
    report += `## Recommendations\n\n${input.recommendations}\n\n`;
  }

  report += '---\n*Report generated by ThreatCaddy AI*\n';

  // Create the report as a note
  const now = Date.now();
  const note = {
    id: nanoid(),
    title: String(input.title || 'Investigation Report'),
    content: report,
    folderId,
    tags: ['report', 'ai-generated'],
    pinned: true,
    archived: false,
    trashed: false,
    createdAt: now,
    updatedAt: now,
  };
  await db.notes.add(note);

  return JSON.stringify({ success: true, id: note.id, title: note.title, contentLength: report.length });
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

const WRITE_TOOLS = new Set([
  'create_note', 'update_note',
  'create_task', 'update_task',
  'create_ioc', 'bulk_create_iocs',
  'create_timeline_event',
  'link_entities',
  'generate_report',
]);

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
      case 'search_all':              result = await executeSearchAll(inp, folderId); break;
      case 'read_note':               result = await executeReadNote(inp, folderId); break;
      case 'list_tasks':              result = await executeListTasks(inp, folderId); break;
      case 'list_iocs':               result = await executeListIOCs(inp, folderId); break;
      case 'list_timeline_events':    result = await executeListTimelineEvents(inp, folderId); break;
      case 'get_investigation_summary': result = await executeGetInvestigationSummary(inp, folderId); break;
      case 'analyze_graph':           result = await executeAnalyzeGraph(inp, folderId); break;
      case 'create_note':             result = await executeCreateNote(inp, folderId); break;
      case 'update_note':             result = await executeUpdateNote(inp); break;
      case 'create_task':             result = await executeCreateTask(inp, folderId); break;
      case 'update_task':             result = await executeUpdateTask(inp); break;
      case 'create_ioc':              result = await executeCreateIOC(inp, folderId); break;
      case 'bulk_create_iocs':        result = await executeBulkCreateIOCs(inp, folderId); break;
      case 'create_timeline_event':   result = await executeCreateTimelineEvent(inp, folderId); break;
      case 'link_entities':           result = await executeLinkEntities(inp); break;
      case 'generate_report':         result = await executeGenerateReport(inp, folderId); break;
      case 'extract_iocs':            result = executeExtractIOCs(inp); break;
      case 'fetch_url':               result = await executeFetchUrl(inp); break;
      default: result = JSON.stringify({ error: `Unknown tool: ${name}` });
    }
    return { result, isError: false };
  } catch (err) {
    return { result: JSON.stringify({ error: String((err as Error).message || err) }), isError: true };
  }
}
