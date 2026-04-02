/* eslint-disable @typescript-eslint/no-non-null-assertion */
import { describe, it, expect, beforeEach } from 'vitest';
import { db } from '../db';

beforeEach(async () => {
  await db.notes.clear();
  await db.tasks.clear();
  await db.folders.clear();
  await db.tags.clear();
  await db.timelineEvents.clear();
  await db.timelines.clear();
  await db.whiteboards.clear();
  await db.activityLog.clear();
  await db.standaloneIOCs.clear();
  await db.chatThreads.clear();
});

// ── Helpers ─────────────────────────────────────────────────────────

function makeNote(overrides: Partial<Parameters<typeof db.notes.add>[0]> & { id: string }) {
  return {
    title: 'Note', content: '', tags: [], pinned: false,
    archived: false, trashed: false, createdAt: Date.now(), updatedAt: Date.now(),
    ...overrides,
  };
}

function makeTask(overrides: Partial<Parameters<typeof db.tasks.add>[0]> & { id: string }) {
  return {
    title: 'Task', completed: false, priority: 'none' as const, tags: [],
    status: 'todo' as const, order: 0, trashed: false, archived: false,
    createdAt: Date.now(), updatedAt: Date.now(),
    ...overrides,
  };
}

function makeTimelineEvent(overrides: Partial<Parameters<typeof db.timelineEvents.add>[0]> & { id: string }) {
  return {
    timestamp: Date.now(), title: 'Event', eventType: 'other' as const,
    source: 'test', confidence: 'medium' as const, linkedIOCIds: [],
    linkedNoteIds: [], linkedTaskIds: [], mitreAttackIds: [], assets: [],
    tags: [], starred: false, timelineId: 'tl1', trashed: false, archived: false,
    createdAt: Date.now(), updatedAt: Date.now(),
    ...overrides,
  };
}

// ── Schema: all tables exist ────────────────────────────────────────

describe('Database schema', () => {
  it('exposes all 13 tables', () => {
    expect(db.notes).toBeDefined();
    expect(db.tasks).toBeDefined();
    expect(db.folders).toBeDefined();
    expect(db.tags).toBeDefined();
    expect(db.timelineEvents).toBeDefined();
    expect(db.timelines).toBeDefined();
    expect(db.whiteboards).toBeDefined();
    expect(db.activityLog).toBeDefined();
    expect(db.standaloneIOCs).toBeDefined();
    expect(db.chatThreads).toBeDefined();
    expect(db.integrationTemplates).toBeDefined();
    expect(db.installedIntegrations).toBeDefined();
    expect(db.integrationRuns).toBeDefined();
  });

  it('is at version 25', () => {
    expect(db.verno).toBe(25);
  });
});

// ── Notes CRUD & queries ────────────────────────────────────────────

describe('Notes', () => {
  it('can CRUD notes', async () => {
    await db.notes.add(makeNote({ id: 'n1', title: 'Test', content: 'Hello', tags: ['a'] }));

    const note = await db.notes.get('n1');
    expect(note).toBeDefined();
    expect(note!.title).toBe('Test');

    await db.notes.update('n1', { title: 'Updated' });
    const updated = await db.notes.get('n1');
    expect(updated!.title).toBe('Updated');

    await db.notes.delete('n1');
    const deleted = await db.notes.get('n1');
    expect(deleted).toBeUndefined();
  });

  it('supports querying by folderId', async () => {
    await db.notes.bulkAdd([
      makeNote({ id: 'n1', title: 'A', folderId: 'f1' }),
      makeNote({ id: 'n2', title: 'B', folderId: 'f2' }),
      makeNote({ id: 'n3', title: 'C' }),
    ]);

    const inF1 = await db.notes.where('folderId').equals('f1').toArray();
    expect(inF1).toHaveLength(1);
    expect(inF1[0].id).toBe('n1');
  });

  it('supports multi-value index on tags', async () => {
    await db.notes.bulkAdd([
      makeNote({ id: 'n1', tags: ['alpha', 'beta'] }),
      makeNote({ id: 'n2', tags: ['beta', 'gamma'] }),
      makeNote({ id: 'n3', tags: ['gamma'] }),
    ]);

    const withBeta = await db.notes.where('tags').equals('beta').toArray();
    expect(withBeta).toHaveLength(2);
    expect(withBeta.map((n) => n.id).sort()).toEqual(['n1', 'n2']);
  });

  it('supports filtering by pinned', async () => {
    await db.notes.bulkAdd([
      makeNote({ id: 'n1', pinned: true }),
      makeNote({ id: 'n2', pinned: false }),
    ]);

    const pinned = await db.notes.filter((n) => n.pinned).toArray();
    expect(pinned).toHaveLength(1);
    expect(pinned[0].id).toBe('n1');
  });

  it('supports filtering by archived and trashed', async () => {
    await db.notes.bulkAdd([
      makeNote({ id: 'n1', archived: true }),
      makeNote({ id: 'n2', trashed: true }),
      makeNote({ id: 'n3' }),
    ]);

    const archived = await db.notes.filter((n) => n.archived).toArray();
    expect(archived).toHaveLength(1);
    expect(archived[0].id).toBe('n1');

    const trashed = await db.notes.filter((n) => n.trashed).toArray();
    expect(trashed).toHaveLength(1);
    expect(trashed[0].id).toBe('n2');
  });

  it('supports ordering by updatedAt', async () => {
    await db.notes.bulkAdd([
      makeNote({ id: 'n1', updatedAt: 100 }),
      makeNote({ id: 'n3', updatedAt: 300 }),
      makeNote({ id: 'n2', updatedAt: 200 }),
    ]);

    const sorted = await db.notes.orderBy('updatedAt').toArray();
    expect(sorted.map((n) => n.id)).toEqual(['n1', 'n2', 'n3']);
  });

  it('supports multi-value index on iocTypes', async () => {
    await db.notes.bulkAdd([
      makeNote({ id: 'n1', iocTypes: ['ipv4', 'domain'] }),
      makeNote({ id: 'n2', iocTypes: ['domain'] }),
      makeNote({ id: 'n3', iocTypes: [] }),
    ]);

    const withDomain = await db.notes.where('iocTypes').equals('domain').toArray();
    expect(withDomain).toHaveLength(2);
  });

  it('stores optional fields (sourceUrl, color, clsLevel)', async () => {
    await db.notes.add(makeNote({
      id: 'n1', sourceUrl: 'https://example.com', color: '#ff0000', clsLevel: 'TLP:RED',
    }));

    const note = await db.notes.get('n1');
    expect(note!.sourceUrl).toBe('https://example.com');
    expect(note!.color).toBe('#ff0000');
    expect(note!.clsLevel).toBe('TLP:RED');
  });
});

// ── Tasks CRUD & queries ────────────────────────────────────────────

describe('Tasks', () => {
  it('can CRUD tasks', async () => {
    await db.tasks.add(makeTask({ id: 't1', title: 'Task', priority: 'high' }));

    const task = await db.tasks.get('t1');
    expect(task).toBeDefined();
    expect(task!.priority).toBe('high');

    await db.tasks.update('t1', { status: 'done', completed: true });
    const done = await db.tasks.get('t1');
    expect(done!.completed).toBe(true);
    expect(done!.status).toBe('done');
  });

  it('supports querying by status', async () => {
    await db.tasks.bulkAdd([
      makeTask({ id: 't1', status: 'todo', order: 1 }),
      makeTask({ id: 't2', status: 'in-progress', order: 2 }),
      makeTask({ id: 't3', status: 'done', completed: true, order: 3 }),
    ]);

    const todos = await db.tasks.where('status').equals('todo').toArray();
    expect(todos).toHaveLength(1);

    const done = await db.tasks.where('status').equals('done').toArray();
    expect(done).toHaveLength(1);
  });

  it('supports querying by priority', async () => {
    await db.tasks.bulkAdd([
      makeTask({ id: 't1', priority: 'high', order: 1 }),
      makeTask({ id: 't2', priority: 'low', order: 2 }),
      makeTask({ id: 't3', priority: 'high', order: 3 }),
    ]);

    const high = await db.tasks.where('priority').equals('high').toArray();
    expect(high).toHaveLength(2);
  });

  it('supports querying by folderId', async () => {
    await db.tasks.bulkAdd([
      makeTask({ id: 't1', folderId: 'f1', order: 1 }),
      makeTask({ id: 't2', folderId: 'f2', order: 2 }),
    ]);

    const inF1 = await db.tasks.where('folderId').equals('f1').toArray();
    expect(inF1).toHaveLength(1);
    expect(inF1[0].id).toBe('t1');
  });

  it('supports multi-value index on tags and iocTypes', async () => {
    await db.tasks.bulkAdd([
      makeTask({ id: 't1', tags: ['malware'], iocTypes: ['sha256'], order: 1 }),
      makeTask({ id: 't2', tags: ['malware', 'phishing'], iocTypes: [], order: 2 }),
    ]);

    const withMalware = await db.tasks.where('tags').equals('malware').toArray();
    expect(withMalware).toHaveLength(2);

    const withSha = await db.tasks.where('iocTypes').equals('sha256').toArray();
    expect(withSha).toHaveLength(1);
  });

  it('supports ordering by order field', async () => {
    await db.tasks.bulkAdd([
      makeTask({ id: 't2', order: 2 }),
      makeTask({ id: 't1', order: 1 }),
      makeTask({ id: 't3', order: 3 }),
    ]);

    const sorted = await db.tasks.orderBy('order').toArray();
    expect(sorted.map((t) => t.id)).toEqual(['t1', 't2', 't3']);
  });

  it('stores optional fields (description, comments, dueDate)', async () => {
    await db.tasks.add(makeTask({
      id: 't1',
      description: 'Investigate C2',
      dueDate: '2025-12-31',
      comments: [{ id: 'c1', text: 'Started analysis', createdAt: Date.now() }],
    }));

    const task = await db.tasks.get('t1');
    expect(task!.description).toBe('Investigate C2');
    expect(task!.dueDate).toBe('2025-12-31');
    expect(task!.comments).toHaveLength(1);
    expect(task!.comments![0].text).toBe('Started analysis');
  });
});

// ── Folders CRUD ────────────────────────────────────────────────────

describe('Folders', () => {
  it('can CRUD folders', async () => {
    await db.folders.add({ id: 'f1', name: 'Work', order: 1, createdAt: Date.now() });

    const folders = await db.folders.toArray();
    expect(folders).toHaveLength(1);
    expect(folders[0].name).toBe('Work');

    await db.folders.update('f1', { name: 'Renamed' });
    const updated = await db.folders.get('f1');
    expect(updated!.name).toBe('Renamed');

    await db.folders.delete('f1');
    expect(await db.folders.count()).toBe(0);
  });

  it('supports ordering by order field', async () => {
    await db.folders.bulkAdd([
      { id: 'f2', name: 'B', order: 2, createdAt: 1 },
      { id: 'f1', name: 'A', order: 1, createdAt: 2 },
      { id: 'f3', name: 'C', order: 3, createdAt: 3 },
    ]);

    const sorted = await db.folders.orderBy('order').toArray();
    expect(sorted.map((f) => f.id)).toEqual(['f1', 'f2', 'f3']);
  });

  it('stores investigation metadata fields', async () => {
    await db.folders.add({
      id: 'f1', name: 'APT29 Investigation', order: 1, createdAt: Date.now(),
      description: 'Tracking APT29 activity', status: 'active',
      clsLevel: 'TLP:AMBER', papLevel: 'PAP:GREEN',
    });

    const folder = await db.folders.get('f1');
    expect(folder!.description).toBe('Tracking APT29 activity');
    expect(folder!.status).toBe('active');
    expect(folder!.clsLevel).toBe('TLP:AMBER');
    expect(folder!.papLevel).toBe('PAP:GREEN');
  });
});

// ── Tags CRUD ───────────────────────────────────────────────────────

describe('Tags', () => {
  it('can CRUD tags', async () => {
    await db.tags.add({ id: 'tg1', name: 'urgent', color: '#ff0000' });

    const tags = await db.tags.toArray();
    expect(tags).toHaveLength(1);
    expect(tags[0].name).toBe('urgent');

    await db.tags.update('tg1', { name: 'critical' });
    const updated = await db.tags.get('tg1');
    expect(updated!.name).toBe('critical');

    await db.tags.delete('tg1');
    expect(await db.tags.count()).toBe(0);
  });

  it('supports querying by name', async () => {
    await db.tags.bulkAdd([
      { id: 'tg1', name: 'alpha', color: '#000' },
      { id: 'tg2', name: 'beta', color: '#111' },
    ]);

    const result = await db.tags.where('name').equals('beta').first();
    expect(result!.id).toBe('tg2');
  });
});

// ── Timeline Events CRUD & queries ──────────────────────────────────

describe('Timeline Events', () => {
  it('can CRUD timeline events', async () => {
    await db.timelineEvents.add(makeTimelineEvent({
      id: 'te1', title: 'Initial compromise', eventType: 'initial-access',
    }));

    const event = await db.timelineEvents.get('te1');
    expect(event).toBeDefined();
    expect(event!.title).toBe('Initial compromise');
    expect(event!.eventType).toBe('initial-access');

    await db.timelineEvents.update('te1', { title: 'Updated title' });
    const updated = await db.timelineEvents.get('te1');
    expect(updated!.title).toBe('Updated title');

    await db.timelineEvents.delete('te1');
    expect(await db.timelineEvents.get('te1')).toBeUndefined();
  });

  it('supports querying by eventType', async () => {
    await db.timelineEvents.bulkAdd([
      makeTimelineEvent({ id: 'te1', eventType: 'initial-access' }),
      makeTimelineEvent({ id: 'te2', eventType: 'execution' }),
      makeTimelineEvent({ id: 'te3', eventType: 'initial-access' }),
    ]);

    const access = await db.timelineEvents.where('eventType').equals('initial-access').toArray();
    expect(access).toHaveLength(2);
  });

  it('supports querying by timelineId', async () => {
    await db.timelineEvents.bulkAdd([
      makeTimelineEvent({ id: 'te1', timelineId: 'tl1' }),
      makeTimelineEvent({ id: 'te2', timelineId: 'tl2' }),
      makeTimelineEvent({ id: 'te3', timelineId: 'tl1' }),
    ]);

    const inTl1 = await db.timelineEvents.where('timelineId').equals('tl1').toArray();
    expect(inTl1).toHaveLength(2);
  });

  it('supports filtering by starred', async () => {
    await db.timelineEvents.bulkAdd([
      makeTimelineEvent({ id: 'te1', starred: true }),
      makeTimelineEvent({ id: 'te2', starred: false }),
    ]);

    const starred = await db.timelineEvents.filter((e) => e.starred).toArray();
    expect(starred).toHaveLength(1);
    expect(starred[0].id).toBe('te1');
  });

  it('supports querying by folderId', async () => {
    await db.timelineEvents.bulkAdd([
      makeTimelineEvent({ id: 'te1', folderId: 'f1' }),
      makeTimelineEvent({ id: 'te2', folderId: 'f2' }),
    ]);

    const inF1 = await db.timelineEvents.where('folderId').equals('f1').toArray();
    expect(inF1).toHaveLength(1);
  });

  it('supports ordering by timestamp', async () => {
    await db.timelineEvents.bulkAdd([
      makeTimelineEvent({ id: 'te2', timestamp: 200 }),
      makeTimelineEvent({ id: 'te1', timestamp: 100 }),
      makeTimelineEvent({ id: 'te3', timestamp: 300 }),
    ]);

    const sorted = await db.timelineEvents.orderBy('timestamp').toArray();
    expect(sorted.map((e) => e.id)).toEqual(['te1', 'te2', 'te3']);
  });

  it('supports multi-value index on tags and iocTypes', async () => {
    await db.timelineEvents.bulkAdd([
      makeTimelineEvent({ id: 'te1', tags: ['apt29'], iocTypes: ['ipv4'] }),
      makeTimelineEvent({ id: 'te2', tags: ['apt29', 'phishing'], iocTypes: ['domain'] }),
    ]);

    const withApt29 = await db.timelineEvents.where('tags').equals('apt29').toArray();
    expect(withApt29).toHaveLength(2);

    const withIpv4 = await db.timelineEvents.where('iocTypes').equals('ipv4').toArray();
    expect(withIpv4).toHaveLength(1);
  });

  it('stores optional geolocation fields', async () => {
    await db.timelineEvents.add(makeTimelineEvent({
      id: 'te1', latitude: 51.5074, longitude: -0.1278,
    }));

    const event = await db.timelineEvents.get('te1');
    expect(event!.latitude).toBeCloseTo(51.5074);
    expect(event!.longitude).toBeCloseTo(-0.1278);
  });
});

// ── Timelines CRUD ──────────────────────────────────────────────────

describe('Timelines', () => {
  it('can CRUD timelines', async () => {
    const now = Date.now();
    await db.timelines.add({
      id: 'tl1', name: 'Incident Alpha', order: 0, createdAt: now, updatedAt: now,
    });

    const timeline = await db.timelines.get('tl1');
    expect(timeline).toBeDefined();
    expect(timeline!.name).toBe('Incident Alpha');

    await db.timelines.update('tl1', { name: 'Renamed', description: 'Updated desc' });
    const updated = await db.timelines.get('tl1');
    expect(updated!.name).toBe('Renamed');
    expect(updated!.description).toBe('Updated desc');

    await db.timelines.delete('tl1');
    expect(await db.timelines.get('tl1')).toBeUndefined();
  });

  it('supports ordering by order field', async () => {
    const now = Date.now();
    await db.timelines.bulkAdd([
      { id: 'tl2', name: 'B', order: 2, createdAt: now, updatedAt: now },
      { id: 'tl1', name: 'A', order: 1, createdAt: now, updatedAt: now },
      { id: 'tl3', name: 'C', order: 3, createdAt: now, updatedAt: now },
    ]);

    const sorted = await db.timelines.orderBy('order').toArray();
    expect(sorted.map((t) => t.id)).toEqual(['tl1', 'tl2', 'tl3']);
  });

  it('stores optional color field', async () => {
    const now = Date.now();
    await db.timelines.add({
      id: 'tl1', name: 'Color Test', order: 0, createdAt: now, updatedAt: now, color: '#ef4444',
    });

    const tl = await db.timelines.get('tl1');
    expect(tl!.color).toBe('#ef4444');
  });
});

// ── Whiteboards CRUD & queries ──────────────────────────────────────

describe('Whiteboards', () => {
  it('can CRUD whiteboards', async () => {
    const now = Date.now();
    await db.whiteboards.add({
      id: 'wb1', name: 'Attack Map', elements: '[]', tags: [],
      order: 0, trashed: false, archived: false, createdAt: now, updatedAt: now,
    });

    const wb = await db.whiteboards.get('wb1');
    expect(wb).toBeDefined();
    expect(wb!.name).toBe('Attack Map');

    await db.whiteboards.update('wb1', { name: 'Updated Map', elements: '[{"type":"rect"}]' });
    const updated = await db.whiteboards.get('wb1');
    expect(updated!.name).toBe('Updated Map');
    expect(updated!.elements).toBe('[{"type":"rect"}]');

    await db.whiteboards.delete('wb1');
    expect(await db.whiteboards.get('wb1')).toBeUndefined();
  });

  it('supports querying by folderId', async () => {
    const now = Date.now();
    await db.whiteboards.bulkAdd([
      { id: 'wb1', name: 'A', elements: '[]', tags: [], folderId: 'f1', order: 0, trashed: false, archived: false, createdAt: now, updatedAt: now },
      { id: 'wb2', name: 'B', elements: '[]', tags: [], folderId: 'f2', order: 1, trashed: false, archived: false, createdAt: now, updatedAt: now },
    ]);

    const inF1 = await db.whiteboards.where('folderId').equals('f1').toArray();
    expect(inF1).toHaveLength(1);
    expect(inF1[0].id).toBe('wb1');
  });

  it('supports multi-value index on tags', async () => {
    const now = Date.now();
    await db.whiteboards.bulkAdd([
      { id: 'wb1', name: 'A', elements: '[]', tags: ['network'], order: 0, trashed: false, archived: false, createdAt: now, updatedAt: now },
      { id: 'wb2', name: 'B', elements: '[]', tags: ['network', 'c2'], order: 1, trashed: false, archived: false, createdAt: now, updatedAt: now },
    ]);

    const withNetwork = await db.whiteboards.where('tags').equals('network').toArray();
    expect(withNetwork).toHaveLength(2);
  });

  it('supports ordering by order field', async () => {
    const now = Date.now();
    await db.whiteboards.bulkAdd([
      { id: 'wb3', name: 'C', elements: '[]', tags: [], order: 3, trashed: false, archived: false, createdAt: now, updatedAt: now },
      { id: 'wb1', name: 'A', elements: '[]', tags: [], order: 1, trashed: false, archived: false, createdAt: now, updatedAt: now },
    ]);

    const sorted = await db.whiteboards.orderBy('order').toArray();
    expect(sorted.map((w) => w.id)).toEqual(['wb1', 'wb3']);
  });
});

// ── Activity Log CRUD & queries ─────────────────────────────────────

describe('Activity Log', () => {
  it('can CRUD activity log entries', async () => {
    await db.activityLog.add({
      id: 'al1', action: 'create', category: 'note',
      detail: 'Created note "Test"', timestamp: Date.now(),
    });

    const entry = await db.activityLog.get('al1');
    expect(entry).toBeDefined();
    expect(entry!.action).toBe('create');
    expect(entry!.category).toBe('note');

    await db.activityLog.delete('al1');
    expect(await db.activityLog.get('al1')).toBeUndefined();
  });

  it('supports querying by category', async () => {
    await db.activityLog.bulkAdd([
      { id: 'al1', action: 'create', category: 'note', detail: 'A', timestamp: 1 },
      { id: 'al2', action: 'update', category: 'task', detail: 'B', timestamp: 2 },
      { id: 'al3', action: 'delete', category: 'note', detail: 'C', timestamp: 3 },
    ]);

    const noteEntries = await db.activityLog.where('category').equals('note').toArray();
    expect(noteEntries).toHaveLength(2);
  });

  it('supports querying by action', async () => {
    await db.activityLog.bulkAdd([
      { id: 'al1', action: 'create', category: 'note', detail: 'A', timestamp: 1 },
      { id: 'al2', action: 'create', category: 'task', detail: 'B', timestamp: 2 },
      { id: 'al3', action: 'delete', category: 'note', detail: 'C', timestamp: 3 },
    ]);

    const creates = await db.activityLog.where('action').equals('create').toArray();
    expect(creates).toHaveLength(2);
  });

  it('supports ordering by timestamp', async () => {
    await db.activityLog.bulkAdd([
      { id: 'al2', action: 'update', category: 'note', detail: 'B', timestamp: 200 },
      { id: 'al1', action: 'create', category: 'note', detail: 'A', timestamp: 100 },
      { id: 'al3', action: 'delete', category: 'note', detail: 'C', timestamp: 300 },
    ]);

    const sorted = await db.activityLog.orderBy('timestamp').toArray();
    expect(sorted.map((e) => e.id)).toEqual(['al1', 'al2', 'al3']);
  });

  it('stores optional itemId and itemTitle', async () => {
    await db.activityLog.add({
      id: 'al1', action: 'create', category: 'note',
      detail: 'Created note', itemId: 'n1', itemTitle: 'Test Note', timestamp: Date.now(),
    });

    const entry = await db.activityLog.get('al1');
    expect(entry!.itemId).toBe('n1');
    expect(entry!.itemTitle).toBe('Test Note');
  });
});

// ── Bulk operations ─────────────────────────────────────────────────

describe('Bulk operations', () => {
  it('bulkAdd inserts multiple notes', async () => {
    await db.notes.bulkAdd([
      makeNote({ id: 'n1', title: 'A' }),
      makeNote({ id: 'n2', title: 'B' }),
      makeNote({ id: 'n3', title: 'C' }),
    ]);

    expect(await db.notes.count()).toBe(3);
  });

  it('bulkPut upserts records', async () => {
    await db.notes.add(makeNote({ id: 'n1', title: 'Original' }));

    await db.notes.bulkPut([
      makeNote({ id: 'n1', title: 'Updated' }),
      makeNote({ id: 'n2', title: 'New' }),
    ]);

    expect(await db.notes.count()).toBe(2);
    const n1 = await db.notes.get('n1');
    expect(n1!.title).toBe('Updated');
  });

  it('bulkDelete removes multiple records', async () => {
    await db.tasks.bulkAdd([
      makeTask({ id: 't1', order: 1 }),
      makeTask({ id: 't2', order: 2 }),
      makeTask({ id: 't3', order: 3 }),
    ]);

    await db.tasks.bulkDelete(['t1', 't3']);
    expect(await db.tasks.count()).toBe(1);
    const remaining = await db.tasks.get('t2');
    expect(remaining).toBeDefined();
  });
});

// ── Cross-table relationships ───────────────────────────────────────

describe('Cross-table relationships', () => {
  it('notes reference folders by folderId', async () => {
    await db.folders.add({ id: 'f1', name: 'Investigation', order: 0, createdAt: Date.now() });
    await db.notes.add(makeNote({ id: 'n1', folderId: 'f1' }));

    const note = await db.notes.get('n1');
    const folder = await db.folders.get(note!.folderId!);
    expect(folder!.name).toBe('Investigation');
  });

  it('timeline events reference timelines by timelineId', async () => {
    const now = Date.now();
    await db.timelines.add({ id: 'tl1', name: 'Main', order: 0, createdAt: now, updatedAt: now });
    await db.timelineEvents.add(makeTimelineEvent({ id: 'te1', timelineId: 'tl1' }));

    const event = await db.timelineEvents.get('te1');
    const timeline = await db.timelines.get(event!.timelineId);
    expect(timeline!.name).toBe('Main');
  });

  it('entity linking fields store cross-references', async () => {
    await db.notes.add(makeNote({
      id: 'n1', linkedTaskIds: ['t1'], linkedTimelineEventIds: ['te1'],
    }));
    await db.tasks.add(makeTask({
      id: 't1', linkedNoteIds: ['n1'], order: 1,
    }));

    const note = await db.notes.get('n1');
    expect(note!.linkedTaskIds).toEqual(['t1']);

    const task = await db.tasks.get('t1');
    expect(task!.linkedNoteIds).toEqual(['n1']);
  });
});
