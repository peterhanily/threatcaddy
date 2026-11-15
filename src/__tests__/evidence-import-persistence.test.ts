import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { db } from '../db';
import { createEvidenceImportPersistence } from '../lib/evidence-import-persistence';
import type { EvidenceItemDraft } from '../lib/evidence-import';
import { clearEncryptionMeta, setEncryptionMeta } from '../lib/encryptionStore';
import { setSessionKey } from '../lib/encryptionMiddleware';
import { generateMasterKey, isEncryptedEnvelope } from '../lib/crypto';
import { disableSync } from '../lib/sync-state';

const metadata = { version: 1 as const, salt: 'fixture', wrappedKey: 'fixture', recoverySalt: 'fixture', recoveryWrappedKey: 'fixture', enabledAt: 1 };
const draft = (name: string): EvidenceItemDraft => ({ title: name, fileName: name, fileType: 'text', size: 8,
  content: 'Synthetic evidence', tags: [], extractionStatus: 'extracted', importedAt: 1, chunkIndex: 1, chunkCount: 1 });
const persist = (signal = new AbortController().signal, assertCurrentScope = () => {}) =>
  createEvidenceImportPersistence({ folderId: 'case', signal, assertCurrentScope });

beforeEach(async () => {
  clearEncryptionMeta(); setSessionKey(null); disableSync();
  await db.table('_syncMeta').clear(); await db.table('_syncQueue').clear();
  await db.evidenceItems.clear(); await db.folders.clear();
  await db.folders.add({ id: 'case', name: 'Synthetic case', order: 1, createdAt: 1, clsLevel: 'TLP:CLEAR' });
});
afterEach(() => { vi.restoreAllMocks(); clearEncryptionMeta(); setSessionKey(null); disableSync(); });

describe('evidence import commit boundary', () => {
  it('commits all chunks with the current destination classification', async () => {
    const write = persist();
    await db.folders.update('case', { clsLevel: 'TLP:RED' });
    const created = await write([draft('one.txt'), draft('two.txt')]);
    expect(created).toHaveLength(2);
    expect(new Set(created.map(item => item.id)).size).toBe(2);
    expect(await db.evidenceItems.count()).toBe(2);
    for (const item of created) expect(item).toMatchObject({ folderId: 'case', clsLevel: 'TLP:RED' });
  });

  it.each(['deleted', 'archived'])('rejects a destination that was %s while parsing', async state => {
    const write = persist();
    if (state === 'deleted') await db.folders.delete('case');
    else await db.folders.update('case', { status: 'archived' });
    await expect(write([draft('one.txt')])).rejects.toThrow('no longer available');
    expect(await db.evidenceItems.count()).toBe(0);
  });

  it('rejects a changed view owner, cancelled work and a changed session before writing', async () => {
    let current = true;
    const write = persist(undefined, () => { if (!current) throw new Error('Scope changed'); });
    current = false;
    await expect(write([draft('one.txt')])).rejects.toThrow('Scope changed');
    const cancelled = new AbortController();
    const other = persist(cancelled.signal); cancelled.abort();
    await expect(other([draft('two.txt')])).rejects.toMatchObject({ name: 'AbortError' });
    const session = persist(); setSessionKey(null);
    await expect(session([draft('three.txt')])).rejects.toThrow('session changed');
    expect(await db.evidenceItems.count()).toBe(0);
  });

  it('refuses parsing ownership in a locked workspace', () => {
    setEncryptionMeta(metadata);
    expect(() => persist()).toThrow('session changed');
  });

  it('rolls back every chunk and outbox entry if cancellation arrives during persistence', async () => {
    await db.table('_syncMeta').put({ key: 'syncWorkspaceIdentityV1', value: { version: 1, serverUrl: 'https://test.invalid', userId: 'fixture-user' } });
    const abort = new AbortController();
    const original = db.evidenceItems.bulkAdd.bind(db.evidenceItems);
    vi.spyOn(db.evidenceItems, 'bulkAdd').mockImplementation((...args: Parameters<typeof db.evidenceItems.bulkAdd>) =>
      original(...args).then(result => { abort.abort(); return result; }));
    await expect(persist(abort.signal)([draft('one.txt'), draft('two.txt')])).rejects.toThrow();
    expect(await db.evidenceItems.count()).toBe(0);
    expect(await db.table('_syncQueue').count()).toBe(0);
  });

  it('rolls back a partially successful bulk write instead of leaving the first document', async () => {
    const add = db.evidenceItems.add.bind(db.evidenceItems);
    vi.spyOn(db.evidenceItems, 'bulkAdd').mockImplementation(items => add(items[0]).then(() => {
      throw new Error('Synthetic storage failure');
    }));
    await expect(persist()([draft('one.txt'), draft('two.txt')])).rejects.toThrow('Synthetic storage failure');
    expect(await db.evidenceItems.count()).toBe(0);
  });

  it('persists encrypted content and durable sync together, without undoing a committed import on later cancellation', async () => {
    setEncryptionMeta(metadata); setSessionKey(await generateMasterKey());
    await db.folders.put({ id: 'case', name: 'Synthetic case', order: 1, createdAt: 1, clsLevel: 'TLP:RED' });
    await db.table('_syncMeta').put({ key: 'syncWorkspaceIdentityV1', value: { version: 1, serverUrl: 'https://test.invalid', userId: 'fixture-user' } });
    const abort = new AbortController();
    const created = await persist(abort.signal)([draft('one.txt'), draft('two.txt')]);
    abort.abort();
    expect(await db.evidenceItems.count()).toBe(2);
    const raw = await new Promise<{ content: unknown }>((resolve, reject) => {
      const request = db.backendDB().transaction('evidenceItems').objectStore('evidenceItems').get(created[0].id);
      request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error);
    });
    expect(isEncryptedEnvelope(raw.content)).toBe(true);
    expect(await db.table('_syncQueue').count()).toBe(2);
  });
});
