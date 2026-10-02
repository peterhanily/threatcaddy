/* eslint-disable @typescript-eslint/no-non-null-assertion */
import { describe, it, expect, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useFolders } from '../hooks/useFolders';
import { db } from '../db';

describe('useFolders', () => {
  beforeEach(async () => {
    await db.table('_localMigrations').clear();
    await db.folders.clear();
    await db.notes.clear();
    await db.tasks.clear();
    await db.timelineEvents.clear();
    await db.whiteboards.clear();
    await db.standaloneIOCs.clear();
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
        order: 1, trashed: false, archived: false, folderId, createdAt: Date.now(), updatedAt: Date.now(),
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
        trashed: false, archived: false,
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
        tags: [], order: 1, trashed: false, archived: false, folderId, createdAt: Date.now(), updatedAt: Date.now(),
      });

      await act(async () => {
        await result.current.deleteFolder(folderId);
      });

      const wb = await db.whiteboards.get('w1');
      expect(wb!.folderId).toBeUndefined();
    });

    it('unsets folderId on standaloneIOCs in the deleted folder', async () => {
      const { result } = renderHook(() => useFolders());
      await act(async () => {});

      await act(async () => {
        await result.current.createFolder('Doomed');
      });
      const folderId = result.current.folders[0].id;

      await db.standaloneIOCs.add({
        id: 'ioc1', type: 'ipv4', value: '10.0.0.1', confidence: 'high',
        tags: [], trashed: false, archived: false,
        folderId, createdAt: Date.now(), updatedAt: Date.now(),
      });

      await act(async () => {
        await result.current.deleteFolder(folderId);
      });

      const ioc = await db.standaloneIOCs.get('ioc1');
      expect(ioc!.folderId).toBeUndefined();
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
        order: 1, trashed: false, archived: false, folderId, createdAt: Date.now(), updatedAt: Date.now(),
      });
      await db.timelineEvents.add({
        id: 'e1', title: 'Event in folder', timestamp: Date.now(),
        eventType: 'other', source: '', confidence: 'low',
        linkedIOCIds: [], linkedNoteIds: [], linkedTaskIds: [],
        mitreAttackIds: [], assets: [], tags: [], starred: false,
        trashed: false, archived: false,
        folderId, timelineId: 'tl1', createdAt: Date.now(), updatedAt: Date.now(),
      });
      await db.whiteboards.add({
        id: 'w1', name: 'Whiteboard in folder', elements: '[]',
        tags: [], order: 1, trashed: false, archived: false, folderId, createdAt: Date.now(), updatedAt: Date.now(),
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
        order: 1, trashed: false, archived: false, folderId, createdAt: Date.now(), updatedAt: Date.now(),
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

    it('deletes standaloneIOCs in the folder', async () => {
      const { result } = renderHook(() => useFolders());
      await act(async () => {});

      await act(async () => {
        await result.current.createFolder('Nuke');
      });
      const folderId = result.current.folders[0].id;

      await db.standaloneIOCs.add({
        id: 'ioc-inside', type: 'ipv4', value: '10.0.0.1', confidence: 'high',
        tags: [], trashed: false, archived: false,
        folderId, createdAt: Date.now(), updatedAt: Date.now(),
      });
      await db.standaloneIOCs.add({
        id: 'ioc-outside', type: 'domain', value: 'example.com', confidence: 'medium',
        tags: [], trashed: false, archived: false,
        createdAt: Date.now(), updatedAt: Date.now(),
      });

      await act(async () => {
        await result.current.deleteFolderWithContents(folderId);
      });

      expect(await db.standaloneIOCs.get('ioc-inside')).toBeUndefined();
      expect(await db.standaloneIOCs.get('ioc-outside')).toBeDefined();
    });
  });

  describe('trashFolderContents', () => {
    it('trashes non-trashed entities and deletes the folder', async () => {
      const { result } = renderHook(() => useFolders());
      await act(async () => {});

      await act(async () => {
        await result.current.createFolder('ToTrash');
      });
      const folderId = result.current.folders[0].id;

      await db.notes.add({
        id: 'n1', title: 'Note', content: '', tags: [],
        pinned: false, archived: false, trashed: false,
        folderId, createdAt: Date.now(), updatedAt: Date.now(),
      });
      await db.tasks.add({
        id: 't1', title: 'Task', tags: [],
        completed: false, priority: 'none', status: 'todo',
        order: 1, trashed: false, archived: false, folderId, createdAt: Date.now(), updatedAt: Date.now(),
      });
      await db.timelineEvents.add({
        id: 'e1', title: 'Event', timestamp: Date.now(),
        eventType: 'other', source: '', confidence: 'low',
        linkedIOCIds: [], linkedNoteIds: [], linkedTaskIds: [],
        mitreAttackIds: [], assets: [], tags: [], starred: false,
        trashed: false, archived: false,
        folderId, timelineId: 'tl1', createdAt: Date.now(), updatedAt: Date.now(),
      });
      await db.whiteboards.add({
        id: 'w1', name: 'WB', elements: '[]',
        tags: [], order: 1, trashed: false, archived: false, folderId, createdAt: Date.now(), updatedAt: Date.now(),
      });
      await db.standaloneIOCs.add({
        id: 'ioc1', type: 'ipv4', value: '10.0.0.1', confidence: 'high',
        tags: [], trashed: false, archived: false,
        folderId, createdAt: Date.now(), updatedAt: Date.now(),
      });

      await act(async () => {
        await result.current.trashFolderContents(folderId);
      });

      // Folder should be deleted
      expect(result.current.folders).toHaveLength(0);
      expect(await db.folders.get(folderId)).toBeUndefined();

      // Entities should be trashed
      const note = await db.notes.get('n1');
      expect(note!.trashed).toBe(true);
      expect(note!.trashedAt).toBeDefined();

      const task = await db.tasks.get('t1');
      expect(task!.trashed).toBe(true);
      expect(task!.trashedAt).toBeDefined();

      const event = await db.timelineEvents.get('e1');
      expect(event!.trashed).toBe(true);

      const wb = await db.whiteboards.get('w1');
      expect(wb!.trashed).toBe(true);

      const ioc = await db.standaloneIOCs.get('ioc1');
      expect(ioc!.trashed).toBe(true);
    });

    it('preserves existing trashedAt on already-trashed items', async () => {
      const { result } = renderHook(() => useFolders());
      await act(async () => {});

      await act(async () => {
        await result.current.createFolder('ToTrash');
      });
      const folderId = result.current.folders[0].id;

      const earlyTimestamp = Date.now() - 100000;
      await db.notes.add({
        id: 'n-already', title: 'Already trashed', content: '', tags: [],
        pinned: false, archived: false, trashed: true, trashedAt: earlyTimestamp,
        folderId, createdAt: Date.now(), updatedAt: Date.now(),
      });

      await act(async () => {
        await result.current.trashFolderContents(folderId);
      });

      const note = await db.notes.get('n-already');
      expect(note!.trashedAt).toBe(earlyTimestamp);
    });

    it('does not affect entities outside the folder', async () => {
      const { result } = renderHook(() => useFolders());
      await act(async () => {});

      await act(async () => {
        await result.current.createFolder('ToTrash');
      });
      const folderId = result.current.folders[0].id;

      await db.notes.add({
        id: 'n-inside', title: 'Inside', content: '', tags: [],
        pinned: false, archived: false, trashed: false,
        folderId, createdAt: Date.now(), updatedAt: Date.now(),
      });
      await db.notes.add({
        id: 'n-outside', title: 'Outside', content: '', tags: [],
        pinned: false, archived: false, trashed: false,
        createdAt: Date.now(), updatedAt: Date.now(),
      });

      await act(async () => {
        await result.current.trashFolderContents(folderId);
      });

      const inside = await db.notes.get('n-inside');
      expect(inside!.trashed).toBe(true);
      const outside = await db.notes.get('n-outside');
      expect(outside!.trashed).toBe(false);
    });
  });

  describe('archiveFolder', () => {
    it('sets folder status to archived and archives non-trashed entities', async () => {
      const { result } = renderHook(() => useFolders());
      await act(async () => {});

      await act(async () => {
        await result.current.createFolder('ToArchive');
      });
      const folderId = result.current.folders[0].id;

      await db.notes.add({
        id: 'n1', title: 'Note', content: '', tags: [],
        pinned: false, archived: false, trashed: false,
        folderId, createdAt: Date.now(), updatedAt: Date.now(),
      });
      await db.tasks.add({
        id: 't1', title: 'Task', tags: [],
        completed: false, priority: 'none', status: 'todo',
        order: 1, trashed: false, archived: false, folderId, createdAt: Date.now(), updatedAt: Date.now(),
      });

      await act(async () => {
        await result.current.archiveFolder(folderId);
      });

      // Folder status should be archived
      const folder = await db.folders.get(folderId);
      expect(folder!.status).toBe('archived');
      expect(result.current.folders[0].status).toBe('archived');

      // Entities should be archived
      const note = await db.notes.get('n1');
      expect(note!.archived).toBe(true);
      const task = await db.tasks.get('t1');
      expect(task!.archived).toBe(true);
    });

    it('skips trashed entities when archiving', async () => {
      const { result } = renderHook(() => useFolders());
      await act(async () => {});

      await act(async () => {
        await result.current.createFolder('ToArchive');
      });
      const folderId = result.current.folders[0].id;

      await db.notes.add({
        id: 'n-trashed', title: 'Trashed', content: '', tags: [],
        pinned: false, archived: false, trashed: true,
        folderId, createdAt: Date.now(), updatedAt: Date.now(),
      });

      await act(async () => {
        await result.current.archiveFolder(folderId);
      });

      const note = await db.notes.get('n-trashed');
      expect(note!.archived).toBe(false);
    });

    it('does not affect entities outside the folder', async () => {
      const { result } = renderHook(() => useFolders());
      await act(async () => {});

      await act(async () => {
        await result.current.createFolder('ToArchive');
      });
      const folderId = result.current.folders[0].id;

      await db.notes.add({
        id: 'n-outside', title: 'Outside', content: '', tags: [],
        pinned: false, archived: false, trashed: false,
        createdAt: Date.now(), updatedAt: Date.now(),
      });

      await act(async () => {
        await result.current.archiveFolder(folderId);
      });

      const note = await db.notes.get('n-outside');
      expect(note!.archived).toBe(false);
    });
  });

  describe('unarchiveFolder', () => {
    it('sets folder status to active and unarchives archived entities', async () => {
      const { result } = renderHook(() => useFolders());
      await act(async () => {});

      await act(async () => {
        await result.current.createFolder('ToUnarchive');
      });
      const folderId = result.current.folders[0].id;

      await db.notes.add({
        id: 'n1', title: 'Archived note', content: '', tags: [],
        pinned: false, archived: false, trashed: false,
        folderId, createdAt: Date.now(), updatedAt: Date.now(),
      });

      // Only rows archived by this folder operation are reopened with it.
      await act(async () => {
        await result.current.archiveFolder(folderId);
      });

      await act(async () => {
        await result.current.unarchiveFolder(folderId);
      });

      const folder = await db.folders.get(folderId);
      expect(folder!.status).toBe('active');
      expect(result.current.folders[0].status).toBe('active');

      const note = await db.notes.get('n1');
      expect(note!.archived).toBe(false);
    });

    it('skips trashed entities when unarchiving', async () => {
      const { result } = renderHook(() => useFolders());
      await act(async () => {});

      await act(async () => {
        await result.current.createFolder('ToUnarchive');
      });
      const folderId = result.current.folders[0].id;

      await db.notes.add({
        id: 'n-trashed', title: 'Trashed', content: '', tags: [],
        pinned: false, archived: true, trashed: true,
        folderId, createdAt: Date.now(), updatedAt: Date.now(),
      });

      await act(async () => {
        await result.current.unarchiveFolder(folderId);
      });

      const note = await db.notes.get('n-trashed');
      // Still archived because it's trashed (skipped by unarchive)
      expect(note!.archived).toBe(true);
    });
  });
});
