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

  it('reads a timestamp in the log as the time it is, whichever side changed it', () => {
    const later = new Date('2026-11-02T08:00:00Z');
    // Only the put changes it: written. (Without the conversion the unchanged case below would look changed.)
    expect(mergeStalePut('tasks', put({ completedAt: later }), base, stored({ priority: 'high' }))).toEqual({ completedAt: later });
    // Only the stored row changed it: kept, and the put's other change is written.
    expect(mergeStalePut('tasks', put({ title: 'New title' }), base, stored({ completedAt: later }))).toEqual({ title: 'New title' });
    // Both changed it to different times: a conflict.
    expect(mergeStalePut('tasks', put({ completedAt: later }), base, stored({ completedAt: new Date('2026-11-03T08:00:00Z') }))).toBeNull();
  });

  it('never merges when either side changed what or where the record is', () => {
    // An edit is not merged into a task a teammate trashed or archived, or the other way round.
    expect(mergeStalePut('tasks', put({ title: 'New title' }), base, stored({ trashed: true, trashedAt: new Date() }))).toBeNull();
    expect(mergeStalePut('tasks', put({ archived: true }), base, stored({ priority: 'high' }))).toBeNull();
    // A note about an indicator is not merged onto a replaced indicator.
    const ioc = { id: 'i1', type: 'ipv4', value: '10.0.0.5', folder_id: 'case', analyst_notes: null, confidence: 'low', trashed: false, archived: false, version: 1 };
    const iocRow = (changes: Record<string, unknown> = {}) => ({ id: 'i1', type: 'ipv4', value: '10.0.0.5', folderId: 'case', analystNotes: null, confidence: 'low', trashed: false, archived: false, version: 2, ...changes });
    expect(mergeStalePut('standaloneIOCs', { analystNotes: 'internal host, benign', confidence: 'high' }, ioc, iocRow({ type: 'domain', value: 'evil.example' }))).toBeNull();
    expect(mergeStalePut('standaloneIOCs', { analystNotes: 'internal host, benign' }, ioc, iocRow({ confidence: 'high' }))).toEqual({ analystNotes: 'internal host, benign' });
    // A phone number for a person is not merged onto an identity that became a system.
    const person = { id: 'p1', type: 'person', name: 'J. Doe', folder_id: 'case', details: [], tags: [], aliases: [], connections: [], trashed: false, archived: false, version: 1 };
    const identityRow = (changes: Record<string, unknown> = {}) => ({ id: 'p1', type: 'person', name: 'J. Doe', folderId: 'case', details: [], tags: [], aliases: [], connections: [], trashed: false, archived: false, version: 2, ...changes });
    const phone = [{ id: 'd1', label: 'Phone', value: '+1 555 0100', private: true }];
    expect(mergeStalePut('identities', { details: phone }, person, identityRow({ type: 'system', name: 'JDOE-LAPTOP' }))).toBeNull();
    expect(mergeStalePut('identities', { details: phone }, person, identityRow({ tags: ['vip'] }))).toEqual({ details: phone });
    // An end time is not merged onto an event whose start moved.
    const event = { id: 'e1', title: 'Login', timestamp: 1000, timestamp_end: null, folder_id: 'case', trashed: false, archived: false, version: 1 };
    expect(mergeStalePut('timelineEvents', { timestampEnd: 5000 }, event, { id: 'e1', title: 'Login', timestamp: 9000, timestampEnd: null, folderId: 'case', trashed: false, archived: false, version: 2 })).toBeNull();
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
