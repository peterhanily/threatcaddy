import { db } from '../db';
import type { IOCType, TimelineEventType, TaskStatus } from '../types';

const MAX_SNIPPET = 200;
const MAX_CONTENT = 8000;

function snippet(text: string, maxLen = MAX_SNIPPET): string {
  if (text.length <= maxLen) return text;
  return text.slice(0, maxLen) + '…';
}

export async function executeSearchNotes(input: Record<string, unknown>, folderId?: string): Promise<string> {
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

export async function executeSearchAll(input: Record<string, unknown>, folderId?: string): Promise<string> {
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

export async function executeReadNote(input: Record<string, unknown>, folderId?: string): Promise<string> {
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

export async function executeListTasks(input: Record<string, unknown>, folderId?: string): Promise<string> {
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

export async function executeListIOCs(input: Record<string, unknown>, folderId?: string): Promise<string> {
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

export async function executeListTimelineEvents(input: Record<string, unknown>, folderId?: string): Promise<string> {
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

export async function executeGetInvestigationSummary(_input: Record<string, unknown>, folderId?: string): Promise<string> {
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
