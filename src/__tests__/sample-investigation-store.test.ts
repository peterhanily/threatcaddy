import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { db } from '../db';
import type { Note, TimelineEvent } from '../types';
import { deleteSampleInvestigation, getSampleFolderId, getSampleRemovalSummary, loadSampleInvestigation } from '../lib/sample-investigation-store';
import { hasPendingChanges } from '../lib/pending-changes';
import { setSessionKey } from '../lib/encryptionMiddleware';
import { clearEncryptionMeta, setEncryptionMeta } from '../lib/encryptionStore';
import { getEntityDraft } from '../lib/entity-drafts';
import { useTimelines } from '../hooks/useTimelines';

const REALISTIC = getSampleFolderId('realistic');
const userNote = (id: string, folderId: string | null = REALISTIC, extra: Partial<Note> = {}): Note => ({ id, title: 'My exercise work',
  content: '', tags: [], pinned: false, archived: false, trashed: false, createdAt: 1, updatedAt: 1, folderId: folderId ?? undefined, ...extra });
const userEvent = (id: string, folderId: string, timelineId: string): TimelineEvent => ({ id, timestamp: 1, title: 'My event',
  eventType: 'evidence', source: 'Analyst', confidence: 'medium', linkedIOCIds: [], linkedNoteIds: [], linkedTaskIds: [],
  mitreAttackIds: [], assets: [], tags: [], starred: false, timelineId, folderId, trashed: false, archived: false, createdAt: 1, updatedAt: 1 });
const bindToTeamServer = () => db.table('_syncMeta').put({ key: 'syncWorkspaceIdentityV1',
  value: { version: 1, serverUrl: 'https://test.invalid', userId: 'alice' } });

beforeEach(async () => { await Promise.all(db.tables.map(table => table.clear())); });
afterEach(() => { expect(hasPendingChanges()).toBe(false); });

describe('removing a sample never loses work silently', () => {
  it('counts the items a user added to a sample case, including another demo record moved into it', async () => {
    await loadSampleInvestigation('realistic');
    await loadSampleInvestigation('parody');
    expect(await getSampleRemovalSummary('realistic')).toEqual({ name: 'Mailbox Compromise — Synthetic Exercise', userItems: 0 });
    await db.notes.update('sample-realistic-note-6', { content: 'My reviewed assessment' });
    await db.notes.add(userNote('u-note'));
    await db.notes.update('sample-note-1', { folderId: REALISTIC });
    await db.timelineEvents.add(userEvent('u-event', REALISTIC, 'sample-realistic-timeline-1'));
    expect((await getSampleRemovalSummary('realistic'))?.userItems).toBe(3);
    expect((await getSampleRemovalSummary('parody'))?.userItems).toBe(0);
    await deleteSampleInvestigation('realistic');
    expect(await getSampleRemovalSummary('realistic')).toBeUndefined();
  });

  it('moves added items to a new local-only investigation when asked, then removes the seeded case', async () => {
    await loadSampleInvestigation('realistic');
    await db.notes.add(userNote('u-note', REALISTIC, { linkedNoteIds: ['sample-realistic-note-1'] }));
    await db.timelineEvents.add(userEvent('u-event', REALISTIC, 'sample-realistic-timeline-1'));
    await db.chatThreads.add({ id: 'u-chat', title: 'My questions', messages: [], model: 'm', provider: 'anthropic',
      folderId: REALISTIC, tags: [], trashed: false, archived: false, createdAt: 1, updatedAt: 1 });
    await db.agentDeployments.add({ id: 'u-agent', investigationId: REALISTIC, profileId: 'ap-lead-analyst', status: 'idle', order: 0, createdAt: 1, updatedAt: 1 });
    const { keptFolder } = await deleteSampleInvestigation('realistic', undefined, { keepUserItemsIn: 'My work from the demo' });
    if (!keptFolder) throw new Error('Expected a folder for the kept items');
    expect(keptFolder).toMatchObject({ name: 'My work from the demo', localOnly: true, clsLevel: 'TLP:CLEAR', status: 'active' });
    expect(await db.folders.get(keptFolder.id)).toBeDefined();
    expect(await db.folders.get(REALISTIC)).toBeUndefined();
    expect(await db.notes.get('sample-realistic-note-1')).toBeUndefined();
    expect(await db.notes.get('u-note')).toMatchObject({ folderId: keptFolder.id, linkedNoteIds: [] });
    expect((await db.timelineEvents.get('u-event'))?.folderId).toBe(keptFolder.id);
    expect((await db.chatThreads.get('u-chat'))?.folderId).toBe(keptFolder.id);
    expect((await db.agentDeployments.get('u-agent'))?.investigationId).toBe(keptFolder.id);
    // The kept event still uses the demo timeline, so the timeline is not removed under it.
    expect(await db.timelines.get('sample-realistic-timeline-1')).toBeDefined();
  });

  it('creates no investigation when keeping is requested but nothing was added', async () => {
    await loadSampleInvestigation('realistic');
    const { keptFolder } = await deleteSampleInvestigation('realistic', undefined, { keepUserItemsIn: 'My work from the demo' });
    expect(keptFolder).toBeUndefined();
    expect(await db.folders.count()).toBe(0);
  });
});

describe('sample tags and timelines stay local and never take over user defaults', () => {
  it('queues no team-wide tag or timeline when a demo is loaded or removed in a team-bound workspace', async () => {
    await bindToTeamServer();
    await loadSampleInvestigation('realistic');
    await loadSampleInvestigation('parody');
    expect(await db.table('_syncQueue').count()).toBe(0);
    await deleteSampleInvestigation('realistic');
    await deleteSampleInvestigation('parody');
    expect(await db.tags.count()).toBe(0);
    expect(await db.timelines.count()).toBe(0);
    const queue: Array<{ table: string }> = await db.table('_syncQueue').toArray();
    expect(queue.filter(entry => entry.table === 'tags' || entry.table === 'timelines')).toEqual([]);
  });

  it('keeps a demo tag or timeline that a record outside the demo still uses', async () => {
    await db.folders.add({ id: 'real', name: 'Real case', order: 0, createdAt: 1 });
    await loadSampleInvestigation('realistic');
    await db.timelineEvents.add(userEvent('real-event', 'real', 'sample-realistic-timeline-1'));
    await db.notes.add(userNote('real-note', 'real', { tags: ['synthetic-training'] }));
    await deleteSampleInvestigation('realistic');
    expect(await db.timelines.get('sample-realistic-timeline-1')).toBeDefined();
    expect(await db.tags.get('sample-realistic-tag-1')).toBeDefined();
    expect((await db.timelineEvents.get('real-event'))?.timelineId).toBe('sample-realistic-timeline-1');
  });

  it('reuses an existing tag of the same name instead of adding a duplicate demo tag', async () => {
    await db.tags.add({ id: 'u-tag', name: 'Remediation', color: '#000000' });
    await db.notes.add(userNote('real-note', null, { tags: ['Remediation'] }));
    await loadSampleInvestigation('parody');
    expect((await db.tags.toArray()).filter(tag => tag.name.toLowerCase() === 'remediation').map(tag => tag.id)).toEqual(['u-tag']);
    await deleteSampleInvestigation('parody');
    expect(await db.tags.toArray()).toEqual([{ id: 'u-tag', name: 'Remediation', color: '#000000' }]);
    expect((await db.notes.get('real-note'))?.tags).toEqual(['Remediation']);
  });

  it('keeps a timeline created after a demo ahead of the demo timeline', async () => {
    await loadSampleInvestigation('realistic');
    await loadSampleInvestigation('parody');
    const { result } = renderHook(() => useTimelines());
    await act(async () => {});
    await act(async () => { await result.current.createTimeline('My case'); });
    expect(result.current.timelines.map(timeline => timeline.name)[0]).toBe('My case');
  });

  it('places demo timelines after a timeline that already existed', async () => {
    await db.timelines.add({ id: 'z-default', name: 'Default', order: 0, createdAt: 1, updatedAt: 1 });
    await db.timelines.add({ id: 'z-clips', name: 'Clips', order: 1, createdAt: 1, updatedAt: 1 });
    await loadSampleInvestigation('realistic');
    await loadSampleInvestigation('parody');
    const timelines = (await db.timelines.toArray()).sort((a, b) => a.order - b.order);
    expect(timelines.map(timeline => timeline.id)).toEqual(['z-default', 'z-clips', 'sample-realistic-timeline-1', 'sample-timeline-1']);
  });

  it('keeps a demo timeline that a remaining investigation still uses', async () => {
    await loadSampleInvestigation('realistic');
    await db.folders.add({ id: 'real', name: 'Real case', order: 0, createdAt: 1, timelineId: 'sample-realistic-timeline-1' });
    await deleteSampleInvestigation('realistic');
    expect(await db.timelines.get('sample-realistic-timeline-1')).toBeDefined();
  });
});

describe('sample persistence', () => {
  it('serializes concurrent loads without duplicate rows and preserves edits on subsequent loads', async () => {
    const results = await Promise.all([loadSampleInvestigation('realistic'), loadSampleInvestigation('realistic')]);
    expect(results.filter(result => result.created)).toHaveLength(1);
    expect(await db.folders.count()).toBe(1);
    expect(await db.notes.count()).toBe(6);
    const firstNoteId = results[0].firstNoteId;
    if (!firstNoteId) throw new Error('Missing first note');
    await db.notes.update(firstNoteId, { title: 'Analyst-edited introduction' });
    await db.folders.update(getSampleFolderId('realistic'), { name: 'Analyst-edited case' });
    const reopened = await loadSampleInvestigation('realistic');
    expect(reopened.created).toBe(false);
    expect(reopened.folder.name).toBe('Analyst-edited case');
    expect(reopened.folder.localOnly).toBe(true);
    expect((await db.notes.get(firstNoteId))?.title).toBe('Analyst-edited introduction');
  });

  it('rolls back all collections when a late write fails', async () => {
    const fail = () => { throw new Error('Simulated disk failure'); };
    db.whiteboards.hook('creating', fail);
    try { await expect(loadSampleInvestigation('realistic')).rejects.toThrow('Simulated disk failure'); }
    finally { db.whiteboards.hook('creating').unsubscribe(fail); }
    for (const table of [db.folders, db.notes, db.tasks, db.timelineEvents, db.evidenceItems, db.standaloneIOCs, db.tags, db.timelines]) {
      expect(await table.count()).toBe(0);
    }
  });

  it('refuses with a translatable reason while the workspace is locked', async () => {
    setEncryptionMeta({ version: 1, salt: 's', wrappedKey: 'w', recoverySalt: 'r', recoveryWrappedKey: 'k', enabledAt: 1 });
    try {
      await expect(loadSampleInvestigation('realistic')).rejects.toMatchObject({ code: 'locked' });
      await expect(getSampleRemovalSummary('realistic')).rejects.toMatchObject({ code: 'locked' });
    } finally { clearEncryptionMeta(); }
    expect(await db.folders.count()).toBe(0);
  });

  it.each(['workspace-will-switch', 'workspace-will-lock'])('cancels a deferred generator before writes on %s', async event => {
    const work = loadSampleInvestigation('realistic');
    window.dispatchEvent(new Event(event));
    await expect(work).rejects.toThrow();
    expect(await db.folders.count()).toBe(0);
    expect(await db.notes.count()).toBe(0);
  });

  it('aborts the entire active create transaction on explicit cancellation', async () => {
    const controller = new AbortController();
    const abort = () => { controller.abort(); };
    db.whiteboards.hook('creating', abort);
    try { await expect(loadSampleInvestigation('realistic', controller.signal)).rejects.toThrow(); }
    finally { db.whiteboards.hook('creating').unsubscribe(abort); }
    expect(await db.folders.count()).toBe(0);
    expect(await db.notes.count()).toBe(0);
    expect(await db.evidenceItems.count()).toBe(0);
  });

  it('deletes only the selected case, cleans reverse edges, and preserves moved notes and reusable global records', async () => {
    await loadSampleInvestigation('realistic');
    const parody = await loadSampleInvestigation('parody');
    await db.notes.update('sample-realistic-note-6', { folderId: parody.folder.id });
    await db.notes.update('sample-note-1', { linkedNoteIds: ['sample-realistic-note-1', 'sample-realistic-note-6'] });
    await db.notes.add({ id: 'user-added', title: 'My exercise work', content: '', tags: [], pinned: false,
      archived: false, trashed: false, createdAt: 1, updatedAt: 1, folderId: getSampleFolderId('realistic') });
    await deleteSampleInvestigation('realistic');
    expect(await db.folders.get(getSampleFolderId('realistic'))).toBeUndefined();
    expect(await db.notes.get('user-added')).toBeUndefined();
    expect(await db.notes.get('sample-realistic-note-1')).toBeUndefined();
    expect((await db.notes.get('sample-realistic-note-6'))?.folderId).toBe(parody.folder.id);
    expect((await db.notes.get('sample-note-1'))?.linkedNoteIds).toEqual(['sample-realistic-note-6']);
    expect(await db.folders.get(parody.folder.id)).toBeDefined();
    // The moved note still uses the demo tag, so its row stays; nothing uses the demo timeline now.
    expect(await db.tags.get('sample-realistic-tag-1')).toBeDefined();
    expect(await db.timelines.get('sample-realistic-timeline-1')).toBeUndefined();
    expect(await db.noteTemplates.count()).toBeGreaterThan(0);
    // Reloading never overwrites the moved note; the rest of the demo is recreated around it.
    const reloaded = await loadSampleInvestigation('realistic');
    expect(reloaded.created).toBe(true);
    expect((await db.notes.get('sample-realistic-note-6'))?.folderId).toBe(parody.folder.id);
    expect(await db.notes.where('folderId').equals(getSampleFolderId('realistic')).count()).toBe(5);
    expect(reloaded.firstNoteId).toBe('sample-realistic-note-1');
  });

  it('opens the first note that is still in a recreated case when the seeded first note was moved', async () => {
    const parody = await loadSampleInvestigation('parody');
    await loadSampleInvestigation('realistic');
    await db.notes.update('sample-realistic-note-1', { folderId: parody.folder.id });
    await deleteSampleInvestigation('realistic');
    const reloaded = await loadSampleInvestigation('realistic');
    expect(reloaded.firstNoteId).toBe('sample-realistic-note-2');
  });

  it('can recreate a removed case without overwriting retained global metadata', async () => {
    await loadSampleInvestigation('realistic');
    await db.tags.update('sample-realistic-tag-1', { color: '#ff0000' });
    await db.notes.add(userNote('elsewhere', null, { tags: ['synthetic-training'] }));
    await deleteSampleInvestigation('realistic');
    await loadSampleInvestigation('realistic');
    expect(await db.notes.count()).toBe(7);
    expect((await db.tags.get('sample-realistic-tag-1'))?.color).toBe('#ff0000');
  });

  it('rolls back deletion and reference cleanup if the workspace locks during the cascade', async () => {
    await loadSampleInvestigation('realistic');
    await loadSampleInvestigation('parody');
    await db.notes.update('sample-note-1', { linkedNoteIds: ['sample-realistic-note-1'] });
    const abort = () => { window.dispatchEvent(new Event('workspace-will-lock')); };
    db.notes.hook('deleting', abort);
    try { await expect(deleteSampleInvestigation('realistic')).rejects.toThrow(); }
    finally { db.notes.hook('deleting').unsubscribe(abort); }
    expect(await db.folders.count()).toBe(2);
    expect(await db.notes.get('sample-realistic-note-1')).toBeDefined();
    expect((await db.notes.get('sample-note-1'))?.linkedNoteIds).toEqual(['sample-realistic-note-1']);
  });

  it('fences deletion when the session changes without a lifecycle event during its transaction', async () => {
    await loadSampleInvestigation('realistic');
    const changeSession = () => { setSessionKey(null); };
    db.notes.hook('deleting', changeSession);
    try { await expect(deleteSampleInvestigation('realistic')).rejects.toMatchObject({ code: 'sessionChanged', message: expect.stringContaining('workspace session changed') }); }
    finally { db.notes.hook('deleting').unsubscribe(changeSession); }
    expect(await db.folders.get(getSampleFolderId('realistic'))).toBeDefined();
    expect(await db.notes.count()).toBe(6);
  });

  it('rechecks the captured session after waiting for an editor draft to flush', async () => {
    await loadSampleInvestigation('realistic');
    let finish: () => void = () => {};
    let started: () => void = () => {};
    const flushing = new Promise<void>(resolve => { started = resolve; });
    const draft = getEntityDraft('sample-test:barrier');
    const release = draft.attach(() => new Promise<void>(resolve => { finish = resolve; started(); }));
    draft.queue({ title: 'Pending editor change' }, 60_000);
    const deleting = deleteSampleInvestigation('realistic');
    const rejected = expect(deleting).rejects.toThrow('workspace session changed');
    await flushing;
    setSessionKey(null);
    finish();
    try { await rejected; }
    finally { release(); }
    expect(await db.folders.get(getSampleFolderId('realistic'))).toBeDefined();
    expect(await db.notes.count()).toBe(6);
  });
});
