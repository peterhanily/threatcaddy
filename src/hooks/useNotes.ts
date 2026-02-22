import { useState, useEffect, useCallback } from 'react';
import { db } from '../db';
import type { Note, SortOption, SortDirection } from '../types';
import { nanoid } from 'nanoid';

const TRASH_PURGE_DAYS = 30;

export function useNotes() {
  const [notes, setNotes] = useState<Note[]>([]);
  const [loading, setLoading] = useState(true);

  const loadNotes = useCallback(async () => {
    const allNotes = await db.notes.toArray();
    // Auto-purge old trash
    const now = Date.now();
    const purgeThreshold = now - TRASH_PURGE_DAYS * 86400000;
    const toPurge = allNotes.filter((n) => n.trashed && n.trashedAt && n.trashedAt < purgeThreshold);
    if (toPurge.length > 0) {
      await db.notes.bulkDelete(toPurge.map((n) => n.id));
    }
    const remaining = allNotes.filter((n) => !toPurge.some((p) => p.id === n.id));
    setNotes(remaining);
    setLoading(false);
  }, []);

  useEffect(() => {
    loadNotes();
  }, [loadNotes]);

  const createNote = useCallback(async (partial?: Partial<Note>): Promise<Note> => {
    const note: Note = {
      id: nanoid(),
      title: 'Untitled Note',
      content: '',
      tags: [],
      pinned: false,
      archived: false,
      trashed: false,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      ...partial,
    };
    await db.notes.add(note);
    setNotes((prev) => [note, ...prev]);
    return note;
  }, []);

  const updateNote = useCallback(async (id: string, updates: Partial<Note>) => {
    const patched = { ...updates, updatedAt: Date.now() };
    await db.notes.update(id, patched);
    setNotes((prev) => prev.map((n) => (n.id === id ? { ...n, ...patched } : n)));
  }, []);

  const deleteNote = useCallback(async (id: string) => {
    await db.notes.delete(id);
    setNotes((prev) => prev.filter((n) => n.id !== id));
  }, []);

  const trashNote = useCallback(async (id: string) => {
    await updateNote(id, { trashed: true, trashedAt: Date.now() });
  }, [updateNote]);

  const restoreNote = useCallback(async (id: string) => {
    await updateNote(id, { trashed: false, trashedAt: undefined });
  }, [updateNote]);

  const togglePin = useCallback(async (id: string) => {
    const note = notes.find((n) => n.id === id);
    if (note) await updateNote(id, { pinned: !note.pinned });
  }, [notes, updateNote]);

  const toggleArchive = useCallback(async (id: string) => {
    const note = notes.find((n) => n.id === id);
    if (note) await updateNote(id, { archived: !note.archived });
  }, [notes, updateNote]);

  const getFilteredNotes = useCallback(
    (opts: {
      folderId?: string;
      tag?: string;
      showTrashed?: boolean;
      showArchived?: boolean;
      search?: string;
      sort?: SortOption;
      sortDir?: SortDirection;
    }) => {
      let filtered = notes;

      if (opts.showTrashed) {
        filtered = filtered.filter((n) => n.trashed);
      } else if (opts.showArchived) {
        filtered = filtered.filter((n) => n.archived && !n.trashed);
      } else {
        filtered = filtered.filter((n) => !n.trashed && !n.archived);
      }

      if (opts.folderId) {
        filtered = filtered.filter((n) => n.folderId === opts.folderId);
      }

      if (opts.tag) {
        filtered = filtered.filter((n) => n.tags.includes(opts.tag!));
      }

      if (opts.search) {
        const lower = opts.search.toLowerCase();
        filtered = filtered.filter(
          (n) =>
            n.title.toLowerCase().includes(lower) ||
            n.content.toLowerCase().includes(lower)
        );
      }

      const sort = opts.sort || 'updatedAt';
      const dir = opts.sortDir || 'desc';

      filtered.sort((a, b) => {
        // Pinned always first
        if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;

        if (sort === 'title') {
          const cmp = a.title.localeCompare(b.title);
          return dir === 'asc' ? cmp : -cmp;
        }
        const aVal = a[sort];
        const bVal = b[sort];
        return dir === 'asc' ? aVal - bVal : bVal - aVal;
      });

      return filtered;
    },
    [notes]
  );

  return {
    notes,
    loading,
    createNote,
    updateNote,
    deleteNote,
    trashNote,
    restoreNote,
    togglePin,
    toggleArchive,
    getFilteredNotes,
    reload: loadNotes,
  };
}
