import { createElement, StrictMode } from 'react';
import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useChats } from '../hooks/useChats';
import { useEvidenceItems } from '../hooks/useEvidenceItems';
import type { ChatThread, EvidenceItem } from '../types';

const queries = vi.hoisted(() => ({ chats: vi.fn(), evidence: vi.fn(), purge: vi.fn() }));
vi.mock('../db', () => ({
  db: {
    isOpen: () => true,
    chatThreads: { toArray: queries.chats },
    evidenceItems: {
      toArray: () => queries.evidence(undefined),
      where: () => ({ equals: (id: string) => ({ toArray: () => queries.evidence(id) }) }),
    },
  },
}));
vi.mock('../lib/trash-purge', () => ({ purgeOldTrash: queries.purge }));
vi.mock('../lib/entity-relations', () => ({ deleteEntitiesWithReferences: vi.fn() }));

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: Error) => void;
  const promise = new Promise<T>((done, fail) => { resolve = done; reject = fail; });
  return { promise, resolve, reject };
}

const chat = (id: string): ChatThread => ({
  id, title: id, messages: [], provider: 'anthropic', model: 'test',
  tags: [], trashed: false, archived: false, createdAt: 0, updatedAt: 0,
});
const evidence = (id: string): EvidenceItem => ({
  id, title: id, fileName: id, fileType: 'text', size: 0, content: '',
  extractionStatus: 'extracted', importedAt: 0, chunkIndex: 0, chunkCount: 1,
  tags: [], trashed: false, archived: false, createdAt: 0, updatedAt: 0,
});
interface HydrationSnapshot {
  rows: Array<{ id: string }>;
  loading: boolean;
  loadedSuccessfully: boolean;
  reload: () => Promise<void>;
}
function useChatSnapshot(): HydrationSnapshot {
  const hook = useChats();
  return { rows: hook.threads, loading: hook.loading, loadedSuccessfully: hook.loadedSuccessfully, reload: hook.reload };
}
function useEvidenceSnapshot(): HydrationSnapshot {
  const hook = useEvidenceItems();
  return { rows: hook.evidenceItems, loading: hook.loading, loadedSuccessfully: hook.loadedSuccessfully, reload: hook.reload };
}
const cases = [
  { name: 'chats', query: queries.chats, useSnapshot: useChatSnapshot, row: chat },
  { name: 'evidence', query: queries.evidence, useSnapshot: useEvidenceSnapshot, row: evidence },
];

beforeEach(() => {
  queries.chats.mockReset();
  queries.evidence.mockReset();
  queries.purge.mockReset().mockImplementation(async rows => rows);
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => vi.restoreAllMocks());

describe.each(cases)('$name successful hydration', ({ query, useSnapshot, row }) => {
  it('does not mistake a failed initial read for a complete empty collection, and can recover', async () => {
    query.mockRejectedValueOnce(new Error('Read failed')).mockResolvedValueOnce([row('recovered')]);
    const { result } = renderHook(useSnapshot);
    expect(result.current.loadedSuccessfully).toBe(false);
    await act(async () => {});
    expect(result.current.loading).toBe(false);
    expect(result.current.loadedSuccessfully).toBe(false);
    expect(result.current.rows).toEqual([]);
    await act(async () => { await result.current.reload(); });
    expect(result.current.loadedSuccessfully).toBe(true);
    expect(result.current.rows.map(item => item.id)).toEqual(['recovered']);
  });

  it('keeps prior data while invalidating readiness during a reload and after failure', async () => {
    query.mockResolvedValueOnce([row('prior')]);
    const { result } = renderHook(useSnapshot);
    await act(async () => {});
    expect(result.current.loadedSuccessfully).toBe(true);
    const pending = deferred<Array<ChatThread | EvidenceItem>>();
    query.mockReturnValueOnce(pending.promise);
    let reload: Promise<void>;
    await act(async () => { reload = result.current.reload(); });
    expect(result.current.loading).toBe(true);
    expect(result.current.loadedSuccessfully).toBe(false);
    expect(result.current.rows.map(item => item.id)).toEqual(['prior']);
    await act(async () => { pending.reject(new Error('Reload failed')); await reload; });
    expect(result.current.loading).toBe(false);
    expect(result.current.loadedSuccessfully).toBe(false);
    expect(result.current.rows.map(item => item.id)).toEqual(['prior']);
  });

  it('does not let an old successful read override a newer failed read', async () => {
    const old = deferred<Array<ChatThread | EvidenceItem>>();
    query.mockReturnValueOnce(old.promise).mockRejectedValueOnce(new Error('Latest read failed'));
    const { result } = renderHook(useSnapshot);
    await act(async () => {});
    await act(async () => { await result.current.reload(); });
    await act(async () => { old.resolve([row('stale')]); });
    expect(result.current.loading).toBe(false);
    expect(result.current.loadedSuccessfully).toBe(false);
    expect(result.current.rows).toEqual([]);
  });

  it('does not let an old failed read override newer successful data', async () => {
    const old = deferred<Array<ChatThread | EvidenceItem>>();
    query.mockReturnValueOnce(old.promise).mockResolvedValueOnce([row('latest')]);
    const { result } = renderHook(useSnapshot);
    await act(async () => {});
    await act(async () => { await result.current.reload(); });
    await act(async () => { old.reject(new Error('Old read failed')); });
    expect(result.current.loadedSuccessfully).toBe(true);
    expect(result.current.rows.map(item => item.id)).toEqual(['latest']);
  });

  it('does not mark hydration successful when post-read trash processing fails', async () => {
    query.mockResolvedValueOnce([row('unprocessed')]);
    queries.purge.mockRejectedValueOnce(new Error('Purge failed'));
    const { result } = renderHook(useSnapshot);
    await act(async () => {});
    expect(result.current.loading).toBe(false);
    expect(result.current.loadedSuccessfully).toBe(false);
    expect(result.current.rows).toEqual([]);
  });

  it('does not process stale results or run retained reload callbacks after unmount', async () => {
    const old = deferred<Array<ChatThread | EvidenceItem>>();
    query.mockReturnValueOnce(old.promise);
    const { result, unmount } = renderHook(useSnapshot);
    await act(async () => {});
    const reload = result.current.reload;
    unmount();
    await act(async () => { old.resolve([row('stale')]); await reload(); });
    expect(query).toHaveBeenCalledTimes(1);
    expect(queries.purge).not.toHaveBeenCalled();
  });

  it('loads successfully under StrictMode setup/cleanup replay', async () => {
    query.mockResolvedValue([row('current')]);
    const { result } = renderHook(useSnapshot, {
      wrapper: ({ children }) => createElement(StrictMode, null, children),
    });
    await act(async () => {});
    expect(result.current.loading).toBe(false);
    expect(result.current.loadedSuccessfully).toBe(true);
    expect(result.current.rows.map(item => item.id)).toEqual(['current']);
  });
});

describe('evidence scope ownership', () => {
  it('invalidates prior hydration on folder change and ignores old-scope reads and callbacks', async () => {
    const next = deferred<EvidenceItem[]>();
    queries.evidence.mockResolvedValueOnce([evidence('first')]).mockReturnValueOnce(next.promise);
    const { result, rerender } = renderHook(({ folderId }) => useEvidenceItems(folderId), {
      initialProps: { folderId: 'first' },
    });
    await act(async () => {});
    expect(result.current.loadedSuccessfully).toBe(true);
    const oldReload = result.current.reload;
    rerender({ folderId: 'next' });
    expect(result.current.loadedSuccessfully).toBe(false);
    expect(result.current.loading).toBe(true);
    await act(async () => { await oldReload(); });
    expect(queries.evidence).toHaveBeenCalledTimes(2);
    await act(async () => { next.resolve([evidence('next')]); });
    expect(result.current.loadedSuccessfully).toBe(true);
    expect(result.current.evidenceItems.map(item => item.id)).toEqual(['next']);
  });

  it('ignores a pending old-folder read after the new folder has loaded', async () => {
    const old = deferred<EvidenceItem[]>();
    queries.evidence.mockReturnValueOnce(old.promise).mockResolvedValueOnce([evidence('next')]);
    const { result, rerender } = renderHook(({ folderId }) => useEvidenceItems(folderId), {
      initialProps: { folderId: 'first' },
    });
    rerender({ folderId: 'next' });
    await act(async () => {});
    await act(async () => { old.resolve([evidence('old')]); });
    expect(result.current.loadedSuccessfully).toBe(true);
    expect(result.current.evidenceItems.map(item => item.id)).toEqual(['next']);
  });
});
