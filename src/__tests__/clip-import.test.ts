import Dexie from 'dexie';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { db } from '../db';
import { createClipImportService, importClipBatch } from '../lib/clip-import';
import { CLIP_LIMITS, createClipRevision, type ClipContent, type ClipReceipt } from '../lib/clip-protocol';
import { getActiveWorkspaceId } from '../lib/workspace-profiles';
import { clearEncryptionMeta, setEncryptionMeta } from '../lib/encryptionStore';
import { setSessionKey } from '../lib/encryptionMiddleware';
import { generateMasterKey, isEncryptedEnvelope } from '../lib/crypto';
import { disableSync } from '../lib/sync-state';

const stores = ['folders', 'notes', 'tasks', 'timelineEvents', 'timelines', 'activityLog', '_clipReceipts', '_syncQueue', '_syncMeta'];
const options = () => ({ sourceId: 'synthetic-installation', workspaceId: getActiveWorkspaceId(), createdBy: 'Synthetic analyst' });
const content = (patch: Partial<ClipContent> = {}): ClipContent => ({ id: 'clip-one', revision: 1, title: 'Synthetic title',
  content: 'Fictional reference example.com', sourceUrl: 'https://example.com/article', sourceTitle: 'Synthetic source',
  entityType: 'note', folderName: 'Research clips', clsLevel: '', createdAt: 1_700_000_000_000, ...patch });
const makeClip = (patch: Partial<ClipContent> = {}) => createClipRevision(content(patch));
const peers: Dexie[] = [];
async function counts() { return Object.fromEntries(await Promise.all(stores.map(async name => [name, await db.table(name).count()]))); }
async function raw(table: string, id: IDBValidKey): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    const request = db.backendDB().transaction(table).objectStore(table).get(id);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}
beforeEach(async () => {
  disableSync(); clearEncryptionMeta(); setSessionKey(null);
  await db.transaction('rw', stores.map(name => db.table(name)), async () => {
    for (const name of stores) await db.table(name).clear();
  });
});
afterEach(() => {
  vi.restoreAllMocks();
  for (const peer of peers.splice(0)) peer.close();
  disableSync(); clearEncryptionMeta(); setSessionKey(null);
});

describe('durable clip import into the actual workspace database', () => {
  it('commits note, folder, content-free activity and minimal receipt together, preserving rendering/classification/IOCs', async () => {
    await db.folders.add({ id: 'existing-case', name: 'Research clips', order: 1, createdAt: 1, clsLevel: 'TLP:AMBER' });
    const clip = await makeClip();
    const [result] = await importClipBatch([clip], { ...options(), enabledIOCTypes: ['domain'], defaultConfidence: 'high' });
    expect(result).toMatchObject({ status: 'imported', entityType: 'note', folderId: 'existing-case' });
    const note = await db.notes.get(result.entityId ?? '');
    expect(note).toMatchObject({ title: clip.sourceUrl, sourceUrl: clip.sourceUrl, sourceTitle: clip.sourceTitle,
      createdAt: clip.createdAt, clsLevel: 'TLP:AMBER', createdBy: 'Synthetic analyst' });
    expect(note?.content).toBe(`*Clipped ${new Date(clip.createdAt).toLocaleString()}*\n\n${clip.content}`);
    expect(note?.iocTypes).toContain('domain');
    expect(note?.iocAnalysis?.iocs.every(ioc => ioc.confidence === 'high')).toBe(true);
    const [receipt] = await db.table<ClipReceipt>('_clipReceipts').toArray();
    expect(Object.keys(receipt).sort()).toEqual(['key', 'sourceId', 'clipId', 'revision', 'fingerprint', 'entityType', 'entityId', 'folderId', 'committedAt'].sort());
    expect(JSON.stringify(await db.activityLog.toArray())).not.toContain(clip.content);
    expect((await counts()).folders).toBe(1);
  });

  it('creates tasks and events using existing defaults, and supplies a real timeline when none exists', async () => {
    const clips = await Promise.all([makeClip({ id: 'task', entityType: 'task', clsLevel: 'TLP:CLEAR' }), makeClip({ id: 'event', entityType: 'timeline-event' })]);
    expect((await importClipBatch(clips, options())).map(result => result.status)).toEqual(['imported', 'imported']);
    expect(await db.tasks.toArray()).toEqual([expect.objectContaining({ title: 'Synthetic title', status: 'todo', priority: 'none', completed: false, clsLevel: 'TLP:CLEAR', order: 1 })]);
    const [event] = await db.timelineEvents.toArray();
    expect(event).toMatchObject({ title: 'Synthetic title', eventType: 'evidence', confidence: 'medium', source: content().sourceUrl });
    expect(await db.timelines.get(event.timelineId)).toMatchObject({ name: 'Clips' });
    expect(await db.folders.count()).toBe(1);
  });

  it('returns a duplicate after a lost acknowledgement without modifying analyst edits or creating another activity', async () => {
    const clip = await makeClip();
    const [first] = await importClipBatch([clip], options());
    await db.notes.update(first.entityId ?? '', { content: 'Analyst-owned edit', folderId: 'moved-case' });
    const [retry] = await importClipBatch([clip], options());
    expect(retry).toMatchObject({ status: 'duplicate', entityId: first.entityId, folderId: 'moved-case' });
    expect((await db.notes.get(first.entityId ?? ''))?.content).toBe('Analyst-owned edit');
    expect(await db.notes.count()).toBe(1);
    expect(await db.activityLog.count()).toBe(1);
  });

  it('serializes concurrent delivery through separate same-workspace connections', async () => {
    const peer = new Dexie(db.name); peers.push(peer);
    const peerImport = createClipImportService(peer);
    await peer.open();
    const clip = await makeClip();
    const results = await Promise.all([importClipBatch([clip], options()), peerImport([clip], options())]);
    expect(results.flat().map(result => result.status).sort()).toEqual(['duplicate', 'imported']);
    expect(new Set(results.flat().map(result => result.entityId)).size).toBe(1);
    expect(await counts()).toMatchObject({ folders: 1, notes: 1, activityLog: 1, _clipReceipts: 1 });
  });

  it('rejects changed content under the same revision, and imports a new revision without overwriting the old entity', async () => {
    const clip = await makeClip();
    const [first] = await importClipBatch([clip], options());
    const [conflict] = await importClipBatch([await makeClip({ content: 'Edited capture' })], options());
    expect(conflict).toMatchObject({ status: 'failed', error: expect.stringMatching(/different content/) });
    const [newer] = await importClipBatch([await makeClip({ revision: 2, content: 'Edited capture' })], options());
    expect(newer.status).toBe('imported');
    expect(newer.entityId).not.toBe(first.entityId);
    expect(await db.notes.count()).toBe(2);
    expect((await db.notes.get(first.entityId ?? ''))?.content).toContain(clip.content);
  });

  it('does not confirm an old receipt whose entity was removed by deletion or restore', async () => {
    const clip = await makeClip();
    const [first] = await importClipBatch([clip], options());
    await db.notes.delete(first.entityId ?? '');
    expect(await importClipBatch([clip], options())).toEqual([expect.objectContaining({ status: 'failed', error: expect.stringMatching(/removed/) })]);
    expect(await db.notes.count()).toBe(0);
    expect(await db.table('_clipReceipts').count()).toBe(1);
  });

  it('namespaces clip identities by extension installation', async () => {
    const clip = await makeClip();
    await importClipBatch([clip], options());
    expect((await importClipBatch([clip], { ...options(), sourceId: 'another-installation' }))[0].status).toBe('imported');
    expect(await db.notes.count()).toBe(2);
  });

  it('snapshots all input rows before asynchronous hashing starts', async () => {
    const first = await makeClip();
    const second = await makeClip({ id: 'second', content: 'Original second clip' });
    const pending = importClipBatch([first, second], options());
    second.content = 'Changed while the first clip hashes';
    const results = await pending;
    expect(results.map(result => result.status)).toEqual(['imported', 'imported']);
    expect((await db.notes.get(results[1].entityId ?? ''))?.content).toContain('Original second clip');
  });

  it('preserves file source metadata without making a network request', async () => {
    const clip = await makeClip({ sourceUrl: 'file:///synthetic/research.html' });
    const [result] = await importClipBatch([clip], options());
    expect((await db.notes.get(result.entityId ?? ''))?.sourceUrl).toBe(clip.sourceUrl);
  });

  it('refuses another workspace, another database, a locked workspace and cancelled delivery before writes', async () => {
    const clip = await makeClip();
    expect((await importClipBatch([clip], { ...options(), workspaceId: 'other-workspace' }))[0]).toMatchObject({ status: 'failed', error: expect.stringMatching(/workspace/) });
    const foreign = new Dexie('not-the-active-workspace'); peers.push(foreign);
    expect((await createClipImportService(foreign)([clip], options()))[0].status).toBe('failed');
    expect(foreign.isOpen()).toBe(false);
    setEncryptionMeta({ version: 1, salt: 'fixture', wrappedKey: 'fixture', recoverySalt: 'fixture', recoveryWrappedKey: 'fixture', enabledAt: 1 });
    expect((await importClipBatch([clip], options()))[0]).toMatchObject({ status: 'failed', error: expect.stringMatching(/Unlock/) });
    clearEncryptionMeta();
    const controller = new AbortController(); controller.abort();
    expect((await importClipBatch([clip], { ...options(), signal: controller.signal }))[0].status).toBe('failed');
    expect(Object.values(await counts()).every(count => count === 0)).toBe(true);
  });

  it('keeps per-clip partial success and refuses malformed or mismatched input without persistence', async () => {
    const good = await makeClip();
    const changed = { ...await makeClip({ id: 'changed' }), content: 'Changed after fingerprint' };
    const results = await importClipBatch([good, { id: 'invalid', revision: 1, fingerprint: good.fingerprint }, changed], options());
    expect(results.map(result => result.status)).toEqual(['imported', 'failed', 'failed']);
    expect(await counts()).toMatchObject({ notes: 1, folders: 1, activityLog: 1, _clipReceipts: 1 });
    await expect(importClipBatch(Array.from({ length: CLIP_LIMITS.batchCount + 1 }, () => good), options())).rejects.toThrow(/at most/);
    await expect(importClipBatch([good], { ...options(), sourceId: '' })).rejects.toThrow(/identifier/);
  });

  it.each(['notes', 'activityLog', '_clipReceipts'])('rolls back folder, entity, activity and receipt if %s persistence fails', async store => {
    const prototype = Object.getPrototypeOf(db.notes) as typeof db.notes;
    const add = prototype.add;
    vi.spyOn(prototype, 'add').mockImplementation(function (this: typeof db.notes, ...args) {
      if (this.name === store) return Dexie.Promise.reject(new DOMException('Synthetic quota failure', 'QuotaExceededError'));
      return add.apply(this, args);
    });
    const [result] = await importClipBatch([await makeClip()], options());
    expect(result).toMatchObject({ status: 'failed', error: expect.stringMatching(/Storage is full/) });
    expect(Object.values(await counts()).every(count => count === 0)).toBe(true);
  });

  it('rolls back the default timeline and earlier writes when cancellation arrives during entity creation', async () => {
    const controller = new AbortController();
    const prototype = Object.getPrototypeOf(db.notes) as typeof db.notes;
    const add = prototype.add;
    vi.spyOn(prototype, 'add').mockImplementation(function (this: typeof db.notes, ...args) {
      const pending = add.apply(this, args);
      return this.name === 'timelineEvents' ? pending.then(value => { controller.abort(); return value; }) : pending;
    });
    expect((await importClipBatch([await makeClip({ entityType: 'timeline-event' })], { ...options(), signal: controller.signal }))[0].status).toBe('failed');
    expect(Object.values(await counts()).every(count => count === 0)).toBe(true);
  });

  it('encrypts captured content and outbox copies while keeping the receipt minimal and plaintext', async () => {
    setEncryptionMeta({ version: 1, salt: 'fixture', wrappedKey: 'fixture', recoverySalt: 'fixture', recoveryWrappedKey: 'fixture', enabledAt: 1 });
    setSessionKey(await generateMasterKey());
    await db.table('_syncMeta').put({ key: 'syncWorkspaceIdentityV1', value: { version: 1, serverUrl: 'https://test.invalid', userId: 'fixture-user' } });
    disableSync();
    const clip = await makeClip();
    const [result] = await importClipBatch([clip], options());
    expect(result.status).toBe('imported');
    expect(isEncryptedEnvelope((await raw('notes', result.entityId ?? '')).content)).toBe(true);
    const queue = await db.table('_syncQueue').toArray();
    expect(queue.some(row => row.table === '_clipReceipts')).toBe(false);
    expect(isEncryptedEnvelope((await raw('_syncQueue', queue[0].seq)).data)).toBe(true);
    const [receipt] = await db.table<ClipReceipt>('_clipReceipts').toArray();
    expect(await raw('_clipReceipts', receipt.key)).toEqual(receipt);
    expect((await importClipBatch([clip], options()))[0].status).toBe('duplicate');
    expect(await db.notes.count()).toBe(1);
    const peer = new Dexie(db.name); peers.push(peer);
    const peerImport = createClipImportService(peer);
    await peer.open();
    expect((await peerImport([clip], options()))[0].status).toBe('duplicate');
    const [second] = await peerImport([await makeClip({ id: 'second-encrypted-clip' })], options());
    expect(second.status).toBe('imported');
    expect(isEncryptedEnvelope((await raw('notes', second.entityId ?? '')).content)).toBe(true);
    expect(await db.folders.count()).toBe(1);
  });

  it('rolls encrypted entities and outbox copies back together if the durable receipt cannot be stored', async () => {
    setEncryptionMeta({ version: 1, salt: 'fixture', wrappedKey: 'fixture', recoverySalt: 'fixture', recoveryWrappedKey: 'fixture', enabledAt: 1 });
    setSessionKey(await generateMasterKey());
    await db.table('_syncMeta').put({ key: 'syncWorkspaceIdentityV1', value: { version: 1, serverUrl: 'https://test.invalid', userId: 'fixture-user' } });
    disableSync();
    const before = await counts();
    const prototype = Object.getPrototypeOf(db.notes) as typeof db.notes;
    const add = prototype.add;
    vi.spyOn(prototype, 'add').mockImplementation(function (this: typeof db.notes, ...args) {
      if (this.name === '_clipReceipts') return Dexie.Promise.reject(new DOMException('Synthetic quota failure', 'QuotaExceededError'));
      return add.apply(this, args);
    });
    expect((await importClipBatch([await makeClip({ entityType: 'timeline-event' })], options()))[0].status).toBe('failed');
    expect(await counts()).toEqual(before);
  });
});
