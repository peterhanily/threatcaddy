import { describe, it, expect, beforeEach } from 'vitest';
import { exportJSON, importJSON, exportNotesMarkdown } from '../lib/export';
import { db } from '../db';
import type { Note } from '../types';

beforeEach(async () => {
  await db.notes.clear();
  await db.tasks.clear();
  await db.folders.clear();
  await db.tags.clear();
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
    expect(counts).toEqual({ notes: 1, tasks: 1, folders: 1, tags: 1, timelineEvents: 0, timelines: 0 });

    // Verify data integrity
    const notes = await db.notes.toArray();
    expect(notes[0].title).toBe('Test Note');
    expect(notes[0].content).toBe('# Hello');
    expect(notes[0].tags).toEqual(['test']);

    const tasks = await db.tasks.toArray();
    expect(tasks[0].title).toBe('Test Task');
    expect(tasks[0].priority).toBe('high');
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
