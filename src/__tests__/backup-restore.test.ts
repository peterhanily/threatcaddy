/* eslint-disable @typescript-eslint/no-explicit-any */
import { beforeEach, describe, expect, it } from 'vitest';
import { db } from '../db';
import type { BackupPayload, EncryptedBackupBlob } from '../lib/backup-crypto';
import { BACKUP_TABLES } from '../lib/backup-tables';
import { buildDifferentialPayload, buildFullBackupPayload } from '../lib/backup-data';
import { previewRestore, restoreFullReplace, restoreMerge } from '../lib/backup-restore';

function makePayload(overrides: Partial<BackupPayload> = {}): BackupPayload {
  return { version: 1, type: 'full', scope: 'all', createdAt: 10000, data: {}, ...overrides };
}
function makeNote(id: string, updatedAt = 1000, folderId?: string) {
  return { id, title: `Note ${id}`, content: 'Preserved analyst text', tags: [], pinned: false,
    archived: false, trashed: false, createdAt: 100, updatedAt, folderId };
}
function makeTask(id: string, updatedAt = 1000, folderId?: string) {
  return { id, title: `Task ${id}`, completed: false, priority: 'none' as const, tags: [],
    status: 'todo' as const, order: 0, trashed: false, archived: false, createdAt: 100, updatedAt, folderId };
}
async function snapshot() {
  return Promise.all(BACKUP_TABLES.map(async name => [name, await db.table(name).toArray()]));
}

beforeEach(async () => {
  await db.transaction('rw', BACKUP_TABLES.map(name => db.table(name)), async () => {
    for (const name of BACKUP_TABLES) await db.table(name).clear();
  });
});

describe('restore with the real application Dexie schema', () => {
  it('preserves absent tables but clears an explicitly empty table', async () => {
    await db.notes.add(makeNote('n'));
    await db.tasks.add(makeTask('t'));
    expect(await restoreFullReplace(makePayload())).toEqual({ added: 0, updated: 0, deleted: 0, tables: [] });
    const preview = await previewRestore(makePayload({ data: { notes: [] } }));
    expect(preview).toMatchObject({ added: 0, updated: 0, deleted: 1 });
    expect(await db.notes.count()).toBe(1);
    const result = await restoreFullReplace(makePayload({ data: { notes: [] } }), preview);
    expect(result).toMatchObject({ deleted: 1, tables: ['notes'] });
    expect(await db.notes.count()).toBe(0);
    expect(await db.tasks.get('t')).toEqual(makeTask('t'));
  });

  it('replaces investigation A while retaining investigation B and shared metadata', async () => {
    const a = { id: 'A', name: 'A', order: 0, createdAt: 100 };
    const b = { id: 'B', name: 'B', order: 1, createdAt: 100, timelineId: 'shared' };
    await db.folders.bulkAdd([a, b]);
    await db.notes.bulkAdd([makeNote('a-old', 1000, 'A'), { ...makeNote('b', 1000, 'B'), tags: ['shared'] }]);
    const sharedTag = { id: 'tag', name: 'shared', color: '#aabbcc' };
    const sharedTimeline = { id: 'shared', name: 'Live timeline', order: 0, createdAt: 100, updatedAt: 1000 };
    await db.tags.add(sharedTag);
    await db.timelines.add(sharedTimeline);
    const payload = makePayload({ scope: 'investigation', scopeId: 'A', data: {
      folders: [{ ...a, name: 'Recovered A' }], notes: [makeNote('a-new', 500, 'A')], tasks: [],
      tags: [{ ...sharedTag, color: '#000000' }], timelines: [{ ...sharedTimeline, name: 'Old title' }],
    } });
    const preview = await previewRestore(payload);
    expect(preview).toMatchObject({ added: 1, updated: 1, deleted: 1, sharedPreserved: 2 });
    await restoreFullReplace(payload, preview);
    expect(await db.notes.get('a-old')).toBeUndefined();
    expect(await db.notes.get('a-new')).toEqual(makeNote('a-new', 500, 'A'));
    expect(await db.notes.get('b')).toEqual({ ...makeNote('b', 1000, 'B'), tags: ['shared'] });
    expect(await db.folders.get('B')).toEqual(b);
    expect(await db.tags.get('tag')).toEqual(sharedTag);
    expect(await db.timelines.get('shared')).toEqual(sharedTimeline);
  });

  it('scopes empty agent and evidence tables by investigationId or folderId', async () => {
    for (const name of ['agentActions', 'agentDeployments', 'agentMeetings', 'evidenceItems'] as const) {
      const field = name === 'evidenceItems' ? 'folderId' : 'investigationId';
      await db.table(name).bulkAdd([{ id: 'a', [field]: 'A' }, { id: 'b', [field]: 'B' }]);
    }
    await restoreFullReplace(makePayload({ scope: 'investigation', scopeId: 'A', data: {
      agentActions: [], agentDeployments: [], agentMeetings: [], evidenceItems: [],
    } }));
    for (const name of ['agentActions', 'agentDeployments', 'agentMeetings', 'evidenceItems'] as const) {
      expect((await db.table(name).toArray()).map(row => row.id)).toEqual(['b']);
    }
  });

  it('replaces only the identified entity, including IDs containing colons', async () => {
    await db.notes.bulkAdd([makeNote('one:part'), makeNote('two')]);
    const payload = makePayload({ scope: 'entity', scopeId: 'notes:one:part', data: { notes: [{ ...makeNote('one:part'), title: 'Recovered' }] } });
    expect((await buildFullBackupPayload('entity', 'notes:one:part')).data.notes).toEqual([makeNote('one:part')]);
    await restoreFullReplace(payload);
    expect((await db.notes.get('one:part'))?.title).toBe('Recovered');
    expect(await db.notes.get('two')).toEqual(makeNote('two'));
  });

  it('can clear the selected entity without clearing its table', async () => {
    await db.notes.bulkAdd([makeNote('one'), makeNote('two')]);
    await restoreFullReplace(makePayload({ scope: 'entity', scopeId: 'notes:one', data: { notes: [] } }));
    expect((await db.notes.toArray()).map(row => row.id)).toEqual(['two']);
  });

  it.each([
    { data: { notes: [{ title: 'Missing ID' }] } },
    { data: { notes: [makeNote('same'), makeNote('same')] } },
    { data: { notes: 'not an array' } },
    { data: { unknownTable: [] } },
    { scope: 'investigation', data: { notes: [] } },
    { scope: 'entity', scopeId: 'notes', data: {} },
    { scope: 'entity', scopeId: 'notes:one', data: { notes: [makeNote('two')] } },
    { scope: 'investigation', scopeId: 'A', data: { notes: [makeNote('b', 1000, 'B')] } },
    { scope: 'investigation', scopeId: 'A', data: { agentProfiles: [] } },
  ])('rejects an invalid complete plan before deleting any data: %j', async invalid => {
    await db.notes.add(makeNote('preserved'));
    const before = await snapshot();
    await expect(restoreFullReplace(makePayload(invalid as any))).rejects.toThrow();
    expect(await snapshot()).toEqual(before);
  });

  it('refuses to claim an existing ID from a different investigation', async () => {
    await db.notes.add(makeNote('shared-id', 1000, 'B'));
    await expect(restoreFullReplace(makePayload({ scope: 'investigation', scopeId: 'A',
      data: { notes: [makeNote('shared-id', 1000, 'A')] } }))).rejects.toThrow('another scope');
    expect((await db.notes.get('shared-id'))?.folderId).toBe('B');
  });

  it('rejects a deletion that would break another investigation’s link', async () => {
    await db.notes.bulkAdd([makeNote('a', 1000, 'A'), { ...makeNote('b', 1000, 'B'), linkedNoteIds: ['a'] }]);
    const before = await snapshot();
    await expect(restoreFullReplace(makePayload({ scope: 'investigation', scopeId: 'A', data: { notes: [] } })))
      .rejects.toThrow('retained reference');
    expect(await snapshot()).toEqual(before);
  });

  it('protects references from newly restored rows too', async () => {
    await db.notes.add(makeNote('old'));
    await expect(restoreFullReplace(makePayload({ data: {
      notes: [{ ...makeNote('new'), linkedNoteIds: ['old'] }],
    } }))).rejects.toThrow('retained reference');
    expect(await db.notes.get('old')).toBeDefined();
    expect(await db.notes.get('new')).toBeUndefined();
  });

  it('protects nested IOC and agent references using the shared relation registry', async () => {
    const note = { ...makeNote('source'), iocAnalysis: { extractedAt: 1, iocs: [{ id: 'embedded', type: 'domain' as const,
      value: 'example.test', confidence: 'high' as const, firstSeen: 1, dismissed: false }] } };
    await db.notes.add(note);
    await db.table('standaloneIOCs').add({ id: 'retained', relationships: [{ targetIOCId: 'embedded', relationshipType: 'related-to' }] });
    await expect(restoreFullReplace(makePayload({ data: { notes: [makeNote('source')] } }))).rejects.toThrow('retained reference');
    expect((await db.notes.get('source'))?.iocAnalysis?.iocs[0].id).toBe('embedded');
    await db.table('agentProfiles').add({ id: 'profile' });
    await db.table('agentDeployments').add({ id: 'deployment', profileId: 'profile' });
    await expect(restoreFullReplace(makePayload({ data: { agentProfiles: [] } }))).rejects.toThrow('retained reference');
    expect(await db.agentProfiles.get('profile')).toBeDefined();
  });

  it('refuses to rename a shared tag or delete a referenced tag', async () => {
    await db.tags.add({ id: 'tag', name: 'keep', color: '#123456' });
    await db.notes.add({ ...makeNote('n'), tags: ['keep'] });
    await expect(restoreFullReplace(makePayload({ scope: 'investigation', scopeId: 'A',
      data: { tags: [{ id: 'tag', name: 'renamed', color: '#000000' }] } }))).rejects.toThrow('different name');
    await expect(restoreFullReplace(makePayload({ data: { tags: [] } }))).rejects.toThrow('tag still used');
    expect((await db.tags.get('tag'))?.name).toBe('keep');
  });

  it('refuses a stale preview and requires a fresh review', async () => {
    await db.notes.add(makeNote('n'));
    const payload = makePayload({ data: { notes: [] } });
    const preview = await previewRestore(payload);
    await db.notes.update('n', { content: 'New analyst work', updatedAt: 2000 });
    await expect(restoreFullReplace(payload, preview)).rejects.toThrow('Data changed after');
    expect((await db.notes.get('n'))?.content).toBe('New analyst work');
    await restoreFullReplace(payload, await previewRestore(payload));
    expect(await db.notes.count()).toBe(0);
  });

  it('rolls all tables back when a later write fails', async () => {
    await db.notes.add(makeNote('old'));
    await db.tasks.add(makeTask('old-task'));
    const before = await snapshot();
    const fail = () => { throw new DOMException('Synthetic storage full', 'QuotaExceededError'); };
    db.tasks.hook('creating', fail);
    try {
      await expect(restoreFullReplace(makePayload({ data: {
        notes: [makeNote('new')], tasks: [makeTask('new-task')],
      } }))).rejects.toThrow('rolled back');
    } finally { db.tasks.hook('creating').unsubscribe(fail); }
    expect(await snapshot()).toEqual(before);
  });

  it('merge adds new records, updates only newer revisions and retains newer local data', async () => {
    await db.notes.bulkAdd([makeNote('newer', 3000), makeNote('older', 1000), makeNote('same', 2000)]);
    const result = await restoreMerge(makePayload({ data: { notes: [
      makeNote('newer', 2000), makeNote('older', 2000), makeNote('same', 2000), makeNote('new', 2000),
    ] } }));
    expect(result).toMatchObject({ added: 1, updated: 1, deleted: 0 });
    expect((await db.notes.get('newer'))?.updatedAt).toBe(3000);
    expect((await db.notes.get('older'))?.updatedAt).toBe(2000);
  });

  it('rejects out-of-scope and contradictory differential deletions atomically', async () => {
    await db.notes.bulkAdd([makeNote('a', 1000, 'A'), makeNote('b', 1000, 'B')]);
    await db.folders.add({ id: 'A', name: 'A', order: 0, createdAt: 100 });
    const parent = await buildFullBackupPayload('investigation', 'A');
    const delta = await buildDifferentialPayload('investigation', parent, 'parent', 'A');
    const before = await snapshot();
    await expect(restoreMerge({ ...delta, deletedIds: { notes: ['b'] } }, undefined, parent)).rejects.toThrow('outside the backup scope');
    await expect(restoreMerge({ ...delta, data: { notes: [makeNote('a', 2000, 'A')] }, deletedIds: { notes: ['a'] } }, undefined, parent))
      .rejects.toThrow('both restores and deletes');
    expect(await snapshot()).toEqual(before);
  });

  it('counts only existing differential deletions and preserves other entities', async () => {
    await db.notes.bulkAdd([makeNote('old'), makeNote('keep')]);
    const parent = await buildFullBackupPayload('all');
    await db.notes.delete('old');
    const delta = await buildDifferentialPayload('all', parent, 'parent');
    await restoreFullReplace(parent);
    const result = await restoreMerge({ ...delta, deletedIds: { notes: ['old', 'absent'] } }, undefined, parent);
    expect(result).toMatchObject({ deleted: 1, tables: ['notes'] });
    expect(await db.notes.get('keep')).toBeDefined();
  });

  it('cannot export internal sync data through an entity table name', async () => {
    await expect(buildFullBackupPayload('entity', '_syncQueue:1')).rejects.toThrow('supported table');
  });
});
describe('backup encryption/decryption round-trip', () => {
  // These tests import the real crypto functions and exercise the
  // encrypt -> decrypt pipeline end-to-end using the Web Crypto API.

  it('encrypts and decrypts a full backup payload', async () => {
    const { encryptBackup, decryptBackup } = await import('../lib/backup-crypto');

    const payload: BackupPayload = {
      version: 1,
      type: 'full',
      scope: 'all',
      createdAt: 1700000000000,
      data: {
        notes: [makeNote('n1', 1000), makeNote('n2', 2000)],
        tasks: [makeTask('t1', 3000)],
      },
    };

    const password = 'test-password-123!';
    const blob = await encryptBackup(password, payload);

    expect(blob.v).toBe(1);
    expect(typeof blob.salt).toBe('string');
    expect(typeof blob.iv).toBe('string');
    expect(typeof blob.ct).toBe('string');

    const decrypted = await decryptBackup(password, blob);
    expect(decrypted).toEqual(payload);
  });

  it('encrypts and decrypts a differential backup with deletedIds', async () => {
    const { encryptBackup, decryptBackup } = await import('../lib/backup-crypto');

    const payload: BackupPayload = {
      version: 1,
      type: 'differential',
      scope: 'all',
      parentBackupId: 'parent-1',
      createdAt: Date.now(),
      lastBackupAt: Date.now() - 3600000,
      data: {
        notes: [makeNote('n-new', 5000)],
      },
      deletedIds: {
        notes: ['n-old-1', 'n-old-2'],
        tasks: ['t-old-1'],
      },
    };

    const password = 'differential-pass';
    const blob = await encryptBackup(password, payload);
    const decrypted = await decryptBackup(password, blob);
    expect(decrypted).toEqual(payload);
  });

  it('encrypts and decrypts an empty data payload', async () => {
    const { encryptBackup, decryptBackup } = await import('../lib/backup-crypto');

    const payload: BackupPayload = {
      version: 1,
      type: 'full',
      scope: 'all',
      createdAt: Date.now(),
      data: {},
    };

    const blob = await encryptBackup('empty-pass', payload);
    const decrypted = await decryptBackup('empty-pass', blob);
    expect(decrypted).toEqual(payload);
  });

  it('fails to decrypt with wrong password', async () => {
    const { encryptBackup, decryptBackup } = await import('../lib/backup-crypto');

    const payload = makePayload({ data: { notes: [makeNote('n1', 1000)] } });
    const blob = await encryptBackup('correct-password', payload);

    await expect(decryptBackup('wrong-password', blob)).rejects.toThrow(
      'Wrong password or corrupted backup',
    );
  });

  it('produces different ciphertext for same payload encrypted twice', async () => {
    const { encryptBackup } = await import('../lib/backup-crypto');

    const payload = makePayload({ data: { notes: [makeNote('n1', 1000)] } });
    const blob1 = await encryptBackup('same-pass', payload);
    const blob2 = await encryptBackup('same-pass', payload);

    // Different salt and IV should produce different ciphertext
    expect(blob1.ct).not.toBe(blob2.ct);
  });

  it('rejects unsupported backup format version', async () => {
    const { decryptBackup } = await import('../lib/backup-crypto');

    const fakeBlob: EncryptedBackupBlob = {
      v: 99 as any, // wrong version
      salt: 'abc',
      iv: 'def',
      ct: 'ghi',
    };

    await expect(decryptBackup('any-password', fakeBlob)).rejects.toThrow(
      'Unsupported backup format version',
    );
  });

  it('preserves all payload fields through encryption round-trip', async () => {
    const { encryptBackup, decryptBackup } = await import('../lib/backup-crypto');

    const payload: BackupPayload = {
      version: 1,
      type: 'differential',
      scope: 'investigation',
      scopeId: 'folder-abc',
      parentBackupId: 'backup-parent-xyz',
      createdAt: 1700000000000,
      lastBackupAt: 1699990000000,
      data: {
        notes: [makeNote('n1', 1000)],
        tasks: [],
        folders: [{ id: 'f1', name: 'Test', order: 0, createdAt: 1000 }] as any,
        tags: [{ id: 'tg1', name: 'urgent', color: '#ff0000' }] as any,
        timelineEvents: [],
        timelines: [],
        whiteboards: [],
        standaloneIOCs: [],
        chatThreads: [],
      },
      deletedIds: {
        notes: ['n-deleted'],
        tasks: ['t-deleted-1', 't-deleted-2'],
      },
    };

    const blob = await encryptBackup('full-field-test', payload);
    const decrypted = await decryptBackup('full-field-test', blob);

    expect(decrypted.version).toBe(1);
    expect(decrypted.type).toBe('differential');
    expect(decrypted.scope).toBe('investigation');
    expect(decrypted.scopeId).toBe('folder-abc');
    expect(decrypted.parentBackupId).toBe('backup-parent-xyz');
    expect(decrypted.createdAt).toBe(1700000000000);
    expect(decrypted.lastBackupAt).toBe(1699990000000);
    expect(decrypted.data.notes).toHaveLength(1);
    expect(decrypted.data.tasks).toHaveLength(0);
    expect(decrypted.data.folders).toHaveLength(1);
    expect(decrypted.data.tags).toHaveLength(1);
    expect(decrypted.deletedIds?.notes).toEqual(['n-deleted']);
    expect(decrypted.deletedIds?.tasks).toEqual(['t-deleted-1', 't-deleted-2']);
  });

  it('EncryptedBackupBlob has the correct shape', async () => {
    const { encryptBackup } = await import('../lib/backup-crypto');

    const payload = makePayload({ data: {} });
    const blob = await encryptBackup('shape-test', payload);

    expect(blob).toHaveProperty('v', 1);
    expect(blob).toHaveProperty('salt');
    expect(blob).toHaveProperty('iv');
    expect(blob).toHaveProperty('ct');

    // All fields should be strings (base64-encoded)
    expect(typeof blob.salt).toBe('string');
    expect(typeof blob.iv).toBe('string');
    expect(typeof blob.ct).toBe('string');
    expect(blob.salt.length).toBeGreaterThan(0);
    expect(blob.iv.length).toBeGreaterThan(0);
    expect(blob.ct.length).toBeGreaterThan(0);
  });
});

// ── RestoreResult structure ────────────────────────────────────────
