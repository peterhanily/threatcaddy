import { beforeEach, afterEach, describe, expect, it } from 'vitest';
import { db } from '../db';
import { enableSync, disableSync, markFolderLocalOnly } from '../lib/sync-middleware';
import { revisionKey, suppressSyncInCurrentTransaction, onOutboxCommit } from '../lib/sync-state';
import { setSessionKey } from '../lib/encryptionMiddleware';

const note = (id: string, title = 'Local note') => ({ id, title, content: 'body', folderId: 'f1', tags: [], pinned: false, archived: false, trashed: false, createdAt: 1, updatedAt: 1 });
beforeEach(async () => {
  disableSync();
  setSessionKey(null);
  markFolderLocalOnly('f1', false);
  await db.transaction('rw', db.tables, async () => { for (const table of db.tables) await table.clear(); });
  await db.folders.add({ id: 'f1', name: 'Case', order: 0, createdAt: 1 });
});
afterEach(() => disableSync());

describe('transactional sync outbox using the actual database', () => {
  it('captures committed adds and later updates without a timer', async () => {
    enableSync();
    await db.notes.add(note('n1'));
    await db.notes.update('n1', { title: 'Updated' });
    const queue = await db.table('_syncQueue').toArray();
    expect(queue).toHaveLength(2);
    expect(queue[0]).toMatchObject({ table: 'notes', entityId: 'n1', clientVersion: 0, data: { title: 'Local note' } });
    expect(queue[1]).toMatchObject({ data: { title: 'Updated', content: 'body' } });
  });

  it('rolls back both the entity and its outgoing operation', async () => {
    enableSync();
    await expect(db.transaction('rw', db.notes, async () => {
      await db.notes.add(note('n1'));
      throw new Error('Cancel edit');
    })).rejects.toThrow('Cancel edit');
    expect(await db.notes.count()).toBe(0);
    expect(await db.table('_syncQueue').count()).toBe(0);
  });

  it('aborts an entity write if its outbox write fails, even if the caller catches it', async () => {
    const fail = () => { throw new Error('Queue unavailable'); };
    db.table('_syncQueue').hook('creating', fail);
    try {
      enableSync();
      await expect(db.notes.add(note('n1'))).rejects.toBeDefined();
      expect(await db.notes.count()).toBe(0);
    } finally {
      // Remove only the test hook.
      db.table('_syncQueue').hook('creating').unsubscribe(fail);
    }
  });

  it('captures deletions with the last acknowledged revision', async () => {
    await db.notes.add(note('n1'));
    await db.table('_syncMeta').put({ key: revisionKey('notes', 'n1'), value: 7 });
    enableSync();
    await db.notes.delete('n1');
    expect(await db.table('_syncQueue').toArray()).toEqual([expect.objectContaining({ entityId: 'n1', op: 'delete', clientVersion: 7 })]);
  });

  it('captures range deletion and clears as durable tombstones', async () => {
    await db.notes.bulkAdd([note('n1'), note('n2')]);
    enableSync();
    await db.notes.clear();
    expect((await db.table('_syncQueue').toArray()).map(e => e.entityId).sort()).toEqual(['n1', 'n2']);
  });

  it('keeps local-only and unscoped records out of the team queue', async () => {
    await db.folders.update('f1', { localOnly: true });
    enableSync();
    await db.notes.add(note('n1'));
    await db.notes.add({ ...note('n2'), folderId: undefined });
    expect(await db.table('_syncQueue').count()).toBe(0);
  });

  it('suppresses only the maintenance transaction and resumes ordinary capture', async () => {
    enableSync();
    await db.transaction('rw', db.notes, async () => {
      suppressSyncInCurrentTransaction();
      await db.notes.add(note('remote'));
    });
    await db.notes.add(note('local'));
    expect((await db.table('_syncQueue').toArray()).map(e => e.entityId)).toEqual(['local']);
  });

  it('uses persisted folder policy when a different tab has changed sharing', async () => {
    markFolderLocalOnly('f1', true);
    enableSync();
    await db.notes.add(note('n1'));
    expect(await db.table('_syncQueue').count()).toBe(1);
  });

  it('notifies transport only after a successful commit', async () => {
    let count = 0;
    const off = onOutboxCommit(() => { count++; });
    try {
      enableSync();
      await expect(db.transaction('rw', db.notes, async () => {
        await db.notes.add(note('rolled-back'));
        throw new Error('rollback');
      })).rejects.toThrow();
      expect(count).toBe(0);
      await db.notes.add(note('committed'));
      expect(count).toBe(1);
    } finally { off(); }
  });

  it('does not queue local writes while sync has never been enabled', async () => {
    await db.notes.add(note('n1'));
    expect(await db.table('_syncQueue').count()).toBe(0);
  });

  it('retains folder privacy while disconnected and after deletion without queueing new writes', async () => {
    await db.folders.update('f1', { localOnly: true });
    await db.folders.delete('f1');
    expect(await db.table('_syncMeta').get(JSON.stringify(['localOnly', 'f1']))).toMatchObject({ value: true });
    expect(await db.table('_syncQueue').count()).toBe(0);
  });

  it('atomically rolls back disconnected privacy and records an explicit return to sharing', async () => {
    await expect(db.transaction('rw', db.folders, async () => {
      await db.folders.update('f1', { localOnly: true });
      throw new Error('Cancelled');
    })).rejects.toThrow('Cancelled');
    expect(await db.table('_syncMeta').get(JSON.stringify(['localOnly', 'f1']))).toBeUndefined();
    await db.folders.update('f1', { localOnly: true });
    await db.folders.update('f1', { localOnly: false });
    expect(await db.table('_syncMeta').get(JSON.stringify(['localOnly', 'f1']))).toMatchObject({ value: false });
  });
});
