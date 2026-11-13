import { beforeEach, describe, expect, it } from 'vitest';
import { db } from '../db';
import { BACKUP_TABLES } from '../lib/backup-tables';
import { buildDifferentialPayload, buildFullBackupPayload } from '../lib/backup-data';
import { decryptBackup, encryptBackup } from '../lib/backup-crypto';
import { restoreFullReplace, restoreMerge } from '../lib/backup-restore';
import { BUILTIN_INTEGRATIONS } from '../lib/builtin-integrations';
import { exportJSON, importJSON } from '../lib/export';
import { sanitizeSyncEntity } from '../lib/sync-sanitize';
import { revisionKey, SYNC_TABLES } from '../lib/sync-state';

beforeEach(async () => {
  for (const table of [...BACKUP_TABLES, '_syncMeta', '_syncQueue']) await db.table(table).clear();
});

async function seedLegacySyncedRows() {
  for (const table of SYNC_TABLES) {
    const row = sanitizeSyncEntity(table, {
      id: table, folderId: 'folders', title: 'Synthetic', name: 'Synthetic', content: 'Preserved body',
      createdAt: 100, updatedAt: 100, timestamp: 100, timelineId: 'timelines',
      type: 'domain', value: 'example.invalid', provider: 'local', model: 'fixture',
      createdBy: 'author', updatedBy: 'editor', version: 7, userId: 'transport-owner',
      messages: [{ id: 'message', role: 'assistant', content: 'Retained result', createdAt: 100, userId: 'message-author',
        toolCalls: [{ id: 'call', name: 'read_note', input: { id: 'notes' }, result: 'Local result', isError: false }] }],
    });
    expect(row, table).not.toBeNull();
    expect(row, table).not.toHaveProperty('version');
    expect(row, table).not.toHaveProperty('userId');
    expect(row, table).toMatchObject({ createdBy: 'author', updatedBy: 'editor' });
    // Existing browser data must remain exportable before any new server pull.
    await db.table(table).put({ ...row, version: 7 });
    await db.table('_syncMeta').put({ key: revisionKey(table, table), value: 7 });
  }
  await db.notes.update('notes', { parentNoteId: 'local-parent', reviewRequired: true });
  await db.tasks.update('tasks', { checklist: [{ id: 'check', text: 'Preserve evidence', done: true }] });
  await db.chatThreads.update('chatThreads', { contextSummary: 'Local summary', mode: 'plan' });
  await db.integrationTemplates.put(BUILTIN_INTEGRATIONS[0]);
}

describe('sync to portable backup contract', () => {
  it('exports all ten synced entity types without transport metadata while preserving portable content and authorship', async () => {
    await seedLegacySyncedRows();
    const full = await buildFullBackupPayload('all');
    for (const table of SYNC_TABLES) {
      expect(full.data[table]?.[0], table).not.toHaveProperty('version');
      expect(full.data[table]?.[0], table).toMatchObject({ createdBy: 'author', updatedBy: 'editor' });
      expect(await db.table(table).get(table), table).toHaveProperty('version', 7);
      expect((await db.table('_syncMeta').get(revisionKey(table, table))).value).toBe(7);
    }
    expect(full.data.integrationTemplates?.[0]).toHaveProperty('version', BUILTIN_INTEGRATIONS[0].version);
    expect(full.data.notes?.[0]).toMatchObject({ parentNoteId: 'local-parent', reviewRequired: true });
    expect(full.data.tasks?.[0]).toHaveProperty('checklist', [{ id: 'check', text: 'Preserve evidence', done: true }]);
    expect(full.data.chatThreads?.[0]).toMatchObject({ mode: 'plan', contextSummary: 'Local summary',
      messages: [{ userId: 'message-author', toolCalls: [{ result: 'Local result', isError: false }] }] });
    expect((await buildFullBackupPayload('entity', 'notes:notes')).data.notes?.[0]).not.toHaveProperty('version');
    const investigation = await buildFullBackupPayload('investigation', 'folders');
    for (const records of Object.values(investigation.data)) for (const row of records ?? []) expect(row).not.toHaveProperty('version');
    expect(investigation.data.tasks?.[0]).toHaveProperty('checklist');
    const encrypted = await encryptBackup('Synthetic backup password 123!', full);
    expect(await decryptBackup('Synthetic backup password 123!', encrypted)).toEqual(full);
    const json = await exportJSON();
    await importJSON(json);
    expect((await buildFullBackupPayload('all')).data).toEqual(full.data);
  });

  it('ignores legacy revision-only differences when verifying a differential restore', async () => {
    await seedLegacySyncedRows();
    const base = await buildFullBackupPayload('all');
    for (const table of SYNC_TABLES) await db.table(table).update(table, { version: 8 });
    expect((await buildDifferentialPayload('all', base, 'base')).data).toEqual({});
    await db.notes.update('notes', { content: 'Portable edit' });
    const delta = await buildDifferentialPayload('all', base, 'base');
    await restoreFullReplace(base);
    for (const table of SYNC_TABLES) await db.table(table).update(table, { version: 9 });
    await restoreMerge(delta, undefined, base);
    expect((await db.notes.get('notes'))?.content).toBe('Portable edit');
    expect((await db.tasks.get('tasks'))?.checklist?.[0].done).toBe(true);
  });

  it('continues rejecting unknown or malformed fields instead of silently dropping user data', async () => {
    await seedLegacySyncedRows();
    await db.table('notes').update('notes', { unrecognizedField: 'Do not silently discard' });
    await expect(buildFullBackupPayload('all')).rejects.toThrow('unrecognizedField');
    await db.table('notes').update('notes', { unrecognizedField: undefined, version: 'not-a-server-revision' });
    await expect(buildFullBackupPayload('all')).rejects.toThrow('notes.version');
  });
});
