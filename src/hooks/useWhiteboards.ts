import { useState, useEffect, useCallback, useMemo } from 'react';
import { db } from '../db';
import type { Whiteboard } from '../types';
import { nanoid } from 'nanoid';
import { purgeOldTrash } from '../lib/trash-purge';

/** Manages Excalidraw whiteboards -- create, update, reorder, trash, and restore. Returns whiteboards array and helpers. */
export function useWhiteboards() {
  const [whiteboards, setWhiteboards] = useState<Whiteboard[]>([]);
  const [loading, setLoading] = useState(true);

  const loadWhiteboards = useCallback(async () => {
    const all = await db.whiteboards.toArray();
    const remaining = await purgeOldTrash(all, db.whiteboards);
    setWhiteboards(remaining.sort((a, b) => a.order - b.order));
    setLoading(false);
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    loadWhiteboards();
  }, [loadWhiteboards]);

  const createWhiteboard = useCallback(async (name?: string, folderId?: string): Promise<Whiteboard> => {
    const maxOrder = whiteboards.reduce((max, w) => Math.max(max, w.order), 0);
    const now = Date.now();
    const whiteboard: Whiteboard = {
      id: nanoid(),
      name: name || 'Untitled Whiteboard',
      elements: '[]',
      tags: [],
      order: maxOrder + 1,
      trashed: false,
      archived: false,
      createdAt: now,
      updatedAt: now,
      ...(folderId ? { folderId } : {}),
    };
    await db.whiteboards.add(whiteboard);
    setWhiteboards((prev) => [...prev, whiteboard].sort((a, b) => a.order - b.order));
    return whiteboard;
  }, [whiteboards]);

  const updateWhiteboard = useCallback(async (id: string, updates: Partial<Whiteboard>) => {
    const patched = { ...updates, updatedAt: Date.now() };
    await db.whiteboards.update(id, patched);
    setWhiteboards((prev) =>
      prev.map((w) => (w.id === id ? { ...w, ...patched } : w)).sort((a, b) => a.order - b.order)
    );
  }, []);

  const deleteWhiteboard = useCallback(async (id: string) => {
    await db.whiteboards.delete(id);
    setWhiteboards((prev) => prev.filter((w) => w.id !== id));
  }, []);

  const trashWhiteboard = useCallback(async (id: string) => {
    await updateWhiteboard(id, { trashed: true, trashedAt: Date.now() });
  }, [updateWhiteboard]);

  const restoreWhiteboard = useCallback(async (id: string) => {
    await updateWhiteboard(id, { trashed: false, trashedAt: undefined });
  }, [updateWhiteboard]);

  const toggleArchiveWhiteboard = useCallback(async (id: string) => {
    const wb = whiteboards.find((w) => w.id === id);
    if (wb) await updateWhiteboard(id, { archived: !wb.archived });
  }, [whiteboards, updateWhiteboard]);

  const emptyTrashWhiteboards = useCallback(async () => {
    const trashedIds = whiteboards.filter((w) => w.trashed).map((w) => w.id);
    if (trashedIds.length === 0) return;
    await db.whiteboards.bulkDelete(trashedIds);
    setWhiteboards((prev) => prev.filter((w) => !w.trashed));
  }, [whiteboards]);

  const getFilteredWhiteboards = useCallback(
    (opts: { folderId?: string; tag?: string; showTrashed?: boolean; showArchived?: boolean }) => {
      let filtered = whiteboards;

      if (opts.showTrashed) {
        filtered = filtered.filter((w) => w.trashed);
      } else if (opts.showArchived) {
        filtered = filtered.filter((w) => w.archived && !w.trashed);
      } else {
        filtered = filtered.filter((w) => !w.trashed && !w.archived);
      }

      if (opts.folderId) {
        filtered = filtered.filter((w) => w.folderId === opts.folderId);
      }
      if (opts.tag) {
        // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
        filtered = filtered.filter((w) => w.tags.includes(opts.tag!));
      }
      return filtered;
    },
    [whiteboards]
  );

  const whiteboardCounts = useMemo(() => ({
    total: whiteboards.filter((w) => !w.trashed && !w.archived).length,
    trashed: whiteboards.filter((w) => w.trashed).length,
    archived: whiteboards.filter((w) => w.archived && !w.trashed).length,
  }), [whiteboards]);

  return {
    whiteboards,
    loading,
    createWhiteboard,
    updateWhiteboard,
    deleteWhiteboard,
    trashWhiteboard,
    restoreWhiteboard,
    toggleArchiveWhiteboard,
    emptyTrashWhiteboards,
    getFilteredWhiteboards,
    whiteboardCounts,
    reload: loadWhiteboards,
  };
}
