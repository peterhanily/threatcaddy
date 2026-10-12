import Dexie from 'dexie';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { db } from '../db';
import { importJSON, mergeImportJSON } from '../lib/export';
import { BACKUP_TABLES } from '../lib/backup-tables';
import { getEntityDraft, type EntityDraft } from '../lib/entity-drafts';

const note = { id: 'safe-note', title: 'Synthetic note', content: 'Before restore', tags: [],
  pinned: false, archived: false, trashed: false, createdAt: 1, updatedAt: 2 };
const task = { id: 'safe-task', title: 'Synthetic task', tags: [], completed: false, priority: 'none' as const,
  status: 'todo' as const, order: 0, archived: false, trashed: false, createdAt: 1, updatedAt: 2 };
const backup = JSON.stringify({ version: 1, exportedAt: 20, notes: [{ ...note, content: 'Restored', updatedAt: 20 }],
  tasks: [{ ...task, title: 'Restored task', updatedAt: 20 }], folders: [], tags: [] });
const registrations: { draft: EntityDraft; detach: () => void }[] = [];

async function snapshot() {
  return Object.fromEntries(await Promise.all(BACKUP_TABLES.map(async name => [name, await db.table(name).toArray()])));
}

beforeEach(async () => {
  await db.transaction('rw', BACKUP_TABLES.map(name => db.table(name)), async () => {
    for (const name of BACKUP_TABLES) await db.table(name).clear();
  });
  await db.notes.add(note);
  await db.tasks.add(task);
});
afterEach(() => {
  vi.restoreAllMocks();
  for (const { draft, detach } of registrations.splice(0)) { draft.discard(true); detach(); }
});

function register(persist: (patch: Record<string, unknown>) => Promise<void>) {
  const draft = getEntityDraft('notes:safe-note');
  registrations.push({ draft, detach: draft.attach(persist) });
  return draft;
}

for (const [mode, restore] of [['replace', importJSON], ['merge', mergeImportJSON]] as const) {
  describe(`portable ${mode} operation safety`, () => {
    it('drains pending editor writes before restoring and leaves no timer able to overwrite the result', async () => {
      const persisted: string[] = [];
      const draft = register(async patch => {
        persisted.push(String(patch.content));
        await db.notes.update(note.id, { content: String(patch.content), updatedAt: 5 });
      });
      draft.queue({ content: 'Pending edit' }, 60_000);
      await restore(backup);
      expect(persisted).toEqual(['Pending edit']);
      expect((await db.notes.get(note.id))?.content).toBe('Restored');
      expect(draft.hasPendingWork()).toBe(false);
      await draft.flush();
      expect((await db.notes.get(note.id))?.content).toBe('Restored');
    });

    it('retains a failed draft and refuses database changes until it is recovered', async () => {
      const draft = register(async () => { throw new Error('Synthetic persistence failure'); });
      draft.queue({ content: 'Uncommitted investigation text' }, 60_000);
      const before = await snapshot();
      await expect(restore(backup)).rejects.toThrow(/draft/i);
      expect(await snapshot()).toEqual(before);
      expect(draft.getSnapshot()).toMatchObject({ status: 'error', patch: { content: 'Uncommitted investigation text' } });
    });

    it('rolls back every entity write if a later table fails, rather than counting a failure as skipped', async () => {
      const before = await snapshot();
      // Restore uses transaction-bound table instances, not the db.tasks property.
      const prototype = Object.getPrototypeOf(db.notes) as typeof db.notes;
      const put = prototype.bulkPut;
      vi.spyOn(prototype, 'bulkPut').mockImplementation(function (this: typeof db.notes, ...args) {
        if (this.name === 'tasks') return Dexie.Promise.reject(new DOMException('Synthetic storage quota failure', 'QuotaExceededError'));
        return put.apply(this, args);
      });
      await expect(restore(backup)).rejects.toThrow(/quota/i);
      expect(await snapshot()).toEqual(before);
    });

    it('retains an edit made during the restore for review without saving it over replacement data', async () => {
      const persist = vi.fn(async patch => { await db.notes.update(note.id, { content: String(patch.content) }); });
      const draft = register(persist);
      const prototype = Object.getPrototypeOf(db.notes) as typeof db.notes;
      const put = prototype.bulkPut;
      vi.spyOn(prototype, 'bulkPut').mockImplementation(function (this: typeof db.notes, ...args) {
        if (this.name === 'notes') draft.queue({ content: 'Late edit retained for review' }, 60_000);
        return put.apply(this, args);
      });
      await restore(backup);
      expect((await db.notes.get(note.id))?.content).toBe('Restored');
      expect(draft.getSnapshot()).toMatchObject({ status: 'error', patch: { content: 'Late edit retained for review' } });
      expect(await draft.flush()).toBe(false);
      expect(persist).not.toHaveBeenCalled();
    });
  });
}
