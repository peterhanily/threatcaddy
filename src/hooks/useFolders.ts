import { useState, useEffect, useCallback } from 'react';
import { db } from '../db';
import { deleteEntitiesWithReferences, setInvestigationArchived } from '../lib/entity-relations';
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
    await db.transaction('rw', [db.folders, db.notes, db.tasks, db.timelineEvents, db.whiteboards, db.standaloneIOCs, db.evidenceItems, db.chatThreads], async () => {
      await db.folders.delete(id);
      // Unset folderId on notes, tasks, timeline events, whiteboards, IOCs, evidence, and chat threads in this folder
      await Promise.all([
        db.notes.where('folderId').equals(id).modify({ folderId: undefined, updatedAt: Date.now() }),
        db.tasks.where('folderId').equals(id).modify({ folderId: undefined, updatedAt: Date.now() }),
        db.timelineEvents.where('folderId').equals(id).modify({ folderId: undefined, updatedAt: Date.now() }),
        db.whiteboards.where('folderId').equals(id).modify({ folderId: undefined, updatedAt: Date.now() }),
        db.standaloneIOCs.where('folderId').equals(id).modify({ folderId: undefined, updatedAt: Date.now() }),
        db.evidenceItems.where('folderId').equals(id).modify({ folderId: undefined, updatedAt: Date.now() }),
        db.chatThreads.where('folderId').equals(id).modify({ folderId: undefined, updatedAt: Date.now() }),
      ]);
    });
    setFolders((prev) => prev.filter((f) => f.id !== id));
  }, []);

  const deleteFolderWithContents = useCallback(async (id: string) => {
    await deleteEntitiesWithReferences({ folders: [id] }, id);
    setFolders((prev) => prev.filter((f) => f.id !== id));
  }, []);

  const trashFolderContents = useCallback(async (id: string) => {
    const now = Date.now();
    await db.transaction('rw', [db.folders, db.notes, db.tasks, db.timelineEvents, db.whiteboards, db.standaloneIOCs, db.evidenceItems, db.chatThreads, db.agentDeployments], async () => {
      await Promise.all([
        db.notes.where('folderId').equals(id).filter((n) => !n.trashed).modify({ trashed: true, trashedAt: now, updatedAt: now }),
        db.tasks.where('folderId').equals(id).filter((t) => !t.trashed).modify({ trashed: true, trashedAt: now, updatedAt: now }),
        db.timelineEvents.where('folderId').equals(id).filter((e) => !e.trashed).modify({ trashed: true, trashedAt: now, updatedAt: now }),
        db.whiteboards.where('folderId').equals(id).filter((w) => !w.trashed).modify({ trashed: true, trashedAt: now, updatedAt: now }),
        db.standaloneIOCs.where('folderId').equals(id).filter((i) => !i.trashed).modify({ trashed: true, trashedAt: now, updatedAt: now }),
        db.evidenceItems.where('folderId').equals(id).filter((e) => !e.trashed).modify({ trashed: true, trashedAt: now, updatedAt: now }),
        db.chatThreads.where('folderId').equals(id).filter((c) => !c.trashed).modify({ trashed: true, trashedAt: now, updatedAt: now }),
        // Stop agent deployments for this investigation
        db.agentDeployments.where('investigationId').equals(id).modify({ shift: 'resting', status: 'idle', updatedAt: now }),
      ]);
      await db.folders.update(id, { agentEnabled: false });
      await db.folders.delete(id);
    });
    setFolders((prev) => prev.filter((f) => f.id !== id));
  }, []);

  const archiveFolder = useCallback(async (id: string) => {
    await setInvestigationArchived(id, true);
    await loadFolders();
  }, [loadFolders]);

  const unarchiveFolder = useCallback(async (id: string) => {
    await setInvestigationArchived(id, false);
    await loadFolders();
  }, [loadFolders]);

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
