import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useRemoteInvestigations } from '../hooks/useRemoteInvestigations';
import type { InvestigationSummary } from '../types';

const api = vi.hoisted(() => ({ fetch: vi.fn() }));
vi.mock('../lib/server-api', () => ({ fetchInvestigations: api.fetch }));

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: Error) => void;
  const promise = new Promise<T>((done, fail) => { resolve = done; reject = fail; });
  return { promise, resolve, reject };
}
function response(id: string) {
  const row: InvestigationSummary = {
    folderId: id, role: 'viewer', joinedAt: '2026-10-04', memberCount: 1,
    folder: { name: id, status: 'active', createdAt: '2026-10-04', updatedAt: '2026-10-04' },
    entityCounts: { notes: 0, tasks: 0, iocs: 0, events: 0, whiteboards: 0, chats: 0 },
  };
  return { data: [row] };
}
type Response = ReturnType<typeof response>;
const useRemote = ({ connected, url }: { connected: boolean; url: string }) => useRemoteInvestigations(connected, url);
beforeEach(() => api.fetch.mockReset());

describe('remote investigation request ownership', () => {
  it('cannot restore a disconnected list when an old request completes', async () => {
    const old = deferred<Response>(); api.fetch.mockReturnValueOnce(old.promise);
    const { result, rerender } = renderHook(useRemote, { initialProps: { connected: true, url: 'https://first.example' } });
    rerender({ connected: false, url: 'https://first.example' });
    expect(result.current.loading).toBe(false);
    await act(async () => { old.resolve(response('old')); });
    expect(result.current.remoteInvestigations).toEqual([]);
    expect(result.current.error).toBeNull();
  });

  it('starts a new server request without waiting for the old one, and ignores old success', async () => {
    const old = deferred<Response>(); const next = deferred<Response>();
    api.fetch.mockReturnValueOnce(old.promise).mockReturnValueOnce(next.promise);
    const { result, rerender } = renderHook(useRemote, { initialProps: { connected: true, url: 'https://first.example' } });
    const staleRefresh = result.current.refresh;
    rerender({ connected: true, url: 'https://second.example' });
    expect(api.fetch).toHaveBeenCalledTimes(2);
    await act(async () => { old.resolve(response('old')); await staleRefresh(); });
    expect(result.current.remoteInvestigations).toEqual([]);
    expect(result.current.loading).toBe(true);
    expect(api.fetch).toHaveBeenCalledTimes(2);
    await act(async () => { next.resolve(response('current')); });
    expect(result.current.remoteInvestigations.map(row => row.folderId)).toEqual(['current']);
    expect(result.current.loading).toBe(false);
  });

  it('ignores an old failure after reconnecting and does not clear current data', async () => {
    const old = deferred<Response>(); const next = deferred<Response>();
    api.fetch.mockReturnValueOnce(old.promise).mockReturnValueOnce(next.promise);
    const { result, rerender } = renderHook(useRemote, { initialProps: { connected: true, url: 'https://first.example' } });
    rerender({ connected: false, url: 'https://first.example' });
    rerender({ connected: true, url: 'https://first.example' });
    await act(async () => { next.resolve(response('current')); });
    await act(async () => { old.reject(new Error('Old transport failed')); });
    expect(result.current.remoteInvestigations.map(row => row.folderId)).toEqual(['current']);
    expect(result.current.error).toBeNull();
  });

  it('deduplicates concurrent current refreshes but releases the lock on current failure', async () => {
    const first = deferred<Response>(); api.fetch.mockReturnValueOnce(first.promise).mockResolvedValueOnce(response('recovered'));
    const { result } = renderHook(useRemote, { initialProps: { connected: true, url: 'https://first.example' } });
    await act(async () => { await result.current.refresh(); await result.current.refresh(); });
    expect(api.fetch).toHaveBeenCalledTimes(1);
    await act(async () => { first.reject(new Error('Current transport failed')); });
    expect(result.current.error).toBe('Current transport failed');
    expect(result.current.loading).toBe(false);
    await act(async () => { await result.current.refresh(); });
    expect(result.current.error).toBeNull();
    expect(result.current.remoteInvestigations.map(row => row.folderId)).toEqual(['recovered']);
  });

  it('does not issue requests through callbacks retained after unmount', async () => {
    const request = deferred<Response>(); api.fetch.mockReturnValueOnce(request.promise);
    const { result, unmount } = renderHook(useRemote, { initialProps: { connected: true, url: 'https://first.example' } });
    const refresh = result.current.refresh;
    unmount();
    await act(async () => { request.resolve(response('old')); await refresh(); });
    expect(api.fetch).toHaveBeenCalledTimes(1);
  });
});
