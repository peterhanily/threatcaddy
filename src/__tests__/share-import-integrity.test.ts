import { beforeEach, describe, expect, it } from 'vitest';
import { db } from '../db';
import { importSharedPayload } from '../lib/share-import';
import { sanitizeNote } from '../lib/export';

const tables = ['folders', 'notes', 'tasks', 'timelineEvents', 'timelines', 'whiteboards', 'standaloneIOCs', 'chatThreads', 'tags'];
beforeEach(async () => { for (const table of tables) await db.table(table).clear(); });
const investigation = () => ({
  v: 1, s: 'investigation', t: 1_700_000_000_000,
  d: {
    folder: { id: 'folder', name: 'Shared investigation', timelineId: 'timeline', agentEnabled: true, agentStatus: 'running', agentPolicy: { autoApproveReads: true } },
    notes: [{ id: 'note', title: 'Shared note', content: 'Ordinary content', folderId: 'folder', linkedTaskIds: ['task'], linkedNoteIds: ['outside'], tags: ['Existing'],
      iocAnalysis: { iocs: [{ id: 'embedded', type: 'domain', value: 'example.test', relationships: [{ targetIOCId: 'ioc', relationshipType: 'related-to' }] }] } }],
    tasks: [{ id: 'task', title: 'Shared task', folderId: 'folder', linkedNoteIds: ['note'], assigneeId: 'outside-user' }],
    events: [{ id: 'event', title: 'Shared event', folderId: 'folder', timelineId: 'timeline', linkedIOCIds: ['ioc', 'embedded'], linkedNoteIds: ['note'] }],
    timelines: [{ id: 'timeline', name: 'Shared timeline' }],
    whiteboards: [{ id: 'board', name: 'Shared board', folderId: 'folder', elements: '[]', appState: '{}', files: '{}' }],
    iocs: [{ id: 'ioc', type: 'domain', value: 'example.test', folderId: 'folder', linkedNoteIds: ['note'], assigneeId: 'sender-user', assigneeName: 'Sender analyst' }],
    chatThreads: [{ id: 'chat', title: 'Transcript', folderId: 'folder', messages: [] }],
    tags: [{ id: 'tag-existing', name: 'Existing', color: '#ffffff' }, { id: 'tag-new', name: 'Shared', color: '#112233' }],
  },
});

describe('additive shared-content persistence', () => {
  it('preserves recipient records, remaps included links, and detaches external bindings', async () => {
    const existingNote = sanitizeNote({ id: 'note', title: 'Recipient note', content: 'Keep this text' });
    if (!existingNote) throw new Error('Fixture note missing');
    await db.notes.add(existingNote);
    await db.tags.add({ id: 'tag-existing', name: 'Existing', color: '#445566' });
    await db.folders.add({ id: 'folder', name: 'Recipient investigation', order: 0, createdAt: 1, agentEnabled: false });
    await importSharedPayload(investigation());
    expect(await db.notes.get('note')).toEqual(existingNote);
    expect((await db.folders.get('folder'))?.name).toBe('Recipient investigation');
    const folder = await db.folders.filter(row => row.id !== 'folder').first();
    const note = await db.notes.filter(row => row.id !== 'note').first();
    const task = await db.tasks.toCollection().first();
    const event = await db.timelineEvents.toCollection().first();
    const timeline = await db.timelines.toCollection().first();
    const ioc = await db.standaloneIOCs.toCollection().first();
    const embedded = note?.iocAnalysis?.iocs[0];
    expect(folder).toMatchObject({ name: 'Shared investigation (shared copy)', agentEnabled: false, agentStatus: 'idle', timelineId: timeline?.id });
    expect(folder).not.toHaveProperty('agentPolicy');
    expect(note).toMatchObject({ folderId: folder?.id, linkedTaskIds: [task?.id], linkedNoteIds: [] });
    expect(task).toMatchObject({ folderId: folder?.id, linkedNoteIds: [note?.id] });
    expect(task).not.toHaveProperty('assigneeId');
    expect(ioc).not.toHaveProperty('assigneeId');
    expect(ioc).not.toHaveProperty('assigneeName');
    expect(event).toMatchObject({ folderId: folder?.id, timelineId: timeline?.id, linkedIOCIds: [ioc?.id, embedded?.id] });
    expect(embedded?.id).not.toBe('embedded');
    expect(embedded?.relationships?.[0].targetIOCId).toBe(ioc?.id);
    expect((await db.whiteboards.toCollection().first())?.folderId).toBe(folder?.id);
    expect((await db.chatThreads.toCollection().first())?.folderId).toBe(folder?.id);
    expect(await db.tags.get('tag-existing')).toMatchObject({ color: '#445566' });
    expect(await db.tags.get('tag-new')).toBeUndefined();
    expect(await db.tags.count()).toBe(2);
  });

  it('imports a single entity as a new unfiled copy, including on repeated imports', async () => {
    const share = { v: 1, s: 'note', t: 1, d: { id: 'n', title: 'Independent note', folderId: 'recipient-folder', parentNoteId: 'recipient-note', linkedTaskIds: ['recipient-task'] } };
    await importSharedPayload(share);
    await importSharedPayload(share);
    const notes = await db.notes.toArray();
    expect(notes).toHaveLength(2);
    expect(new Set(notes.map(row => row.id)).size).toBe(2);
    for (const note of notes) {
      expect(note.id).not.toBe('n');
      expect(note).not.toHaveProperty('folderId');
      expect(note).not.toHaveProperty('parentNoteId');
      expect(note.linkedTaskIds).toEqual([]);
    }
  });

  it('validates every collection before any writes', async () => {
    const share = investigation();
    share.d.tasks.push({ ...share.d.tasks[0] });
    await expect(importSharedPayload(share)).rejects.toThrow('Duplicate');
    for (const table of tables) expect(await db.table(table).count()).toBe(0);
  });

  it('rolls back all shared records when a later table write fails', async () => {
    const failTaskWrite = () => { throw new Error('Synthetic storage interruption'); };
    db.tasks.hook('creating', failTaskWrite);
    try {
      await expect(importSharedPayload(investigation())).rejects.toThrow('Synthetic storage interruption');
    } finally { db.tasks.hook('creating').unsubscribe(failTaskWrite); }
    for (const table of tables) expect(await db.table(table).count()).toBe(0);
  });
});
