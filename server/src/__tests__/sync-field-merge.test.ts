import { describe, it, expect, vi } from 'vitest';

vi.mock('../db/index.js', () => ({ db: {} }));

import { mergeStalePut } from '../services/sync-service.js';

// The change log stores a row under its column names; the stored row and the put use field names.
const base = { id: 't1', title: 'Collect logs', description: null, completed: false, priority: 'none', due_date: null, folder_id: 'case',
  tags: [], status: 'todo', order: 0, comments: [], trashed: false, archived: false, trashed_at: null, completed_at: '2026-11-01T10:00:00+00:00', version: 3 };
const stored = (changes: Record<string, unknown> = {}) => ({ id: 't1', title: 'Collect logs', description: null, completed: false, priority: 'none',
  dueDate: null, folderId: 'case', tags: [], status: 'todo', order: 0, comments: [], trashed: false, archived: false, trashedAt: null,
  completedAt: new Date('2026-11-01T10:00:00Z'), version: 5, ...changes });
const put = (changes: Record<string, unknown> = {}) => { const { version: _version, id: _id, ...rest } = stored(); void _version; void _id; return { ...rest, ...changes }; };

describe('merging a stale put by field', () => {
  it('keeps both when the two sides changed different fields', () => {
    // A teammate set the priority (stored); this put sets the status, and still carries the old priority.
    expect(mergeStalePut('tasks', put({ status: 'in-progress' }), base, stored({ priority: 'high' }))).toEqual({ status: 'in-progress' });
  });

  it('does not count a timestamp as changed because the log holds it as text', () => {
    expect(mergeStalePut('tasks', put({ title: 'Collect all logs' }), base, stored({ priority: 'high' }))).toEqual({ title: 'Collect all logs' });
  });

  it('is a conflict when both changed one field to different values, and not when to the same value', () => {
    expect(mergeStalePut('tasks', put({ status: 'done' }), base, stored({ status: 'in-progress' }))).toBeNull();
    expect(mergeStalePut('tasks', put({ status: 'done', title: 'New title' }), base, stored({ status: 'done' }))).toEqual({ title: 'New title' });
    expect(mergeStalePut('tasks', put({ status: 'done' }), base, stored({ status: 'done', priority: 'low' }))).toEqual({});
  });

  it('never merges a move between investigations, on either side', () => {
    expect(mergeStalePut('tasks', put({ folderId: 'other' }), base, stored({ priority: 'high' }))).toBeNull();
    expect(mergeStalePut('tasks', put({ status: 'done' }), base, stored({ folderId: 'other' }))).toBeNull();
  });

  it('treats a field the put does not name as unchanged, and compares lists by value', () => {
    const partial = { status: 'in-progress' };
    expect(mergeStalePut('tasks', partial, base, stored({ priority: 'high', tags: ['urgent'] }))).toEqual({ status: 'in-progress' });
    expect(mergeStalePut('tasks', put({ tags: ['a', 'b'] }), { ...base, tags: ['a'] }, stored({ tags: ['a'], priority: 'high' }))).toEqual({ tags: ['a', 'b'] });
    expect(mergeStalePut('tasks', put({ tags: ['a', 'b'] }), { ...base, tags: ['a'] }, stored({ tags: ['a', 'c'] }))).toBeNull();
  });
});
