import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { db } from '../db';
import { fileNotePersistence } from '../lib/file-note-persistence';
import { clearEncryptionMeta, setEncryptionMeta } from '../lib/encryptionStore';
import { setSessionKey } from '../lib/encryptionMiddleware';
import { generateMasterKey, isEncryptedEnvelope } from '../lib/crypto';
import { disableSync } from '../lib/sync-state';
import type { Note } from '../types';

const note = (): Note => ({ id: 'file-note', title: 'Fictional file', content: '# Fictional content', tags: [],
  pinned: false, archived: false, trashed: false, createdAt: 1, updatedAt: 1, folderId: 'case', clsLevel: 'TLP:CLEAR' });
const metadata = { version: 1 as const, salt: 'fixture', wrappedKey: 'fixture', recoverySalt: 'fixture', recoveryWrappedKey: 'fixture', enabledAt: 1 };
beforeEach(async () => {
  clearEncryptionMeta(); setSessionKey(null); disableSync();
  await db.table('_syncMeta').clear(); await db.table('_syncQueue').clear();
  await db.notes.clear(); await db.folders.clear();
  await db.folders.add({ id: 'case', name: 'Fictional case', order: 1, createdAt: 1, clsLevel: 'TLP:RED' });
});
afterEach(() => { vi.restoreAllMocks(); clearEncryptionMeta(); setSessionKey(null); disableSync(); });

describe('file import commit boundary', () => {
  it('resolves current destination classification instead of stale startup state', async () => {
    const input = note(); await fileNotePersistence(new AbortController().signal)(input);
    expect(await db.notes.get(input.id)).toMatchObject({ clsLevel: 'TLP:RED', content: input.content });
    expect(input.clsLevel).toBe('TLP:RED');
  });
  it('refuses a deleted destination without creating an orphan note', async () => {
    await db.folders.delete('case');
    await expect(fileNotePersistence(new AbortController().signal)(note())).rejects.toThrow('no longer exists');
    expect(await db.notes.count()).toBe(0);
  });
  it('rejects before writing when locked or already cancelled', async () => {
    const abort = new AbortController(); abort.abort();
    await expect(fileNotePersistence(abort.signal)(note())).rejects.toMatchObject({ name: 'AbortError' });
    setEncryptionMeta(metadata);
    await expect(fileNotePersistence(new AbortController().signal)(note())).rejects.toThrow('Unlock');
    expect(await db.notes.count()).toBe(0);
  });
  it('rolls back both the note and signed-out durable outbox when aborted during writing', async () => {
    await db.table('_syncMeta').put({ key: 'syncWorkspaceIdentityV1', value: { version: 1, serverUrl: 'https://test.invalid', userId: 'fixture-user' } });
    const abort = new AbortController(); const add = db.notes.add.bind(db.notes);
    vi.spyOn(db.notes, 'add').mockImplementation(value => add(value).then(id => { abort.abort(); return id; }));
    await expect(fileNotePersistence(abort.signal)(note())).rejects.toThrow();
    expect(await db.notes.count()).toBe(0); expect(await db.table('_syncQueue').count()).toBe(0);
  });
  it('commits encrypted content and outbox together; later cancellation cannot undo success', async () => {
    const key = await generateMasterKey(); setSessionKey(key);
    // Seed the folder through encryption middleware before marking protection enabled.
    await db.folders.put({ id: 'case', name: 'Fictional case', order: 1, createdAt: 1, clsLevel: 'TLP:RED' });
    setEncryptionMeta(metadata);
    await db.table('_syncMeta').put({ key: 'syncWorkspaceIdentityV1', value: { version: 1, serverUrl: 'https://test.invalid', userId: 'fixture-user' } });
    const abort = new AbortController(); await fileNotePersistence(abort.signal)(note()); abort.abort();
    expect(await db.notes.get('file-note')).toMatchObject({ clsLevel: 'TLP:RED' });
    const raw = await new Promise<Note>((resolve, reject) => {
      const read = db.backendDB().transaction('notes').objectStore('notes').get('file-note');
      read.onsuccess = () => resolve(read.result); read.onerror = () => reject(read.error);
    });
    expect(isEncryptedEnvelope(raw.content)).toBe(true);
    expect(await db.table('_syncQueue').count()).toBe(1);
  });
});
