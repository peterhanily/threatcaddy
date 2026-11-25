import Dexie from 'dexie';
import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { db } from '../db';
import type { Identity } from '../types';
import { buildDifferentialPayload, buildFullBackupPayload } from '../lib/backup-data';
import { backupFingerprint, backupStateFingerprint, encryptBackup, type BackupPayload } from '../lib/backup-crypto';
import { previewRestore, restoreFullReplace, restoreMerge } from '../lib/backup-restore';
import { validatePortableTables } from '../lib/backup-records';
import { deleteEntitiesWithReferences, setInvestigationArchived } from '../lib/entity-relations';
import { exportEncryptedJSON, exportInvestigationJSON, exportJSON, importInvestigationJSON, importJSON, mergeImportJSON, sanitizeIdentity } from '../lib/export';
import { restoreSyncRecovery } from '../lib/sync-recovery';
import { setSessionKey } from '../lib/encryptionMiddleware';
import { clearEncryptionMeta, setEncryptionMeta } from '../lib/encryptionStore';
import { generateMasterKey, isEncryptedEnvelope } from '../lib/crypto';
import { useIdentities } from '../hooks/useIdentities';

// Synthetic investigation data only.
const folder = { id: 'case', name: 'Synthetic payroll diversion', order: 0, createdAt: 1, updatedAt: 1 };
const identity = (id: string, over: Partial<Identity> = {}): Identity => ({
  id, folderId: 'case', type: 'person', name: id, aliases: [], details: [], connections: [], tags: [],
  trashed: false, archived: false, createdAt: 1, updatedAt: 1, ...over,
});
const org = identity('org', { type: 'organization', name: 'Halvorsen Logistics', tags: ['client'] });
const dana = identity('dana', {
  name: 'Dana Okafor', description: 'Payroll lead', aliases: ['D. Okafor'], status: 'compromised', contact: true, clsLevel: 'TLP:AMBER',
  details: [{ id: 'email', label: 'Email', value: 'dana@halvorsen.example' }, { id: 'phone', label: 'Phone', value: '+44 20 7946 0101', private: true }],
  connections: [{ targetId: 'org', label: 'works at' }], tags: ['client'],
});

async function clearAll() {
  await db.transaction('rw', db.tables, async () => { for (const table of db.tables) await table.clear(); });
}
async function seed() {
  await db.folders.add(folder);
  await db.tags.add({ id: 'tag-client', name: 'client', color: '#336699' });
  await db.identities.bulkAdd([org, dana]);
}
const withoutIdentities = (json: string) => {
  const document = JSON.parse(json);
  delete document.identities;
  return JSON.stringify(document);
};

beforeEach(async () => { localStorage.clear(); setSessionKey(null); clearEncryptionMeta(); await clearAll(); });
afterEach(() => { setSessionKey(null); clearEncryptionMeta(); });

describe('Dexie version 35', () => {
  it('opens a version 34 database with its data unchanged and an empty identities table', async () => {
    db.close();
    await Dexie.delete(db.name);
    const historical = new Dexie(db.name);
    historical.version(34).stores(Object.fromEntries(db.tables.filter(table => table.name !== 'identities').map(table => [table.name,
      [table.schema.primKey.src, ...table.schema.indexes.map(index => index.src)].join(', ')])));
    const note = { id: 'note', folderId: 'case', title: 'Kept', content: 'Unchanged by the upgrade', tags: ['client'], pinned: false, archived: false, trashed: false, createdAt: 1, updatedAt: 1 };
    await historical.table('folders').add(folder);
    await historical.table('notes').add(note);
    await historical.table('_syncMeta').add({ key: 'fixture', value: 'kept' });
    historical.close();
    await db.open();
    expect(db.verno).toBe(35);
    expect(await db.folders.toArray()).toEqual([folder]);
    expect(await db.notes.toArray()).toEqual([note]);
    expect(await db.table('_syncMeta').get('fixture')).toEqual({ key: 'fixture', value: 'kept' });
    expect(await db.identities.count()).toBe(0);
    expect(db.identities.schema.indexes.map(index => index.name).sort()).toEqual(['archived', 'folderId', 'tags', 'trashed', 'updatedAt']);
  });
});

describe('backups', () => {
  it('round-trips identities through plain and encrypted portable backups', async () => {
    await seed();
    const plain = await exportJSON();
    expect(JSON.parse(plain).identities).toEqual([dana, org]);
    const encrypted = await exportEncryptedJSON('a synthetic backup password');
    expect(encrypted).not.toContain('Dana Okafor');
    for (const [json, password] of [[plain, undefined], [encrypted, 'a synthetic backup password']] as const) {
      await clearAll();
      const counts = await importJSON(json, password);
      expect(counts.identities).toBe(2);
      expect(await db.identities.toArray()).toEqual([dana, org]);
    }
  });

  it('leaves an empty identities table out of portable files, so older versions can still read them', async () => {
    await db.folders.add(folder);
    // The tables a version 34 reader accepts: its own list, with no identities.
    const olderReader = new Set(['version', 'format', 'exportedAt', 'quickLinks', 'redactions', 'notes', 'tasks', 'folders', 'tags', 'timelineEvents',
      'timelines', 'whiteboards', 'standaloneIOCs', 'evidenceItems', 'chatThreads', 'agentActions', 'agentProfiles', 'agentDeployments', 'agentMeetings',
      'noteTemplates', 'playbookTemplates', 'integrationTemplates', 'installedIntegrations', 'customSlashCommands']);
    const document = JSON.parse(await exportJSON());
    expect(Object.keys(document).filter(key => !olderReader.has(key))).toEqual([]);
    await db.identities.add(dana);
    expect(JSON.parse(await exportJSON()).identities).toEqual([dana]);
  });

  it('round-trips identities through full and differential backups', async () => {
    await seed();
    const base = await buildFullBackupPayload('all');
    expect(base.data.identities).toEqual([dana, org]);
    await db.identities.update('dana', { status: 'cleared' });
    await db.identities.add(identity('laptop', { type: 'system', name: 'FIN-WS-014', connections: [{ targetId: 'dana', label: 'used by' }] }));
    const delta = await buildDifferentialPayload('all', base, 'base-id');
    expect(delta.data.identities?.map(row => (row as Identity).id).sort()).toEqual(['dana', 'laptop']);
    const expected = await db.identities.toArray();
    await clearAll();
    await restoreFullReplace(base);
    expect(await db.identities.toArray()).toEqual([dana, org]);
    await restoreMerge(delta, await previewRestore(delta, 'merge', base), base);
    expect(await db.identities.toArray()).toEqual(expected);
  });

  it('keeps only one investigation\'s identities in its backup', async () => {
    await seed();
    await db.folders.add({ ...folder, id: 'other', name: 'Another case' });
    await db.identities.add(identity('elsewhere', { folderId: 'other' }));
    expect((await buildFullBackupPayload('investigation', 'case')).data.identities).toEqual([dana, org]);
  });

  it('restores a portable file made before identities existed as holding none of them', async () => {
    await seed();
    const old = withoutIdentities(await exportJSON());
    // Replace All makes the workspace match the file, which held no identities.
    await db.identities.add(identity('newer', { name: 'Added after the backup' }));
    await importJSON(old);
    expect(await db.identities.count()).toBe(0);
    expect(await db.folders.toArray()).toEqual([folder]);
  });

  it('keeps identities when a backup payload leaves the table out, as for every other table', async () => {
    await seed();
    const payload = await buildFullBackupPayload('all');
    delete payload.data.identities;
    const preview = await previewRestore(payload, 'replace');
    expect(preview.tables).not.toContain('identities');
    await restoreFullReplace(payload, preview);
    expect(await db.identities.toArray()).toEqual([dana, org]);
    await restoreMerge(payload);
    expect(await db.identities.count()).toBe(2);
  });

  it('still rejects a portable file whose identities entry is not a list', async () => {
    await seed();
    const document = JSON.parse(await exportJSON());
    document.identities = null;
    await expect(importJSON(JSON.stringify(document))).rejects.toThrow('nothing was imported');
    expect(await db.identities.count()).toBe(2);
  });

  it('restores a differential chain made before identities existed and leaves identities alone', async () => {
    await seed();
    await db.notes.add({ id: 'note', folderId: 'case', title: 'Draft', content: 'v1', tags: [], pinned: false, archived: false, trashed: false, createdAt: 1, updatedAt: 1 });
    // Rebuild the chain as version 34 wrote it: no identities table anywhere.
    const legacy = <T extends { data: BackupPayload['data'] }>(payload: T): T => {
      const data = { ...payload.data };
      delete data.identities;
      return { ...payload, data };
    };
    const complete = await buildFullBackupPayload('all');
    const base = legacy(complete);
    await db.notes.update('note', { content: 'v2' });
    const current = legacy(await buildFullBackupPayload('all'));
    const delta = legacy(await buildDifferentialPayload('all', complete, 'base-id'));
    expect(delta.data).toEqual({ notes: [expect.objectContaining({ id: 'note', content: 'v2' })] });
    Object.assign(delta, { baseFingerprint: await backupFingerprint(base), baseStateFingerprint: await backupStateFingerprint(base),
      lastBackupAt: base.createdAt, resultFingerprint: await backupStateFingerprint(current) });
    await db.notes.update('note', { content: 'v1' });
    await db.identities.update('dana', { status: 'cleared' }); // an identity edited after the chain was made
    const preview = await previewRestore(delta, 'merge', base);
    expect(preview.tables).toEqual(['notes']);
    await restoreMerge(delta, preview, base);
    expect((await db.notes.get('note'))?.content).toBe('v2');
    expect((await db.identities.get('dana'))?.status).toBe('cleared');
    // A differential cannot change a table its full parent never held.
    const forged = { ...delta, data: { ...delta.data, identities: [dana] } };
    await expect(previewRestore(forged, 'merge', base)).rejects.toThrow('its full parent does not contain');
    // Only tables added since may be missing: a parent without an older table is still incomplete.
    const incomplete = { ...base, data: { ...base.data } };
    delete incomplete.data.tasks;
    await expect(previewRestore(delta, 'merge', incomplete)).rejects.toThrow('complete supported snapshot');
  });

  it('asks for a new full backup when a differential\'s parent predates identities', async () => {
    await seed();
    const base = await buildFullBackupPayload('all');
    delete base.data.identities;
    await expect(buildDifferentialPayload('all', base, 'old-base')).rejects.toThrow('Create a new full backup first.');
  });

  it('validates identity records strictly', () => {
    expect(() => validatePortableTables({ identities: [dana] })).not.toThrow();
    expect(() => validatePortableTables({ identities: [{ ...dana, status: 'unknown' }] })).toThrow('identities.status');
    expect(() => validatePortableTables({ identities: [{ ...dana, title: 'Payroll lead' }] })).toThrow('unsupported');
    expect(() => validatePortableTables({ identities: [{ ...dana, details: [{ label: 'Email', value: 'x' }] }] })).toThrow('details[0].id');
    expect(() => validatePortableTables({ identities: [{ ...dana, connections: [{ targetId: 'org' }] }] })).toThrow('connections[0].label');
    const missing: Record<string, unknown> = { ...dana };
    delete missing.aliases;
    expect(() => validatePortableTables({ identities: [missing] })).toThrow('identities.aliases');
  });
});

describe('investigation export and import', () => {
  it('carries identities, their tags and their connections into the imported copy', async () => {
    await seed();
    const exported = JSON.parse(await exportInvestigationJSON('case'));
    expect(exported.identities).toEqual([dana, org]);
    // A row written without an investigation still lands in the imported one.
    exported.identities.push(identity('unfiled', { folderId: undefined, name: 'Unfiled contact' }));
    expect(exported.tags.map((tag: { name: string }) => tag.name)).toEqual(['client']);
    const result = await importInvestigationJSON(JSON.stringify(exported));
    expect(result.identities).toBe(3);
    const copies = await db.identities.where('folderId').equals(result.folderId).toArray();
    expect(copies.map(row => row.name).sort()).toEqual(['Dana Okafor', 'Halvorsen Logistics', 'Unfiled contact']);
    const copiedOrg = copies.find(row => row.name === 'Halvorsen Logistics');
    const copiedDana = copies.find(row => row.name === 'Dana Okafor');
    expect(copiedOrg?.id).not.toBe('org');
    expect(copiedDana).toMatchObject({ details: dana.details, aliases: dana.aliases, status: 'compromised', connections: [{ targetId: copiedOrg?.id, label: 'works at' }] });
  });

  it('brings identities back through the Load Backup dialog paths', async () => {
    await seed();
    const json = await exportInvestigationJSON('case');
    await clearAll();
    await importJSON(json); // an investigation file is merged, never a replacement
    expect(await db.identities.toArray()).toEqual([dana, org]);
    await clearAll();
    const result = await mergeImportJSON(json);
    expect(result.tables.identities).toMatchObject({ incoming: 2, added: 2 });
    expect(await db.identities.toArray()).toEqual([dana, org]);
  });

  it('omits identities from an investigation export that has none', async () => {
    await db.folders.add(folder);
    expect(JSON.parse(await exportInvestigationJSON('case'))).not.toHaveProperty('identities');
  });

  it('sanitizes imported identities', () => {
    expect(sanitizeIdentity({ id: 'x', name: 'Ann', status: 'bogus', contact: 'yes', aliases: ['A', 3],
      details: [{ label: 'Email', value: 'ann@example.test' }, 'junk'], connections: [{ label: 'works at' }, { targetId: 'org', label: 'works at' }] }))
      .toMatchObject({ id: 'x', type: 'person', name: 'Ann', status: undefined, contact: undefined, aliases: ['A'],
        details: [{ id: expect.any(String), label: 'Email', value: 'ann@example.test' }], connections: [{ targetId: 'org', label: 'works at' }] });
    expect(sanitizeIdentity('not an identity')).toBeNull();
  });
});

describe('investigation lifecycle', () => {
  it('archives and unarchives identities with their investigation, and deletes them with it', async () => {
    await seed();
    await db.identities.add(identity('archived-already', { archived: true }));
    await setInvestigationArchived('case', true);
    expect((await db.identities.toArray()).every(row => row.archived)).toBe(true);
    await setInvestigationArchived('case', false);
    expect((await db.identities.get('dana'))?.archived).toBe(false);
    // Identities cannot be archived one by one, so unarchiving the investigation brings every one back,
    // including those archived elsewhere (a 2.0.4 teammate's unarchive leaves them archived).
    expect((await db.identities.get('archived-already'))?.archived).toBe(false);
    await deleteEntitiesWithReferences({ folders: ['case'] }, 'case');
    expect(await db.identities.count()).toBe(0);
  });
});

describe('local encryption', () => {
  it('encrypts identity content at rest and still renames, merges and cascades', async () => {
    setEncryptionMeta({ version: 1, salt: 'fixture-salt', wrappedKey: 'fixture-wrapped', recoverySalt: 'fixture-recovery-salt', recoveryWrappedKey: 'fixture-recovery-key', enabledAt: 1 });
    setSessionKey(await generateMasterKey());
    await seed();
    await db.identities.add(identity('dana-2', { name: 'D Okafor', connections: [{ targetId: 'org', label: 'works at' }] }));
    const raw = await new Promise<Record<string, unknown>>((resolve, reject) => {
      const request = db.backendDB().transaction('identities').objectStore('identities').get('dana');
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    for (const field of ['type', 'name', 'description', 'aliases', 'status', 'contact', 'details', 'connections', 'clsLevel']) expect(isEncryptedEnvelope(raw[field]), field).toBe(true);
    expect(JSON.stringify(raw)).not.toContain('Okafor');
    expect(raw).toMatchObject({ id: 'dana', folderId: 'case', tags: ['client'], trashed: false, archived: false });
    expect(await db.identities.get('dana')).toEqual(dana);

    const { result } = renderHook(() => useIdentities('case'));
    await waitFor(() => expect(result.current.loadedSuccessfully).toBe(true));
    await act(async () => { await result.current.updateIdentity('dana-2', { name: 'Dana O.' }); });
    expect((await db.identities.get('dana-2'))?.aliases).toEqual(['D Okafor']);
    await act(async () => { await result.current.mergeIdentities('dana', 'dana-2'); });
    expect((await db.identities.get('dana'))?.aliases).toEqual(['D. Okafor', 'Dana O.', 'D Okafor']);
    await act(async () => { await result.current.deleteIdentity('org'); });
    expect((await db.identities.get('dana'))?.connections).toEqual([]);
  });
});

describe('workspace recovery archives', () => {
  const password = 'a synthetic recovery phrase';
  const archive = (databaseVersion: number, names: string[]) => ({ version: 1, kind: 'threatcaddy-workspace-recovery', databaseVersion,
    data: Object.fromEntries(names.map(name => [name, name === 'folders' ? [folder] : []])) as Record<string, unknown[]> });
  const names = () => db.tables.map(table => table.name);

  it('restores a version 34 archive, which has no identities store', async () => {
    const blob = await encryptBackup(password, archive(34, names().filter(name => name !== 'identities')));
    expect(await restoreSyncRecovery(password, blob, true)).toBe(1);
    expect(await db.folders.toArray()).toEqual([folder]);
  });

  it('restores identities from a version 35 archive', async () => {
    const data = archive(35, names());
    data.data.identities = [dana];
    expect(await restoreSyncRecovery(password, await encryptBackup(password, data), true)).toBe(2);
    expect(await db.identities.toArray()).toEqual([dana]);
  });

  it('rejects archives whose stores do not match their version', async () => {
    for (const bad of [archive(34, names()), archive(35, names().filter(name => name !== 'identities')), archive(33, names().filter(name => name !== 'identities'))]) {
      await expect(restoreSyncRecovery(password, await encryptBackup(password, bad), true)).rejects.toThrow('Unsupported workspace recovery archive.');
    }
  });
});

describe('scale', () => {
  // Real-browser timings for 5,000 and 20,000 identities are in the phase records; here fake
  // IndexedDB rewrites rows slowly, so the test checks the bulk path without time limits.
  it('loads 2,000 identities in one investigation and removes a connection target from all of them', async () => {
    await db.folders.add(folder);
    const people = Array.from({ length: 2000 }, (_, index) => identity(`person-${index}`, {
      name: `Synthetic Person ${index}`, details: [{ id: `email-${index}`, label: 'Email', value: `person${index}@example.test` }],
      connections: [{ targetId: 'org', label: 'works at' }],
    }));
    await db.identities.bulkAdd([org, ...people]);
    const { result } = renderHook(() => useIdentities('case'));
    await waitFor(() => expect(result.current.loadedSuccessfully).toBe(true), { timeout: 30_000 });
    expect(result.current.identities).toHaveLength(2001);
    await act(async () => { await result.current.deleteIdentity('org'); });
    expect((await db.identities.toArray()).every(row => row.connections.length === 0)).toBe(true);
  }, 120_000);
});
