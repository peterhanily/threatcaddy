import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';

// ── Mocks ────────────────────────────────────────────────────────────

const mockWSConnect = vi.fn();
const mockWSDisconnect = vi.fn();
const mockWSOn = vi.fn();
const mockWSOnStatusChange = vi.fn();

// Track constructor calls
const mockWSConstructorArgs: unknown[][] = [];

vi.mock('../lib/ws-client', () => ({
  WSClient: class MockWSClient {
    constructor(...args: unknown[]) {
      mockWSConstructorArgs.push(args);
    }
    connect = mockWSConnect;
    disconnect = mockWSDisconnect;
    on = mockWSOn;
    onStatusChange = mockWSOnStatusChange;
  },
}));

const mockSyncStart = vi.fn();
const mockSyncStop = vi.fn();
const mockSetWSClient = vi.fn();
const mockSetConflictHandler = vi.fn();
const mockSetRemoteChangeHandler = vi.fn();
const mockSetReadyHandler = vi.fn();
const mockResolveConflicts = vi.fn();
const mockSync = vi.fn();
const mockApplyRemoteChange = vi.fn();

vi.mock('../lib/sync-engine', () => ({
  syncEngine: {
    start: () => mockSyncStart(),
    stop: () => mockSyncStop(),
    setWSClient: (ws: unknown) => mockSetWSClient(ws),
    setConflictHandler: (handler: unknown) => mockSetConflictHandler(handler),
    setRemoteChangeHandler: (handler: unknown) => mockSetRemoteChangeHandler(handler),
    setReadyHandler: (handler: unknown) => mockSetReadyHandler(handler),
    resolveConflicts: (...args: unknown[]) => mockResolveConflicts(...args),
    sync: () => mockSync(),
    applyRemoteChange: (...args: unknown[]) => mockApplyRemoteChange(...args),
  },
}));

const mockConfigureServerApi = vi.fn();
vi.mock('../lib/server-api', () => ({
  configureServerApi: (...args: unknown[]) => mockConfigureServerApi(...args),
}));

const mockEnableSync = vi.fn();
const mockDisableSync = vi.fn();
vi.mock('../lib/sync-middleware', () => ({
  enableSync: () => mockEnableSync(),
  disableSync: () => mockDisableSync(),
}));

// Import after mocks
import { useServerSync } from '../hooks/useServerSync';

// ── Helpers ──────────────────────────────────────────────────────────

function makeAuth(overrides: Partial<{
  serverUrl: string | null;
  connected: boolean;
  getAccessToken: () => Promise<string | null>;
  invalidateAccessToken: () => void;
  setReachable: (ok: boolean) => void;
}> = {}) {
  return {
    serverUrl: 'https://server.example.com',
    connected: true,
    getAccessToken: vi.fn(async () => 'test-token'),
    invalidateAccessToken: vi.fn(),
    setReachable: vi.fn(),
    ...overrides,
  };
}

function makeReloadFns() {
  return {
    notes: vi.fn(),
    tasks: vi.fn(),
    timeline: vi.fn(),
    timelines: vi.fn(),
    whiteboards: vi.fn(),
    standaloneIOCs: vi.fn(),
    chats: vi.fn(),
    folders: vi.fn(),
    tags: vi.fn(),
  };
}

async function flushPromises() {
  await act(async () => {
    await new Promise((r) => setTimeout(r, 50));
  });
}

// ── Tests ────────────────────────────────────────────────────────────

describe('useServerSync', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockWSConstructorArgs.length = 0;
  });

  it('establishes connection when auth is connected', async () => {
    const auth = makeAuth();
    const reloadFns = makeReloadFns();

    renderHook(() => useServerSync(auth, reloadFns));
    await flushPromises();

    expect(mockConfigureServerApi).toHaveBeenCalledWith(
      'https://server.example.com',
      auth.getAccessToken,
      auth.invalidateAccessToken,
    );
    expect(mockEnableSync).toHaveBeenCalled();
    expect(mockSyncStart).toHaveBeenCalled();
    expect(mockSetConflictHandler).toHaveBeenCalled();
    expect(mockSetRemoteChangeHandler).toHaveBeenCalled();
  });

  it('creates WSClient and connects when token is available', async () => {
    const auth = makeAuth();
    const reloadFns = makeReloadFns();

    renderHook(() => useServerSync(auth, reloadFns));
    await flushPromises();

    expect(mockWSConstructorArgs).toHaveLength(1);
    expect(mockWSConstructorArgs[0]).toEqual(['https://server.example.com', 'test-token']);
    expect(mockWSConnect).toHaveBeenCalled();
    expect(mockWSOn).toHaveBeenCalled();
  });

  it('disables sync and disconnects when auth is disconnected', async () => {
    const auth = makeAuth({ serverUrl: null, connected: false });
    const reloadFns = makeReloadFns();

    renderHook(() => useServerSync(auth, reloadFns));
    await flushPromises();

    expect(mockDisableSync).toHaveBeenCalled();
    expect(mockSyncStop).toHaveBeenCalled();
    expect(mockSetWSClient).toHaveBeenCalledWith(null);
  });

  it('cleans up on unmount', async () => {
    const auth = makeAuth();
    const reloadFns = makeReloadFns();

    const { unmount } = renderHook(() => useServerSync(auth, reloadFns));
    await flushPromises();

    // Clear mock counts before unmount
    mockSyncStop.mockClear();
    mockDisableSync.mockClear();
    mockSetWSClient.mockClear();

    unmount();

    expect(mockSyncStop).toHaveBeenCalled();
    expect(mockDisableSync).toHaveBeenCalled();
    expect(mockSetWSClient).toHaveBeenCalledWith(null);
  });

  it('sets conflict handler that updates syncConflicts', async () => {
    const auth = makeAuth();
    const reloadFns = makeReloadFns();

    const { result } = renderHook(() => useServerSync(auth, reloadFns));
    await flushPromises();

    // Extract the conflict handler
    const handler = mockSetConflictHandler.mock.calls[0][0] as (conflicts: unknown[]) => void;
    const mockConflicts = [{ entityId: 'e1', table: 'notes' }];

    await act(async () => {
      handler(mockConflicts);
    });

    expect(result.current.syncConflicts).toEqual(mockConflicts);
  });

  it('calls folder invite handler when folder-invite event fires', async () => {
    const auth = makeAuth();
    const reloadFns = makeReloadFns();
    const onFolderInvite = vi.fn();

    renderHook(() => useServerSync(auth, reloadFns, onFolderInvite));
    await flushPromises();

    // Find the 'folder-invite' listener registered on the WS client
    const folderInviteCall = mockWSOn.mock.calls.find(
      (call) => call[0] === 'folder-invite',
    );
    expect(folderInviteCall).toBeTruthy();

    const handler = folderInviteCall![1] as (msg: unknown) => void;
    handler({ folderId: 'folder-123' });
    expect(onFolderInvite).toHaveBeenCalledWith('folder-123');
  });

  it('resolves a single conflict', async () => {
    const auth = makeAuth();
    const reloadFns = makeReloadFns();

    const { result } = renderHook(() => useServerSync(auth, reloadFns));
    await flushPromises();

    // Set up some conflicts
    const handler = mockSetConflictHandler.mock.calls[0][0] as (conflicts: unknown[]) => void;
    const conflicts = [
      { entityId: 'e1', table: 'notes' },
      { entityId: 'e2', table: 'tasks' },
    ];

    await act(async () => {
      handler(conflicts);
    });

    await act(async () => {
      await result.current.handleResolveConflict('e1', 'mine');
    });

    expect(mockResolveConflicts).toHaveBeenCalledWith(
      [{ entityId: 'e1', table: 'notes' }],
      'mine',
    );
    expect(result.current.syncConflicts).toHaveLength(1);
    expect(result.current.syncConflicts[0]).toEqual({ entityId: 'e2', table: 'tasks' });
  });

  it('resolves all conflicts at once', async () => {
    const auth = makeAuth();
    const reloadFns = makeReloadFns();

    const { result } = renderHook(() => useServerSync(auth, reloadFns));
    await flushPromises();

    const handler = mockSetConflictHandler.mock.calls[0][0] as (conflicts: unknown[]) => void;
    const conflicts = [
      { entityId: 'e1', table: 'notes' },
      { entityId: 'e2', table: 'tasks' },
    ];

    await act(async () => {
      handler(conflicts);
    });

    await act(async () => {
      await result.current.handleResolveAllConflicts('theirs');
    });

    expect(mockResolveConflicts).toHaveBeenCalledWith(conflicts, 'theirs');
    expect(result.current.syncConflicts).toHaveLength(0);
  });

  it('starts with empty presence users', () => {
    const auth = makeAuth({ serverUrl: null, connected: false });
    const reloadFns = makeReloadFns();

    const { result } = renderHook(() => useServerSync(auth, reloadFns));
    expect(result.current.presenceUsers).toEqual([]);
  });
});
