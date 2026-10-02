import { afterEach, describe, expect, it, vi } from 'vitest';
import { SearchIndex, SearchProjection } from '../lib/search-index';
import { SearchSession } from '../lib/search-session';
import type { Note, EvidenceItem, Whiteboard, ChatThread } from '../types';

const note = (id: string, extra: Partial<Note> = {}): Note => ({ id, title: `Summary ${id}`, content: 'Prepared report', tags: [], pinned: false, archived: false, trashed: false, createdAt: 1, updatedAt: 1, ...extra });
const evidence = (id: string, extra: Partial<EvidenceItem> = {}): EvidenceItem => ({ id, title: 'Exhibit', fileName: 'report.txt', fileType: 'text', size: 20, content: 'Extracted statement', extractionStatus: 'extracted', importedAt: 1, chunkIndex: 0, chunkCount: 1, tags: ['reviewed'], archived: false, trashed: false, createdAt: 1, updatedAt: 1, ...extra });
afterEach(() => vi.useRealTimers());

describe('incremental search projection and index', () => {
  it('sends one changed document from 5,000 rows and no patch for attachment-only changes', () => {
    const projection = new SearchProjection();
    const notes = Array.from({ length: 5000 }, (_, i) => note(String(i)));
    const coldStarted = performance.now();
    const initial = projection.update({ notes, tasks: [] });
    expect(initial.upserts).toHaveLength(5000);
    const index = new SearchIndex(); index.apply(initial);
    const coldIndexMs = performance.now() - coldStarted;
    const firstQueryStarted = performance.now();
    index.search({ mode: 'simple', raw: 'summary' });
    const coldQueryMs = performance.now() - firstQueryStarted;
    const warmQueriesStarted = performance.now();
    for (let i = 0; i < 20; i++) index.search({ mode: 'simple', raw: `summary ${i}` });
    const meanWarmQueryMs = (performance.now() - warmQueriesStarted) / 20;
    expect(projection.update({ notes, tasks: [] }).upserts).toHaveLength(0);
    const next = notes.map(n => n.id === '2000' ? { ...n, title: 'Unique amendment', updatedAt: 2 } : n);
    const delta = projection.update({ notes: next, tasks: [] });
    expect(delta.upserts).toHaveLength(1);
    expect(JSON.stringify(delta).length).toBeLessThan(1000);
    index.apply(delta);
    console.info('Search synthetic 5,000-row measurement (ms)', { coldIndex: +coldIndexMs.toFixed(2), coldQuery: +coldQueryMs.toFixed(2), meanWarmQuery: +meanWarmQueryMs.toFixed(2), changedDocuments: delta.upserts.length, patchBytes: JSON.stringify(delta).length });
    expect(index.search({ mode: 'simple', raw: 'amendment' }).results.map(r => r.id)).toEqual(['2000']);
    const imagesOnly = next.map(n => n.id === '2000' ? { ...n, images: [{ id: 'image', data: 'data:image/png;base64,synthetic' }] } : n) as Note[];
    expect(projection.update({ notes: imagesOnly, tasks: [] }).upserts).toHaveLength(0);
    const removal = projection.update({ notes: next.filter(n => n.id !== '2000'), tasks: [] });
    expect(removal.deleted).toEqual(['note:2000']); index.apply(removal);
    expect(index.search({ mode: 'simple', raw: 'amendment' }).results).toEqual([]);
  });

  it('projects evidence OCR, analysis and filenames but excludes binary/scene/tool payloads', () => {
    const projection = new SearchProjection();
    const patch = projection.update({ notes: [], tasks: [], evidenceItems: [evidence('e', { imageData: 'SECRET_BINARY', imageOcrText: 'transcribed receipt', imageAnalysis: 'Description of exhibit' })], whiteboards: [{ id: 'w', name: 'Diagram', tags: [], elements: 'SECRET_SCENE', files: 'SECRET_FILES', order: 0, trashed: false, archived: false, createdAt: 1, updatedAt: 1 }] as Whiteboard[], chatThreads: [{ id: 'c', title: 'Conversation', tags: [], messages: [{ content: 'Visible message', toolCalls: [{ input: 'SECRET_TOOL' }] }], createdAt: 1, updatedAt: 1 }] as unknown as ChatThread[] });
    expect(JSON.stringify(patch)).not.toContain('SECRET');
    const index = new SearchIndex(); index.apply(patch);
    for (const raw of ['receipt', 'report.txt', 'statement', 'exhibit', 'reviewed']) expect(index.search({ mode: 'simple', raw }).results.some(r => r.type === 'evidence')).toBe(true);
    expect(index.search({ mode: 'regex', raw: 'transcribed.*receipt' }).results[0].id).toBe('e');
    expect(index.search({ mode: 'advanced', raw: 'tags:contains("reviewed") AND content:contains("receipt")' }).results[0].id).toBe('e');
  });

  it('separates equal IDs, respects folder/date scope before result limit, and removes hidden rows', () => {
    const projection = new SearchProjection(); const index = new SearchIndex();
    const notes = Array.from({ length: 60 }, (_, i) => note(String(i), { folderId: 'case', createdAt: i }));
    index.apply(projection.update({ notes, tasks: [], evidenceItems: [evidence('0', { title: 'Summary exhibit', folderId: 'other' })] }));
    expect(index.documents.size).toBe(61);
    expect(index.search({ mode: 'simple', raw: 'summary', dateFilter: { field: 'createdAt', from: 55 } }, 'case').results).toHaveLength(5);
    expect(index.search({ mode: 'simple', raw: 'summary' }, 'other').results.map(r => r.type)).toEqual(['evidence']);
    index.apply(projection.update({ notes: [note('0', { trashed: true })], tasks: [], evidenceItems: [evidence('0', { archived: true })] }));
    expect(index.documents.size).toBe(0);
  });
});

function fakeWorker() {
  return { postMessage: vi.fn(), terminate: vi.fn(), onmessage: null, onerror: null, onmessageerror: null } as unknown as Worker;
}

describe('search worker lifecycle', () => {
  it('recovers from a deferred worker load failure using the latest query and evidence', () => {
    const worker = fakeWorker(); const publish = vi.fn();
    const session = new SearchSession(() => worker, publish);
    session.update({ notes: [], tasks: [], evidenceItems: [evidence('e')] });
    session.search({ mode: 'simple', raw: 'statement' });
    worker.onerror?.(new Event('error') as ErrorEvent);
    expect(worker.terminate).toHaveBeenCalledOnce();
    expect(publish.mock.lastCall?.[0].results[0]).toMatchObject({ id: 'e', type: 'evidence' });
    session.dispose();
  });

  it('ignores old query and old dataset responses, including an empty-query reset', () => {
    const worker = fakeWorker(); const publish = vi.fn(); const session = new SearchSession(() => worker, publish);
    session.update({ notes: [note('1')], tasks: [] }); session.search({ mode: 'simple', raw: 'summary' });
    session.update({ notes: [note('1', { title: 'Updated' })], tasks: [] }); session.search({ mode: 'simple', raw: 'updated' });
    worker.onmessage?.({ data: { id: 1, revision: 1, result: { results: ['old'] } } } as MessageEvent);
    worker.onmessage?.({ data: { id: 2, revision: 1, result: { results: ['stale data'] } } } as MessageEvent);
    expect(publish).not.toHaveBeenCalled();
    worker.onmessage?.({ data: { id: 2, revision: 2, result: { results: [] } } } as MessageEvent);
    expect(publish).toHaveBeenCalledOnce();
    session.search({ mode: 'simple', raw: '' });
    worker.onmessage?.({ data: { id: 2, revision: 2, result: { results: ['late'] } } } as MessageEvent);
    expect(publish.mock.lastCall?.[0]).toEqual({ results: [] }); session.dispose();
  });

  it('terminates an unresponsive worker, keeps simple search usable and never evaluates regex on main thread', () => {
    vi.useFakeTimers(); const worker = fakeWorker(); const publish = vi.fn(); const session = new SearchSession(() => worker, publish);
    session.update({ notes: [note('1')], tasks: [] }); session.search({ mode: 'regex', raw: 'report' });
    vi.advanceTimersByTime(5000);
    expect(worker.terminate).toHaveBeenCalledOnce(); expect(publish.mock.lastCall?.[0].error).toContain('working search worker');
    session.search({ mode: 'simple', raw: 'report' }); expect(publish.mock.lastCall?.[0].results).toHaveLength(1);
    session.dispose();
  });

  it('recovers after construction or message-cloning failures and suppresses callbacks after close', () => {
    const publish = vi.fn(); const session = new SearchSession(() => { throw new Error('worker unavailable'); }, publish);
    session.update({ notes: [note('1')], tasks: [] }); session.search({ mode: 'advanced', raw: 'title:contains("summary")' });
    expect(publish.mock.lastCall?.[0].results).toHaveLength(1); session.dispose();
    const worker = fakeWorker(); vi.mocked(worker.postMessage).mockImplementation(() => { throw new Error('clone failed'); });
    const second = new SearchSession(() => worker, publish); second.update({ notes: [note('2')], tasks: [] }); second.search({ mode: 'simple', raw: 'report' });
    expect(publish.mock.lastCall?.[0].results[0].id).toBe('2'); second.dispose(); publish.mockClear();
    worker.onmessage?.({ data: { id: 1, revision: 1, result: { results: [] } } } as MessageEvent); expect(publish).not.toHaveBeenCalled();
  });
});
