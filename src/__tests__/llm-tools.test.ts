import { describe, it, expect, beforeEach } from 'vitest';
import { TOOL_DEFINITIONS, isWriteTool, executeTool, buildSystemPrompt } from '../lib/llm-tools';
import { db } from '../db';
import type { ToolUseBlock } from '../types';

function makeToolUse(name: string, input: Record<string, unknown> = {}): ToolUseBlock {
  return { type: 'tool_use', id: `tool-${name}`, name, input };
}

describe('TOOL_DEFINITIONS', () => {
  it('has the expected number of tool definitions', () => {
    expect(TOOL_DEFINITIONS.length).toBe(37);
  });

  it('each tool has name, description, and input_schema', () => {
    for (const tool of TOOL_DEFINITIONS) {
      expect(tool.name).toBeTruthy();
      expect(tool.description).toBeTruthy();
      expect(tool.input_schema).toBeDefined();
      expect(tool.input_schema.type).toBe('object');
    }
  });

  it('all tool names are unique', () => {
    const names = TOOL_DEFINITIONS.map(t => t.name);
    expect(new Set(names).size).toBe(names.length);
  });

  it('each tool has a properties and required field in schema', () => {
    for (const tool of TOOL_DEFINITIONS) {
      expect(tool.input_schema.properties).toBeDefined();
      expect(Array.isArray(tool.input_schema.required)).toBe(true);
    }
  });
});

describe('isWriteTool', () => {
  it('returns true for create_note', () => {
    expect(isWriteTool('create_note')).toBe(true);
  });

  it('returns true for create_task', () => {
    expect(isWriteTool('create_task')).toBe(true);
  });

  it('returns true for create_ioc', () => {
    expect(isWriteTool('create_ioc')).toBe(true);
  });

  it('returns true for create_timeline_event', () => {
    expect(isWriteTool('create_timeline_event')).toBe(true);
  });

  it('returns true for update_note', () => {
    expect(isWriteTool('update_note')).toBe(true);
  });

  it('returns true for update_task', () => {
    expect(isWriteTool('update_task')).toBe(true);
  });

  it('returns true for update_ioc', () => {
    expect(isWriteTool('update_ioc')).toBe(true);
  });

  it('returns true for bulk_create_iocs', () => {
    expect(isWriteTool('bulk_create_iocs')).toBe(true);
  });

  it('returns true for update_timeline_event', () => {
    expect(isWriteTool('update_timeline_event')).toBe(true);
  });

  it('returns true for link_entities', () => {
    expect(isWriteTool('link_entities')).toBe(true);
  });

  it('returns true for generate_report', () => {
    expect(isWriteTool('generate_report')).toBe(true);
  });

  it('returns false for read tools', () => {
    expect(isWriteTool('search_notes')).toBe(false);
    expect(isWriteTool('read_note')).toBe(false);
    expect(isWriteTool('read_task')).toBe(false);
    expect(isWriteTool('read_ioc')).toBe(false);
    expect(isWriteTool('read_timeline_event')).toBe(false);
    expect(isWriteTool('list_tasks')).toBe(false);
    expect(isWriteTool('list_iocs')).toBe(false);
    expect(isWriteTool('list_timeline_events')).toBe(false);
    expect(isWriteTool('get_investigation_summary')).toBe(false);
    expect(isWriteTool('extract_iocs')).toBe(false);
    expect(isWriteTool('search_all')).toBe(false);
    expect(isWriteTool('analyze_graph')).toBe(false);
  });

  it('returns false for unknown tools', () => {
    expect(isWriteTool('nonexistent')).toBe(false);
  });
});

describe('executeTool — read tools', () => {
  beforeEach(async () => {
    await db.notes.clear();
    await db.tasks.clear();
    await db.standaloneIOCs.clear();
    await db.timelineEvents.clear();
    await db.folders.clear();
  });

  it('search_notes requires a query', async () => {
    const { result } = await executeTool(makeToolUse('search_notes', {}));
    expect(JSON.parse(result).error).toContain('query');
  });

  it('search_notes finds matching notes', async () => {
    await db.notes.add({
      id: 'n1', title: 'Malware Analysis', content: 'Found suspicious binary',
      folderId: 'f1', tags: [], pinned: false, archived: false, trashed: false, createdAt: Date.now(), updatedAt: Date.now(),
    });
    await db.notes.add({
      id: 'n2', title: 'Unrelated', content: 'Nothing here',
      folderId: 'f1', tags: [], pinned: false, archived: false, trashed: false, createdAt: Date.now(), updatedAt: Date.now(),
    });

    const { result } = await executeTool(makeToolUse('search_notes', { query: 'malware' }), 'f1');
    const parsed = JSON.parse(result);
    expect(parsed.count).toBe(1);
    expect(parsed.notes[0].title).toBe('Malware Analysis');
  });

  it('read_note finds by id', async () => {
    await db.notes.add({
      id: 'n1', title: 'My Note', content: 'Content here',
      tags: [], pinned: false, archived: false, trashed: false, createdAt: Date.now(), updatedAt: Date.now(),
    });

    const { result } = await executeTool(makeToolUse('read_note', { id: 'n1' }));
    const parsed = JSON.parse(result);
    expect(parsed.title).toBe('My Note');
    expect(parsed.content).toBe('Content here');
  });

  it('read_note finds by title', async () => {
    await db.notes.add({
      id: 'n1', title: 'Incident Report', content: 'Details...',
      folderId: 'f1', tags: [], pinned: false, archived: false, trashed: false, createdAt: Date.now(), updatedAt: Date.now(),
    });

    const { result } = await executeTool(makeToolUse('read_note', { title: 'incident report' }), 'f1');
    const parsed = JSON.parse(result);
    expect(parsed.title).toBe('Incident Report');
  });

  it('read_note returns error for missing note', async () => {
    const { result } = await executeTool(makeToolUse('read_note', { id: 'nonexistent' }));
    expect(JSON.parse(result).error).toContain('not found');
  });

  it('list_tasks returns tasks', async () => {
    await db.tasks.add({
      id: 't1', title: 'Check logs', completed: false, priority: 'high', status: 'todo',
      order: 0, folderId: 'f1', tags: [], trashed: false, archived: false, createdAt: Date.now(), updatedAt: Date.now(),
    });

    const { result } = await executeTool(makeToolUse('list_tasks'), 'f1');
    const parsed = JSON.parse(result);
    expect(parsed.count).toBe(1);
    expect(parsed.tasks[0].title).toBe('Check logs');
  });

  it('list_tasks filters by status', async () => {
    await db.tasks.add({
      id: 't1', title: 'Done task', completed: true, priority: 'none', status: 'done',
      order: 0, folderId: 'f1', tags: [], trashed: false, archived: false, createdAt: Date.now(), updatedAt: Date.now(),
    });
    await db.tasks.add({
      id: 't2', title: 'Todo task', completed: false, priority: 'none', status: 'todo',
      order: 1, folderId: 'f1', tags: [], trashed: false, archived: false, createdAt: Date.now(), updatedAt: Date.now(),
    });

    const { result } = await executeTool(makeToolUse('list_tasks', { status: 'todo' }), 'f1');
    const parsed = JSON.parse(result);
    expect(parsed.count).toBe(1);
    expect(parsed.tasks[0].title).toBe('Todo task');
  });

  it('list_iocs returns IOCs', async () => {
    await db.standaloneIOCs.add({
      id: 'ioc1', type: 'ipv4', value: '1.2.3.4', confidence: 'high',
      folderId: 'f1', tags: [], trashed: false, archived: false, createdAt: Date.now(), updatedAt: Date.now(),
    });

    const { result } = await executeTool(makeToolUse('list_iocs'), 'f1');
    const parsed = JSON.parse(result);
    expect(parsed.count).toBe(1);
    expect(parsed.iocs[0].value).toBe('1.2.3.4');
  });

  it('list_timeline_events returns events', async () => {
    await db.timelineEvents.add({
      id: 'e1', timestamp: Date.now(), title: 'Initial Access', eventType: 'initial-access',
      source: 'EDR', confidence: 'high', linkedIOCIds: [], linkedNoteIds: [], linkedTaskIds: [],
      mitreAttackIds: [], assets: [], tags: [], starred: false, folderId: 'f1', timelineId: 'tl1',
      trashed: false, archived: false, createdAt: Date.now(), updatedAt: Date.now(),
    });

    const { result } = await executeTool(makeToolUse('list_timeline_events'), 'f1');
    const parsed = JSON.parse(result);
    expect(parsed.count).toBe(1);
    expect(parsed.events[0].title).toBe('Initial Access');
  });

  it('get_investigation_summary requires folderId', async () => {
    const { result } = await executeTool(makeToolUse('get_investigation_summary'));
    expect(JSON.parse(result).error).toContain('No investigation');
  });

  it('get_investigation_summary returns counts', async () => {
    await db.folders.add({ id: 'f1', name: 'Test Investigation', order: 0, createdAt: Date.now() });
    await db.notes.add({
      id: 'n1', title: 'Note', content: '', folderId: 'f1',
      tags: [], pinned: false, archived: false, trashed: false, createdAt: Date.now(), updatedAt: Date.now(),
    });

    const { result } = await executeTool(makeToolUse('get_investigation_summary'), 'f1');
    const parsed = JSON.parse(result);
    expect(parsed.name).toBe('Test Investigation');
    expect(parsed.counts.notes).toBe(1);
  });
});

describe('executeTool — write tools', () => {
  beforeEach(async () => {
    await db.notes.clear();
    await db.tasks.clear();
    await db.standaloneIOCs.clear();
    await db.timelineEvents.clear();
    await db.timelines.clear();
  });

  it('create_note persists a note', async () => {
    const { result, isError } = await executeTool(
      makeToolUse('create_note', { title: 'AI Note', content: '# Hello' }),
      'f1',
    );
    expect(isError).toBe(false);
    const parsed = JSON.parse(result);
    expect(parsed.success).toBe(true);
    expect(parsed.title).toBe('AI Note');

    const stored = await db.notes.get(parsed.id);
    expect(stored).toBeDefined();
    expect(stored!.content).toBe('# Hello');
    expect(stored!.folderId).toBe('f1');
  });

  it('create_task persists a task', async () => {
    const { result, isError } = await executeTool(
      makeToolUse('create_task', { title: 'Review logs', priority: 'high', status: 'in-progress' }),
      'f1',
    );
    expect(isError).toBe(false);
    const parsed = JSON.parse(result);
    expect(parsed.success).toBe(true);

    const stored = await db.tasks.get(parsed.id);
    expect(stored).toBeDefined();
    expect(stored!.priority).toBe('high');
    expect(stored!.status).toBe('in-progress');
  });

  it('create_ioc persists an IOC', async () => {
    const { result, isError } = await executeTool(
      makeToolUse('create_ioc', { type: 'domain', value: 'evil.com', confidence: 'high', analystNotes: 'Known C2' }),
    );
    expect(isError).toBe(false);
    const parsed = JSON.parse(result);
    expect(parsed.success).toBe(true);
    expect(parsed.type).toBe('domain');
    expect(parsed.value).toBe('evil.com');

    const stored = await db.standaloneIOCs.get(parsed.id);
    expect(stored!.analystNotes).toBe('Known C2');
  });

  it('create_timeline_event persists and parses timestamp', async () => {
    const { result, isError } = await executeTool(
      makeToolUse('create_timeline_event', {
        title: 'Lateral Movement',
        timestamp: '2025-06-15T14:30:00Z',
        eventType: 'lateral-movement',
        source: 'SIEM',
      }),
    );
    expect(isError).toBe(false);
    const parsed = JSON.parse(result);
    expect(parsed.success).toBe(true);
    expect(parsed.timestamp).toBe('2025-06-15T14:30:00.000Z');

    const stored = await db.timelineEvents.get(parsed.id);
    expect(stored!.eventType).toBe('lateral-movement');
    expect(stored!.source).toBe('SIEM');
  });

  it('create_timeline_event validates geo coordinates', async () => {
    const { result } = await executeTool(
      makeToolUse('create_timeline_event', {
        title: 'Geolocated Event',
        timestamp: '2025-06-15T14:30:00Z',
        latitude: 40.7128,
        longitude: -74.006,
      }),
    );
    const parsed = JSON.parse(result);
    const stored = await db.timelineEvents.get(parsed.id);
    expect(stored!.latitude).toBe(40.7128);
    expect(stored!.longitude).toBe(-74.006);
  });

  it('create_timeline_event rejects invalid geo coordinates', async () => {
    const { result } = await executeTool(
      makeToolUse('create_timeline_event', {
        title: 'Bad Geo',
        timestamp: '2025-01-01T00:00:00Z',
        latitude: 200,
        longitude: -74,
      }),
    );
    const parsed = JSON.parse(result);
    const stored = await db.timelineEvents.get(parsed.id);
    expect(stored!.latitude).toBeUndefined();
    expect(stored!.longitude).toBeUndefined();
  });
});

describe('executeTool — single-entity read tools', () => {
  beforeEach(async () => {
    await db.tasks.clear();
    await db.standaloneIOCs.clear();
    await db.timelineEvents.clear();
  });

  it('read_task finds by id', async () => {
    await db.tasks.add({
      id: 't1', title: 'Analyze payload', description: 'Check the binary', completed: false, priority: 'high', status: 'in-progress',
      order: 0, folderId: 'f1', tags: ['malware'], trashed: false, archived: false, createdAt: Date.now(), updatedAt: Date.now(),
    });

    const { result, isError } = await executeTool(makeToolUse('read_task', { id: 't1' }));
    expect(isError).toBe(false);
    const parsed = JSON.parse(result);
    expect(parsed.title).toBe('Analyze payload');
    expect(parsed.description).toBe('Check the binary');
    expect(parsed.status).toBe('in-progress');
    expect(parsed.priority).toBe('high');
  });

  it('read_task finds by title (case-insensitive)', async () => {
    await db.tasks.add({
      id: 't1', title: 'Review EDR Logs', completed: false, priority: 'none', status: 'todo',
      order: 0, folderId: 'f1', tags: [], trashed: false, archived: false, createdAt: Date.now(), updatedAt: Date.now(),
    });

    const { result } = await executeTool(makeToolUse('read_task', { title: 'review edr logs' }), 'f1');
    expect(JSON.parse(result).title).toBe('Review EDR Logs');
  });

  it('read_task finds by partial title match', async () => {
    await db.tasks.add({
      id: 't1', title: 'Investigate lateral movement', completed: false, priority: 'none', status: 'todo',
      order: 0, folderId: 'f1', tags: [], trashed: false, archived: false, createdAt: Date.now(), updatedAt: Date.now(),
    });

    const { result } = await executeTool(makeToolUse('read_task', { title: 'lateral' }), 'f1');
    expect(JSON.parse(result).title).toBe('Investigate lateral movement');
  });

  it('read_task returns error for missing task', async () => {
    const { result } = await executeTool(makeToolUse('read_task', { id: 'nonexistent' }));
    expect(JSON.parse(result).error).toContain('not found');
  });

  it('read_ioc finds by id', async () => {
    await db.standaloneIOCs.add({
      id: 'ioc1', type: 'ipv4', value: '10.0.0.1', confidence: 'high',
      analystNotes: 'Known C2 server', attribution: 'APT29', iocSubtype: 'C2 Server', iocStatus: 'active',
      folderId: 'f1', tags: [], trashed: false, archived: false, createdAt: Date.now(), updatedAt: Date.now(),
    });

    const { result, isError } = await executeTool(makeToolUse('read_ioc', { id: 'ioc1' }));
    expect(isError).toBe(false);
    const parsed = JSON.parse(result);
    expect(parsed.type).toBe('ipv4');
    expect(parsed.value).toBe('10.0.0.1');
    expect(parsed.analystNotes).toBe('Known C2 server');
    expect(parsed.attribution).toBe('APT29');
    expect(parsed.iocSubtype).toBe('C2 Server');
    expect(parsed.iocStatus).toBe('active');
  });

  it('read_ioc finds by value (case-insensitive)', async () => {
    await db.standaloneIOCs.add({
      id: 'ioc1', type: 'domain', value: 'Evil.Com', confidence: 'medium',
      folderId: 'f1', tags: [], trashed: false, archived: false, createdAt: Date.now(), updatedAt: Date.now(),
    });

    const { result } = await executeTool(makeToolUse('read_ioc', { value: 'evil.com' }), 'f1');
    expect(JSON.parse(result).value).toBe('Evil.Com');
  });

  it('read_ioc finds by partial value match', async () => {
    await db.standaloneIOCs.add({
      id: 'ioc1', type: 'url', value: 'https://malware.evil.com/payload.exe', confidence: 'high',
      folderId: 'f1', tags: [], trashed: false, archived: false, createdAt: Date.now(), updatedAt: Date.now(),
    });

    const { result } = await executeTool(makeToolUse('read_ioc', { value: 'evil.com' }), 'f1');
    expect(JSON.parse(result).value).toBe('https://malware.evil.com/payload.exe');
  });

  it('read_ioc returns error for missing IOC', async () => {
    const { result } = await executeTool(makeToolUse('read_ioc', { id: 'nonexistent' }));
    expect(JSON.parse(result).error).toContain('not found');
  });

  it('read_timeline_event finds by id', async () => {
    await db.timelineEvents.add({
      id: 'e1', timestamp: new Date('2025-06-15T14:30:00Z').getTime(), title: 'Phishing Email Received',
      description: 'Employee clicked link', eventType: 'initial-access', source: 'Email Gateway',
      confidence: 'high', actor: 'APT29', linkedIOCIds: ['ioc1'], linkedNoteIds: [], linkedTaskIds: [],
      mitreAttackIds: ['T1566.001'], assets: ['workstation-01'], tags: [], starred: false,
      folderId: 'f1', timelineId: 'tl1', trashed: false, archived: false, createdAt: Date.now(), updatedAt: Date.now(),
    });

    const { result, isError } = await executeTool(makeToolUse('read_timeline_event', { id: 'e1' }));
    expect(isError).toBe(false);
    const parsed = JSON.parse(result);
    expect(parsed.title).toBe('Phishing Email Received');
    expect(parsed.description).toBe('Employee clicked link');
    expect(parsed.eventType).toBe('initial-access');
    expect(parsed.source).toBe('Email Gateway');
    expect(parsed.actor).toBe('APT29');
    expect(parsed.mitreAttackIds).toContain('T1566.001');
    expect(parsed.linkedIOCIds).toContain('ioc1');
    expect(parsed.assets).toContain('workstation-01');
    expect(parsed.timestamp).toBe('2025-06-15T14:30:00.000Z');
  });

  it('read_timeline_event finds by title (case-insensitive)', async () => {
    await db.timelineEvents.add({
      id: 'e1', timestamp: Date.now(), title: 'C2 Beacon Detected', eventType: 'command-and-control',
      source: 'NDR', confidence: 'high', linkedIOCIds: [], linkedNoteIds: [], linkedTaskIds: [],
      mitreAttackIds: [], assets: [], tags: [], starred: false, folderId: 'f1', timelineId: 'tl1',
      trashed: false, archived: false, createdAt: Date.now(), updatedAt: Date.now(),
    });

    const { result } = await executeTool(makeToolUse('read_timeline_event', { title: 'c2 beacon detected' }), 'f1');
    expect(JSON.parse(result).title).toBe('C2 Beacon Detected');
  });

  it('read_timeline_event returns error for missing event', async () => {
    const { result } = await executeTool(makeToolUse('read_timeline_event', { id: 'nonexistent' }));
    expect(JSON.parse(result).error).toContain('not found');
  });
});

describe('executeTool — update tools', () => {
  beforeEach(async () => {
    await db.notes.clear();
    await db.tasks.clear();
  });

  it('update_note updates title and content', async () => {
    await db.notes.add({
      id: 'n1', title: 'Original', content: 'Old content',
      tags: [], pinned: false, archived: false, trashed: false, createdAt: Date.now(), updatedAt: Date.now(),
    });

    const { result, isError } = await executeTool(
      makeToolUse('update_note', { id: 'n1', title: 'Updated', content: 'New content' }),
    );
    expect(isError).toBe(false);
    const parsed = JSON.parse(result);
    expect(parsed.success).toBe(true);

    const stored = await db.notes.get('n1');
    expect(stored!.title).toBe('Updated');
    expect(stored!.content).toBe('New content');
  });

  it('update_note appends content', async () => {
    await db.notes.add({
      id: 'n1', title: 'Note', content: 'Line 1',
      tags: [], pinned: false, archived: false, trashed: false, createdAt: Date.now(), updatedAt: Date.now(),
    });

    await executeTool(makeToolUse('update_note', { id: 'n1', appendContent: 'Line 2' }));
    const stored = await db.notes.get('n1');
    expect(stored!.content).toBe('Line 1\nLine 2');
  });

  it('update_note returns error for missing id', async () => {
    const { result } = await executeTool(makeToolUse('update_note', {}));
    expect(JSON.parse(result).error).toContain('id');
  });

  it('update_task updates status and marks completed', async () => {
    await db.tasks.add({
      id: 't1', title: 'Task', completed: false, priority: 'none', status: 'todo',
      order: 0, tags: [], trashed: false, archived: false, createdAt: Date.now(), updatedAt: Date.now(),
    });

    const { result, isError } = await executeTool(
      makeToolUse('update_task', { id: 't1', status: 'done', priority: 'high' }),
    );
    expect(isError).toBe(false);
    expect(JSON.parse(result).success).toBe(true);

    const stored = await db.tasks.get('t1');
    expect(stored!.status).toBe('done');
    expect(stored!.completed).toBe(true);
    expect(stored!.priority).toBe('high');
  });

  it('update_task returns error for missing task', async () => {
    const { result } = await executeTool(makeToolUse('update_task', { id: 'nonexistent' }));
    expect(JSON.parse(result).error).toContain('not found');
  });
});

describe('executeTool — update_ioc', () => {
  beforeEach(async () => {
    await db.standaloneIOCs.clear();
  });

  it('updates IOC fields', async () => {
    await db.standaloneIOCs.add({
      id: 'ioc1', type: 'ipv4', value: '10.0.0.1', confidence: 'medium',
      folderId: 'f1', tags: [], trashed: false, archived: false, createdAt: Date.now(), updatedAt: Date.now(),
    });

    const { result, isError } = await executeTool(
      makeToolUse('update_ioc', { id: 'ioc1', confidence: 'high', analystNotes: 'Confirmed C2', attribution: 'APT29', iocSubtype: 'C2 Server', iocStatus: 'active' }),
    );
    expect(isError).toBe(false);
    const parsed = JSON.parse(result);
    expect(parsed.success).toBe(true);

    const stored = await db.standaloneIOCs.get('ioc1');
    expect(stored!.confidence).toBe('high');
    expect(stored!.analystNotes).toBe('Confirmed C2');
    expect(stored!.attribution).toBe('APT29');
    expect(stored!.iocSubtype).toBe('C2 Server');
    expect(stored!.iocStatus).toBe('active');
  });

  it('updates IOC value and type', async () => {
    await db.standaloneIOCs.add({
      id: 'ioc1', type: 'ipv4', value: '10.0.0.1', confidence: 'low',
      folderId: 'f1', tags: [], trashed: false, archived: false, createdAt: Date.now(), updatedAt: Date.now(),
    });

    const { result } = await executeTool(
      makeToolUse('update_ioc', { id: 'ioc1', type: 'domain', value: 'evil.com' }),
    );
    const parsed = JSON.parse(result);
    expect(parsed.success).toBe(true);
    expect(parsed.type).toBe('domain');
    expect(parsed.value).toBe('evil.com');

    const stored = await db.standaloneIOCs.get('ioc1');
    expect(stored!.type).toBe('domain');
    expect(stored!.value).toBe('evil.com');
  });

  it('returns error for missing id', async () => {
    const { result } = await executeTool(makeToolUse('update_ioc', {}));
    expect(JSON.parse(result).error).toContain('id');
  });

  it('returns error for missing IOC', async () => {
    const { result } = await executeTool(makeToolUse('update_ioc', { id: 'nonexistent' }));
    expect(JSON.parse(result).error).toContain('not found');
  });
});

describe('executeTool — update_timeline_event', () => {
  beforeEach(async () => {
    await db.timelineEvents.clear();
  });

  it('updates timeline event fields', async () => {
    await db.timelineEvents.add({
      id: 'e1', timestamp: Date.now(), title: 'Original', eventType: 'other',
      source: 'Manual', confidence: 'low', linkedIOCIds: [], linkedNoteIds: [], linkedTaskIds: [],
      mitreAttackIds: [], assets: [], tags: [], starred: false, folderId: 'f1', timelineId: 'tl1',
      trashed: false, archived: false, createdAt: Date.now(), updatedAt: Date.now(),
    });

    const { result, isError } = await executeTool(
      makeToolUse('update_timeline_event', {
        id: 'e1', title: 'Updated Event', description: 'New details',
        eventType: 'lateral-movement', source: 'EDR', actor: 'APT28', confidence: 'high',
      }),
    );
    expect(isError).toBe(false);
    expect(JSON.parse(result).success).toBe(true);

    const stored = await db.timelineEvents.get('e1');
    expect(stored!.title).toBe('Updated Event');
    expect(stored!.description).toBe('New details');
    expect(stored!.eventType).toBe('lateral-movement');
    expect(stored!.source).toBe('EDR');
    expect(stored!.actor).toBe('APT28');
    expect(stored!.confidence).toBe('high');
  });

  it('updates timestamp', async () => {
    await db.timelineEvents.add({
      id: 'e1', timestamp: Date.now(), title: 'Event', eventType: 'other',
      source: 'Manual', confidence: 'medium', linkedIOCIds: [], linkedNoteIds: [], linkedTaskIds: [],
      mitreAttackIds: [], assets: [], tags: [], starred: false, folderId: 'f1', timelineId: 'tl1',
      trashed: false, archived: false, createdAt: Date.now(), updatedAt: Date.now(),
    });

    await executeTool(makeToolUse('update_timeline_event', { id: 'e1', timestamp: '2025-01-15T08:00:00Z' }));
    const stored = await db.timelineEvents.get('e1');
    expect(stored!.timestamp).toBe(new Date('2025-01-15T08:00:00Z').getTime());
  });

  it('updates geo coordinates', async () => {
    await db.timelineEvents.add({
      id: 'e1', timestamp: Date.now(), title: 'Event', eventType: 'other',
      source: 'Manual', confidence: 'medium', linkedIOCIds: [], linkedNoteIds: [], linkedTaskIds: [],
      mitreAttackIds: [], assets: [], tags: [], starred: false, folderId: 'f1', timelineId: 'tl1',
      trashed: false, archived: false, createdAt: Date.now(), updatedAt: Date.now(),
    });

    await executeTool(makeToolUse('update_timeline_event', { id: 'e1', latitude: 51.5074, longitude: -0.1278 }));
    const stored = await db.timelineEvents.get('e1');
    expect(stored!.latitude).toBe(51.5074);
    expect(stored!.longitude).toBe(-0.1278);
  });

  it('rejects invalid geo coordinates', async () => {
    await db.timelineEvents.add({
      id: 'e1', timestamp: Date.now(), title: 'Event', eventType: 'other',
      source: 'Manual', confidence: 'medium', linkedIOCIds: [], linkedNoteIds: [], linkedTaskIds: [],
      mitreAttackIds: [], assets: [], tags: [], starred: false, folderId: 'f1', timelineId: 'tl1',
      trashed: false, archived: false, createdAt: Date.now(), updatedAt: Date.now(),
    });

    await executeTool(makeToolUse('update_timeline_event', { id: 'e1', latitude: 200, longitude: -0.1278 }));
    const stored = await db.timelineEvents.get('e1');
    expect(stored!.latitude).toBeUndefined();
    expect(stored!.longitude).toBeUndefined();
  });

  it('returns error for missing id', async () => {
    const { result } = await executeTool(makeToolUse('update_timeline_event', {}));
    expect(JSON.parse(result).error).toContain('id');
  });

  it('returns error for missing event', async () => {
    const { result } = await executeTool(makeToolUse('update_timeline_event', { id: 'nonexistent' }));
    expect(JSON.parse(result).error).toContain('not found');
  });
});

describe('executeTool — bulk_create_iocs', () => {
  beforeEach(async () => {
    await db.standaloneIOCs.clear();
  });

  it('creates multiple IOCs', async () => {
    const { result, isError } = await executeTool(
      makeToolUse('bulk_create_iocs', {
        iocs: [
          { type: 'ipv4', value: '10.0.0.1', confidence: 'high' },
          { type: 'domain', value: 'evil.com', confidence: 'medium' },
        ],
      }),
      'f1',
    );
    expect(isError).toBe(false);
    const parsed = JSON.parse(result);
    expect(parsed.success).toBe(true);
    expect(parsed.count).toBe(2);
    expect(parsed.iocs).toHaveLength(2);

    const stored = await db.standaloneIOCs.toArray();
    expect(stored).toHaveLength(2);
  });

  it('returns error for empty iocs array', async () => {
    const { result } = await executeTool(makeToolUse('bulk_create_iocs', { iocs: [] }));
    expect(JSON.parse(result).error).toContain('iocs');
  });
});

describe('executeTool — link_entities', () => {
  beforeEach(async () => {
    await db.notes.clear();
    await db.tasks.clear();
  });

  it('links a note to a task', async () => {
    await db.notes.add({
      id: 'n1', title: 'Note', content: '',
      tags: [], pinned: false, archived: false, trashed: false, createdAt: Date.now(), updatedAt: Date.now(),
    });
    await db.tasks.add({
      id: 't1', title: 'Task', completed: false, priority: 'none', status: 'todo',
      order: 0, tags: [], trashed: false, archived: false, createdAt: Date.now(), updatedAt: Date.now(),
    });

    const { result, isError } = await executeTool(
      makeToolUse('link_entities', {
        links: [{ sourceType: 'note', sourceId: 'n1', targetType: 'task', targetId: 't1' }],
      }),
    );
    expect(isError).toBe(false);
    const parsed = JSON.parse(result);
    expect(parsed.success).toBe(true);
    expect(parsed.linked).toBe(1);

    const stored = await db.notes.get('n1');
    expect(stored!.linkedTaskIds).toContain('t1');
  });

  it('returns error for empty links', async () => {
    const { result } = await executeTool(makeToolUse('link_entities', { links: [] }));
    expect(JSON.parse(result).error).toContain('links');
  });
});

describe('executeTool — search_all', () => {
  beforeEach(async () => {
    await db.notes.clear();
    await db.tasks.clear();
    await db.standaloneIOCs.clear();
    await db.timelineEvents.clear();
  });

  it('searches across all entity types', async () => {
    await db.notes.add({
      id: 'n1', title: 'Malware Note', content: '',
      folderId: 'f1', tags: [], pinned: false, archived: false, trashed: false, createdAt: Date.now(), updatedAt: Date.now(),
    });
    await db.tasks.add({
      id: 't1', title: 'Malware Task', completed: false, priority: 'none', status: 'todo',
      order: 0, folderId: 'f1', tags: [], trashed: false, archived: false, createdAt: Date.now(), updatedAt: Date.now(),
    });

    const { result } = await executeTool(makeToolUse('search_all', { query: 'malware' }), 'f1');
    const parsed = JSON.parse(result);
    expect(parsed.notes.count).toBeGreaterThanOrEqual(1);
    expect(parsed.tasks.count).toBeGreaterThanOrEqual(1);
    expect(parsed.totalMatches).toBeGreaterThanOrEqual(2);
  });

  it('requires a query', async () => {
    const { result } = await executeTool(makeToolUse('search_all', {}));
    expect(JSON.parse(result).error).toContain('query');
  });
});

describe('executeTool — analyze_graph', () => {
  it('requires folderId', async () => {
    const { result } = await executeTool(makeToolUse('analyze_graph'));
    expect(JSON.parse(result).error).toContain('investigation');
  });
});

describe('executeTool — generate_report', () => {
  beforeEach(async () => {
    await db.notes.clear();
    await db.folders.clear();
  });

  it('requires folderId', async () => {
    const { result } = await executeTool(makeToolUse('generate_report'));
    expect(JSON.parse(result).error).toContain('investigation');
  });

  it('creates a report note', async () => {
    await db.folders.add({ id: 'f1', name: 'Test Case', order: 0, createdAt: Date.now() });

    const { result, isError } = await executeTool(
      makeToolUse('generate_report', { title: 'Test Report', executiveSummary: 'Summary here' }),
      'f1',
    );
    expect(isError).toBe(false);
    const parsed = JSON.parse(result);
    expect(parsed.success).toBe(true);
    expect(parsed.title).toBe('Test Report');

    const stored = await db.notes.get(parsed.id);
    expect(stored!.content).toContain('Summary here');
  });
});

describe('executeTool — extract_iocs', () => {
  it('extracts IOCs from text', async () => {
    const { result, isError } = await executeTool(
      makeToolUse('extract_iocs', { text: 'Found IP 192.168.1.1 and domain evil.com with hash d41d8cd98f00b204e9800998ecf8427e' }),
    );
    expect(isError).toBe(false);
    const parsed = JSON.parse(result);
    expect(parsed.totalFound).toBeGreaterThan(0);
    expect(parsed.byType).toBeDefined();
  });

  it('extract_iocs requires text', async () => {
    const { result } = await executeTool(makeToolUse('extract_iocs', {}));
    expect(JSON.parse(result).error).toContain('text');
  });
});

describe('executeTool — error handling', () => {
  it('returns error for unknown tool', async () => {
    const { result, isError } = await executeTool(makeToolUse('nonexistent_tool'));
    expect(isError).toBe(false);
    expect(JSON.parse(result).error).toContain('Unknown tool');
  });
});

describe('buildSystemPrompt', () => {
  beforeEach(async () => {
    await db.notes.clear();
    await db.tasks.clear();
    await db.standaloneIOCs.clear();
    await db.timelineEvents.clear();
  });

  it('returns a prompt without folder context', async () => {
    const prompt = await buildSystemPrompt();
    expect(prompt).toContain('Caddy');
    expect(prompt).not.toContain('Current investigation');
  });

  it('includes folder context when provided', async () => {
    await db.notes.add({
      id: 'n1', title: 'Note', content: '', folderId: 'f1',
      tags: [], pinned: false, archived: false, trashed: false, createdAt: Date.now(), updatedAt: Date.now(),
    });

    const folder = { id: 'f1', name: 'APT29 Investigation', order: 0, createdAt: Date.now(), description: 'Tracking APT29', status: 'active' as const };
    const prompt = await buildSystemPrompt(folder);
    expect(prompt).toContain('APT29 Investigation');
    expect(prompt).toContain('Tracking APT29');
    expect(prompt).toContain('1 notes');
  });
});
