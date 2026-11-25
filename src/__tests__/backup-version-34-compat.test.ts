import { beforeEach, describe, expect, it } from 'vitest';
import { db } from '../db';
import type { BackupPayload } from '../lib/backup-crypto';
import { previewRestore, restoreFullReplace, restoreMerge } from '../lib/backup-restore';
import { importJSON } from '../lib/export';
import fixture from './fixtures/version-34-backups.json';

// Backups written by the version 34 build itself, before identities existed.
const old = fixture as unknown as { verno: number; full: BackupPayload; fullInv: BackupPayload; diff: BackupPayload; diffInv: BackupPayload; expectedNotes: unknown[]; portable: string };
const identity = { id: 'kept', folderId: 'case', type: 'person', name: 'Synthetic Person', aliases: [], details: [], connections: [], tags: [],
  trashed: false, archived: false, createdAt: 1, updatedAt: 1 };

beforeEach(async () => {
  await db.transaction('rw', db.tables, async () => { for (const table of db.tables) await table.clear(); });
});

describe('backups written by version 34', () => {
  it('came from version 34 and hold no identities', () => {
    expect(old.verno).toBe(34);
    for (const payload of [old.full, old.fullInv, old.diff, old.diffInv]) expect(payload.data).not.toHaveProperty('identities');
    expect(JSON.parse(old.portable)).not.toHaveProperty('identities');
  });

  it('restores the full server backup and leaves identities alone', async () => {
    await db.identities.add(identity);
    await restoreFullReplace(old.full);
    expect((await db.notes.toArray()).map(note => note.id)).toEqual(['n1']);
    expect(await db.identities.toArray()).toEqual([identity]);
  });

  it('removes the identities of an investigation that Replace removes, and keeps the others', async () => {
    await restoreFullReplace(old.full);
    await db.folders.add({ id: 'newer-case', name: 'Opened after the backup', order: 9, createdAt: 2, updatedAt: 2 } as never);
    await db.identities.bulkAdd([identity, { ...identity, id: 'newer', folderId: 'newer-case', connections: [{ targetId: 'newer-org', label: 'works at' }] },
      { ...identity, id: 'newer-org', folderId: 'newer-case', type: 'organization', name: 'Synthetic Org' }]);
    const preview = await previewRestore(old.full, 'replace');
    expect(preview.changes.find(change => change.table === 'identities')).toEqual({ table: 'identities', added: 0, updated: 0, deleted: 2 });
    await restoreFullReplace(old.full);
    expect(await db.folders.get('newer-case')).toBeUndefined();
    expect(await db.identities.toArray()).toEqual([identity]);
  });

  it('imports the portable file as holding no identities', async () => {
    await db.identities.add(identity);
    await importJSON(old.portable);
    expect((await db.notes.toArray()).map(note => note.id).sort()).toEqual(['n1', 'n2']);
    expect(await db.identities.count()).toBe(0);
  });

  it.each([['workspace', 'full', 'diff'], ['investigation', 'fullInv', 'diffInv']] as const)('applies a %s differential on top of its full parent', async (_scope, full, diff) => {
    await restoreFullReplace(old[full]);
    await db.identities.add(identity);
    const preview = await previewRestore(old[diff], 'merge', old[full]);
    await restoreMerge(old[diff], preview, old[full]);
    expect(await db.notes.toArray()).toEqual(old.expectedNotes);
    expect(await db.identities.toArray()).toEqual([identity]);
  });
});
