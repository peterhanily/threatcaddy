import { useState, useEffect, useCallback } from 'react';
import { db } from '../db';
import type { Folder } from '../types';
import { nanoid } from 'nanoid';

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
    await db.folders.delete(id);
    // Unset folderId on notes, tasks, timeline events, and whiteboards in this folder
    const notesInFolder = await db.notes.where('folderId').equals(id).toArray();
    const tasksInFolder = await db.tasks.where('folderId').equals(id).toArray();
    const eventsInFolder = await db.timelineEvents.where('folderId').equals(id).toArray();
    const whiteboardsInFolder = await db.whiteboards.where('folderId').equals(id).toArray();
    const iocsInFolder = await db.standaloneIOCs.where('folderId').equals(id).toArray();
    await Promise.all([
      ...notesInFolder.map((n) => db.notes.update(n.id, { folderId: undefined })),
      ...tasksInFolder.map((t) => db.tasks.update(t.id, { folderId: undefined })),
      ...eventsInFolder.map((e) => db.timelineEvents.update(e.id, { folderId: undefined })),
      ...whiteboardsInFolder.map((w) => db.whiteboards.update(w.id, { folderId: undefined })),
      ...iocsInFolder.map((i) => db.standaloneIOCs.update(i.id, { folderId: undefined })),
    ]);
    setFolders((prev) => prev.filter((f) => f.id !== id));
  }, []);

  const deleteFolderWithContents = useCallback(async (id: string) => {
    // Collect all entities in this folder (same query pattern as deleteFolder)
    const notesInFolder = await db.notes.where('folderId').equals(id).toArray();
    const tasksInFolder = await db.tasks.where('folderId').equals(id).toArray();
    const eventsInFolder = await db.timelineEvents.where('folderId').equals(id).toArray();
    const whiteboardsInFolder = await db.whiteboards.where('folderId').equals(id).toArray();
    const iocsInFolder = await db.standaloneIOCs.where('folderId').equals(id).toArray();

    const noteIds = notesInFolder.map(n => n.id);
    const taskIds = tasksInFolder.map(t => t.id);
    const eventIds = eventsInFolder.map(e => e.id);
    const whiteboardIds = whiteboardsInFolder.map(w => w.id);
    const iocIds = iocsInFolder.map(i => i.id);

    // Bulk-delete all entities
    await Promise.all([
      db.notes.bulkDelete(noteIds),
      db.tasks.bulkDelete(taskIds),
      db.timelineEvents.bulkDelete(eventIds),
      db.whiteboards.bulkDelete(whiteboardIds),
      db.standaloneIOCs.bulkDelete(iocIds),
    ]);

    // Clean orphaned cross-entity links
    const noteIdSet = new Set(noteIds);
    const taskIdSet = new Set(taskIds);
    const eventIdSet = new Set(eventIds);

    if (noteIdSet.size > 0) {
      await db.notes.filter(n => n.linkedNoteIds?.some(nid => noteIdSet.has(nid)) ?? false).modify(n => {
        n.linkedNoteIds = (n.linkedNoteIds ?? []).filter(nid => !noteIdSet.has(nid));
      });
      await db.tasks.filter(t => t.linkedNoteIds?.some(nid => noteIdSet.has(nid)) ?? false).modify(t => {
        t.linkedNoteIds = (t.linkedNoteIds ?? []).filter(nid => !noteIdSet.has(nid));
      });
      await db.timelineEvents.filter(e => e.linkedNoteIds.some(nid => noteIdSet.has(nid))).modify(e => {
        e.linkedNoteIds = e.linkedNoteIds.filter(nid => !noteIdSet.has(nid));
      });
      await db.standaloneIOCs.filter(i => i.linkedNoteIds?.some(nid => noteIdSet.has(nid)) ?? false).modify(i => {
        i.linkedNoteIds = (i.linkedNoteIds ?? []).filter(nid => !noteIdSet.has(nid));
      });
    }

    if (taskIdSet.size > 0) {
      await db.notes.filter(n => n.linkedTaskIds?.some(tid => taskIdSet.has(tid)) ?? false).modify(n => {
        n.linkedTaskIds = (n.linkedTaskIds ?? []).filter(tid => !taskIdSet.has(tid));
      });
      await db.tasks.filter(t => t.linkedTaskIds?.some(tid => taskIdSet.has(tid)) ?? false).modify(t => {
        t.linkedTaskIds = (t.linkedTaskIds ?? []).filter(tid => !taskIdSet.has(tid));
      });
      await db.timelineEvents.filter(e => e.linkedTaskIds.some(tid => taskIdSet.has(tid))).modify(e => {
        e.linkedTaskIds = e.linkedTaskIds.filter(tid => !taskIdSet.has(tid));
      });
      await db.standaloneIOCs.filter(i => i.linkedTaskIds?.some(tid => taskIdSet.has(tid)) ?? false).modify(i => {
        i.linkedTaskIds = (i.linkedTaskIds ?? []).filter(tid => !taskIdSet.has(tid));
      });
    }

    if (eventIdSet.size > 0) {
      await db.notes.filter(n => n.linkedTimelineEventIds?.some(eid => eventIdSet.has(eid)) ?? false).modify(n => {
        n.linkedTimelineEventIds = (n.linkedTimelineEventIds ?? []).filter(eid => !eventIdSet.has(eid));
      });
      await db.tasks.filter(t => t.linkedTimelineEventIds?.some(eid => eventIdSet.has(eid)) ?? false).modify(t => {
        t.linkedTimelineEventIds = (t.linkedTimelineEventIds ?? []).filter(eid => !eventIdSet.has(eid));
      });
      await db.standaloneIOCs.filter(i => i.linkedTimelineEventIds?.some(eid => eventIdSet.has(eid)) ?? false).modify(i => {
        i.linkedTimelineEventIds = (i.linkedTimelineEventIds ?? []).filter(eid => !eventIdSet.has(eid));
      });
    }

    // Delete the folder itself
    await db.folders.delete(id);
    setFolders((prev) => prev.filter((f) => f.id !== id));
  }, []);

  const trashFolderContents = useCallback(async (id: string) => {
    const now = Date.now();
    const notesInFolder = await db.notes.where('folderId').equals(id).toArray();
    const tasksInFolder = await db.tasks.where('folderId').equals(id).toArray();
    const eventsInFolder = await db.timelineEvents.where('folderId').equals(id).toArray();
    const whiteboardsInFolder = await db.whiteboards.where('folderId').equals(id).toArray();
    const iocsInFolder = await db.standaloneIOCs.where('folderId').equals(id).toArray();

    await Promise.all([
      ...notesInFolder.filter((n) => !n.trashed).map((n) => db.notes.update(n.id, { trashed: true, trashedAt: now })),
      ...tasksInFolder.filter((t) => !t.trashed).map((t) => db.tasks.update(t.id, { trashed: true, trashedAt: now })),
      ...eventsInFolder.filter((e) => !e.trashed).map((e) => db.timelineEvents.update(e.id, { trashed: true, trashedAt: now })),
      ...whiteboardsInFolder.filter((w) => !w.trashed).map((w) => db.whiteboards.update(w.id, { trashed: true, trashedAt: now })),
      ...iocsInFolder.filter((i) => !i.trashed).map((i) => db.standaloneIOCs.update(i.id, { trashed: true, trashedAt: now })),
    ]);

    await db.folders.delete(id);
    setFolders((prev) => prev.filter((f) => f.id !== id));
  }, []);

  const archiveFolder = useCallback(async (id: string) => {
    await db.folders.update(id, { status: 'archived', updatedAt: Date.now() });
    const notesInFolder = await db.notes.where('folderId').equals(id).toArray();
    const tasksInFolder = await db.tasks.where('folderId').equals(id).toArray();
    const eventsInFolder = await db.timelineEvents.where('folderId').equals(id).toArray();
    const whiteboardsInFolder = await db.whiteboards.where('folderId').equals(id).toArray();
    const iocsInFolder = await db.standaloneIOCs.where('folderId').equals(id).toArray();

    await Promise.all([
      ...notesInFolder.filter((n) => !n.trashed).map((n) => db.notes.update(n.id, { archived: true })),
      ...tasksInFolder.filter((t) => !t.trashed).map((t) => db.tasks.update(t.id, { archived: true })),
      ...eventsInFolder.filter((e) => !e.trashed).map((e) => db.timelineEvents.update(e.id, { archived: true })),
      ...whiteboardsInFolder.filter((w) => !w.trashed).map((w) => db.whiteboards.update(w.id, { archived: true })),
      ...iocsInFolder.filter((i) => !i.trashed).map((i) => db.standaloneIOCs.update(i.id, { archived: true })),
    ]);

    setFolders((prev) =>
      prev.map((f) => (f.id === id ? { ...f, status: 'archived' as const, updatedAt: Date.now() } : f)).sort((a, b) => a.order - b.order)
    );
  }, []);

  const unarchiveFolder = useCallback(async (id: string) => {
    await db.folders.update(id, { status: 'active', updatedAt: Date.now() });
    const notesInFolder = await db.notes.where('folderId').equals(id).toArray();
    const tasksInFolder = await db.tasks.where('folderId').equals(id).toArray();
    const eventsInFolder = await db.timelineEvents.where('folderId').equals(id).toArray();
    const whiteboardsInFolder = await db.whiteboards.where('folderId').equals(id).toArray();
    const iocsInFolder = await db.standaloneIOCs.where('folderId').equals(id).toArray();

    await Promise.all([
      ...notesInFolder.filter((n) => n.archived && !n.trashed).map((n) => db.notes.update(n.id, { archived: false })),
      ...tasksInFolder.filter((t) => t.archived && !t.trashed).map((t) => db.tasks.update(t.id, { archived: false })),
      ...eventsInFolder.filter((e) => e.archived && !e.trashed).map((e) => db.timelineEvents.update(e.id, { archived: false })),
      ...whiteboardsInFolder.filter((w) => w.archived && !w.trashed).map((w) => db.whiteboards.update(w.id, { archived: false })),
      ...iocsInFolder.filter((i) => i.archived && !i.trashed).map((i) => db.standaloneIOCs.update(i.id, { archived: false })),
    ]);

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
