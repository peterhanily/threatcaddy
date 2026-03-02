/* eslint-disable @typescript-eslint/no-non-null-assertion */
import { describe, it, expect, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useWhiteboards } from '../hooks/useWhiteboards';
import { db } from '../db';

describe('useWhiteboards', () => {
  beforeEach(async () => {
    await db.whiteboards.clear();
  });

  it('starts with empty whiteboards and loading=false', async () => {
    const { result } = renderHook(() => useWhiteboards());
    await act(async () => {});
    expect(result.current.whiteboards).toEqual([]);
    expect(result.current.loading).toBe(false);
  });

  it('creates a whiteboard with default name', async () => {
    const { result } = renderHook(() => useWhiteboards());
    await act(async () => {});

    await act(async () => {
      await result.current.createWhiteboard();
    });

    expect(result.current.whiteboards).toHaveLength(1);
    expect(result.current.whiteboards[0].name).toBe('Untitled Whiteboard');
    expect(result.current.whiteboards[0].elements).toBe('[]');
    expect(result.current.whiteboards[0].trashed).toBe(false);
    expect(result.current.whiteboards[0].archived).toBe(false);
  });

  it('creates a whiteboard with custom name and folderId', async () => {
    const { result } = renderHook(() => useWhiteboards());
    await act(async () => {});

    await act(async () => {
      await result.current.createWhiteboard('Network Diagram', 'folder-1');
    });

    expect(result.current.whiteboards[0].name).toBe('Network Diagram');
    expect(result.current.whiteboards[0].folderId).toBe('folder-1');
  });

  it('persists to IndexedDB', async () => {
    const { result } = renderHook(() => useWhiteboards());
    await act(async () => {});

    await act(async () => {
      await result.current.createWhiteboard('Persisted');
    });

    const stored = await db.whiteboards.toArray();
    expect(stored).toHaveLength(1);
    expect(stored[0].name).toBe('Persisted');
  });

  it('auto-increments order', async () => {
    const { result } = renderHook(() => useWhiteboards());
    await act(async () => {});

    await act(async () => {
      await result.current.createWhiteboard('First');
    });
    expect(result.current.whiteboards[0].order).toBe(1);

    await act(async () => {
      await result.current.createWhiteboard('Second');
    });
    expect(result.current.whiteboards[1].order).toBe(2);

    await act(async () => {
      await result.current.createWhiteboard('Third');
    });
    expect(result.current.whiteboards[2].order).toBe(3);
  });

  it('updates a whiteboard', async () => {
    const { result } = renderHook(() => useWhiteboards());
    await act(async () => {});

    await act(async () => {
      await result.current.createWhiteboard('Original');
    });
    const id = result.current.whiteboards[0].id;

    await act(async () => {
      await result.current.updateWhiteboard(id, { name: 'Renamed', elements: '[{"type":"rect"}]' });
    });

    expect(result.current.whiteboards[0].name).toBe('Renamed');
    expect(result.current.whiteboards[0].elements).toBe('[{"type":"rect"}]');

    const stored = await db.whiteboards.get(id);
    expect(stored!.name).toBe('Renamed');
    expect(stored!.updatedAt).toBeGreaterThanOrEqual(stored!.createdAt);
  });

  it('deletes a whiteboard permanently', async () => {
    const { result } = renderHook(() => useWhiteboards());
    await act(async () => {});

    await act(async () => {
      await result.current.createWhiteboard('Doomed');
    });
    const id = result.current.whiteboards[0].id;

    await act(async () => {
      await result.current.deleteWhiteboard(id);
    });

    expect(result.current.whiteboards).toHaveLength(0);

    const stored = await db.whiteboards.get(id);
    expect(stored).toBeUndefined();
  });

  it('trashes and restores a whiteboard', async () => {
    const { result } = renderHook(() => useWhiteboards());
    await act(async () => {});

    await act(async () => {
      await result.current.createWhiteboard('Trashable');
    });
    const id = result.current.whiteboards[0].id;

    // Trash it
    await act(async () => {
      await result.current.trashWhiteboard(id);
    });

    expect(result.current.whiteboards[0].trashed).toBe(true);
    expect(result.current.whiteboards[0].trashedAt).toBeDefined();

    // Restore it
    await act(async () => {
      await result.current.restoreWhiteboard(id);
    });

    expect(result.current.whiteboards[0].trashed).toBe(false);
    expect(result.current.whiteboards[0].trashedAt).toBeUndefined();
  });

  it('toggles archive on a whiteboard', async () => {
    const { result } = renderHook(() => useWhiteboards());
    await act(async () => {});

    await act(async () => {
      await result.current.createWhiteboard('Archivable');
    });
    const id = result.current.whiteboards[0].id;

    // Archive it
    await act(async () => {
      await result.current.toggleArchiveWhiteboard(id);
    });

    expect(result.current.whiteboards[0].archived).toBe(true);

    // Unarchive it
    await act(async () => {
      await result.current.toggleArchiveWhiteboard(id);
    });

    expect(result.current.whiteboards[0].archived).toBe(false);
  });

  it('empties trash whiteboards', async () => {
    const { result } = renderHook(() => useWhiteboards());
    await act(async () => {});

    await act(async () => {
      await result.current.createWhiteboard('Keep');
    });
    await act(async () => {
      await result.current.createWhiteboard('Trash 1');
    });
    await act(async () => {
      await result.current.createWhiteboard('Trash 2');
    });

    const trash1Id = result.current.whiteboards[1].id;
    const trash2Id = result.current.whiteboards[2].id;

    await act(async () => {
      await result.current.trashWhiteboard(trash1Id);
    });
    await act(async () => {
      await result.current.trashWhiteboard(trash2Id);
    });

    await act(async () => {
      await result.current.emptyTrashWhiteboards();
    });

    // Only the non-trashed whiteboard should remain
    expect(result.current.whiteboards).toHaveLength(1);
    expect(result.current.whiteboards[0].name).toBe('Keep');

    // Verify removed from DB
    const stored = await db.whiteboards.toArray();
    expect(stored).toHaveLength(1);
    expect(stored[0].name).toBe('Keep');
  });

  it('filters by active status', async () => {
    const { result } = renderHook(() => useWhiteboards());
    await act(async () => {});

    await act(async () => {
      await result.current.createWhiteboard('Active');
    });
    await act(async () => {
      await result.current.createWhiteboard('Trashed');
    });
    await act(async () => {
      await result.current.createWhiteboard('Archived');
    });

    const trashedId = result.current.whiteboards[1].id;
    const archivedId = result.current.whiteboards[2].id;

    await act(async () => {
      await result.current.trashWhiteboard(trashedId);
    });
    await act(async () => {
      await result.current.toggleArchiveWhiteboard(archivedId);
    });

    const active = result.current.getFilteredWhiteboards({});
    expect(active).toHaveLength(1);
    expect(active[0].name).toBe('Active');
  });

  it('filters by trashed status', async () => {
    const { result } = renderHook(() => useWhiteboards());
    await act(async () => {});

    await act(async () => {
      await result.current.createWhiteboard('Active');
    });
    await act(async () => {
      await result.current.createWhiteboard('Trashed');
    });

    const trashedId = result.current.whiteboards[1].id;

    await act(async () => {
      await result.current.trashWhiteboard(trashedId);
    });

    const trashed = result.current.getFilteredWhiteboards({ showTrashed: true });
    expect(trashed).toHaveLength(1);
    expect(trashed[0].name).toBe('Trashed');
  });

  it('filters by archived status', async () => {
    const { result } = renderHook(() => useWhiteboards());
    await act(async () => {});

    await act(async () => {
      await result.current.createWhiteboard('Active');
    });
    await act(async () => {
      await result.current.createWhiteboard('Archived');
    });

    const archivedId = result.current.whiteboards[1].id;

    await act(async () => {
      await result.current.toggleArchiveWhiteboard(archivedId);
    });

    const archived = result.current.getFilteredWhiteboards({ showArchived: true });
    expect(archived).toHaveLength(1);
    expect(archived[0].name).toBe('Archived');
  });

  it('filters by folderId', async () => {
    const { result } = renderHook(() => useWhiteboards());
    await act(async () => {});

    await act(async () => {
      await result.current.createWhiteboard('In folder', 'folder-1');
    });
    await act(async () => {
      await result.current.createWhiteboard('No folder');
    });

    const filtered = result.current.getFilteredWhiteboards({ folderId: 'folder-1' });
    expect(filtered).toHaveLength(1);
    expect(filtered[0].name).toBe('In folder');
  });

  it('computes whiteboardCounts correctly', async () => {
    const { result } = renderHook(() => useWhiteboards());
    await act(async () => {});

    await act(async () => {
      await result.current.createWhiteboard('Active 1');
    });
    await act(async () => {
      await result.current.createWhiteboard('Active 2');
    });
    await act(async () => {
      await result.current.createWhiteboard('To Trash');
    });
    await act(async () => {
      await result.current.createWhiteboard('To Archive');
    });

    const trashId = result.current.whiteboards[2].id;
    const archiveId = result.current.whiteboards[3].id;

    await act(async () => {
      await result.current.trashWhiteboard(trashId);
    });
    await act(async () => {
      await result.current.toggleArchiveWhiteboard(archiveId);
    });

    expect(result.current.whiteboardCounts).toEqual({
      total: 2,
      trashed: 1,
      archived: 1,
    });
  });

  it('auto-purges old trashed whiteboards on load', async () => {
    const now = Date.now();
    const thirtyOneDaysAgo = now - 31 * 86400000;

    // Seed the DB with an old trashed whiteboard and a recent trashed one
    await db.whiteboards.add({
      id: 'old-trashed', name: 'Old Trashed', elements: '[]',
      tags: [], order: 1, trashed: true, trashedAt: thirtyOneDaysAgo,
      archived: false, createdAt: thirtyOneDaysAgo, updatedAt: thirtyOneDaysAgo,
    });
    await db.whiteboards.add({
      id: 'recent-trashed', name: 'Recent Trashed', elements: '[]',
      tags: [], order: 2, trashed: true, trashedAt: now - 86400000,
      archived: false, createdAt: now, updatedAt: now,
    });
    await db.whiteboards.add({
      id: 'active', name: 'Active', elements: '[]',
      tags: [], order: 3, trashed: false,
      archived: false, createdAt: now, updatedAt: now,
    });

    const { result } = renderHook(() => useWhiteboards());
    // Allow the useEffect -> loadWhiteboards to complete (async DB reads + bulkDelete + state updates)
    await act(async () => {
      await result.current.reload();
    });

    // Old trashed whiteboard should have been purged
    const oldStored = await db.whiteboards.get('old-trashed');
    expect(oldStored).toBeUndefined();

    // Recent trashed and active should remain
    expect(result.current.whiteboards).toHaveLength(2);
    const names = result.current.whiteboards.map((w) => w.name);
    expect(names).toContain('Recent Trashed');
    expect(names).toContain('Active');
  });
});
