import { describe, it, expect, beforeEach } from 'vitest';
import { db } from '../db';
import { purgeOldTrash } from '../lib/trash-purge';
import type { Note, Task } from '../types';

const DAY_MS = 86_400_000;
const NOW = Date.now();
function note(overrides: Partial<Note> = {}): Note {
  return { id: 'note', title: 'Test note', content: '', tags: [], pinned: false,
    trashed: false, archived: false, createdAt: NOW, updatedAt: NOW, ...overrides };
}
function task(overrides: Partial<Task> = {}): Task {
  return { id: 'task', title: 'Test task', tags: [], status: 'todo', completed: false,
    priority: 'none', order: 0, trashed: false, archived: false, createdAt: NOW, updatedAt: NOW, ...overrides };
}
async function purgeNotes(items: Note[]) {
  await db.notes.bulkAdd(items);
  return purgeOldTrash(items, db.notes);
}

describe('purgeOldTrash with the registered IndexedDB lifecycle', () => {
  beforeEach(async () => { await Promise.all(db.tables.map(table => table.clear())); });

  it('keeps recent, undated and non-trashed records', async () => {
    const items = [
      note({ id: 'recent', trashed: true, trashedAt: NOW - 15 * DAY_MS }),
      note({ id: 'undated', trashed: true }),
      note({ id: 'active', trashedAt: NOW - 60 * DAY_MS }),
    ];
    expect(await purgeNotes(items)).toEqual(items);
    expect(await db.notes.count()).toBe(3);
  });

  it('purges records older than 30 days, including just over the boundary', async () => {
    expect(await purgeNotes([
      note({ id: 'old', trashed: true, trashedAt: NOW - 31 * DAY_MS }),
      note({ id: 'boundary', trashed: true, trashedAt: NOW - 30 * DAY_MS - 1 }),
    ])).toEqual([]);
    expect(await db.notes.count()).toBe(0);
  });

  it('returns a mixed list without the purged records', async () => {
    const items = [
      note({ id: 'old', trashed: true, trashedAt: NOW - 40 * DAY_MS }),
      note({ id: 'recent', trashed: true, trashedAt: NOW - 5 * DAY_MS }),
      note({ id: 'active' }), note({ id: 'undated', trashed: true }),
    ];
    expect((await purgeNotes(items)).map(row => row.id)).toEqual(['recent', 'active', 'undated']);
    expect((await db.notes.toArray()).map(row => row.id).sort()).toEqual(['active', 'recent', 'undated']);
  });

  it('accepts an empty list', async () => {
    expect(await purgeOldTrash([], db.notes)).toEqual([]);
  });

  it('deletes several old records and their reverse references atomically', async () => {
    await db.tasks.add(task({ linkedNoteIds: ['old-1', 'old-2', 'retained'] }));
    expect(await purgeNotes(['old-1', 'old-2'].map(id => note({ id, trashed: true, trashedAt: NOW - 40 * DAY_MS })))).toEqual([]);
    expect((await db.tasks.get('task'))?.linkedNoteIds).toEqual(['retained']);
  });

  it('handles task records through the same lifecycle', async () => {
    const tasks = [task({ id: 'old', trashed: true, trashedAt: NOW - 60 * DAY_MS }),
      task({ id: 'recent', trashed: true, trashedAt: NOW - 2 * DAY_MS })];
    await db.tasks.bulkAdd(tasks);
    expect((await purgeOldTrash(tasks, db.tasks)).map(row => row.id)).toEqual(['recent']);
    expect(await db.tasks.get('old')).toBeUndefined();
  });

  it('serializes concurrent startup purges, including duplicate reloads', async () => {
    const notes = [note({ trashed: true, trashedAt: NOW - 40 * DAY_MS })];
    const tasks = [task({ trashed: true, trashedAt: NOW - 40 * DAY_MS })];
    await db.notes.bulkAdd(notes);
    await db.tasks.bulkAdd(tasks);
    expect(await Promise.all([purgeOldTrash(notes, db.notes), purgeOldTrash(tasks, db.tasks), purgeOldTrash(notes, db.notes)])).toEqual([[], [], []]);
    expect(await db.notes.count()).toBe(0);
    expect(await db.tasks.count()).toBe(0);
  });

  it('rechecks the current row and preserves a restored record from a stale purge snapshot', async () => {
    const old = note({ trashed: true, trashedAt: NOW - 40 * DAY_MS });
    await db.notes.add(old);
    await db.notes.update(old.id, { trashed: false, trashedAt: undefined, title: 'Restored' });
    await db.tasks.add(task({ linkedNoteIds: [old.id] }));
    const result = await purgeOldTrash([old], db.notes);
    expect(result).toMatchObject([{ id: old.id, trashed: false, title: 'Restored' }]);
    expect((await db.tasks.get('task'))?.linkedNoteIds).toEqual([old.id]);
  });

  it('does not leave partial reference cleanup if deletion fails', async () => {
    await db.tasks.add(task({ linkedNoteIds: ['note'] }));
    const old = note({ trashed: true, trashedAt: NOW - 40 * DAY_MS });
    await db.notes.add(old);
    const fail = () => { throw new Error('write failure'); };
    db.tasks.hook('updating', fail);
    try { await expect(purgeOldTrash([old], db.notes)).rejects.toThrow('write failure'); }
    finally { db.tasks.hook('updating').unsubscribe(fail); }
    expect(await db.notes.get(old.id)).toBeDefined();
    expect((await db.tasks.get('task'))?.linkedNoteIds).toEqual([old.id]);
    // A rejected lifecycle operation must not poison the queue.
    expect(await purgeOldTrash([old], db.notes)).toEqual([]);
  });
});
