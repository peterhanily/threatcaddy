import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';

// ── vi.hoisted — mock fns available in vi.mock factories ──────────────────────

const {
  mockFetchInvestigations,
  mockSyncSnapshot,
  mockDbTables,
  makeWhereChain,
} = vi.hoisted(() => {
  const mockFetchInvestigations = vi.fn();
  const mockSyncSnapshot = vi.fn();

  const mockDbTables: Record<string, unknown[]> = {
    notes: [],
    tasks: [],
    timelineEvents: [],
    whiteboards: [],
    standaloneIOCs: [],
    chatThreads: [],
    evidenceItems: [],
  };

  function makeWhereChain(dataRef: () => unknown[]) {
    return {
      where: () => ({
        equals: () => ({
          toArray: () => Promise.resolve(dataRef()),
        }),
      }),
    };
  }

  return { mockFetchInvestigations, mockSyncSnapshot, mockDbTables, makeWhereChain };
});

// ── Mocks ─────────────────────────────────────────────────────────────────────

vi.mock('../lib/server-api', () => ({
  fetchInvestigations: (...args: unknown[]) => mockFetchInvestigations(...args),
  syncSnapshot: (...args: unknown[]) => mockSyncSnapshot(...args),
}));

vi.mock('../db', () => ({
  db: {
    notes: makeWhereChain(() => mockDbTables.notes),
    tasks: makeWhereChain(() => mockDbTables.tasks),
    timelineEvents: makeWhereChain(() => mockDbTables.timelineEvents),
    whiteboards: makeWhereChain(() => mockDbTables.whiteboards),
    standaloneIOCs: makeWhereChain(() => mockDbTables.standaloneIOCs),
    chatThreads: makeWhereChain(() => mockDbTables.chatThreads),
    evidenceItems: makeWhereChain(() => mockDbTables.evidenceItems),
  },
}));

// ── Import hooks (after mocks) ────────────────────────────────────────────────

import { useRemoteInvestigations } from '../hooks/useRemoteInvestigations';
import { useInvestigationData } from '../hooks/useInvestigationData';
import type { InvestigationSummary } from '../types';

// ── Fixtures ──────────────────────────────────────────────────────────────────

const fakeSummary: InvestigationSummary = {
  folderId: 'folder-1',
  role: 'editor',
  joinedAt: '2024-01-01T00:00:00Z',
  folder: {
    name: 'Op Midnight',
    status: 'active',
    createdAt: '2024-01-01T00:00:00Z',
    updatedAt: '2024-01-02T00:00:00Z',
  },
  entityCounts: { notes: 5, tasks: 3, iocs: 2, events: 1, whiteboards: 0, chats: 0 },
  memberCount: 4,
};

function resetDbTables() {
  for (const key of Object.keys(mockDbTables)) {
    mockDbTables[key] = [];
  }
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('useRemoteInvestigations', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns empty array when serverConnected is false', async () => {
    const { result } = renderHook(() => useRemoteInvestigations(false));
    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });
    expect(result.current.remoteInvestigations).toEqual([]);
    expect(mockFetchInvestigations).not.toHaveBeenCalled();
  });

  it('extracts .data from the fetchInvestigations response envelope', async () => {
    mockFetchInvestigations.mockResolvedValue({ data: [fakeSummary] });
    const { result } = renderHook(() => useRemoteInvestigations(true));
    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });
    expect(result.current.remoteInvestigations).toEqual([fakeSummary]);
  });

  it('sets loading to true during fetch, false after', async () => {
    let resolve!: (v: unknown) => void;
    mockFetchInvestigations.mockReturnValue(new Promise((r) => { resolve = r; }));
    const { result } = renderHook(() => useRemoteInvestigations(true));

    // Loading should be true while fetch is in progress
    await waitFor(() => {
      expect(result.current.loading).toBe(true);
    });

    // Resolve fetch
    await act(async () => {
      resolve({ data: [] });
    });

    expect(result.current.loading).toBe(false);
  });

  it('handles fetch errors — sets error state and returns empty array', async () => {
    mockFetchInvestigations.mockRejectedValue(new Error('Network failure'));
    const { result } = renderHook(() => useRemoteInvestigations(true));
    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });
    expect(result.current.error).toBe('Network failure');
    expect(result.current.remoteInvestigations).toEqual([]);
  });

  it('handles non-Error throw — sets generic error message', async () => {
    mockFetchInvestigations.mockRejectedValue('kaboom');
    const { result } = renderHook(() => useRemoteInvestigations(true));
    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });
    expect(result.current.error).toBe('Failed to fetch investigations');
  });

  it('calling refresh() triggers a new fetch', async () => {
    mockFetchInvestigations.mockResolvedValue({ data: [fakeSummary] });
    const { result } = renderHook(() => useRemoteInvestigations(true));
    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });
    expect(mockFetchInvestigations).toHaveBeenCalledTimes(1);

    // Refresh
    mockFetchInvestigations.mockResolvedValue({ data: [] });
    await act(async () => {
      await result.current.refresh();
    });
    expect(mockFetchInvestigations).toHaveBeenCalledTimes(2);
    expect(result.current.remoteInvestigations).toEqual([]);
  });

  it('clears investigations and error when serverConnected transitions to false', async () => {
    mockFetchInvestigations.mockResolvedValue({ data: [fakeSummary] });
    const { result, rerender } = renderHook(
      ({ connected }) => useRemoteInvestigations(connected),
      { initialProps: { connected: true } },
    );
    await waitFor(() => {
      expect(result.current.remoteInvestigations).toHaveLength(1);
    });

    rerender({ connected: false });
    await waitFor(() => {
      expect(result.current.remoteInvestigations).toEqual([]);
      expect(result.current.error).toBeNull();
    });
  });

  it('refresh() is a no-op when not connected', async () => {
    const { result } = renderHook(() => useRemoteInvestigations(false));
    await act(async () => {
      await result.current.refresh();
    });
    expect(mockFetchInvestigations).not.toHaveBeenCalled();
  });
});

// ── useInvestigationData ──────────────────────────────────────────────────────

describe('useInvestigationData', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetDbTables();
  });

  it('returns empty data when folderId is null', () => {
    const { result } = renderHook(() => useInvestigationData(null, 'local'));
    expect(result.current.notes).toEqual([]);
    expect(result.current.tasks).toEqual([]);
    expect(result.current.events).toEqual([]);
    expect(result.current.loading).toBe(false);
    expect(result.current.isRemote).toBe(false);
  });

  it('local mode: reads from Dexie, filters out trashed/archived', async () => {
    mockDbTables.notes = [
      { id: 'n1', trashed: false, archived: false },
      { id: 'n2', trashed: true, archived: false },
      { id: 'n3', trashed: false, archived: true },
    ];
    mockDbTables.tasks = [
      { id: 't1', trashed: false, archived: false },
    ];

    const { result } = renderHook(() => useInvestigationData('folder-1', 'local'));
    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });
    expect(result.current.notes).toHaveLength(1);
    expect(result.current.notes[0].id).toBe('n1');
    expect(result.current.tasks).toHaveLength(1);
    expect(result.current.isRemote).toBe(false);
  });

  it('remote mode: calls syncSnapshot, maps response keys correctly', async () => {
    mockSyncSnapshot.mockResolvedValue({
      notes: [{ id: 'n1' }],
      tasks: [{ id: 't1' }, { id: 't2' }],
      timelineEvents: [{ id: 'e1' }],
      whiteboards: [],
      standaloneIOCs: [{ id: 'i1', type: 'domain', value: 'example.invalid' }],
      chatThreads: [{ id: 'c1' }],
      evidenceItems: [{ id: 'evidence-1', fileName: 'fixture.txt', title: 'Fixture', content: 'Readable source' }],
    });

    const { result } = renderHook(() => useInvestigationData('folder-remote', 'remote'));
    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(mockSyncSnapshot).toHaveBeenCalledWith('folder-remote');
    expect(result.current.notes).toHaveLength(1);
    expect(result.current.tasks).toHaveLength(2);
    // timelineEvents -> events
    expect(result.current.events).toHaveLength(1);
    // standaloneIOCs -> iocs
    expect(result.current.iocs).toHaveLength(1);
    // chatThreads -> chats
    expect(result.current.chats).toHaveLength(1);
    expect(result.current.evidence).toHaveLength(1);
    expect(result.current.isRemote).toBe(true);
  });

  it('remote mode: handles missing keys in snapshot gracefully', async () => {
    mockSyncSnapshot.mockResolvedValue({});
    const { result } = renderHook(() => useInvestigationData('folder-x', 'remote'));
    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });
    expect(result.current.notes).toEqual([]);
    expect(result.current.events).toEqual([]);
    expect(result.current.iocs).toEqual([]);
  });

  it('handles fetch errors gracefully', async () => {
    mockSyncSnapshot.mockRejectedValue(new Error('Server unreachable'));
    const { result } = renderHook(() => useInvestigationData('folder-err', 'remote'));
    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });
    expect(result.current.error).toBe('Server unreachable');
    expect(result.current.notes).toEqual([]);
  });

  it('isRemote is true only for remote mode', () => {
    const { result: localResult } = renderHook(() => useInvestigationData('f1', 'local'));
    expect(localResult.current.isRemote).toBe(false);

    const { result: syncedResult } = renderHook(() => useInvestigationData('f2', 'synced'));
    expect(syncedResult.current.isRemote).toBe(false);

    mockSyncSnapshot.mockResolvedValue({});
    const { result: remoteResult } = renderHook(() => useInvestigationData('f3', 'remote'));
    expect(remoteResult.current.isRemote).toBe(true);
  });

  it('re-fetches when folderId changes', async () => {
    mockDbTables.notes = [{ id: 'n1', trashed: false, archived: false }];

    const { result, rerender } = renderHook(
      ({ folderId }) => useInvestigationData(folderId, 'local'),
      { initialProps: { folderId: 'folder-a' as string | null } },
    );
    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });
    expect(result.current.notes).toHaveLength(1);

    // Switch to null
    rerender({ folderId: null });
    expect(result.current.notes).toEqual([]);
  });
});
