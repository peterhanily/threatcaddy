import { act, renderHook } from '@testing-library/react';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { InvestigationProvider, useInvestigation } from '../contexts/InvestigationContext';
import type { Folder, InvestigationMember } from '../types';

const api = vi.hoisted(() => ({ members: vi.fn(), count: vi.fn(), bridge: vi.fn() }));
vi.mock('../lib/server-api', () => ({ fetchInvestigationMembers: api.members }));
vi.mock('../lib/agent-bridge', () => ({ syncBridgeFolderId: api.bridge }));
vi.mock('../lib/sync-cache', () => ({ evictSyncedFolder: vi.fn() }));
vi.mock('../db', () => ({ db: { agentActions: { where: () => ({
  equals: ([folderId]: [string, string]) => ({ count: () => api.count(folderId) }),
}) } } }));

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: Error) => void;
  const promise = new Promise<T>((done, fail) => { resolve = done; reject = fail; });
  return { promise, resolve, reject };
}
const folders: Folder[] = ['first', 'second'].map(id => ({ id, name: id, order: 0, createdAt: 1 }));
const member = (id: string): InvestigationMember => ({ id, userId: id, role: 'viewer', joinedAt: '2026-10-04', displayName: id, email: `${id}@example.test` });
beforeEach(() => {
  api.members.mockReset().mockResolvedValue([]);
  api.count.mockReset().mockResolvedValue(0);
  api.bridge.mockClear();
});
const wrapper = ({ children }: { children: ReactNode }) => <InvestigationProvider folders={folders} tags={[]} authConnected initialSelectedFolderId="first">{children}</InvestigationProvider>;

describe('investigation context scope ownership', () => {
  it('does not show a previous folder membership or pending count in the selected folder', async () => {
    const oldMembers = deferred<InvestigationMember[]>(); const nextMembers = deferred<InvestigationMember[]>();
    const oldCount = deferred<number>(); const nextCount = deferred<number>();
    api.members.mockReturnValueOnce(oldMembers.promise).mockReturnValueOnce(nextMembers.promise);
    api.count.mockReturnValueOnce(oldCount.promise).mockReturnValueOnce(nextCount.promise);
    const { result } = renderHook(useInvestigation, { wrapper });
    act(() => result.current.setSelectedFolderId('second'));
    await act(async () => { oldMembers.resolve([member('old')]); oldCount.resolve(99); });
    expect(result.current.investigationMembers).toEqual([]);
    expect(result.current.agentPendingCount).toBe(0);
    await act(async () => { nextMembers.resolve([member('current')]); nextCount.resolve(2); });
    expect(result.current.investigationMembers.map(row => row.id)).toEqual(['current']);
    expect(result.current.agentPendingCount).toBe(2);
  });

  it('does not clear current members or pending counts when old requests reject', async () => {
    const oldMembers = deferred<InvestigationMember[]>(); const oldCount = deferred<number>();
    api.members.mockReturnValueOnce(oldMembers.promise).mockResolvedValueOnce([member('current')]);
    api.count.mockReturnValueOnce(oldCount.promise).mockResolvedValueOnce(3);
    const { result } = renderHook(useInvestigation, { wrapper });
    await act(async () => result.current.setSelectedFolderId('second'));
    await act(async () => { oldMembers.reject(new Error('Old membership failure')); oldCount.reject(new Error('Old query failure')); });
    expect(result.current.investigationMembers.map(row => row.id)).toEqual(['current']);
    expect(result.current.agentPendingCount).toBe(3);
  });

  it('clears membership on disconnect and ignores the still-pending response', async () => {
    const request = deferred<InvestigationMember[]>(); api.members.mockReturnValueOnce(request.promise);
    let connected = true;
    const { result, rerender } = renderHook(useInvestigation, { wrapper: ({ children }) => <InvestigationProvider folders={folders} tags={[]} authConnected={connected} initialSelectedFolderId="first">{children}</InvestigationProvider> });
    connected = false;
    rerender();
    await act(async () => request.resolve([member('old')]));
    expect(result.current.investigationMembers).toEqual([]);
  });

  it('keeps remote-only investigation selection even when other local folders exist', async () => {
    const { result } = renderHook(useInvestigation, { wrapper });
    await act(async () => result.current.handleOpenInvestigation('remote-only', 'remote'));
    expect(result.current.selectedFolderId).toBe('remote-only');
    expect(result.current.investigationMode).toBe('remote');
    await act(async () => result.current.clearFilters());
    expect(result.current.selectedFolderId).toBeUndefined();
    expect(result.current.investigationMode).toBe('local');
    expect(api.bridge).toHaveBeenLastCalledWith(undefined);
  });
});
