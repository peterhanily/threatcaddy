import { nanoid } from 'nanoid';
import { db } from '../db';
import type {
  IOCType, ConfidenceLevel, TimelineEventType, Priority, TaskStatus, Note, Task,
} from '../types';

const MAX_SNIPPET = 200;

function snippet(text: string, maxLen = MAX_SNIPPET): string {
  if (text.length <= maxLen) return text;
  return text.slice(0, maxLen) + '…';
}

export async function executeCreateNote(input: Record<string, unknown>, folderId?: string): Promise<string> {
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

export async function executeUpdateNote(input: Record<string, unknown>): Promise<string> {
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

export async function executeCreateTask(input: Record<string, unknown>, folderId?: string): Promise<string> {
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
    assigneeId: input.assigneeId ? String(input.assigneeId) : undefined,
    createdAt: now,
    updatedAt: now,
  };
  await db.tasks.add(task);
  return JSON.stringify({ success: true, id: task.id, title: task.title });
}

export async function executeUpdateTask(input: Record<string, unknown>): Promise<string> {
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
  if (input.assigneeId !== undefined) updates.assigneeId = input.assigneeId ? String(input.assigneeId) : undefined;

  await db.tasks.update(id, updates);
  return JSON.stringify({ success: true, id, title: updates.title || task.title });
}

export async function executeCreateIOC(input: Record<string, unknown>, folderId?: string): Promise<string> {
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

export async function executeBulkCreateIOCs(input: Record<string, unknown>, folderId?: string): Promise<string> {
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

export async function executeCreateTimelineEvent(input: Record<string, unknown>, folderId?: string): Promise<string> {
  const now = Date.now();
  let timestamp = now;
  if (input.timestamp) {
    const parsed = new Date(String(input.timestamp)).getTime();
    if (!isNaN(parsed)) timestamp = parsed;
  }

  let timelineId = '';
  if (folderId) {
    const folder = await db.folders.get(folderId);
    if (folder?.timelineId) {
      timelineId = folder.timelineId;
    }
  }
  if (!timelineId) {
    const first = await db.timelines.orderBy('order').first();
    if (first) timelineId = first.id;
  }

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
    source: input.source ? String(input.source) : 'CaddyChat',
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

export async function executeLinkEntities(input: Record<string, unknown>): Promise<string> {
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

export async function executeGenerateReport(input: Record<string, unknown>, folderId?: string): Promise<string> {
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

  report += `## Executive Summary\n\n${input.executiveSummary || ''}\n\n`;
  report += `## Key Findings\n\n${input.findings || ''}\n\n`;

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

  if (input.recommendations) {
    report += `## Recommendations\n\n${input.recommendations}\n\n`;
  }

  report += '---\n*Report generated by CaddyAI*\n';

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

export async function executeCreateInInvestigation(input: Record<string, unknown>): Promise<string> {
  const id = String(input.investigationId || '');
  const name = String(input.investigationName || '');
  const entityType = String(input.entityType || '');
  const data = input.data as Record<string, unknown> | undefined;

  if (!entityType || !data) return JSON.stringify({ error: 'entityType and data are required' });

  // Resolve investigation
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

  // Delegate to existing create functions with the resolved folderId
  switch (entityType) {
    case 'note':
      return executeCreateNote(data, folder.id);
    case 'task':
      return executeCreateTask(data, folder.id);
    case 'ioc':
      return executeCreateIOC(data, folder.id);
    case 'timeline-event':
      return executeCreateTimelineEvent(data, folder.id);
    default:
      return JSON.stringify({ error: `Unknown entity type: ${entityType}. Use: note, task, ioc, timeline-event` });
  }
}
