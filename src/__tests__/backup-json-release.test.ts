import Dexie from 'dexie';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { db } from '../db';
import { exportJSON, importJSON, mergeImportJSON, sanitizeChatThread } from '../lib/export';
import type { ChatThread, NoteTemplate } from '../types';
import { getEntityDraft, type EntityDraft } from '../lib/entity-drafts';

const thread: ChatThread = {
  id: 'backup-chat', title: 'Fictional classified discussion', folderId: 'backup-case',
  messages: [{ id: 'backup-message', role: 'user', content: 'Synthetic analyst observation. 中文', createdAt: 10 }],
  provider: 'local', model: 'fictional-offline-model', tags: ['fictional'], clsLevel: 'TLP:RED',
  mode: 'plan', source: 'user', contextSummary: 'Fictional context retained for review.',
  archived: false, trashed: false, createdAt: 10, updatedAt: 20,
};
const baseline: NoteTemplate = {
  id: 'backup-baseline', name: 'Fictional report baseline', content: '# Report\n\n## Findings',
  category: 'Product Baseline', source: 'user', tags: ['product-baseline'], clsLevel: 'TLP:AMBER',
  productBaseline: { schemaVersion: 1, kind: 'markdown', productType: 'custom', renderer: 'markdown', visualFidelity: 'structural', importedAt: 10 },
  createdAt: 10, updatedAt: 20,
};
const registeredDrafts: Array<{ draft: EntityDraft; detach: () => void }> = [];

beforeEach(async () => {
  await Promise.all([db.chatThreads.clear(), db.noteTemplates.clear(), db.notes.clear(), db.tasks.clear(), db.folders.clear(), db.tags.clear()]);
});

afterEach(() => {
  vi.restoreAllMocks();
  for (const { draft, detach } of registeredDrafts.splice(0)) {
    draft.discard(true);
    detach();
  }
});

describe('JSON backup release regressions', () => {
  for (const [name, restore] of [['replace', importJSON], ['merge', mergeImportJSON]] as const) {
    it(`preserves classified chat identity, transcript and supported metadata through export/${name}`, async () => {
      await db.chatThreads.add(thread);
      const backup = await exportJSON();
      expect(JSON.parse(backup).chatThreads).toEqual([thread]);
      await db.chatThreads.clear();
      await restore(backup);
      expect(await db.chatThreads.get(thread.id)).toMatchObject(thread);
    });
  }

  it('keeps explicit chat fields allowlisted when restoring untrusted JSON', () => {
    const restored = sanitizeChatThread({ ...thread, mode: 'execute-anything', source: 'unknown', contextSummary: {}, arbitraryField: 'not part of a thread', apiKey: 'fictional-secret', accessToken: 'fictional-access-token', toolCalls: [{ action: 'unrecognized' }] });
    expect(restored?.clsLevel).toBe('TLP:RED');
    expect(restored?.mode).toBeUndefined();
    expect(restored?.source).toBeUndefined();
    expect(restored?.contextSummary).toBeUndefined();
    expect(restored).not.toHaveProperty('arbitraryField');
    expect(restored).not.toHaveProperty('apiKey');
    expect(restored).not.toHaveProperty('accessToken');
    expect(restored).not.toHaveProperty('toolCalls');
  });

  it('flushes a registered unsaved edit before taking the JSON backup snapshot', async () => {
    await db.notes.add({ id: 'draft-note', title: 'Fictional note', content: 'Before edit', tags: [], pinned: false, archived: false, trashed: false, createdAt: 10, updatedAt: 20 });
    const draft = getEntityDraft('notes:draft-note');
    const detach = draft.attach(async patch => { await db.notes.update('draft-note', { content: String(patch.content) }); });
    registeredDrafts.push({ draft, detach });
    draft.queue({ content: 'Just-edited content that has not reached the autosave timer.' }, 60_000);
    expect((await db.notes.get('draft-note'))?.content).toBe('Before edit');
    const backup = JSON.parse(await exportJSON());
    expect(backup.notes[0].content).toBe('Just-edited content that has not reached the autosave timer.');
    expect(draft.hasPendingWork()).toBe(false);
  });

  it('refuses a backup when a registered draft cannot be persisted and retains the failed edit', async () => {
    const draft = getEntityDraft('notes:failed-backup-note');
    registeredDrafts.push({ draft, detach: draft.attach(async () => { throw new Error('Fictional write failure'); }) });
    draft.queue({ content: 'Unsaved synthetic content' }, 60_000);
    await expect(exportJSON()).rejects.toThrow('Save or recover pending drafts');
    expect(draft.getSnapshot()).toMatchObject({ status: 'error', patch: { content: 'Unsaved synthetic content' } });
  });

  it('reads a consistent multi-table snapshot while another connection updates related records', async () => {
    await db.notes.add({ id: 'snapshot-note', title: 'Fictional note', content: 'Before change', tags: [], pinned: false, archived: false, trashed: false, createdAt: 10, updatedAt: 20 });
    await db.tasks.add({ id: 'snapshot-task', title: 'Before change', completed: false, priority: 'none', status: 'todo', order: 0, tags: [], archived: false, trashed: false, createdAt: 10, updatedAt: 20 });
    const peer = new Dexie(db.name);
    await peer.open();
    let concurrentWrite: Promise<unknown> | undefined;
    const startConcurrentWrite = (row: unknown) => {
      if (!concurrentWrite) concurrentWrite = peer.transaction('rw', [peer.table('notes'), peer.table('tasks')], async () => {
        await peer.table('notes').update('snapshot-note', { content: 'After change' });
        await peer.table('tasks').update('snapshot-task', { title: 'After change' });
      });
      return row;
    };
    db.notes.hook('reading', startConcurrentWrite);
    try {
      const backup = JSON.parse(await exportJSON());
      expect(concurrentWrite).toBeDefined();
      await concurrentWrite;
      expect(backup.notes[0].content).toBe('Before change');
      expect(backup.tasks[0].title).toBe('Before change');
      expect((await db.notes.get('snapshot-note'))?.content).toBe('After change');
      expect((await db.tasks.get('snapshot-task'))?.title).toBe('After change');
    } finally {
      db.notes.hook('reading').unsubscribe(startConcurrentWrite);
      await concurrentWrite;
      peer.close();
    }
  });

  it('merges backed-up baselines without losing metadata or duplicating identities', async () => {
    await db.noteTemplates.add(baseline);
    const backup = await exportJSON();
    await db.noteTemplates.clear();
    const first = await mergeImportJSON(backup);
    expect(await db.noteTemplates.get(baseline.id)).toMatchObject(baseline);
    expect(first.tables.noteTemplates).toMatchObject({ incoming: 1, added: 1, updated: 0, skipped: 0 });
    const second = await mergeImportJSON(backup);
    expect(await db.noteTemplates.count()).toBe(1);
    expect(second.tables.noteTemplates).toMatchObject({ incoming: 1, added: 0, updated: 0, skipped: 1 });
  });

  it('retains newer local baselines and only updates older versions during merge', async () => {
    const older = { ...baseline, id: 'older-baseline' };
    await db.noteTemplates.bulkAdd([baseline, older]);
    const backup = await exportJSON();
    await db.noteTemplates.update(baseline.id, { content: 'Newer local reviewed baseline', updatedAt: 30 });
    await db.noteTemplates.update(older.id, { content: 'Older local baseline', updatedAt: 15 });
    const result = await mergeImportJSON(backup);
    expect(await db.noteTemplates.get(baseline.id)).toMatchObject({ content: 'Newer local reviewed baseline', updatedAt: 30 });
    expect(await db.noteTemplates.get(older.id)).toMatchObject(older);
    expect(result.tables.noteTemplates).toMatchObject({ incoming: 2, added: 0, updated: 1, skipped: 1 });
  });
});
