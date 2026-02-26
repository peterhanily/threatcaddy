import { describe, it, expect, beforeEach } from 'vitest';
import { exportJSON, importJSON, exportNotesMarkdown } from '../lib/export';
import { db } from '../db';
import type { Note } from '../types';

beforeEach(async () => {
  await db.notes.clear();
  await db.tasks.clear();
  await db.folders.clear();
  await db.tags.clear();
  await db.timelines.clear();
  await db.timelineEvents.clear();
  await db.whiteboards.clear();
});

describe('exportJSON / importJSON roundtrip', () => {
  it('exports and re-imports data correctly', async () => {
    // Seed data
    await db.notes.add({
      id: 'n1', title: 'Test Note', content: '# Hello', tags: ['test'],
      pinned: false, archived: false, trashed: false, createdAt: 1000, updatedAt: 2000,
    });
    await db.tasks.add({
      id: 't1', title: 'Test Task', completed: false, priority: 'high',
      tags: [], status: 'todo', order: 1, createdAt: 1000, updatedAt: 2000,
    });
    await db.folders.add({ id: 'f1', name: 'Work', order: 1, createdAt: 1000 });
    await db.tags.add({ id: 'tg1', name: 'test', color: '#ff0000' });

    // Export
    const json = await exportJSON();
    const parsed = JSON.parse(json);
    expect(parsed.version).toBe(1);
    expect(parsed.notes).toHaveLength(1);
    expect(parsed.tasks).toHaveLength(1);
    expect(parsed.folders).toHaveLength(1);
    expect(parsed.tags).toHaveLength(1);

    // Clear and reimport
    await db.notes.clear();
    await db.tasks.clear();
    await db.folders.clear();
    await db.tags.clear();

    const counts = await importJSON(json);
    expect(counts).toEqual({ notes: 1, tasks: 1, folders: 1, tags: 1, timelineEvents: 0, timelines: 0, whiteboards: 0 });

    // Verify data integrity
    const notes = await db.notes.toArray();
    expect(notes[0].title).toBe('Test Note');
    expect(notes[0].content).toBe('# Hello');
    expect(notes[0].tags).toEqual(['test']);

    const tasks = await db.tasks.toArray();
    expect(tasks[0].title).toBe('Test Task');
    expect(tasks[0].priority).toBe('high');
  });

  it('preserves all v9-v11 fields through export→import round-trip', async () => {
    // Seed data with all new fields from DB v9-v11
    await db.notes.add({
      id: 'n1', title: 'Classified Note', content: 'secret', tags: ['intel'],
      pinned: false, archived: false, trashed: false, createdAt: 1000, updatedAt: 2000,
      clsLevel: 'TLP:AMBER',
      linkedNoteIds: ['n2'],
      linkedTaskIds: ['t1'],
      linkedTimelineEventIds: ['ev1'],
    });
    await db.tasks.add({
      id: 't1', title: 'Classified Task', completed: false, priority: 'high',
      tags: [], status: 'todo', order: 1, createdAt: 1000, updatedAt: 2000,
      clsLevel: 'TLP:RED',
      linkedNoteIds: ['n1'],
      linkedTaskIds: [],
      linkedTimelineEventIds: ['ev1'],
    });
    await db.folders.add({
      id: 'f1', name: 'Case Alpha', order: 1, createdAt: 1000,
      description: 'Major incident', status: 'active',
      clsLevel: 'TLP:GREEN', papLevel: 'PAP:WHITE',
      tags: ['case'], timelineId: 'tl1',
    });
    await db.tags.add({ id: 'tg1', name: 'intel', color: '#ff0000' });
    await db.timelines.add({ id: 'tl1', name: 'Alpha TL', order: 0, createdAt: 1000, updatedAt: 1000 });
    await db.timelineEvents.add({
      id: 'ev1', timestamp: 5000, title: 'Event 1', eventType: 'other',
      source: 'test', confidence: 'high', linkedIOCIds: [], linkedNoteIds: ['n1'],
      linkedTaskIds: ['t1'], mitreAttackIds: [], assets: [], tags: [], starred: false,
      timelineId: 'tl1', createdAt: 1000, updatedAt: 2000,
      clsLevel: 'TLP:AMBER',
      iocAnalysis: {
        extractedAt: 3000,
        iocs: [{
          id: 'ioc1', type: 'ipv4', value: '10.0.0.1', confidence: 'high',
          firstSeen: 1000, dismissed: false,
          iocSubtype: 'ipv4', iocStatus: 'active', clsLevel: 'TLP:RED',
          relationships: [{ targetIOCId: 'ioc2', relationshipType: 'communicates-with' }],
        }],
        analysisSummary: 'Suspicious IP',
        lastPushedAt: 4000,
      },
      iocTypes: ['ipv4'],
    });

    // Export
    const json = await exportJSON();

    // Clear everything
    await Promise.all([
      db.notes.clear(), db.tasks.clear(), db.folders.clear(),
      db.tags.clear(), db.timelines.clear(), db.timelineEvents.clear(),
      db.whiteboards.clear(),
    ]);

    // Re-import through sanitizers
    const counts = await importJSON(json);
    expect(counts).toEqual({ notes: 1, tasks: 1, folders: 1, tags: 1, timelineEvents: 1, timelines: 1, whiteboards: 0 });

    // Verify Note fields
    const notes = await db.notes.toArray();
    expect(notes[0].clsLevel).toBe('TLP:AMBER');
    expect(notes[0].linkedNoteIds).toEqual(['n2']);
    expect(notes[0].linkedTaskIds).toEqual(['t1']);
    expect(notes[0].linkedTimelineEventIds).toEqual(['ev1']);

    // Verify Task fields
    const tasks = await db.tasks.toArray();
    expect(tasks[0].clsLevel).toBe('TLP:RED');
    expect(tasks[0].linkedNoteIds).toEqual(['n1']);
    expect(tasks[0].linkedTimelineEventIds).toEqual(['ev1']);

    // Verify Folder/Investigation fields
    const folders = await db.folders.toArray();
    expect(folders[0].description).toBe('Major incident');
    expect(folders[0].status).toBe('active');
    expect(folders[0].clsLevel).toBe('TLP:GREEN');
    expect(folders[0].papLevel).toBe('PAP:WHITE');
    expect(folders[0].tags).toEqual(['case']);
    expect(folders[0].timelineId).toBe('tl1');

    // Verify TimelineEvent fields
    const events = await db.timelineEvents.toArray();
    expect(events[0].clsLevel).toBe('TLP:AMBER');
    expect(events[0].iocTypes).toEqual(['ipv4']);
    expect(events[0].iocAnalysis).toBeDefined();
    expect(events[0].iocAnalysis?.lastPushedAt).toBe(4000);
    expect(events[0].iocAnalysis?.analysisSummary).toBe('Suspicious IP');

    // Verify IOCEntry fields within iocAnalysis
    const ioc = events[0].iocAnalysis?.iocs[0];
    expect(ioc).toBeDefined();
    expect(ioc?.iocSubtype).toBe('ipv4');
    expect(ioc?.iocStatus).toBe('active');
    expect(ioc?.clsLevel).toBe('TLP:RED');
    expect(ioc?.relationships).toEqual([{ targetIOCId: 'ioc2', relationshipType: 'communicates-with' }]);
  });

  it('rejects invalid import data', async () => {
    await expect(importJSON('{}')).rejects.toThrow('Invalid backup file format');
    await expect(importJSON('not json')).rejects.toThrow();
  });
});

describe('exportNotesMarkdown', () => {
  it('formats notes as markdown with metadata', () => {
    const notes: Note[] = [{
      id: '1', title: 'My Note', content: 'Hello world',
      tags: ['tag1', 'tag2'], pinned: false, archived: false, trashed: false,
      createdAt: new Date('2024-01-15').getTime(),
      updatedAt: new Date('2024-01-16').getTime(),
    }];

    const md = exportNotesMarkdown(notes);
    expect(md).toContain('# My Note');
    expect(md).toContain('Tags: tag1, tag2');
    expect(md).toContain('Hello world');
    expect(md).toContain('Created:');
  });

  it('handles multiple notes with separators', () => {
    const notes: Note[] = [
      { id: '1', title: 'A', content: 'a', tags: [], pinned: false, archived: false, trashed: false, createdAt: 1000, updatedAt: 1000 },
      { id: '2', title: 'B', content: 'b', tags: [], pinned: false, archived: false, trashed: false, createdAt: 1000, updatedAt: 1000 },
    ];

    const md = exportNotesMarkdown(notes);
    expect(md).toContain('# A');
    expect(md).toContain('# B');
    expect(md).toContain('---');
  });
});
