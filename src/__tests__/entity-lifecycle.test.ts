import { beforeEach, describe, expect, it, vi } from 'vitest';
import { db } from '../db';
import { changeTagEverywhere, deleteEntitiesWithReferences, setInvestigationArchived, TAGGED_TABLES } from '../lib/entity-relations';
import { exportInvestigationJSON, importInvestigationJSON } from '../lib/export';

beforeEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(db.tables.map(table => table.clear()));
});
const base = { tags: ['shared'], createdAt: 1, updatedAt: 1, trashed: false, archived: false, createdBy: 'Original analyst', updatedBy: 'Reviewer' };
async function graph() {
  await db.table('folders').add({ ...base, id: 'f', name: 'Case', order: 0, localOnly: true, agentEnabled: true, agentThreadId: 'chat', timelineId: 'tl', agentPolicy: { autoApproveCreate: false } });
  await db.table('notes').bulkAdd([
    { ...base, id: 'parent', title: 'Parent', content: 'Nested notes', folderId: 'f', pinned: false },
    { ...base, id: 'child', title: 'Child', content: 'Analysis', folderId: 'f', pinned: false, parentNoteId: 'parent', linkedTaskIds: ['task'], linkedNoteIds: ['external-note'],
      iocAnalysis: { extractedAt: 1, iocs: [{ id: 'embedded', type: 'domain', value: 'embedded.test', confidence: 'high', firstSeen: 1, dismissed: false, relationships: [{ targetIOCId: 'ioc', relationshipType: 'related-to' }] }] } },
  ]);
  await db.table('tasks').add({ ...base, id: 'task', title: 'Review', folderId: 'f', status: 'todo', completed: false, priority: 'none', order: 0, linkedNoteIds: ['child'] });
  await db.table('timelines').add({ id: 'tl', name: 'Timeline', order: 0, createdAt: 1, updatedAt: 1 });
  await db.table('timelineEvents').add({ ...base, id: 'event', title: 'Observation', folderId: 'f', timelineId: 'tl', timestamp: 1, eventType: 'other', source: '', confidence: 'high', linkedNoteIds: ['child'], linkedTaskIds: ['task'], linkedIOCIds: ['ioc', 'embedded'] });
  await db.table('standaloneIOCs').add({ ...base, id: 'ioc', type: 'domain', value: 'example.test', confidence: 'high', folderId: 'f', linkedNoteIds: ['child'], linkedEvidenceIds: ['evidence'], relationships: [{ targetIOCId: 'embedded', relationshipType: 'related-to' }] });
  await db.table('evidenceItems').add({ ...base, id: 'evidence', title: 'Source', fileName: 'source.txt', fileType: 'text', content: 'Source text', size: 11, importedAt: 1, chunkIndex: 1, chunkCount: 1, extractionStatus: 'extracted', folderId: 'f', linkedIOCIds: ['ioc'] });
  await db.table('whiteboards').add({ ...base, id: 'board', name: 'Board', elements: '[]', files: '{"file":{"dataURL":"data:image/png;base64,aA=="}}', folderId: 'f', order: 0 });
  await db.table('chatThreads').bulkAdd([
    { ...base, id: 'chat', title: 'Chat folder', isFolder: true, messages: [], provider: 'anthropic', model: 'model', folderId: 'f' },
    { ...base, id: 'child-chat', title: 'Agent thread', parentThreadId: 'chat', messages: [], provider: 'anthropic', model: 'model', folderId: 'f' },
  ]);
  await db.table('agentProfiles').add({ id: 'profile', name: 'Analyst profile', role: 'specialist', systemPrompt: 'Review evidence', policy: { autoApproveCreate: false }, source: 'user', createdAt: 1, updatedAt: 1 });
  await db.table('agentDeployments').bulkAdd([
    { id: 'deployment', investigationId: 'f', profileId: 'profile', threadId: 'child-chat', status: 'running', shift: 'active', order: 0, createdAt: 1, updatedAt: 1 },
    { id: 'subordinate', investigationId: 'f', profileId: 'profile', supervisorDeploymentId: 'deployment', threadId: 'child-chat', status: 'running', shift: 'active', order: 1, createdAt: 1, updatedAt: 1 },
  ]);
  await db.table('agentActions').add({ id: 'action', investigationId: 'f', threadId: 'child-chat', toolName: 'create_note', toolInput: { title: 'Original proposed input' }, toolBinding: 'historical-fingerprint', rationale: 'Preserved history', status: 'approved', createdAt: 1 });
  await db.table('agentMeetings').add({ id: 'meeting', investigationId: 'f', participantDeploymentIds: ['deployment', 'subordinate'], threadId: 'child-chat', minutesNoteId: 'child', agenda: 'Review', status: 'completed', roundsCompleted: 1, maxRounds: 1, participantConfidence: { deployment: 4 }, createdAt: 1 });
}

describe('portable investigation graph', () => {
  it('preallocates only present IDs, preserves graph and privacy, and imports inert agent history', async () => {
    await graph();
    const original = await exportInvestigationJSON('f');
    const imported = await importInvestigationJSON(original);
    const folder = await db.folders.get(imported.folderId);
    expect(folder).toMatchObject({ localOnly: true, agentEnabled: false, createdBy: 'Original analyst', updatedBy: 'Reviewer' });
    const notes = await db.notes.where('folderId').equals(imported.folderId).toArray();
    const parent = notes.find(note => note.title === 'Parent');
    const child = notes.find(note => note.title === 'Child');
    if (!child || !parent) throw new Error('Missing notes');
    expect(child.parentNoteId).toBe(parent.id);
    expect(child.linkedNoteIds).toEqual(['external-note']);
    expect(imported.warnings).toEqual([expect.stringContaining('external-note')]);
    const ioc = await db.standaloneIOCs.where('folderId').equals(imported.folderId).first();
    const evidence = await db.evidenceItems.where('folderId').equals(imported.folderId).first();
    const event = await db.timelineEvents.where('folderId').equals(imported.folderId).first();
    expect(ioc?.linkedEvidenceIds).toEqual([evidence?.id]);
    expect(evidence?.linkedIOCIds).toEqual([ioc?.id]);
    expect(child.iocAnalysis?.iocs[0].relationships?.[0].targetIOCId).toBe(ioc?.id);
    expect(ioc?.relationships?.[0].targetIOCId).toBe(child.iocAnalysis?.iocs[0].id);
    expect(event?.linkedIOCIds).toEqual([ioc?.id, child.iocAnalysis?.iocs[0].id]);
    expect(event?.timelineId).toBe(folder?.timelineId);
    const deployments = await db.agentDeployments.where('investigationId').equals(imported.folderId).toArray();
    expect(deployments).toHaveLength(2);
    expect(deployments.every(row => row.status === 'idle' && row.shift === 'resting' && !row.serverSideEnabled)).toBe(true);
    const profile = await db.agentProfiles.get(deployments[0].profileId);
    expect(profile?.name).toBe('Analyst profile');
    const meeting = await db.agentMeetings.where('investigationId').equals(imported.folderId).first();
    expect(meeting?.minutesNoteId).toBe(child.id);
    expect(new Set(meeting?.participantDeploymentIds)).toEqual(new Set(deployments.map(row => row.id)));
    expect(Object.keys(meeting?.participantConfidence ?? {})).toEqual([deployments.find(row => row.order === 0)?.id]);
    const action = await db.agentActions.where('investigationId').equals(imported.folderId).first();
    expect(action?.status).toBe('rejected');
    expect(action?.resultSummary).toContain('original status approved');
    const chat = await db.chatThreads.get(action?.threadId ?? '');
    expect(chat?.parentThreadId).toBe(folder?.agentThreadId);
    expect((await db.whiteboards.where('folderId').equals(imported.folderId).first())?.files).toContain('data:image/png');
    expect(await db.notes.get('child')).toBeDefined();
  });
  it('rolls back the entire graph if any imported collection fails', async () => {
    await graph();
    const json = await exportInvestigationJSON('f');
    const fail = () => { throw new Error('quota'); };
    db.agentMeetings.hook('creating', fail);
    try { await expect(importInvestigationJSON(json)).rejects.toThrow('quota'); }
    finally { db.agentMeetings.hook('creating').unsubscribe(fail); }
    expect(await db.folders.count()).toBe(1);
    expect(await db.notes.count()).toBe(2);
  });
});

describe('shared lifecycle', () => {
  it('rejects blank and duplicate tag renames without changing linked records', async () => {
    await graph();
    await db.tags.bulkAdd([{ id: 'tag', name: 'shared', color: 'red' }, { id: 'other', name: 'Existing', color: 'blue' }]);
    await expect(changeTagEverywhere('tag', { name: '   ' })).rejects.toThrow('empty');
    await expect(changeTagEverywhere('tag', { name: ' existing ' })).rejects.toThrow('already exists');
    expect((await db.tags.get('tag'))?.name).toBe('shared');
    for (const name of TAGGED_TABLES) expect((await db.table(name).toArray()).every(row => row.tags.includes('shared') && row.updatedAt === 1)).toBe(true);
  });

  it('normalizes a renamed tag consistently in its definition and every linked record', async () => {
    await graph();
    await db.tags.add({ id: 'tag', name: 'shared', color: 'red' });
    await changeTagEverywhere('tag', { name: '  normalized  ' });
    expect((await db.tags.get('tag'))?.name).toBe('normalized');
    for (const name of TAGGED_TABLES) expect((await db.table(name).toArray()).every(row => row.tags.includes('normalized'))).toBe(true);
  });

  it('renames/deletes tags in every family with modification metadata', async () => {
    await graph();
    await db.tags.add({ id: 'tag', name: 'shared', color: 'red' });
    await changeTagEverywhere('tag', { name: 'renamed' });
    for (const name of TAGGED_TABLES) {
      const rows = await db.table(name).toArray();
      expect(rows.every(row => row.tags.includes('renamed') && !row.tags.includes('shared') && row.updatedAt > 1)).toBe(true);
    }
    await changeTagEverywhere('tag');
    for (const name of TAGGED_TABLES) expect((await db.table(name).toArray()).every(row => !row.tags.includes('renamed'))).toBe(true);
  });
  it('unarchives evidence while retaining independently archived rows', async () => {
    await graph();
    await db.notes.update('parent', { archived: true });
    await setInvestigationArchived('f', true);
    expect((await db.evidenceItems.get('evidence'))?.archived).toBe(true);
    await setInvestigationArchived('f', false);
    expect((await db.evidenceItems.get('evidence'))?.archived).toBe(false);
    expect((await db.notes.get('child'))?.archived).toBe(false);
    expect((await db.notes.get('parent'))?.archived).toBe(true);
  });
  it('cleans IOC/evidence/note reverse edges including nested IOC relationships and parent notes', async () => {
    await graph();
    await deleteEntitiesWithReferences({ standaloneIOCs: ['ioc'] });
    expect((await db.evidenceItems.get('evidence'))?.linkedIOCIds).toEqual([]);
    expect((await db.notes.get('child'))?.iocAnalysis?.iocs[0].relationships).toEqual([]);
    expect((await db.timelineEvents.get('event'))?.linkedIOCIds).toEqual(['embedded']);
    await deleteEntitiesWithReferences({ notes: ['parent', 'child'] });
    expect((await db.tasks.get('task'))?.linkedNoteIds).toEqual([]);
    expect((await db.timelineEvents.get('event'))?.linkedIOCIds).toEqual([]);
    expect((await db.agentMeetings.get('meeting'))?.minutesNoteId).toBeUndefined();
    expect((await db.tasks.get('task'))?.updatedAt).toBeGreaterThan(1);
  });
  it('rolls deletion back when reverse-edge persistence fails', async () => {
    await graph();
    const fail = () => { throw new Error('quota'); };
    db.notes.hook('updating', fail);
    try { await expect(deleteEntitiesWithReferences({ standaloneIOCs: ['ioc'] })).rejects.toThrow('quota'); }
    finally { db.notes.hook('updating').unsubscribe(fail); }
    expect(await db.standaloneIOCs.get('ioc')).toBeDefined();
    expect((await db.evidenceItems.get('evidence'))?.linkedIOCIds).toEqual(['ioc']);
  });
  it('keeps unrelated investigations intact while removing all linked scoped artifacts', async () => {
    await graph();
    await db.table('notes').add({ ...base, id: 'outside', folderId: 'other', title: 'Outside', content: '', linkedNoteIds: ['child'], pinned: false });
    await deleteEntitiesWithReferences({ folders: ['f'] }, 'f');
    expect(await db.folders.get('f')).toBeUndefined();
    expect(await db.agentMeetings.count()).toBe(0);
    expect(await db.evidenceItems.count()).toBe(0);
    expect((await db.notes.get('outside'))?.linkedNoteIds).toEqual([]);
  });
});
