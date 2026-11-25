import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { createElement, type ReactNode } from 'react';
import { createInstance } from 'i18next';
import { I18nextProvider } from 'react-i18next';
import commonEn from '../../public/locales/en/common.json';
import commonDe from '../../public/locales/de/common.json';

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
    setSubscriptions = mockWSSetSubscriptions;
    setPresence = mockWSSetPresence;
  },
}));

const mockWSSetSubscriptions = vi.fn();
const mockWSSetPresence = vi.fn();
const mockServerFolderIds = vi.fn<() => Promise<string[]>>(async () => []);
const mockSyncStart = vi.fn();
const mockSyncStop = vi.fn();
const mockSetWSClient = vi.fn();
const mockSetConflictHandler = vi.fn();
const mockSetRemoteChangeHandler = vi.fn();
const mockSetReadyHandler = vi.fn();
const mockSetErrorHandler = vi.fn();
const mockResolveConflicts = vi.fn();
const mockSync = vi.fn();
const mockApplyRemoteChange = vi.fn();
const mockForgetSkippedFolder = vi.fn<(folderId: string) => Promise<void>>(async () => {});

vi.mock('../lib/sync-engine', () => ({
  syncEngine: {
    start: () => mockSyncStart(),
    stop: () => mockSyncStop(),
    setWSClient: (ws: unknown) => mockSetWSClient(ws),
    setConflictHandler: (handler: unknown) => mockSetConflictHandler(handler),
    setRemoteChangeHandler: (handler: unknown) => mockSetRemoteChangeHandler(handler),
    setReadyHandler: (handler: unknown) => mockSetReadyHandler(handler),
    setErrorHandler: (handler: unknown) => mockSetErrorHandler(handler),
    setWorkspaceIdentity: vi.fn(),
    resolveConflicts: (...args: unknown[]) => mockResolveConflicts(...args),
    sync: () => mockSync(),
    applyRemoteChange: (...args: unknown[]) => mockApplyRemoteChange(...args),
    forgetSkippedFolder: (folderId: string) => mockForgetSkippedFolder(folderId),
    serverFolderIds: () => mockServerFolderIds(),
  },
}));

const mockConfigureServerApi = vi.fn();
const mockPauseReason = vi.hoisted(() => vi.fn(async (): Promise<string | null> => null));
vi.mock('../lib/sync-capture-policy', () => ({ getSyncPauseReason: () => mockPauseReason() }));
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
    identities: vi.fn(),
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

  it('surfaces offline transport errors without changing durable capture policy', async () => {
    const auth = { ...makeAuth({ connected: false }), user: { id: 'u1' } };
    const { result } = renderHook(() => useServerSync(auth, makeReloadFns()));
    await flushPromises();
    expect(mockEnableSync).not.toHaveBeenCalled();
    act(() => mockSetErrorHandler.mock.calls[0][0]('Sync paused; edits retained'));
    expect(result.current.syncError).toBe('Sync paused; edits retained');
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
    expect(mockEnableSync).not.toHaveBeenCalled();
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

  it('subscribes the socket to the investigations the server holds', async () => {
    mockServerFolderIds.mockResolvedValue(['folder-1', 'folder-2']);
    mockWSSetSubscriptions.mockClear();

    renderHook(() => useServerSync(makeAuth(), makeReloadFns()));
    await flushPromises();
    await vi.waitFor(() => expect(mockWSSetSubscriptions).toHaveBeenCalledWith(['folder-1', 'folder-2']));
    mockServerFolderIds.mockResolvedValue([]);
  });

  it('stops transport without disabling durable capture when auth is disconnected', async () => {
    const auth = makeAuth({ serverUrl: null, connected: false });
    const reloadFns = makeReloadFns();

    renderHook(() => useServerSync(auth, reloadFns));
    await flushPromises();

    expect(mockDisableSync).not.toHaveBeenCalled();
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
    expect(mockDisableSync).not.toHaveBeenCalled();
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

  it('forgets skipped server rows of an investigation whose access was revoked', async () => {
    const reloadFns = makeReloadFns();
    renderHook(() => useServerSync(makeAuth(), reloadFns));
    await flushPromises();
    const handler = mockWSOn.mock.calls.find((call) => call[0] === 'access-revoked')?.[1] as ((msg: unknown) => void) | undefined;
    handler?.({ folderId: 'folder-123' });
    expect(mockForgetSkippedFolder).toHaveBeenCalledWith('folder-123');
    expect(reloadFns.folders).toHaveBeenCalled();
  });

  it('resolves a single conflict', async () => {
    const auth = makeAuth();
    const reloadFns = makeReloadFns();

    const { result } = renderHook(() => useServerSync(auth, reloadFns));
    await flushPromises();

    // Set up some conflicts
    const handler = mockSetConflictHandler.mock.calls[0][0] as (conflicts: unknown[]) => void;
    const conflicts = [
      { entityId: 'e1', table: 'notes', status: 'conflict' },
      { entityId: 'e2', table: 'tasks', status: 'conflict' },
    ];

    await act(async () => {
      handler(conflicts);
    });

    await act(async () => {
      await result.current.handleResolveConflict('e1', 'mine');
    });

    expect(mockResolveConflicts).toHaveBeenCalledWith(
      [{ entityId: 'e1', table: 'notes', status: 'conflict' }],
      'mine',
    );
    expect(result.current.syncConflicts).toHaveLength(1);
    expect(result.current.syncConflicts[0]).toEqual({ entityId: 'e2', table: 'tasks', status: 'conflict' });
  });

  it('resolves all conflicts at once', async () => {
    const auth = makeAuth();
    const reloadFns = makeReloadFns();

    const { result } = renderHook(() => useServerSync(auth, reloadFns));
    await flushPromises();

    const handler = mockSetConflictHandler.mock.calls[0][0] as (conflicts: unknown[]) => void;
    const conflicts = [
      { entityId: 'e1', table: 'notes', status: 'conflict' },
      { entityId: 'e2', table: 'tasks', status: 'conflict' },
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

  it('keeps a conflict whose server version this device cannot read when all are resolved as theirs', async () => {
    const { result } = renderHook(() => useServerSync(makeAuth(), makeReloadFns()));
    await flushPromises();
    const handler = mockSetConflictHandler.mock.calls[0][0] as (conflicts: unknown[]) => void;
    const unreadable = { entityId: 'i1', table: 'standaloneIOCs', status: 'conflict', serverVersion: 3, serverData: { id: 'i1', type: 'ip', value: '198.51.100.1' } };
    const readable = { entityId: 'n1', table: 'notes', status: 'conflict', serverVersion: 4, serverData: { id: 'n1', title: 'Theirs' } };
    await act(async () => { handler([unreadable, readable]); });
    await act(async () => { await result.current.handleResolveAllConflicts('theirs'); });
    expect(mockResolveConflicts).toHaveBeenLastCalledWith([readable], 'theirs');
    expect(result.current.syncConflicts).toEqual([unreadable]);
  });

  it('starts with empty presence users', () => {
    const auth = makeAuth({ serverUrl: null, connected: false });
    const reloadFns = makeReloadFns();

    const { result } = renderHook(() => useServerSync(auth, reloadFns));
    expect(result.current.presenceFor('folder-1')).toEqual([]);
  });

  it('keeps presence per investigation, without this person, and tells the socket where they are', async () => {
    const auth = { ...makeAuth(), user: { id: 'me' } };
    const { result } = renderHook(() => useServerSync(auth, makeReloadFns()));
    // Reported before the socket exists: handed over when it is created.
    act(() => result.current.reportPresence('folder-1', 'notes'));
    await vi.waitFor(() => expect(mockWSSetPresence).toHaveBeenCalledWith('folder-1', 'notes'));
    const onPresence = mockWSOn.mock.calls.find(call => call[0] === 'presence')?.[1] as (message: unknown) => void;
    const dana = { id: 'dana', displayName: 'Dana', avatarUrl: null, view: 'timeline' };
    act(() => {
      onPresence({ type: 'presence', folderId: 'folder-1', users: [{ id: 'me', displayName: 'Me', avatarUrl: null, view: 'notes' }, dana] });
      onPresence({ type: 'presence', folderId: 'folder-2', users: [] });
      onPresence({ type: 'presence', users: [{ id: 'nobody' }] });
    });
    expect(result.current.presenceFor('folder-1')).toEqual([dana]);
    expect(result.current.presenceFor('folder-2')).toEqual([]);
    expect(result.current.presenceFor(undefined)).toEqual([]);
    act(() => result.current.reportPresence(null, 'investigations'));
    expect(mockWSSetPresence).toHaveBeenLastCalledWith(null, 'investigations');
    // The server repeats an unchanged list at every member's update: the list handed out stays the same one.
    const before = result.current.presenceFor;
    act(() => onPresence({ type: 'presence', folderId: 'folder-1', users: [{ id: 'me', displayName: 'Me', avatarUrl: null, view: 'notes' }, dana] }));
    expect(result.current.presenceFor).toBe(before);
  });

  it("waits before syncing on this person's own change from another device or tab", async () => {
    const auth = { ...makeAuth(), user: { id: 'me' } };
    renderHook(() => useServerSync(auth, makeReloadFns()));
    await vi.waitFor(() => expect(mockWSOn.mock.calls.some(call => call[0] === 'entity-change')).toBe(true));
    const onChange = mockWSOn.mock.calls.find(call => call[0] === 'entity-change')?.[1] as (message: unknown) => void;
    vi.useFakeTimers();
    try {
      mockSync.mockClear(); mockApplyRemoteChange.mockClear();
      mockApplyRemoteChange.mockResolvedValue(undefined);
      onChange({ type: 'entity-change', table: 'notes', op: 'put', entityId: 'n1', updatedBy: 'me' });
      // A tab of the same browser shares the outgoing queue with the one that is still pushing.
      expect(mockApplyRemoteChange).not.toHaveBeenCalled();
      vi.advanceTimersByTime(1499);
      expect(mockSync).not.toHaveBeenCalled();
      vi.advanceTimersByTime(1);
      expect(mockSync).toHaveBeenCalledTimes(1);
      onChange({ type: 'entity-change', table: 'notes', op: 'put', entityId: 'n2', updatedBy: 'dana' });
      expect(mockApplyRemoteChange).toHaveBeenCalledWith('notes', 'put', 'n2', undefined);
    } finally { vi.useRealTimers(); }
  });

  it('keeps sync paused with a translated notice when its safety state cannot be read', async () => {
    const locale = createInstance();
    await locale.init({ lng: 'de', fallbackLng: 'en', defaultNS: 'common', interpolation: { escapeValue: false },
      resources: { en: { common: commonEn }, de: { common: commonDe } } });
    mockPauseReason.mockRejectedValueOnce(new Error('Synthetic unreadable sync metadata'));
    const wrapper = ({ children }: { children: ReactNode }) => createElement(I18nextProvider, { i18n: locale }, children);
    const { result } = renderHook(() => useServerSync(makeAuth({ serverUrl: null, connected: false }), makeReloadFns()), { wrapper });
    await flushPromises();
    expect(commonDe['syncStatus.pausedUnreadable']).not.toBe(commonEn['syncStatus.pausedUnreadable']);
    expect(result.current.syncError).toBe(commonDe['syncStatus.pausedUnreadable']);
  });
});
