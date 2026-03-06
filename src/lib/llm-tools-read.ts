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

export async function executeListInvestigations(input: Record<string, unknown>): Promise<string> {
  const statusFilter = input.status as string | undefined;
  const limit = Math.min(Number(input.limit) || 20, 50);

  let folders = await db.folders.toArray();
  if (statusFilter) folders = folders.filter(f => (f.status || 'active') === statusFilter);
  folders.sort((a, b) => (b.updatedAt || b.createdAt) - (a.updatedAt || a.createdAt));
  folders = folders.slice(0, limit);

  const results = await Promise.all(folders.map(async (f) => {
    const [noteCount, taskCount, iocCount, eventCount] = await Promise.all([
      db.notes.where('folderId').equals(f.id).and(n => !n.trashed).count(),
      db.tasks.where('folderId').equals(f.id).and(t => !t.trashed).count(),
      db.standaloneIOCs.where('folderId').equals(f.id).and(i => !i.trashed).count(),
      db.timelineEvents.where('folderId').equals(f.id).and(e => !e.trashed).count(),
    ]);
    return {
      id: f.id,
      name: f.name,
      status: f.status || 'active',
      description: f.description ? snippet(f.description) : '',
      counts: { notes: noteCount, tasks: taskCount, iocs: iocCount, events: eventCount },
      clsLevel: f.clsLevel,
      createdAt: new Date(f.createdAt).toISOString(),
      updatedAt: new Date(f.updatedAt || f.createdAt).toISOString(),
    };
  }));

  return JSON.stringify({ count: results.length, investigations: results });
}

export async function executeGetInvestigationDetails(input: Record<string, unknown>): Promise<string> {
  const id = String(input.id || '');
  const name = String(input.name || '');

  let folder;
  if (id) {
    folder = await db.folders.get(id);
  } else if (name) {
    const lower = name.toLowerCase();
    const all = await db.folders.toArray();
    folder = all.find(f => f.name.toLowerCase() === lower)
      || all.find(f => f.name.toLowerCase().includes(lower));
  }

  if (!folder) return JSON.stringify({ error: 'Investigation not found' });

  const [notes, tasks, iocs, events] = await Promise.all([
    db.notes.where('folderId').equals(folder.id).and(n => !n.trashed).toArray(),
    db.tasks.where('folderId').equals(folder.id).and(t => !t.trashed).toArray(),
    db.standaloneIOCs.where('folderId').equals(folder.id).and(i => !i.trashed).toArray(),
    db.timelineEvents.where('folderId').equals(folder.id).and(e => !e.trashed).toArray(),
  ]);

  const tasksByStatus = { todo: 0, 'in-progress': 0, done: 0 };
  tasks.forEach(t => { tasksByStatus[t.status] = (tasksByStatus[t.status] || 0) + 1; });

  const topIOCs = iocs.slice(0, 10).map(i => ({ type: i.type, value: i.value, confidence: i.confidence }));

  const recentNotes = notes
    .sort((a, b) => b.updatedAt - a.updatedAt)
    .slice(0, 5)
    .map(n => ({ id: n.id, title: n.title }));

  return JSON.stringify({
    id: folder.id,
    name: folder.name,
    description: folder.description || '',
    status: folder.status || 'active',
    clsLevel: folder.clsLevel,
    papLevel: folder.papLevel,
    counts: { notes: notes.length, tasks: tasks.length, iocs: iocs.length, events: events.length },
    tasksByStatus,
    topIOCs,
    recentNotes,
    createdAt: new Date(folder.createdAt).toISOString(),
    updatedAt: new Date(folder.updatedAt || folder.createdAt).toISOString(),
  });
}

export async function executeSearchAcrossInvestigations(input: Record<string, unknown>): Promise<string> {
  const query = String(input.query || '').toLowerCase();
  if (!query) return JSON.stringify({ error: 'query is required' });
  const limit = Math.min(Number(input.limit) || 5, 20);
  const entityTypes = (input.entityTypes as string[] | undefined) || ['notes', 'tasks', 'iocs', 'events'];

  const folders = await db.folders.toArray();
  const results: Record<string, unknown>[] = [];

  for (const folder of folders) {
    const match: Record<string, unknown> = { investigationId: folder.id, investigationName: folder.name };
    let totalHits = 0;

    if (entityTypes.includes('notes')) {
      const notes = await db.notes.where('folderId').equals(folder.id).and(n => !n.trashed).toArray();
      const hits = notes
        .filter(n => n.title.toLowerCase().includes(query) || n.content.toLowerCase().includes(query))
        .slice(0, limit)
        .map(n => ({ id: n.id, title: n.title, snippet: snippet(n.content) }));
      if (hits.length > 0) { match.notes = hits; totalHits += hits.length; }
    }

    if (entityTypes.includes('tasks')) {
      const tasks = await db.tasks.where('folderId').equals(folder.id).and(t => !t.trashed).toArray();
      const hits = tasks
        .filter(t => t.title.toLowerCase().includes(query) || (t.description || '').toLowerCase().includes(query))
        .slice(0, limit)
        .map(t => ({ id: t.id, title: t.title, status: t.status }));
      if (hits.length > 0) { match.tasks = hits; totalHits += hits.length; }
    }

    if (entityTypes.includes('iocs')) {
      const iocs = await db.standaloneIOCs.where('folderId').equals(folder.id).and(i => !i.trashed).toArray();
      const hits = iocs
        .filter(i => i.value.toLowerCase().includes(query) || (i.analystNotes || '').toLowerCase().includes(query))
        .slice(0, limit)
        .map(i => ({ id: i.id, type: i.type, value: i.value, confidence: i.confidence }));
      if (hits.length > 0) { match.iocs = hits; totalHits += hits.length; }
    }

    if (entityTypes.includes('events')) {
      const events = await db.timelineEvents.where('folderId').equals(folder.id).and(e => !e.trashed).toArray();
      const hits = events
        .filter(e => e.title.toLowerCase().includes(query) || (e.description || '').toLowerCase().includes(query))
        .slice(0, limit)
        .map(e => ({ id: e.id, title: e.title, eventType: e.eventType }));
      if (hits.length > 0) { match.events = hits; totalHits += hits.length; }
    }

    if (totalHits > 0) results.push(match);
  }

  return JSON.stringify({ query, investigationsSearched: folders.length, investigationsWithHits: results.length, results });
}

export async function executeCompareInvestigations(input: Record<string, unknown>): Promise<string> {
  const ids = input.investigationIds as string[];
  if (!ids || ids.length < 2) return JSON.stringify({ error: 'At least 2 investigation IDs required' });

  const comparisons = await Promise.all(ids.map(async (id) => {
    const folder = await db.folders.get(id);
    if (!folder) return { id, error: 'Not found' };

    const [notes, tasks, iocs, events] = await Promise.all([
      db.notes.where('folderId').equals(id).and(n => !n.trashed).count(),
      db.tasks.where('folderId').equals(id).and(t => !t.trashed).count(),
      db.standaloneIOCs.where('folderId').equals(id).and(i => !i.trashed).toArray(),
      db.timelineEvents.where('folderId').equals(id).and(e => !e.trashed).toArray(),
    ]);

    const eventTypes = new Set(events.map(e => e.eventType));

    return {
      id,
      name: folder.name,
      status: folder.status || 'active',
      counts: { notes, tasks, iocs: iocs.length, events: events.length },
      iocValues: iocs.map(i => i.value),
      iocTypes: [...new Set(iocs.map(i => i.type))],
      eventTypes: [...eventTypes],
      timeRange: events.length > 0 ? {
        earliest: new Date(Math.min(...events.map(e => e.timestamp))).toISOString(),
        latest: new Date(Math.max(...events.map(e => e.timestamp))).toISOString(),
      } : null,
    };
  }));

  // Find shared IOCs
  const validComparisons = comparisons.filter(c => !('error' in c && c.error));
  const iocSets = validComparisons.map(c => new Set((c as { iocValues: string[] }).iocValues));
  const sharedIOCs: string[] = [];
  if (iocSets.length >= 2) {
    for (const val of iocSets[0]) {
      if (iocSets.slice(1).every(s => s.has(val))) sharedIOCs.push(val);
    }
  }

  // Find shared event types (TTPs)
  const ttpSets = validComparisons.map(c => new Set((c as { eventTypes: string[] }).eventTypes));
  const sharedTTPs: string[] = [];
  if (ttpSets.length >= 2) {
    for (const val of ttpSets[0]) {
      if (ttpSets.slice(1).every(s => s.has(val))) sharedTTPs.push(val);
    }
  }

  // Clean up before returning — remove raw arrays
  const summaries = comparisons.map(c => {
    if ('error' in c && c.error) return c;
    const { iocValues, ...rest } = c as Record<string, unknown>;
    void iocValues;
    return rest;
  });

  return JSON.stringify({
    investigations: summaries,
    sharedIOCs,
    sharedTTPs,
    overlap: {
      sharedIOCCount: sharedIOCs.length,
      sharedTTPCount: sharedTTPs.length,
    },
  });
}
