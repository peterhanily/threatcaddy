import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useServerSync } from '../hooks/useServerSync';

const mocks = vi.hoisted(() => ({
  ready: vi.fn(), remote: vi.fn(), conflicts: vi.fn(), error: vi.fn(), apply: vi.fn(), sync: vi.fn(), resolve: vi.fn(),
  sockets: [] as Array<{ handlers: Map<string, (message: Record<string, unknown>) => void>; status?: (connected: boolean) => void; disconnect: ReturnType<typeof vi.fn> }>,
}));
vi.mock('../lib/server-api', () => ({ configureServerApi: vi.fn() }));
vi.mock('../lib/sync-middleware', () => ({ enableSync: vi.fn(), disableSync: vi.fn() }));
vi.mock('../lib/sync-engine', () => ({ syncEngine: {
  start: vi.fn(), stop: vi.fn(), setWSClient: vi.fn(), setWorkspaceIdentity: vi.fn(),
  setReadyHandler: mocks.ready, setRemoteChangeHandler: mocks.remote, setConflictHandler: mocks.conflicts,
  setErrorHandler: mocks.error, applyRemoteChange: mocks.apply, sync: mocks.sync, resolveConflicts: mocks.resolve,
} }));
vi.mock('../lib/ws-client', () => ({ WSClient: class {
  handlers = new Map<string, (message: Record<string, unknown>) => void>();
  status?: (connected: boolean) => void;
  disconnect = vi.fn();
  constructor() { mocks.sockets.push(this); }
  connect() {}
  on(name: string, handler: (message: Record<string, unknown>) => void) { this.handlers.set(name, handler); }
  onStatusChange(handler: (connected: boolean) => void) { this.status = handler; }
} }));
const makeAuth = () => ({ user: { id: 'analyst' }, serverUrl: 'https://first.example', connected: true, getAccessToken: vi.fn(async () => 'test-token'), setReachable: vi.fn() });
const reloads = () => ({ notes: vi.fn(), tasks: vi.fn(), timeline: vi.fn(), timelines: vi.fn(), whiteboards: vi.fn(), standaloneIOCs: vi.fn(), evidenceItems: vi.fn(), chats: vi.fn(), folders: vi.fn(), tags: vi.fn(), onSyncPullComplete: vi.fn() });
beforeEach(() => { vi.clearAllMocks(); mocks.sockets.length = 0; mocks.apply.mockResolvedValue(undefined); mocks.resolve.mockResolvedValue(undefined); });

describe('sync callback ownership', () => {
  it('drops queued reloads, ready/conflict handlers and socket events after unmount', async () => {
    const auth = makeAuth(); const reload = reloads(); const invite = vi.fn();
    const { unmount } = renderHook(() => useServerSync(auth, reload, invite));
    await act(async () => {});
    const socket = mocks.sockets[0];
    if (!socket) throw new Error('Expected the live socket');
    act(() => {
      mocks.remote.mock.calls[0][0]([], new Set(['notes']));
      unmount();
    });
    await act(async () => {
      mocks.ready.mock.calls[0][0]();
      mocks.conflicts.mock.calls[0][0]([{ entityId: 'old', table: 'notes', status: 'conflict' }]);
      socket.status?.(false);
      socket.handlers.get('entity-change')?.({ table: 'notes', op: 'put', entityId: 'old' });
      socket.handlers.get('folder-invite')?.({ folderId: 'old' });
      socket.handlers.get('access-revoked')?.({ folderId: 'old' });
    });
    expect(reload.notes).not.toHaveBeenCalled();
    expect(reload.folders).not.toHaveBeenCalled();
    expect(reload.onSyncPullComplete).not.toHaveBeenCalled();
    expect(invite).not.toHaveBeenCalled();
    expect(auth.setReachable).not.toHaveBeenCalled();
    expect(mocks.apply).not.toHaveBeenCalled();
    expect(socket.disconnect).toHaveBeenCalled();
  });

  it('uses committed latest callbacks without reconnecting on ordinary render changes', async () => {
    const auth = makeAuth(); const first = reloads(); const latest = reloads();
    const firstInvite = vi.fn(); const latestInvite = vi.fn();
    const { rerender } = renderHook(({ reload, invite }) => useServerSync(auth, reload, invite), { initialProps: { reload: first, invite: firstInvite } });
    await act(async () => {});
    rerender({ reload: latest, invite: latestInvite });
    const socket = mocks.sockets[0];
    if (!socket) throw new Error('Expected the live socket');
    await act(async () => {
      mocks.remote.mock.calls[0][0]([], new Set(['notes', 'evidenceItems']));
      socket.handlers.get('folder-invite')?.({ folderId: 'current' });
    });
    expect(mocks.sockets).toHaveLength(1);
    expect(first.notes).not.toHaveBeenCalled();
    expect(firstInvite).not.toHaveBeenCalled();
    expect(latest.notes).toHaveBeenCalledOnce();
    expect(latest.evidenceItems).toHaveBeenCalledOnce();
    expect(latestInvite).toHaveBeenCalledWith('current');
  });

  it('rejects retained conflict decisions and old socket state after a server change', async () => {
    const auth = makeAuth(); const reload = reloads();
    const { result, rerender } = renderHook(({ serverUrl }) => useServerSync({ ...auth, serverUrl }, reload), { initialProps: { serverUrl: auth.serverUrl } });
    await act(async () => {});
    const old = mocks.sockets[0];
    if (!old) throw new Error('Expected the old socket');
    act(() => {
      old.handlers.get('presence')?.({ users: [{ id: 'old-user' }] });
      mocks.conflicts.mock.calls[0][0]([{ entityId: 'old', table: 'notes', status: 'conflict' }]);
    });
    const oldDecision = result.current.handleResolveAllConflicts;
    rerender({ serverUrl: 'https://second.example' });
    await act(async () => {
      old.handlers.get('presence')?.({ users: [{ id: 'late-old-user' }] });
      mocks.error.mock.calls[0][0]('Old transport error');
      await oldDecision('mine');
    });
    expect(result.current.presenceUsers).toEqual([]);
    expect(result.current.syncConflicts).toEqual([]);
    expect(result.current.syncError).toBeNull();
    expect(mocks.resolve).not.toHaveBeenCalled();
  });

  it('does not restart synchronization for a remote-apply rejection after cleanup', async () => {
    let reject!: (error: Error) => void;
    mocks.apply.mockReturnValueOnce(new Promise<void>((_resolve, fail) => { reject = fail; }));
    const { unmount } = renderHook(() => useServerSync(makeAuth(), reloads()));
    await act(async () => {});
    const socket = mocks.sockets[0];
    if (!socket) throw new Error('Expected the live socket');
    socket.handlers.get('entity-change')?.({ table: 'notes', op: 'put', entityId: 'current' });
    unmount();
    await act(async () => reject(new Error('Late apply rejection')));
    expect(mocks.sync).not.toHaveBeenCalled();
  });
});
