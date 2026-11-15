import { beforeEach, describe, expect, it } from 'vitest';
import { db } from '../db';
import { buildFullBackupPayload } from '../lib/backup-data';
import { deleteEntitiesWithReferences } from '../lib/entity-relations';
import { exportJSON } from '../lib/export';
import { purgeOldTrash } from '../lib/trash-purge';

const base = { tags: [], createdAt: 1, updatedAt: 1, trashed: false, archived: false };
const policy = { autoApproveReads: true, autoApproveEnrich: true, autoApproveFetch: false, autoApproveCreate: false, autoApproveModify: false, intervalMinutes: 5 };

beforeEach(async () => {
  await Promise.all(db.tables.map(table => table.clear()));
});

/** Every explicit reference edge whose target a supported caller can permanently delete. */
async function graph() {
  await db.table('folders').add({ id: 'f', name: 'Case', order: 0, createdAt: 1, updatedAt: 1, agentThreadId: 'audit', timelineId: 'tl', agentPolicy: policy });
  await db.table('timelines').add({ id: 'tl', name: 'Timeline', order: 0, createdAt: 1, updatedAt: 1 });
  await db.table('notes').bulkAdd([
    { ...base, id: 'parent', title: 'Parent', content: 'Body', folderId: 'f', pinned: false },
    { ...base, id: 'minutes', title: 'Minutes', content: 'Meeting minutes', folderId: 'f', pinned: false, parentNoteId: 'parent', linkedTaskIds: ['task'],
      iocAnalysis: { extractedAt: 1, iocs: [{ id: 'embedded', type: 'domain', value: 'embedded.test', confidence: 'high', firstSeen: 1, dismissed: false, relationships: [{ targetIOCId: 'ioc', relationshipType: 'related-to' }] }] } },
  ]);
  await db.table('tasks').add({ ...base, id: 'task', title: 'Review', folderId: 'f', status: 'todo', completed: false, priority: 'none', order: 0, linkedNoteIds: ['minutes'], linkedTimelineEventIds: ['event'] });
  await db.table('timelineEvents').add({ ...base, id: 'event', title: 'Observation', folderId: 'f', timelineId: 'tl', timestamp: 1, eventType: 'other', source: '', confidence: 'high',
    linkedNoteIds: ['minutes'], linkedTaskIds: ['task'], linkedIOCIds: ['ioc', 'embedded'], mitreAttackIds: [], assets: [], starred: false });
  await db.table('standaloneIOCs').add({ ...base, id: 'ioc', type: 'domain', value: 'example.test', confidence: 'high', folderId: 'f', linkedNoteIds: ['minutes'], linkedEvidenceIds: ['evidence'],
    relationships: [{ targetIOCId: 'embedded', relationshipType: 'related-to' }] });
  await db.table('evidenceItems').add({ ...base, id: 'evidence', title: 'Source', fileName: 'source.txt', fileType: 'text', content: 'Source text', size: 11, importedAt: 1,
    chunkIndex: 1, chunkCount: 1, extractionStatus: 'extracted', folderId: 'f', linkedIOCIds: ['ioc'] });
  await db.table('whiteboards').add({ ...base, id: 'board', name: 'Board', elements: '[]', folderId: 'f', order: 0 });
  await db.table('chatThreads').bulkAdd([
    { ...base, id: 'audit', title: 'Agent audit', messages: [], provider: 'anthropic', model: 'model', folderId: 'f', source: 'agent' },
    { ...base, id: 'meeting-thread', title: 'Meeting', parentThreadId: 'audit', messages: [], provider: 'anthropic', model: 'model', folderId: 'f', source: 'agent-meeting' },
  ]);
  await db.table('agentProfiles').add({ id: 'profile', name: 'Analyst', role: 'specialist', systemPrompt: 'Review', policy, source: 'user', createdAt: 1, updatedAt: 1 });
  await db.table('agentDeployments').add({ id: 'deployment', investigationId: 'f', profileId: 'profile', threadId: 'audit', status: 'idle', shift: 'active', order: 0, createdAt: 1, updatedAt: 1 });
  await db.table('agentActions').add({ id: 'action', investigationId: 'f', threadId: 'audit', toolName: 'create_note', toolInput: { title: 'Draft' }, rationale: 'History', status: 'executed', createdAt: 1 });
  await db.table('agentMeetings').add({ id: 'meeting', investigationId: 'f', participantDeploymentIds: ['deployment'], threadId: 'meeting-thread', minutesNoteId: 'minutes',
    agenda: 'Review', status: 'completed', roundsCompleted: 1, maxRounds: 1, createdAt: 1 });
}

async function expectBackupsSucceed(label: string) {
  await expect(buildFullBackupPayload('all'), label).resolves.toBeDefined();
  await expect(buildFullBackupPayload('investigation', 'f'), label).resolves.toBeDefined();
  await expect(exportJSON(), label).resolves.toContain('threatcaddy-backup');
}

describe('permanent deletion keeps every remaining record backup-valid', () => {
  it('starts from a backup-valid graph', async () => {
    await graph();
    await expectBackupsSucceed('baseline');
  });

  it.each([
    ['notes', 'minutes'], ['notes', 'parent'], ['tasks', 'task'], ['timelineEvents', 'event'], ['standaloneIOCs', 'ioc'],
    ['evidenceItems', 'evidence'], ['whiteboards', 'board'], ['chatThreads', 'audit'], ['chatThreads', 'meeting-thread'],
  ])('after deleting %s:%s', async (table, id) => {
    await graph();
    await deleteEntitiesWithReferences({ [table]: [id] });
    await expectBackupsSucceed(`${table}:${id}`);
  });

  it('keeps agent history rows, without updatedAt, and marks a removed required thread edge as empty', async () => {
    await graph();
    await deleteEntitiesWithReferences({ notes: ['minutes'], chatThreads: ['audit', 'meeting-thread'] });
    const meeting = await db.agentMeetings.get('meeting');
    const action = await db.agentActions.get('action');
    expect(meeting).toBeDefined();
    expect(meeting).not.toHaveProperty('updatedAt');
    expect(meeting).not.toHaveProperty('minutesNoteId');
    expect(meeting?.threadId).toBe('');
    expect(action).not.toHaveProperty('updatedAt');
    expect(action?.threadId).toBe('');
    // Tables whose records carry a modification time are still stamped.
    expect((await db.agentDeployments.get('deployment'))?.updatedAt).toBeGreaterThan(1);
    expect((await db.agentDeployments.get('deployment'))).not.toHaveProperty('threadId');
    expect((await db.tasks.get('task'))?.updatedAt).toBeGreaterThan(1);
  });

  it('keeps backups working after the 30-day purge removes a meeting-minutes note', async () => {
    await graph();
    await db.notes.update('minutes', { trashed: true, trashedAt: 1 });
    const notes = await db.notes.toArray();
    await purgeOldTrash(notes, db.notes);
    expect(await db.notes.get('minutes')).toBeUndefined();
    await expectBackupsSucceed('purge');
  });
});
