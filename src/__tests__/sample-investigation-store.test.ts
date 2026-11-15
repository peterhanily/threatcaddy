import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { db } from '../db';
import { deleteSampleInvestigation, getSampleFolderId, loadSampleInvestigation } from '../lib/sample-investigation-store';
import { hasPendingChanges } from '../lib/pending-changes';
import { setSessionKey } from '../lib/encryptionMiddleware';
import { getEntityDraft } from '../lib/entity-drafts';

beforeEach(async () => { await Promise.all(db.tables.map(table => table.clear())); });
afterEach(() => { expect(hasPendingChanges()).toBe(false); });

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
    expect(await db.tags.get('sample-realistic-tag-1')).toBeDefined();
    expect(await db.timelines.get('sample-realistic-timeline-1')).toBeDefined();
    expect(await db.noteTemplates.count()).toBeGreaterThan(0);
    // A deterministic ID collision must refuse recreation, never overwrite moved work.
    await expect(loadSampleInvestigation('realistic')).rejects.toThrow();
    expect(await db.folders.get(getSampleFolderId('realistic'))).toBeUndefined();
    expect((await db.notes.get('sample-realistic-note-6'))?.folderId).toBe(parody.folder.id);
  });

  it('can recreate a removed case without overwriting retained global metadata', async () => {
    await loadSampleInvestigation('realistic');
    await db.tags.update('sample-realistic-tag-1', { color: '#ff0000' });
    await deleteSampleInvestigation('realistic');
    await loadSampleInvestigation('realistic');
    expect(await db.notes.count()).toBe(6);
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
    try { await expect(deleteSampleInvestigation('realistic')).rejects.toThrow('workspace session changed'); }
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
