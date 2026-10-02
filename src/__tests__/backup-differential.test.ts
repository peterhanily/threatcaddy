import { beforeEach, describe, expect, it } from 'vitest';
import { db } from '../db';
import { BACKUP_TABLES } from '../lib/backup-tables';
import { buildDifferentialPayload, buildFullBackupPayload } from '../lib/backup-data';
import { backupFingerprint, backupStateFingerprint, decryptBackup, encryptBackup, type BackupPayload } from '../lib/backup-crypto';
import { previewRestore, restoreFullReplace, restoreMerge } from '../lib/backup-restore';

const note = (id: string, folderId?: string) => ({ id, folderId, title: id, content: 'Initial content',
  tags: [] as string[], pinned: false, archived: false, trashed: false, createdAt: 100, updatedAt: 100 });
const folder = (id: string) => ({ id, name: id, order: 0, createdAt: 100 });
async function snapshot() { return (await buildFullBackupPayload('all')).data; }

beforeEach(async () => {
  await db.transaction('rw', BACKUP_TABLES.map(name => db.table(name)), async () => {
    for (const name of BACKUP_TABLES) await db.table(name).clear();
  });
});

describe('verified snapshot differentials with real IndexedDB', () => {
  it('captures timestamp-free changes, soft trash, hard deletion and additions, then restores the exact result', async () => {
    await db.folders.add(folder('A'));
    await db.tags.add({ id: 'tag', name: 'analysis', color: '#123456' });
    await db.notes.bulkAdd([note('edited', 'A'), note('trashed', 'A'), note('deleted', 'A')]);
    const base = await buildFullBackupPayload('all');
    await db.folders.update('A', { name: 'Changed without updatedAt' });
    await db.tags.update('tag', { color: '#abcdef' });
    await db.notes.update('edited', { content: 'Changed without advancing timestamp' });
    await db.notes.update('trashed', { trashed: true });
    await db.notes.delete('deleted');
    await db.notes.add(note('new', 'A'));
    const expected = await snapshot();
    const delta = await buildDifferentialPayload('all', base, 'base-id');
    expect(delta.version).toBe(2);
    expect(delta.deletedIds).toEqual({ notes: ['deleted'] });
    expect(delta.data.notes).toEqual(expect.arrayContaining([expect.objectContaining({ id: 'trashed', trashed: true })]));
    expect(delta.data.folders).toEqual([expect.objectContaining({ name: 'Changed without updatedAt' })]);
    await restoreFullReplace(base);
    const preview = await previewRestore(delta, 'merge', base);
    expect(preview).toMatchObject({ added: 1, updated: 4, deleted: 1 });
    await restoreMerge(delta, preview, base);
    expect(await snapshot()).toEqual(expected);
  });

  it('limits investigation snapshots and deletions while retaining unrelated work and shared catalogs', async () => {
    await db.folders.bulkAdd([folder('A'), folder('B')]);
    await db.tags.add({ id: 'shared', name: 'shared', color: '#123456' });
    await db.notes.bulkAdd([{ ...note('a', 'A'), tags: ['shared'] }, { ...note('b', 'B'), tags: ['shared'] }, note('trash', 'A')]);
    for (const name of ['agentActions', 'agentDeployments', 'agentMeetings', 'evidenceItems'] as const) {
      const field = name === 'evidenceItems' ? 'folderId' : 'investigationId';
      await db.table(name).bulkAdd([{ id: 'a', [field]: 'A' }, { id: 'b', [field]: 'B' }]);
    }
    const base = await buildFullBackupPayload('investigation', 'A');
    await db.notes.delete('a');
    await db.notes.update('trash', { trashed: true });
    await db.evidenceItems.delete('a');
    await db.agentActions.delete('a');
    const delta = await buildDifferentialPayload('investigation', base, 'base-a', 'A');
    expect(delta.deletedIds).toEqual({ notes: ['a'], evidenceItems: ['a'], agentActions: ['a'] });
    expect(delta.deletedIds?.tags).toBeUndefined();
    await restoreFullReplace(base);
    await db.notes.update('b', { content: 'Unrelated work after base restore' });
    await restoreMerge(delta, await previewRestore(delta, 'merge', base), base);
    expect((await db.notes.get('b'))?.content).toBe('Unrelated work after base restore');
    expect((await db.notes.get('trash'))?.trashed).toBe(true);
    expect(await db.notes.get('a')).toBeUndefined();
    expect(await db.evidenceItems.get('b')).toBeDefined();
    expect(await db.agentActions.get('b')).toBeDefined();
    expect(await db.tags.get('shared')).toBeDefined();
  });

  it('requires the exact parent and unchanged base state, preserving intervening local edits', async () => {
    await db.notes.add(note('n'));
    const base = await buildFullBackupPayload('all');
    await db.notes.update('n', { content: 'Delta content' });
    const delta = await buildDifferentialPayload('all', base, 'base');
    await restoreFullReplace(base);
    const before = await snapshot();
    await expect(restoreMerge(delta)).rejects.toThrow('matching full parent');
    await expect(restoreMerge(delta, undefined, { ...base, createdAt: base.createdAt + 1 })).rejects.toThrow('matching full parent');
    await expect(restoreMerge(delta, undefined, { ...base, scope: 'investigation', scopeId: 'B' })).rejects.toThrow();
    expect(await snapshot()).toEqual(before);
    await db.notes.update('n', { content: 'New unsaved-to-server local work' });
    const edited = await snapshot();
    await expect(restoreMerge(delta, undefined, base)).rejects.toThrow('current data differs');
    expect(await snapshot()).toEqual(edited);
  });

  it('verifies the projected result and rejects incomplete deltas before changing any table', async () => {
    await db.notes.add(note('n'));
    const base = await buildFullBackupPayload('all');
    await db.notes.update('n', { content: 'Delta content' });
    const delta = await buildDifferentialPayload('all', base, 'base');
    await restoreFullReplace(base);
    const before = await snapshot();
    await expect(restoreMerge({ ...delta, data: {} }, undefined, base)).rejects.toThrow('verified result');
    await expect(restoreMerge({ ...delta, resultFingerprint: 'a'.repeat(64) }, undefined, base)).rejects.toThrow('verified result');
    expect(await snapshot()).toEqual(before);
  });

  it('supports a hard-deleted entity scope without deleting other records', async () => {
    await db.notes.bulkAdd([note('one:part'), note('other')]);
    const base = await buildFullBackupPayload('entity', 'notes:one:part');
    await db.notes.delete('one:part');
    const delta = await buildDifferentialPayload('entity', base, 'base', 'notes:one:part');
    expect(delta.deletedIds).toEqual({ notes: ['one:part'] });
    await restoreFullReplace(base);
    await restoreMerge(delta, undefined, base);
    expect(await db.notes.get('one:part')).toBeUndefined();
    expect(await db.notes.get('other')).toBeDefined();
  });

  it('rolls back earlier delta writes if a later table fails', async () => {
    await db.notes.add(note('n'));
    const base = await buildFullBackupPayload('all');
    await db.notes.update('n', { content: 'Delta content' });
    await db.table('tasks').add({ id: 'new-task', title: 'Task', tags: [], createdAt: 100, updatedAt: 100 });
    const delta = await buildDifferentialPayload('all', base, 'base');
    await restoreFullReplace(base);
    const before = await snapshot();
    const fail = () => { throw new DOMException('Synthetic storage full', 'QuotaExceededError'); };
    db.tasks.hook('creating', fail);
    try {
      await expect(restoreMerge(delta, undefined, base)).rejects.toThrow('rolled back');
    } finally { db.tasks.hook('creating').unsubscribe(fail); }
    expect(await snapshot()).toEqual(before);
  });

  it('retains v1 full compatibility and clearly rejects unverifiable legacy differentials', async () => {
    const legacy: BackupPayload = { version: 1, type: 'full', scope: 'all', createdAt: 100, data: { notes: [note('n')] } };
    await restoreFullReplace(legacy);
    expect(await db.notes.get('n')).toBeDefined();
    await expect(buildDifferentialPayload('all', legacy, 'legacy')).rejects.toThrow('complete supported snapshot');
    const before = await snapshot();
    await expect(restoreMerge({ ...legacy, type: 'differential', deletedIds: { notes: ['n'] } })).rejects.toThrow('Legacy differential');
    expect(await snapshot()).toEqual(before);
  });

  it('requires a new full investigation backup when shared catalog values have changed', async () => {
    await db.folders.add(folder('A'));
    await db.notes.add({ ...note('a', 'A'), tags: ['shared'] });
    await db.tags.add({ id: 'shared', name: 'shared', color: '#123456' });
    const base = await buildFullBackupPayload('investigation', 'A');
    await db.tags.update('shared', { color: '#abcdef' });
    await expect(buildDifferentialPayload('investigation', base, 'base', 'A')).rejects.toThrow('Shared tags or timelines changed');
  });

  it('round-trips encrypted parent and delta with stable fingerprints and no password leakage', async () => {
    await db.notes.bulkAdd([note('n'), note('another')]);
    const base = await buildFullBackupPayload('all');
    const reordered = { ...base, data: { ...base.data, notes: [...(base.data.notes ?? [])].reverse() } };
    expect(await backupFingerprint(reordered)).toBe(await backupFingerprint(base));
    await db.notes.update('n', { content: 'Encrypted delta content' });
    const expected = await buildFullBackupPayload('all');
    const delta = await buildDifferentialPayload('all', base, 'base');
    const password = 'test-long-differential-password';
    const baseEnvelope = await encryptBackup(password, base);
    const deltaEnvelope = await encryptBackup(password, delta);
    expect(JSON.stringify(deltaEnvelope)).not.toContain('Encrypted delta content');
    expect(JSON.stringify(deltaEnvelope)).not.toContain(password);
    await expect(decryptBackup('incorrect-password', deltaEnvelope)).rejects.toThrow('Wrong password');
    const restoredBase = await decryptBackup(password, baseEnvelope);
    const restoredDelta = await decryptBackup(password, deltaEnvelope);
    expect(await backupFingerprint(restoredBase)).toBe(delta.baseFingerprint);
    await restoreFullReplace(restoredBase);
    await restoreMerge(restoredDelta, undefined, restoredBase);
    expect(await backupStateFingerprint(await buildFullBackupPayload('all'))).toBe(await backupStateFingerprint(expected));
  });
});
