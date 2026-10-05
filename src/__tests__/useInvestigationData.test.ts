import { useLayoutEffect } from 'react';
import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { db } from '../db';
import { useInvestigationData } from '../hooks/useInvestigationData';
import type { InvestigationDataMode, Note } from '../types';

const api = vi.hoisted(() => ({ snapshot: vi.fn() }));
vi.mock('../lib/server-api', () => ({ syncSnapshot: api.snapshot }));
type Snapshot = Record<string, Record<string, unknown>[]>;
function deferred() {
  let resolve!: (value: Snapshot) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<Snapshot>((done, fail) => { resolve = done; reject = fail; });
  return { promise, resolve, reject };
}
const note = (id: string, folderId: string): Note => ({ id, folderId, title: `Note ${id}`, content: 'Synthetic case text',
  tags: [], pinned: false, trashed: false, archived: false, createdAt: 1, updatedAt: 1 });
const snapshot = (id: string, folderId: string): Snapshot => ({ notes: [note(id, folderId) as unknown as Record<string, unknown>] });
type Props = { folder: string | null; mode: InvestigationDataMode };
const useData = ({ folder, mode }: Props) => useInvestigationData(folder, mode);
beforeEach(async () => { api.snapshot.mockReset(); await db.notes.clear(); });
afterEach(() => vi.restoreAllMocks());

describe('useInvestigationData request ownership', () => {
  it('requires a successful current-scope read even before the loading effect runs', async () => {
    const first = deferred(); const second = deferred();
    api.snapshot.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
    const committed: Array<{ folder: string | null; loading: boolean; loadedSuccessfully: boolean }> = [];
    const { result, rerender } = renderHook((properties: Props) => {
      const data = useData(properties);
      useLayoutEffect(() => {
        committed.push({ folder: properties.folder, loading: data.loading, loadedSuccessfully: data.loadedSuccessfully });
      });
      return data;
    }, { initialProps: { folder: 'first', mode: 'remote' } as Props });
    expect(committed[0]).toEqual({ folder: 'first', loading: false, loadedSuccessfully: false });
    expect(result.current.loadedSuccessfully).toBe(false);
    await act(async () => { first.resolve(snapshot('current', 'first')); });
    expect(result.current.loadedSuccessfully).toBe(true);

    rerender({ folder: 'second', mode: 'remote' });
    expect(committed.find(value => value.folder === 'second')).toEqual({ folder: 'second', loading: false, loadedSuccessfully: false });
    expect(result.current.loadedSuccessfully).toBe(false);
    await act(async () => { second.resolve({}); });
    expect(result.current.notes).toEqual([]);
    expect(result.current.loadedSuccessfully).toBe(true);
  });

  it('does not mistake an initial failure for an empty success and recovers only after retry succeeds', async () => {
    api.snapshot.mockRejectedValueOnce(new Error('Initial snapshot unavailable'));
    const { result } = renderHook(useData, { initialProps: { folder: 'case', mode: 'remote' } as Props });
    await waitFor(() => expect(result.current.error).toBe('Initial snapshot unavailable'));
    expect(result.current.loading).toBe(false);
    expect(result.current.loadedSuccessfully).toBe(false);
    const retry = deferred(); api.snapshot.mockReturnValueOnce(retry.promise);
    let refreshing!: Promise<void>;
    act(() => { refreshing = result.current.refresh(); });
    expect(result.current.loadedSuccessfully).toBe(false);
    await act(async () => { retry.resolve({}); await refreshing; });
    expect(result.current).toMatchObject({ notes: [], loading: false, error: null, loadedSuccessfully: true });
  });

  it('ignores a previous folder success and its loading completion while the latest folder is pending', async () => {
    const first = deferred(); const second = deferred();
    api.snapshot.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
    const { result, rerender } = renderHook(useData, { initialProps: { folder: 'first', mode: 'remote' } as Props });
    rerender({ folder: 'second', mode: 'remote' });
    await act(async () => { first.resolve(snapshot('old', 'first')); });
    expect(result.current.notes).toEqual([]);
    expect(result.current.loading).toBe(true);
    expect(result.current.loadedSuccessfully).toBe(false);
    expect(result.current.error).toBeNull();
    await act(async () => { second.resolve(snapshot('current', 'second')); });
    expect(result.current.notes.map(row => row.id)).toEqual(['current']);
    expect(result.current.loading).toBe(false);
    expect(result.current.loadedSuccessfully).toBe(true);
  });

  it('ignores an old failure after a newer success rather than clearing current records', async () => {
    const first = deferred(); const second = deferred();
    api.snapshot.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
    const { result, rerender } = renderHook(useData, { initialProps: { folder: 'first', mode: 'remote' } as Props });
    rerender({ folder: 'second', mode: 'remote' });
    await act(async () => { second.resolve(snapshot('current', 'second')); });
    await act(async () => { first.reject(new Error('Old request failed')); });
    expect(result.current.notes.map(row => row.id)).toEqual(['current']);
    expect(result.current.error).toBeNull();
    expect(result.current.loading).toBe(false);
    expect(result.current.loadedSuccessfully).toBe(true);
  });

  it('preserves latest loading on an older refresh failure, then surfaces the current failure', async () => {
    api.snapshot.mockResolvedValueOnce(snapshot('initial', 'case'));
    const { result } = renderHook(useData, { initialProps: { folder: 'case', mode: 'remote' } as Props });
    await waitFor(() => expect(result.current.notes).toHaveLength(1));
    expect(result.current.loadedSuccessfully).toBe(true);
    const older = deferred(); const latest = deferred();
    api.snapshot.mockReturnValueOnce(older.promise).mockReturnValueOnce(latest.promise);
    let olderRefresh!: Promise<void>; let latestRefresh!: Promise<void>;
    act(() => { olderRefresh = result.current.refresh(); latestRefresh = result.current.refresh(); });
    await act(async () => { older.reject(new Error('Superseded refresh')); await olderRefresh; });
    expect(result.current.notes).toHaveLength(1);
    expect(result.current.loading).toBe(true);
    expect(result.current.loadedSuccessfully).toBe(false);
    expect(result.current.error).toBeNull();
    await act(async () => { latest.reject(new Error('Current service unavailable')); await latestRefresh; });
    expect(result.current.notes).toEqual([]);
    expect(result.current.loading).toBe(false);
    expect(result.current.error).toBe('Current service unavailable');
    expect(result.current.loadedSuccessfully).toBe(false);
  });

  it('fences remote completion when changing to local mode and reads the actual local store', async () => {
    await db.notes.bulkAdd([note('local', 'case'), { ...note('trashed', 'case'), trashed: true }, note('other-case', 'other')]);
    const remote = deferred(); api.snapshot.mockReturnValueOnce(remote.promise);
    const { result, rerender } = renderHook(useData, { initialProps: { folder: 'case', mode: 'remote' } as Props });
    rerender({ folder: 'case', mode: 'local' });
    expect(result.current.loadedSuccessfully).toBe(false);
    await waitFor(() => expect(result.current.notes.map(row => row.id)).toEqual(['local']));
    await act(async () => { remote.resolve(snapshot('stale-remote', 'case')); });
    expect(result.current.notes.map(row => row.id)).toEqual(['local']);
    expect(result.current.isRemote).toBe(false);
    expect(result.current.error).toBeNull();
    expect(result.current.loadedSuccessfully).toBe(true);
  });

  it('returns an empty inactive result after clearing the folder, including a late rejection', async () => {
    const pending = deferred(); api.snapshot.mockReturnValueOnce(pending.promise);
    const { result, rerender } = renderHook(useData, { initialProps: { folder: 'case', mode: 'remote' } as Props });
    rerender({ folder: null, mode: 'local' });
    await act(async () => { pending.reject(new Error('Request ended after navigation')); });
    expect(result.current).toMatchObject({ notes: [], evidence: [], loading: false, loadedSuccessfully: false, error: null, isRemote: false });
    await result.current.refresh();
    expect(api.snapshot).toHaveBeenCalledOnce();
  });

  it('does not let a retained refresh callback reclaim a previous scope or restart after unmount', async () => {
    api.snapshot.mockResolvedValueOnce(snapshot('first', 'first')).mockResolvedValueOnce(snapshot('second', 'second'));
    const { result, rerender, unmount } = renderHook(useData, { initialProps: { folder: 'first', mode: 'remote' } as Props });
    await waitFor(() => expect(result.current.notes).toHaveLength(1));
    const staleRefresh = result.current.refresh;
    rerender({ folder: 'second', mode: 'remote' });
    await waitFor(() => expect(result.current.notes[0]?.id).toBe('second'));
    await act(async () => { await staleRefresh(); });
    expect(api.snapshot).toHaveBeenCalledTimes(2);
    expect(result.current.notes[0]?.id).toBe('second');
    const unmountedRefresh = result.current.refresh;
    unmount();
    await unmountedRefresh();
    expect(api.snapshot).toHaveBeenCalledTimes(2);
  });

  it.each(['resolve', 'reject'] as const)('does not render or restart after unmount and late %s', async outcome => {
    const pending = deferred(); api.snapshot.mockReturnValueOnce(pending.promise);
    let renders = 0;
    const view = renderHook(() => { renders++; return useInvestigationData('case', 'remote'); });
    view.unmount(); const count = renders;
    await act(async () => { if (outcome === 'resolve') pending.resolve(snapshot('late', 'case')); else pending.reject(new Error('Unmounted')); });
    expect(renders).toBe(count);
    expect(api.snapshot).toHaveBeenCalledOnce();
    expect(await db.notes.count()).toBe(0);
  });
});
