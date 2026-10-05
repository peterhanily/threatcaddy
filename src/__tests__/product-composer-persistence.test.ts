import Dexie from 'dexie';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { db } from '../db';
import { createProductComposerPersistence } from '../lib/product-composer-persistence';
import { prepareProductComposerNote, type ProductComposerSnapshot } from '../lib/product-composer';
import { generateMasterKey, isEncryptedEnvelope } from '../lib/crypto';
import { installEncryptionMiddleware, setSessionKey } from '../lib/encryptionMiddleware';
import { clearEncryptionMeta, encryptionStorageKey, setEncryptionMeta } from '../lib/encryptionStore';
import { enableSync, disableSync } from '../lib/sync-state';
import * as workspaces from '../lib/workspace-profiles';
import { DEFAULT_CLS_LEVELS, type EvidenceItem, type Note, type NoteTemplate, type StandaloneIOC, type Task, type TimelineEvent } from '../types';

const common = { folderId: 'case', tags: [], trashed: false, archived: false, createdAt: 1, updatedAt: 1, clsLevel: 'TLP:CLEAR' };
const note = (id: string, extra: Partial<Note> = {}): Note => ({ ...common, id, title: id, content: `Fictional content for ${id}`, pinned: false, ...extra });
const task = (id: string): Task => ({ ...common, id, title: id, completed: false, priority: 'none', status: 'todo', order: 0 });
const event = (id: string): TimelineEvent => ({ ...common, id, title: id, timestamp: 0, timelineId: 'timeline', eventType: 'other', source: 'Fictional source', confidence: 'medium', linkedIOCIds: [], linkedNoteIds: [], linkedTaskIds: [], mitreAttackIds: [], assets: [], starred: false });
const ioc = (id: string): StandaloneIOC => ({ ...common, id, type: 'domain', value: 'fictional.example', confidence: 'low' });
const evidence = (id: string): EvidenceItem => ({ ...common, id, title: id, content: 'Fictional evidence', fileName: 'fixture.txt', fileType: 'text', size: 0, extractionStatus: 'extracted', importedAt: 0, chunkIndex: 0, chunkCount: 1 });
const snapshot = (): ProductComposerSnapshot => ({
  folder: { id: 'case', name: 'Fictional investigation', order: 0, createdAt: 0, clsLevel: 'TLP:CLEAR' },
  notes: [note('source-note')], tasks: [task('source-task')], timelineEvents: [event('source-event')],
  iocs: [ioc('source-ioc')], evidence: [evidence('source-evidence')],
});
const baseline = (): NoteTemplate => ({
  id: 'baseline', name: 'Fictional baseline', category: 'Product Baseline', source: 'user', createdAt: 0, updatedAt: 0,
  content: '# Report\n\n## Findings', clsLevel: 'TLP:CLEAR',
  productBaseline: { schemaVersion: 1, kind: 'markdown', productType: 'custom', renderer: 'markdown', visualFidelity: 'structural', importedAt: 0 },
});
const tables = [db.notes, db.tasks, db.timelineEvents, db.standaloneIOCs, db.evidenceItems, db.folders, db.noteTemplates];
const settingsKey = workspaces.workspaceStorageKey('threatcaddy-settings');

async function seed(source = snapshot(), template?: NoteTemplate) {
  await db.folders.add(source.folder);
  await db.notes.bulkAdd([...source.notes]);
  await db.tasks.bulkAdd([...source.tasks]);
  await db.timelineEvents.bulkAdd([...source.timelineEvents]);
  await db.standaloneIOCs.bulkAdd([...source.iocs]);
  await db.evidenceItems.bulkAdd([...source.evidence]);
  if (template) await db.noteTemplates.add(template);
  return source;
}

function prepare(source: ProductComposerSnapshot, options: { clsLevel?: string; template?: NoteTemplate; assertCurrentScope?: () => void; levels?: readonly string[] } = {}) {
  const input = {
    title: 'Reviewed product', content: `# Reviewed product\n\n**Classification:** ${options.clsLevel ?? 'TLP:CLEAR'}\n\nAnalyst-approved text.`,
    clsLevel: options.clsLevel ?? 'TLP:CLEAR', baselineId: options.template?.id,
  };
  const effectiveLevels = options.levels ?? DEFAULT_CLS_LEVELS;
  const patch = prepareProductComposerNote(input, source, options.template, effectiveLevels);
  const candidate = note('new-product', { ...patch, createdBy: 'Fictional analyst', createdAt: 2, updatedAt: 2 });
  return {
    candidate,
    persist: createProductComposerPersistence({ input, originSnapshot: source, originBaseline: options.template, effectiveLevels, assertCurrentScope: options.assertCurrentScope ?? (() => {}) }),
  };
}

async function inOtherTab(action: (peer: Dexie) => Promise<unknown>) {
  const peer = new Dexie(db.name);
  installEncryptionMiddleware(peer);
  try { await peer.open(); await action(peer); } finally { peer.close(); }
}

beforeEach(async () => {
  clearEncryptionMeta();
  setSessionKey(null);
  disableSync();
  localStorage.removeItem(settingsKey);
  await Promise.all(tables.map(table => table.clear()));
  await db.table('_syncQueue').clear();
  await db.table('_syncMeta').clear();
});

afterEach(() => {
  vi.restoreAllMocks();
  disableSync();
  clearEncryptionMeta();
  setSessionKey(null);
  localStorage.removeItem(settingsKey);
});

describe('atomic current-persisted product classification', () => {
  it('saves the exact new ordinary note and commits its normal durable sync entry', async () => {
    const source = await seed();
    const { candidate, persist } = prepare(source);
    enableSync();
    await persist(candidate);
    expect(await db.notes.get(candidate.id)).toEqual(candidate);
    expect(await db.notes.get('source-note')).toEqual(source.notes[0]);
    expect(await db.table('_syncQueue').toArray()).toEqual([expect.objectContaining({ table: 'notes', entityId: candidate.id, data: candidate, folderId: 'case', op: 'put' })]);
  });

  it.each([
    ['notes', 'source-note'], ['tasks', 'source-task'], ['timelineEvents', 'source-event'],
    ['standaloneIOCs', 'source-ioc'], ['evidenceItems', 'source-evidence'], ['folders', 'case'],
  ])('rejects a higher persisted %s classification written by another tab', async (table, id) => {
    const source = await seed();
    const { candidate, persist } = prepare(source);
    await inOtherTab(peer => peer.table(table).update(id, { clsLevel: 'TLP:RED', updatedAt: 2 }));
    await expect(persist(candidate)).rejects.toThrow('classification');
    expect(await db.notes.get(candidate.id)).toBeUndefined();
    expect(source.notes[0].clsLevel).toBe('TLP:CLEAR');
  });

  it('includes new source rows and does not silently update only report metadata', async () => {
    const source = await seed();
    const { candidate, persist } = prepare(source);
    await inOtherTab(peer => peer.table('notes').add(note('new-red-source', { clsLevel: 'TLP:RED' })));
    await expect(persist(candidate)).rejects.toThrow('classification');
    expect(await db.notes.get(candidate.id)).toBeUndefined();
    expect(candidate.clsLevel).toBe('TLP:CLEAR');
    expect(candidate.content).toContain('TLP:CLEAR');
  });

  it('includes current embedded IOC classifications', async () => {
    const source = await seed();
    const { candidate, persist } = prepare(source);
    await db.tasks.update('source-task', { iocAnalysis: { extractedAt: 2, iocs: [{ id: 'embedded', value: 'fictional.example', type: 'domain', confidence: 'low', firstSeen: 0, dismissed: false, clsLevel: 'TLP:RED' }] } });
    await expect(persist(candidate)).rejects.toThrow('classification');
    expect(await db.notes.get(candidate.id)).toBeUndefined();
  });

  it('retains the original staged classification even after source declassification', async () => {
    const source = snapshot();
    source.notes[0].clsLevel = 'TLP:RED';
    await seed(source);
    await db.notes.update('source-note', { clsLevel: 'TLP:CLEAR' });
    expect(() => prepare(source)).toThrow('classification');
    const { candidate, persist } = prepare(source, { clsLevel: 'TLP:RED' });
    await persist(candidate);
    expect((await db.notes.get(candidate.id))?.clsLevel).toBe('TLP:RED');
  });

  it('never treats an unknown current label as weaker than a known classification', async () => {
    const source = await seed();
    const { candidate, persist } = prepare(source, { clsLevel: 'TLP:RED' });
    await db.notes.update('source-note', { clsLevel: 'UNRANKED RESTRICTION' });
    await expect(persist(candidate)).rejects.toThrow('classification');
  });

  it('preserves unknown original handling restrictions after the persisted label changes', async () => {
    const source = snapshot();
    source.folder.clsLevel = undefined;
    for (const key of ['notes', 'tasks', 'timelineEvents', 'iocs', 'evidence'] as const) {
      for (const row of source[key]) row.clsLevel = undefined;
    }
    source.notes[0].clsLevel = 'CUSTOM RESTRICTION';
    await seed(source);
    await db.notes.update('source-note', { clsLevel: undefined });
    expect(() => prepare(source, { clsLevel: 'TLP:RED' })).toThrow('classification');
    const { candidate, persist } = prepare(source, { clsLevel: 'CUSTOM RESTRICTION' });
    await persist(candidate);
    expect((await db.notes.get(candidate.id))?.clsLevel).toBe('CUSTOM RESTRICTION');
  });

  it('ignores unrelated investigations and already unavailable non-source rows', async () => {
    const source = await seed();
    const { candidate, persist } = prepare(source);
    await db.notes.bulkAdd([
      note('unrelated', { folderId: 'other-case', clsLevel: 'TLP:RED' }),
      note('archived', { archived: true, clsLevel: 'TLP:RED' }),
      note('trashed', { trashed: true, clsLevel: 'TLP:RED' }),
      note('old-product', { tags: ['product'], clsLevel: 'TLP:RED' }),
    ]);
    await persist(candidate);
    expect(await db.notes.get(candidate.id)).toEqual(candidate);
  });
});

describe('source and baseline ownership', () => {
  it.each([
    ['notes', 'source-note'], ['tasks', 'source-task'], ['timelineEvents', 'source-event'],
    ['standaloneIOCs', 'source-ioc'], ['evidenceItems', 'source-evidence'],
  ])('rejects a deleted original %s source', async (table, id) => {
    const source = await seed();
    const { candidate, persist } = prepare(source);
    await db.table(table).delete(id);
    await expect(persist(candidate)).rejects.toThrow('source was deleted');
    expect(await db.notes.get(candidate.id)).toBeUndefined();
  });

  it.each([{ folderId: 'other-case' }, { archived: true }, { trashed: true }, { tags: ['product'] }])('rejects unavailable original sources: %j', async update => {
    const source = await seed();
    const { candidate, persist } = prepare(source);
    await db.notes.update('source-note', update);
    await expect(persist(candidate)).rejects.toThrow('source was deleted');
  });

  it.each(['deleted', 'archived'])('rejects a %s investigation', async state => {
    const source = await seed();
    const { candidate, persist } = prepare(source);
    if (state === 'deleted') await db.folders.delete('case');
    else await db.folders.update('case', { status: 'archived' });
    await expect(persist(candidate)).rejects.toThrow('investigation is no longer available');
  });

  it.each(['reclassified', 'deleted', 'not-product'])('rejects a %s persisted baseline without trusting its cached copy', async state => {
    const template = baseline();
    const source = await seed(snapshot(), template);
    const { candidate, persist } = prepare(source, { template });
    if (state === 'deleted') await db.noteTemplates.delete(template.id);
    else await db.noteTemplates.update(template.id, state === 'reclassified' ? { clsLevel: 'TLP:RED' } : { productBaseline: undefined });
    await expect(persist(candidate)).rejects.toThrow(state === 'reclassified' ? 'classification' : 'baseline is no longer available');
    expect(await db.notes.get(candidate.id)).toBeUndefined();
  });

  it('keeps the baseline tag on a valid persisted baseline save', async () => {
    const template = baseline();
    const source = await seed(snapshot(), template);
    const { candidate, persist } = prepare(source, { template });
    await persist(candidate);
    expect((await db.notes.get(candidate.id))?.tags).toEqual(['product', 'draft-product', 'baseline:baseline']);
  });

  it('rejects current source inventories over budget rather than checking an incomplete floor', async () => {
    const source = await seed();
    const { candidate, persist } = prepare(source);
    await db.notes.bulkAdd(Array.from({ length: 2_001 }, (_, i) => note(`additional-${i}`)));
    await expect(persist(candidate)).rejects.toThrow('source items');
  });

  it('rejects altered candidate content or destination instead of bypassing the validated patch', async () => {
    const source = await seed();
    const { candidate, persist } = prepare(source);
    await expect(persist({ ...candidate, content: 'Different content' })).rejects.toThrow('draft changed');
    await expect(persist({ ...candidate, folderId: 'other-case' })).rejects.toThrow('draft changed');
    expect(await db.notes.get(candidate.id)).toBeUndefined();
  });
});

describe('asynchronous session, transaction and hierarchy fences', () => {
  it('serializes a second-tab classification write with the entire read-and-insert operation', async () => {
    const source = await seed();
    const { candidate, persist } = prepare(source);
    const peer = new Dexie(db.name);
    await peer.open();
    try {
      let concurrentWrite: PromiseLike<unknown> | undefined;
      let writerCommitted = false;
      const originalAdd = db.notes.add.bind(db.notes);
      vi.spyOn(db.notes, 'add').mockImplementation(value => {
        // A second connection starts changing the source after validation but
        // before insertion. It must wait for the product transaction to commit.
        Dexie.ignoreTransaction(() => {
          concurrentWrite = peer.table('notes').update('source-note', { clsLevel: 'TLP:RED' }).then(() => { writerCommitted = true; });
        });
        return originalAdd(value).then(id => {
          expect(writerCommitted).toBe(false);
          return id;
        });
      });
      await persist(candidate);
      await concurrentWrite;
      expect((await db.notes.get(candidate.id))?.clsLevel).toBe('TLP:CLEAR');
      expect((await db.notes.get('source-note'))?.clsLevel).toBe('TLP:RED');
    } finally { peer.close(); }
  });

  it('rechecks scope after asynchronous reads before inserting', async () => {
    const source = await seed();
    let owned = true;
    const { candidate, persist } = prepare(source, { assertCurrentScope: () => { if (!owned) throw new Error('Composer ownership changed'); } });
    const originalGet = db.folders.get.bind(db.folders);
    vi.spyOn(db.folders, 'get').mockImplementation(key => originalGet(key).then(folder => { owned = false; return folder; }));
    const add = vi.spyOn(db.notes, 'add');
    await expect(persist(candidate)).rejects.toThrow('ownership changed');
    expect(add).not.toHaveBeenCalled();
  });

  it('rolls back the inserted note and sync outbox when ownership changes during the write', async () => {
    const source = await seed();
    let owned = true;
    const { candidate, persist } = prepare(source, { assertCurrentScope: () => { if (!owned) throw new Error('Composer ownership changed'); } });
    const originalAdd = db.notes.add.bind(db.notes);
    vi.spyOn(db.notes, 'add').mockImplementation(value => originalAdd(value).then(id => { owned = false; return id; }));
    enableSync();
    await expect(persist(candidate)).rejects.toThrow('ownership changed');
    expect(await db.notes.get(candidate.id)).toBeUndefined();
    expect(await db.table('_syncQueue').count()).toBe(0);
  });

  it('rolls back storage failures without leaving a product or outbox entry', async () => {
    const source = await seed();
    const { candidate, persist } = prepare(source);
    const originalAdd = db.notes.add.bind(db.notes);
    vi.spyOn(db.notes, 'add').mockImplementation(value => originalAdd(value).then(() => { throw new Error('Simulated storage failure'); }));
    enableSync();
    await expect(persist(candidate)).rejects.toThrow('storage failure');
    expect(await db.notes.get(candidate.id)).toBeUndefined();
    expect(await db.table('_syncQueue').count()).toBe(0);
    expect(await db.notes.get('source-note')).toEqual(source.notes[0]);
  });

  it('rejects a stale workspace callback and a changed encryption key', async () => {
    const source = await seed();
    const { candidate, persist } = prepare(source);
    const workspace = vi.spyOn(workspaces, 'getActiveWorkspaceId').mockReturnValue('different-workspace');
    await expect(persist(candidate)).rejects.toThrow('workspace session changed');
    workspace.mockRestore();
    setSessionKey(await generateMasterKey());
    await expect(persist(candidate)).rejects.toThrow('workspace session changed');
  });

  it('refuses locked or damaged encryption settings before reading any source', async () => {
    const source = await seed();
    const metadata = { version: 1 as const, salt: 'fixture', wrappedKey: 'fixture', recoverySalt: 'fixture', recoveryWrappedKey: 'fixture', enabledAt: 1 };
    setEncryptionMeta(metadata);
    expect(() => prepare(source)).toThrow('workspace session changed');
    setSessionKey(await generateMasterKey());
    localStorage.setItem(encryptionStorageKey, '{');
    expect(() => prepare(source)).toThrow('workspace session changed');
  });

  it('rejects an unreadable hierarchy and a hierarchy changed in another tab', async () => {
    const source = await seed();
    const { candidate, persist } = prepare(source);
    localStorage.setItem(settingsKey, '{');
    await expect(persist(candidate)).rejects.toThrow('could not be verified');
    localStorage.setItem(settingsKey, JSON.stringify({ tiClsLevels: [...DEFAULT_CLS_LEVELS].reverse() }));
    await expect(persist(candidate)).rejects.toThrow('Classification settings changed');
  });

  it('honors unchanged persisted custom rankings and ignores unrelated setting changes', async () => {
    const levels = ['PUBLIC', 'INTERNAL', 'SECRET'];
    localStorage.setItem(settingsKey, JSON.stringify({ tiClsLevels: levels }));
    const source = snapshot();
    source.folder.clsLevel = 'PUBLIC';
    for (const key of ['notes', 'tasks', 'timelineEvents', 'iocs', 'evidence'] as const) for (const row of source[key]) row.clsLevel = 'INTERNAL';
    await seed(source);
    const { candidate, persist } = prepare(source, { levels, clsLevel: 'INTERNAL' });
    localStorage.setItem(settingsKey, JSON.stringify({ tiClsLevels: levels, theme: 'light' }));
    await persist(candidate);
    expect((await db.notes.get(candidate.id))?.clsLevel).toBe('INTERNAL');
  });

  it('checks real encrypted source labels and persists encrypted report/outbox content', async () => {
    const key = await generateMasterKey();
    setEncryptionMeta({ version: 1, salt: 'fixture', wrappedKey: 'fixture', recoverySalt: 'fixture', recoveryWrappedKey: 'fixture', enabledAt: 1 });
    setSessionKey(key);
    const template = baseline();
    const source = await seed(snapshot(), template);
    const stale = prepare(source, { template });
    await inOtherTab(peer => peer.table('notes').update('source-note', { clsLevel: 'TLP:RED' }));
    await expect(stale.persist(stale.candidate)).rejects.toThrow('classification');
    const accepted = prepare(source, { template, clsLevel: 'TLP:RED' });
    enableSync();
    await accepted.persist(accepted.candidate);
    expect(await db.notes.get(accepted.candidate.id)).toEqual(accepted.candidate);
    const rawNote = await new Promise<Record<string, unknown>>((resolve, reject) => {
      const request = db.backendDB().transaction('notes').objectStore('notes').get(accepted.candidate.id);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    expect(isEncryptedEnvelope(rawNote.content)).toBe(true);
    expect(isEncryptedEnvelope(rawNote.clsLevel)).toBe(true);
    const outbox = (await db.table('_syncQueue').toArray())[0];
    expect(outbox.data).toEqual(accepted.candidate);
    const rawOutbox = await new Promise<Record<string, unknown>>((resolve, reject) => {
      const request = db.backendDB().transaction('_syncQueue').objectStore('_syncQueue').get(outbox.seq);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    expect(isEncryptedEnvelope(rawOutbox.data)).toBe(true);
  });
});
