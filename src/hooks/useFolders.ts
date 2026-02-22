import { useState, useEffect, useCallback } from 'react';
import { db } from '../db';
import type { Folder } from '../types';
import { nanoid } from 'nanoid';

export function useFolders() {
  const [folders, setFolders] = useState<Folder[]>([]);

  const loadFolders = useCallback(async () => {
    const all = await db.folders.toArray();
    setFolders(all.sort((a, b) => a.order - b.order));
  }, []);

  useEffect(() => {
    loadFolders();
  }, [loadFolders]);

  const createFolder = useCallback(async (name: string, color?: string, icon?: string): Promise<Folder> => {
    const maxOrder = folders.reduce((max, f) => Math.max(max, f.order), 0);
    const folder: Folder = {
      id: nanoid(),
      name,
      color,
      icon,
      order: maxOrder + 1,
      createdAt: Date.now(),
    };
    await db.folders.add(folder);
    setFolders((prev) => [...prev, folder].sort((a, b) => a.order - b.order));
    return folder;
  }, [folders]);

  const updateFolder = useCallback(async (id: string, updates: Partial<Folder>) => {
    await db.folders.update(id, updates);
    setFolders((prev) =>
      prev.map((f) => (f.id === id ? { ...f, ...updates } : f)).sort((a, b) => a.order - b.order)
    );
  }, []);

  const findOrCreateFolder = useCallback(async (name: string): Promise<Folder> => {
    const existing = folders.find((f) => f.name === name);
    if (existing) return existing;
    return createFolder(name);
  }, [folders, createFolder]);

  const deleteFolder = useCallback(async (id: string) => {
    await db.folders.delete(id);
    // Unset folderId on notes and tasks in this folder
    const notesInFolder = await db.notes.where('folderId').equals(id).toArray();
    const tasksInFolder = await db.tasks.where('folderId').equals(id).toArray();
    await Promise.all([
      ...notesInFolder.map((n) => db.notes.update(n.id, { folderId: undefined })),
      ...tasksInFolder.map((t) => db.tasks.update(t.id, { folderId: undefined })),
    ]);
    setFolders((prev) => prev.filter((f) => f.id !== id));
  }, []);

  return {
    folders,
    createFolder,
    findOrCreateFolder,
    updateFolder,
    deleteFolder,
    reload: loadFolders,
  };
}
