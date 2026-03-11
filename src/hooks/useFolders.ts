import { useState, useEffect, useCallback } from 'react';
import { db } from '../db';
import type { Folder } from '../types';
import { nanoid } from 'nanoid';

/** Manages investigation folders (create, update, reorder, close). Returns sorted folders array and mutation helpers. */
export function useFolders() {
  const [folders, setFolders] = useState<Folder[]>([]);
  const [loading, setLoading] = useState(true);

  const loadFolders = useCallback(async () => {
    const all = await db.folders.toArray();
    setFolders(all.sort((a, b) => a.order - b.order));
    setLoading(false);
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    loadFolders();
  }, [loadFolders]);

  const createFolder = useCallback(async (name: string, color?: string, icon?: string, extra?: Partial<Folder>): Promise<Folder> => {
    const maxOrder = folders.reduce((max, f) => Math.max(max, f.order), 0);
    const now = Date.now();
    const folder: Folder = {
      id: nanoid(),
      name,
      color,
      icon,
      order: maxOrder + 1,
      createdAt: now,
      status: 'active',
      updatedAt: now,
      ...extra,
    };
    await db.folders.add(folder);
    setFolders((prev) => [...prev, folder].sort((a, b) => a.order - b.order));
    return folder;
  }, [folders]);

  const updateFolder = useCallback(async (id: string, updates: Partial<Folder>) => {
    const withTimestamp = { ...updates, updatedAt: Date.now() };
    await db.folders.update(id, withTimestamp);
    setFolders((prev) =>
      prev.map((f) => (f.id === id ? { ...f, ...withTimestamp } : f)).sort((a, b) => a.order - b.order)
    );
  }, []);

  const findOrCreateFolder = useCallback(async (name: string): Promise<Folder> => {
    const existing = folders.find((f) => f.name === name);
    if (existing) return existing;
    return createFolder(name);
  }, [folders, createFolder]);

  const deleteFolder = useCallback(async (id: string) => {
    await db.transaction('rw', [db.folders, db.notes, db.tasks, db.timelineEvents, db.whiteboards, db.standaloneIOCs], async () => {
      await db.folders.delete(id);
      // Unset folderId on notes, tasks, timeline events, whiteboards, and IOCs in this folder
      await Promise.all([
        db.notes.where('folderId').equals(id).modify({ folderId: undefined }),
        db.tasks.where('folderId').equals(id).modify({ folderId: undefined }),
        db.timelineEvents.where('folderId').equals(id).modify({ folderId: undefined }),
        db.whiteboards.where('folderId').equals(id).modify({ folderId: undefined }),
        db.standaloneIOCs.where('folderId').equals(id).modify({ folderId: undefined }),
      ]);
    });
    setFolders((prev) => prev.filter((f) => f.id !== id));
  }, []);

  const deleteFolderWithContents = useCallback(async (id: string) => {
    await db.transaction('rw', [db.folders, db.notes, db.tasks, db.timelineEvents, db.whiteboards, db.standaloneIOCs, db.chatThreads], async () => {
      // Collect IDs of entities in this folder (needed for orphan link cleanup)
      const [notesInFolder, tasksInFolder, eventsInFolder] = await Promise.all([
        db.notes.where('folderId').equals(id).primaryKeys(),
        db.tasks.where('folderId').equals(id).primaryKeys(),
        db.timelineEvents.where('folderId').equals(id).primaryKeys(),
      ]);

      const noteIdSet = new Set(notesInFolder as string[]);
      const taskIdSet = new Set(tasksInFolder as string[]);
      const eventIdSet = new Set(eventsInFolder as string[]);

      // Bulk-delete all entities in the folder (including chat threads)
      await Promise.all([
        db.notes.where('folderId').equals(id).delete(),
        db.tasks.where('folderId').equals(id).delete(),
        db.timelineEvents.where('folderId').equals(id).delete(),
        db.whiteboards.where('folderId').equals(id).delete(),
        db.standaloneIOCs.where('folderId').equals(id).delete(),
        db.chatThreads.where('folderId').equals(id).delete(),
      ]);

      // Clean orphaned cross-entity links in parallel batches
      const linkCleanups: Promise<number>[] = [];

      if (noteIdSet.size > 0) {
        linkCleanups.push(
          db.notes.filter(n => n.linkedNoteIds?.some(nid => noteIdSet.has(nid)) ?? false).modify(n => {
            n.linkedNoteIds = (n.linkedNoteIds ?? []).filter(nid => !noteIdSet.has(nid));
          }),
          db.tasks.filter(t => t.linkedNoteIds?.some(nid => noteIdSet.has(nid)) ?? false).modify(t => {
            t.linkedNoteIds = (t.linkedNoteIds ?? []).filter(nid => !noteIdSet.has(nid));
          }),
          db.timelineEvents.filter(e => e.linkedNoteIds.some(nid => noteIdSet.has(nid))).modify(e => {
            e.linkedNoteIds = e.linkedNoteIds.filter(nid => !noteIdSet.has(nid));
          }),
          db.standaloneIOCs.filter(i => i.linkedNoteIds?.some(nid => noteIdSet.has(nid)) ?? false).modify(i => {
            i.linkedNoteIds = (i.linkedNoteIds ?? []).filter(nid => !noteIdSet.has(nid));
          }),
        );
      }

      if (taskIdSet.size > 0) {
        linkCleanups.push(
          db.notes.filter(n => n.linkedTaskIds?.some(tid => taskIdSet.has(tid)) ?? false).modify(n => {
            n.linkedTaskIds = (n.linkedTaskIds ?? []).filter(tid => !taskIdSet.has(tid));
          }),
          db.tasks.filter(t => t.linkedTaskIds?.some(tid => taskIdSet.has(tid)) ?? false).modify(t => {
            t.linkedTaskIds = (t.linkedTaskIds ?? []).filter(tid => !taskIdSet.has(tid));
          }),
          db.timelineEvents.filter(e => e.linkedTaskIds.some(tid => taskIdSet.has(tid))).modify(e => {
            e.linkedTaskIds = e.linkedTaskIds.filter(tid => !taskIdSet.has(tid));
          }),
          db.standaloneIOCs.filter(i => i.linkedTaskIds?.some(tid => taskIdSet.has(tid)) ?? false).modify(i => {
            i.linkedTaskIds = (i.linkedTaskIds ?? []).filter(tid => !taskIdSet.has(tid));
          }),
        );
      }

      if (eventIdSet.size > 0) {
        linkCleanups.push(
          db.notes.filter(n => n.linkedTimelineEventIds?.some(eid => eventIdSet.has(eid)) ?? false).modify(n => {
            n.linkedTimelineEventIds = (n.linkedTimelineEventIds ?? []).filter(eid => !eventIdSet.has(eid));
          }),
          db.tasks.filter(t => t.linkedTimelineEventIds?.some(eid => eventIdSet.has(eid)) ?? false).modify(t => {
            t.linkedTimelineEventIds = (t.linkedTimelineEventIds ?? []).filter(eid => !eventIdSet.has(eid));
          }),
          db.standaloneIOCs.filter(i => i.linkedTimelineEventIds?.some(eid => eventIdSet.has(eid)) ?? false).modify(i => {
            i.linkedTimelineEventIds = (i.linkedTimelineEventIds ?? []).filter(eid => !eventIdSet.has(eid));
          }),
        );
      }

      if (linkCleanups.length > 0) {
        await Promise.all(linkCleanups);
      }

      // Delete the folder itself
      await db.folders.delete(id);
    });
    setFolders((prev) => prev.filter((f) => f.id !== id));
  }, []);

  const trashFolderContents = useCallback(async (id: string) => {
    const now = Date.now();
    await db.transaction('rw', [db.folders, db.notes, db.tasks, db.timelineEvents, db.whiteboards, db.standaloneIOCs], async () => {
      await Promise.all([
        db.notes.where('folderId').equals(id).filter((n) => !n.trashed).modify({ trashed: true, trashedAt: now }),
        db.tasks.where('folderId').equals(id).filter((t) => !t.trashed).modify({ trashed: true, trashedAt: now }),
        db.timelineEvents.where('folderId').equals(id).filter((e) => !e.trashed).modify({ trashed: true, trashedAt: now }),
        db.whiteboards.where('folderId').equals(id).filter((w) => !w.trashed).modify({ trashed: true, trashedAt: now }),
        db.standaloneIOCs.where('folderId').equals(id).filter((i) => !i.trashed).modify({ trashed: true, trashedAt: now }),
      ]);
      await db.folders.delete(id);
    });
    setFolders((prev) => prev.filter((f) => f.id !== id));
  }, []);

  const archiveFolder = useCallback(async (id: string) => {
    await db.transaction('rw', [db.folders, db.notes, db.tasks, db.timelineEvents, db.whiteboards, db.standaloneIOCs], async () => {
      await db.folders.update(id, { status: 'archived', updatedAt: Date.now() });
      await Promise.all([
        db.notes.where('folderId').equals(id).filter((n) => !n.trashed).modify({ archived: true }),
        db.tasks.where('folderId').equals(id).filter((t) => !t.trashed).modify({ archived: true }),
        db.timelineEvents.where('folderId').equals(id).filter((e) => !e.trashed).modify({ archived: true }),
        db.whiteboards.where('folderId').equals(id).filter((w) => !w.trashed).modify({ archived: true }),
        db.standaloneIOCs.where('folderId').equals(id).filter((i) => !i.trashed).modify({ archived: true }),
      ]);
    });
    setFolders((prev) =>
      prev.map((f) => (f.id === id ? { ...f, status: 'archived' as const, updatedAt: Date.now() } : f)).sort((a, b) => a.order - b.order)
    );
  }, []);

  const unarchiveFolder = useCallback(async (id: string) => {
    await db.transaction('rw', [db.folders, db.notes, db.tasks, db.timelineEvents, db.whiteboards, db.standaloneIOCs], async () => {
      await db.folders.update(id, { status: 'active', updatedAt: Date.now() });
      await Promise.all([
        db.notes.where('folderId').equals(id).filter((n) => n.archived && !n.trashed).modify({ archived: false }),
        db.tasks.where('folderId').equals(id).filter((t) => t.archived && !t.trashed).modify({ archived: false }),
        db.timelineEvents.where('folderId').equals(id).filter((e) => e.archived && !e.trashed).modify({ archived: false }),
        db.whiteboards.where('folderId').equals(id).filter((w) => w.archived && !w.trashed).modify({ archived: false }),
        db.standaloneIOCs.where('folderId').equals(id).filter((i) => i.archived && !i.trashed).modify({ archived: false }),
      ]);
    });
    setFolders((prev) =>
      prev.map((f) => (f.id === id ? { ...f, status: 'active' as const, updatedAt: Date.now() } : f)).sort((a, b) => a.order - b.order)
    );
  }, []);

  return {
    folders,
    loading,
    createFolder,
    findOrCreateFolder,
    updateFolder,
    deleteFolder,
    deleteFolderWithContents,
    trashFolderContents,
    archiveFolder,
    unarchiveFolder,
    reload: loadFolders,
  };
}
