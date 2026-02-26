/* eslint-disable @typescript-eslint/no-non-null-assertion */
import { describe, it, expect, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useFolders } from '../hooks/useFolders';
import { db } from '../db';

describe('useFolders', () => {
  beforeEach(async () => {
    await db.folders.clear();
    await db.notes.clear();
    await db.tasks.clear();
    await db.timelineEvents.clear();
    await db.whiteboards.clear();
  });

  it('starts with empty folders', async () => {
    const { result } = renderHook(() => useFolders());
    await act(async () => {});
    expect(result.current.folders).toEqual([]);
  });

  it('creates a folder with auto-incremented order', async () => {
    const { result } = renderHook(() => useFolders());
    await act(async () => {});

    await act(async () => {
      await result.current.createFolder('Work');
    });
    expect(result.current.folders).toHaveLength(1);
    expect(result.current.folders[0].name).toBe('Work');
    expect(result.current.folders[0].order).toBe(1);

    await act(async () => {
      await result.current.createFolder('Personal');
    });
    expect(result.current.folders).toHaveLength(2);
    expect(result.current.folders[1].name).toBe('Personal');
    expect(result.current.folders[1].order).toBe(2);
  });

  it('creates a folder with color and icon', async () => {
    const { result } = renderHook(() => useFolders());
    await act(async () => {});

    await act(async () => {
      await result.current.createFolder('Red Folder', '#ef4444', '📁');
    });

    expect(result.current.folders[0].color).toBe('#ef4444');
    expect(result.current.folders[0].icon).toBe('📁');
  });

  it('persists folders to IndexedDB', async () => {
    const { result } = renderHook(() => useFolders());
    await act(async () => {});

    await act(async () => {
      await result.current.createFolder('Persisted');
    });

    const stored = await db.folders.toArray();
    expect(stored).toHaveLength(1);
    expect(stored[0].name).toBe('Persisted');
  });

  it('updates a folder', async () => {
    const { result } = renderHook(() => useFolders());
    await act(async () => {});

    await act(async () => {
      await result.current.createFolder('Original');
    });
    const id = result.current.folders[0].id;

    await act(async () => {
      await result.current.updateFolder(id, { name: 'Renamed', color: '#3b82f6' });
    });

    expect(result.current.folders[0].name).toBe('Renamed');
    expect(result.current.folders[0].color).toBe('#3b82f6');
  });

  it('maintains sort order after updates', async () => {
    const { result } = renderHook(() => useFolders());
    await act(async () => {});

    await act(async () => {
      await result.current.createFolder('Alpha');
    });
    await act(async () => {
      await result.current.createFolder('Beta');
    });

    const betaId = result.current.folders[1].id;
    await act(async () => {
      await result.current.updateFolder(betaId, { order: 0 });
    });

    expect(result.current.folders[0].name).toBe('Beta');
    expect(result.current.folders[1].name).toBe('Alpha');
  });

  describe('findOrCreateFolder', () => {
    it('creates a new folder if it does not exist', async () => {
      const { result } = renderHook(() => useFolders());
      await act(async () => {});

      await act(async () => {
        await result.current.findOrCreateFolder('Clips');
      });

      expect(result.current.folders).toHaveLength(1);
      expect(result.current.folders[0].name).toBe('Clips');
    });

    it('returns existing folder if it exists', async () => {
      const { result } = renderHook(() => useFolders());
      await act(async () => {});

      await act(async () => {
        await result.current.createFolder('Clips');
      });
      const existingId = result.current.folders[0].id;

      let folder: Awaited<ReturnType<typeof result.current.findOrCreateFolder>>;
      await act(async () => {
        folder = await result.current.findOrCreateFolder('Clips');
      });

      expect(result.current.folders).toHaveLength(1);
      expect(folder!.id).toBe(existingId);
    });
  });

  describe('deleteFolder', () => {
    it('removes the folder', async () => {
      const { result } = renderHook(() => useFolders());
      await act(async () => {});

      await act(async () => {
        await result.current.createFolder('Doomed');
      });
      const id = result.current.folders[0].id;

      await act(async () => {
        await result.current.deleteFolder(id);
      });

      expect(result.current.folders).toHaveLength(0);
    });

    it('unsets folderId on notes in the deleted folder', async () => {
      const { result } = renderHook(() => useFolders());
      await act(async () => {});

      await act(async () => {
        await result.current.createFolder('Doomed');
      });
      const folderId = result.current.folders[0].id;

      // Add a note to that folder directly in the DB
      await db.notes.add({
        id: 'n1', title: 'Note in folder', content: '', tags: [],
        pinned: false, archived: false, trashed: false,
        folderId, createdAt: Date.now(), updatedAt: Date.now(),
      });

      await act(async () => {
        await result.current.deleteFolder(folderId);
      });

      const note = await db.notes.get('n1');
      expect(note!.folderId).toBeUndefined();
    });

    it('unsets folderId on tasks in the deleted folder', async () => {
      const { result } = renderHook(() => useFolders());
      await act(async () => {});

      await act(async () => {
        await result.current.createFolder('Doomed');
      });
      const folderId = result.current.folders[0].id;

      await db.tasks.add({
        id: 't1', title: 'Task in folder', tags: [],
        completed: false, priority: 'none', status: 'todo',
        order: 1, folderId, createdAt: Date.now(), updatedAt: Date.now(),
      });

      await act(async () => {
        await result.current.deleteFolder(folderId);
      });

      const task = await db.tasks.get('t1');
      expect(task!.folderId).toBeUndefined();
    });

    it('unsets folderId on timeline events in the deleted folder', async () => {
      const { result } = renderHook(() => useFolders());
      await act(async () => {});

      await act(async () => {
        await result.current.createFolder('Doomed');
      });
      const folderId = result.current.folders[0].id;

      await db.timelineEvents.add({
        id: 'e1', title: 'Event in folder', timestamp: Date.now(),
        eventType: 'other', source: '', confidence: 'low',
        linkedIOCIds: [], linkedNoteIds: [], linkedTaskIds: [],
        mitreAttackIds: [], assets: [], tags: [], starred: false,
        folderId, timelineId: 'tl1', createdAt: Date.now(), updatedAt: Date.now(),
      });

      await act(async () => {
        await result.current.deleteFolder(folderId);
      });

      const event = await db.timelineEvents.get('e1');
      expect(event!.folderId).toBeUndefined();
    });

    it('unsets folderId on whiteboards in the deleted folder', async () => {
      const { result } = renderHook(() => useFolders());
      await act(async () => {});

      await act(async () => {
        await result.current.createFolder('Doomed');
      });
      const folderId = result.current.folders[0].id;

      await db.whiteboards.add({
        id: 'w1', name: 'Whiteboard in folder', elements: '[]',
        tags: [], order: 1, folderId, createdAt: Date.now(), updatedAt: Date.now(),
      });

      await act(async () => {
        await result.current.deleteFolder(folderId);
      });

      const wb = await db.whiteboards.get('w1');
      expect(wb!.folderId).toBeUndefined();
    });
  });

  describe('deleteFolderWithContents', () => {
    it('removes the folder and all its entities from the DB', async () => {
      const { result } = renderHook(() => useFolders());
      await act(async () => {});

      await act(async () => {
        await result.current.createFolder('Nuke');
      });
      const folderId = result.current.folders[0].id;

      // Add entities to the folder
      await db.notes.add({
        id: 'n1', title: 'Note in folder', content: '', tags: [],
        pinned: false, archived: false, trashed: false,
        folderId, createdAt: Date.now(), updatedAt: Date.now(),
      });
      await db.tasks.add({
        id: 't1', title: 'Task in folder', tags: [],
        completed: false, priority: 'none', status: 'todo',
        order: 1, folderId, createdAt: Date.now(), updatedAt: Date.now(),
      });
      await db.timelineEvents.add({
        id: 'e1', title: 'Event in folder', timestamp: Date.now(),
        eventType: 'other', source: '', confidence: 'low',
        linkedIOCIds: [], linkedNoteIds: [], linkedTaskIds: [],
        mitreAttackIds: [], assets: [], tags: [], starred: false,
        folderId, timelineId: 'tl1', createdAt: Date.now(), updatedAt: Date.now(),
      });
      await db.whiteboards.add({
        id: 'w1', name: 'Whiteboard in folder', elements: '[]',
        tags: [], order: 1, folderId, createdAt: Date.now(), updatedAt: Date.now(),
      });

      await act(async () => {
        await result.current.deleteFolderWithContents(folderId);
      });

      expect(result.current.folders).toHaveLength(0);
      expect(await db.notes.get('n1')).toBeUndefined();
      expect(await db.tasks.get('t1')).toBeUndefined();
      expect(await db.timelineEvents.get('e1')).toBeUndefined();
      expect(await db.whiteboards.get('w1')).toBeUndefined();
    });

    it('does not delete entities outside the folder', async () => {
      const { result } = renderHook(() => useFolders());
      await act(async () => {});

      await act(async () => {
        await result.current.createFolder('Nuke');
      });
      const folderId = result.current.folders[0].id;

      // Entity inside the folder
      await db.notes.add({
        id: 'n-inside', title: 'Inside', content: '', tags: [],
        pinned: false, archived: false, trashed: false,
        folderId, createdAt: Date.now(), updatedAt: Date.now(),
      });
      // Entity outside the folder
      await db.notes.add({
        id: 'n-outside', title: 'Outside', content: '', tags: [],
        pinned: false, archived: false, trashed: false,
        createdAt: Date.now(), updatedAt: Date.now(),
      });

      await act(async () => {
        await result.current.deleteFolderWithContents(folderId);
      });

      expect(await db.notes.get('n-inside')).toBeUndefined();
      expect(await db.notes.get('n-outside')).toBeDefined();
    });

    it('cleans orphaned cross-entity links after deletion', async () => {
      const { result } = renderHook(() => useFolders());
      await act(async () => {});

      await act(async () => {
        await result.current.createFolder('Nuke');
      });
      const folderId = result.current.folders[0].id;

      // Note inside the folder
      await db.notes.add({
        id: 'n-inside', title: 'Inside', content: '', tags: [],
        pinned: false, archived: false, trashed: false,
        folderId, createdAt: Date.now(), updatedAt: Date.now(),
      });
      // Task inside the folder
      await db.tasks.add({
        id: 't-inside', title: 'Task inside', tags: [],
        completed: false, priority: 'none', status: 'todo',
        order: 1, folderId, createdAt: Date.now(), updatedAt: Date.now(),
      });
      // Note outside that links to the deleted note and task
      await db.notes.add({
        id: 'n-outside', title: 'Outside', content: '', tags: [],
        pinned: false, archived: false, trashed: false,
        linkedNoteIds: ['n-inside', 'other-note'],
        linkedTaskIds: ['t-inside'],
        createdAt: Date.now(), updatedAt: Date.now(),
      });

      await act(async () => {
        await result.current.deleteFolderWithContents(folderId);
      });

      const outside = await db.notes.get('n-outside');
      expect(outside!.linkedNoteIds).toEqual(['other-note']);
      expect(outside!.linkedTaskIds).toEqual([]);
    });
  });
});
