import Dexie from 'dexie';
import { afterEach, describe, expect, it } from 'vitest';
import { db } from '../db';
import { isBackupTable } from '../lib/backup-tables';
import { isSyncTable } from '../lib/sync-state';

afterEach(async () => { db.close(); await Dexie.delete(db.name); });

describe('workspace-local receipt schema upgrade', () => {
  it('upgrades v33 without inspecting or rewriting encrypted content', async () => {
    db.close(); await Dexie.delete(db.name);
    const historical = new Dexie(db.name);
    historical.version(33).stores(Object.fromEntries(db.tables.filter(table => table.name !== '_clipReceipts').map(table => [table.name,
      [table.schema.primKey.src, ...table.schema.indexes.map(index => index.src)].join(', ')])));
    const envelope = { __enc: 1, iv: 'preserved-fixture-iv', ct: 'preserved-fixture-ciphertext' };
    await historical.table('notes').add({ id: 'encrypted-fixture', title: envelope, content: envelope, createdAt: 1 });
    await historical.table('_syncMeta').add({ key: 'ownership-fixture', value: 'preserve' });
    historical.close();
    await db.open();
    expect(db.verno).toBe(34);
    expect((await db.notes.get('encrypted-fixture'))?.content).toEqual(envelope);
    expect(await db.table('_syncMeta').get('ownership-fixture')).toEqual({ key: 'ownership-fixture', value: 'preserve' });
    expect(await db.table('_clipReceipts').count()).toBe(0);
  });

  it('does not expose delivery receipts through portable or sync registries', () => {
    expect(isBackupTable('_clipReceipts')).toBe(false);
    expect(isSyncTable('_clipReceipts')).toBe(false);
  });
});
