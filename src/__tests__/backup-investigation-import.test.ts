import { beforeEach, describe, expect, it } from 'vitest';
import { db } from '../db';
import { buildDifferentialPayload, buildFullBackupPayload } from '../lib/backup-data';
import { MAX_BACKUP_BYTES } from '../lib/backup-records';
import { restoreFullReplace, restoreMerge } from '../lib/backup-restore';
import { BUILTIN_INTEGRATIONS } from '../lib/builtin-integrations';
import { exportInvestigationJSON, importJSON, mergeImportJSON } from '../lib/export';
import { revisionKey } from '../lib/sync-state';

const base = { tags: [], createdAt: 1, updatedAt: 1, trashed: false, archived: false };
const note = (id: string, folderId?: string) => ({ ...base, id, title: `Note ${id}`, content: `Body ${id}`, pinned: false, ...(folderId ? { folderId } : {}) });
const chat = (id: string, folderId?: string) => ({ ...base, id, title: `Chat ${id}`, messages: [], model: 'model', provider: 'anthropic' as const, ...(folderId ? { folderId } : {}) });

beforeEach(async () => {
  await Promise.all(db.tables.map(table => table.clear()));
});

async function twoInvestigations() {
  await db.folders.bulkAdd([{ id: 'A', name: 'Case A', order: 0, createdAt: 1 }, { id: 'B', name: 'Case B', order: 1, createdAt: 1 }]);
  await db.notes.bulkAdd([note('nA', 'A'), note('nB', 'B'), note('unfiled')]);
  await db.tasks.add({ ...base, id: 'tB', title: 'Task B', folderId: 'B', status: 'todo', completed: false, priority: 'none', order: 0 });
  await db.chatThreads.bulkAdd([chat('cA', 'A'), chat('cB', 'B'), chat('global')]);
  await db.agentProfiles.add({ id: 'user-profile', name: 'Mine', role: 'specialist', systemPrompt: 'Help', source: 'user', createdAt: 1, updatedAt: 1,
    policy: { autoApproveReads: true, autoApproveEnrich: true, autoApproveFetch: false, autoApproveCreate: false, autoApproveModify: false, intervalMinutes: 5 } });
}

async function remaining() {
  return {
    folders: (await db.folders.toArray()).map(row => row.id).sort(),
    notes: (await db.notes.toArray()).map(row => row.id).sort(),
    tasks: (await db.tasks.toArray()).map(row => row.id).sort(),
    chats: (await db.chatThreads.toArray()).map(row => row.id).sort(),
    profiles: (await db.agentProfiles.toArray()).map(row => row.id),
  };
}
const everything = { folders: ['A', 'B'], notes: ['nA', 'nB', 'unfiled'], tasks: ['tB'], chats: ['cA', 'cB', 'global'], profiles: ['user-profile'] };

describe('Export Investigation files never replace the workspace', () => {
  it('marks investigation exports', async () => {
    await twoInvestigations();
    expect(JSON.parse(await exportInvestigationJSON('A'))).toMatchObject({ format: 'threatcaddy-investigation', folders: [{ id: 'A' }] });
  });

  it('keeps every other investigation when Settings › Import JSON Backup (Replace All) receives an investigation export', async () => {
    await twoInvestigations();
    const file = await exportInvestigationJSON('A');
    await db.notes.update('nA', { content: 'Edited after export', updatedAt: 5 });
    await db.notes.delete('nA');
    const result = await importJSON(file);
    expect(await remaining()).toEqual(everything);
    expect((await db.notes.get('nA'))?.content).toBe('Body nA');
    expect(result.warnings).toEqual(expect.arrayContaining([expect.stringContaining('single investigation')]));
  });

  it('treats a legacy unmarked single-investigation file the same way', async () => {
    await twoInvestigations();
    const legacy = JSON.parse(await exportInvestigationJSON('A'));
    delete legacy.format;
    await importJSON(JSON.stringify(legacy));
    expect(await remaining()).toEqual(everything);
  });

  it('still restores an old whole-workspace backup that holds one investigation, without deleting newer work', async () => {
    await db.folders.add({ id: 'A', name: 'Case A', order: 0, createdAt: 1 });
    await db.notes.add(note('nA', 'A'));
    const old = { version: 1, exportedAt: 1, notes: [note('nA', 'A'), note('lost', 'A')], tasks: [], folders: [{ id: 'A', name: 'Case A', order: 0, createdAt: 1 }], tags: [] };
    await db.notes.add(note('newer', 'A'));
    await importJSON(JSON.stringify(old));
    expect((await db.notes.toArray()).map(row => row.id).sort()).toEqual(['lost', 'nA', 'newer']);
  });

  it('keeps Replace All for genuine multi-investigation backups', async () => {
    await twoInvestigations();
    const json = JSON.stringify({ version: 1, exportedAt: 1, notes: [note('nA', 'A')], tasks: [], chatThreads: [],
      folders: [{ id: 'A', name: 'Case A', order: 0, createdAt: 1 }, { id: 'C', name: 'Case C', order: 2, createdAt: 1 }], tags: [] });
    await importJSON(json);
    expect((await db.folders.toArray()).map(row => row.id).sort()).toEqual(['A', 'C']);
    expect((await db.notes.toArray()).map(row => row.id)).toEqual(['nA']);
  });

  it('merges an investigation export from the header Load Backup without deleting anything', async () => {
    await twoInvestigations();
    const file = await exportInvestigationJSON('A');
    await mergeImportJSON(file);
    expect(await remaining()).toEqual(everything);
  });

  it('refuses to write an investigation file its own import would refuse', async () => {
    await twoInvestigations();
    await db.tasks.add({ ...base, id: 'tA', title: 'Task A', folderId: 'A', status: 'todo', completed: false, priority: 'urgent' as never, order: 0 });
    await expect(exportInvestigationJSON('A')).rejects.toThrow('Invalid backup field tasks.priority in record tasks:tA');
    await db.tasks.update('tA', { priority: 'high' });
    const file = await exportInvestigationJSON('A');
    await db.tasks.delete('tA');
    await expect(importJSON(file)).resolves.toMatchObject({ tasks: 1 });
    expect((await db.tasks.get('tA'))?.priority).toBe('high');
  });

  it('refuses to write an investigation file larger than its own import accepts', async () => {
    await twoInvestigations();
    await db.notes.update('nA', { content: 'x'.repeat(MAX_BACKUP_BYTES) });
    await expect(exportInvestigationJSON('A')).rejects.toThrow('Backup file too large (maximum 50 MiB)');
  });
});

describe('files that carry a legacy sync revision', () => {
  async function versionedInvestigation() {
    await twoInvestigations();
    for (const table of ['folders', 'notes', 'chatThreads'] as const) {
      for (const row of await db.table(table).toArray()) {
        await db.table(table).update(row.id, { version: 7 });
        await db.table('_syncMeta').put({ key: revisionKey(table, row.id), value: 7 });
      }
    }
  }

  it('exports investigations without the transport revision', async () => {
    await versionedInvestigation();
    const file = JSON.parse(await exportInvestigationJSON('A'));
    for (const name of ['folders', 'notes', 'chatThreads']) for (const row of file[name]) expect(row, name).not.toHaveProperty('version');
    expect((await db.table('notes').get('nA'))?.version).toBe(7);
  });

  it('imports legacy full backups and investigation exports whose rows carry version', async () => {
    await versionedInvestigation();
    const legacyFull = { version: 1, exportedAt: 1, notes: (await db.notes.toArray()), tasks: await db.tasks.toArray(), folders: await db.folders.toArray(),
      tags: [], chatThreads: await db.chatThreads.toArray(), integrationTemplates: [BUILTIN_INTEGRATIONS[0]] };
    const investigation = { format: 'threatcaddy-investigation', version: 1, exportedAt: 1, notes: [{ ...note('nA', 'A'), version: 3 }], tasks: [],
      folders: [{ id: 'A', name: 'Case A', order: 0, createdAt: 1, version: 3 }], tags: [] };
    await expect(mergeImportJSON(JSON.stringify(investigation))).resolves.toBeDefined();
    await expect(importJSON(JSON.stringify(investigation))).resolves.toBeDefined();
    await expect(mergeImportJSON(JSON.stringify(legacyFull))).resolves.toBeDefined();
    await expect(importJSON(JSON.stringify(legacyFull))).resolves.toBeDefined();
    expect(await db.notes.get('nB')).not.toHaveProperty('version');
    expect((await db.integrationTemplates.get(BUILTIN_INTEGRATIONS[0].id))?.version).toBe(BUILTIN_INTEGRATIONS[0].version);
  });

  it('keeps rejecting a version that is not a positive server revision', async () => {
    for (const version of [0, -1, 1.5, '7']) {
      const file = { version: 1, exportedAt: 1, notes: [{ ...note('n'), version }], tasks: [], folders: [], tags: [] };
      await expect(importJSON(JSON.stringify(file)), String(version)).rejects.toThrow('notes.version');
    }
  });

  it('verifies an investigation-scoped differential against rows that still carry version', async () => {
    await versionedInvestigation();
    const full = await buildFullBackupPayload('investigation', 'A');
    await db.notes.update('nA', { content: 'Differential edit', updatedAt: 9 });
    const delta = await buildDifferentialPayload('investigation', full, 'parent', 'A');
    await restoreFullReplace(full);
    for (const row of await db.notes.where('folderId').equals('A').toArray()) await db.table('notes').update(row.id, { version: 8 });
    await db.table('folders').update('A', { version: 8 });
    await restoreMerge(delta, undefined, full);
    expect((await db.notes.get('nA'))?.content).toBe('Differential edit');
  });
});
