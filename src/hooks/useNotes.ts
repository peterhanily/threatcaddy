import { useState, useEffect, useCallback } from 'react';
import { db } from '../db';
import type { Note, SortOption, SortDirection, IOCType } from '../types';
import { nanoid } from 'nanoid';
import { purgeOldTrash } from '../lib/trash-purge';

/** Manages CRUD operations and state for investigation notes stored in IndexedDB. Returns notes array, loading flag, and mutation helpers. */
export function useNotes() {
  const [notes, setNotes] = useState<Note[]>([]);
  const [loading, setLoading] = useState(true);

  const loadNotes = useCallback(async () => {
    const allNotes = await db.notes.toArray();
    const remaining = await purgeOldTrash(allNotes, db.notes);
    setNotes(remaining);
    setLoading(false);
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
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
    try {
      await db.notes.add(note);
    } catch (err) {
      console.error('Failed to create note:', err);
      throw err;
    }
    setNotes((prev) => [note, ...prev]);
    return note;
  }, []);

  const updateNote = useCallback(async (id: string, updates: Partial<Note>) => {
    const patched = { ...updates, updatedAt: Date.now() };
    try {
      await db.notes.update(id, patched);
    } catch (err) {
      console.error('Failed to update note:', err);
      throw err;
    }
    setNotes((prev) => prev.map((n) => (n.id === id ? { ...n, ...patched } : n)));
  }, []);

  const deleteNote = useCallback(async (id: string) => {
    try {
      await db.notes.delete(id);
      // Clean orphaned links from other entities
      await db.notes.filter(n => n.linkedNoteIds?.includes(id) ?? false).modify(n => {
        n.linkedNoteIds = (n.linkedNoteIds ?? []).filter(nid => nid !== id);
      });
      await db.tasks.filter(t => t.linkedNoteIds?.includes(id) ?? false).modify(t => {
        t.linkedNoteIds = (t.linkedNoteIds ?? []).filter(nid => nid !== id);
      });
      await db.timelineEvents.filter(e => e.linkedNoteIds.includes(id)).modify(e => {
        e.linkedNoteIds = e.linkedNoteIds.filter(nid => nid !== id);
      });
    } catch (err) {
      console.error('Failed to delete note:', err);
      throw err;
    }
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
      excludeFolderIds?: string[];
      tag?: string;
      showTrashed?: boolean;
      showArchived?: boolean;
      search?: string;
      sort?: SortOption;
      sortDir?: SortDirection;
      iocTypes?: IOCType[];
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
      } else if (opts.excludeFolderIds && opts.excludeFolderIds.length > 0) {
        // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
        filtered = filtered.filter((n) => !opts.excludeFolderIds!.includes(n.folderId!));
      }

      if (opts.tag) {
        // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
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

      if (opts.iocTypes && opts.iocTypes.length > 0) {
        filtered = filtered.filter((n) =>
          // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
          n.iocTypes && opts.iocTypes!.some((t) => n.iocTypes!.includes(t))
        );
      }

      const sort = opts.sort || 'updatedAt';
      const dir = opts.sortDir || 'desc';

      filtered.sort((a, b) => {
        // Pinned always first
        if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;

        if (sort === 'iocCount') {
          const aCount = a.iocAnalysis?.iocs.filter((i) => !i.dismissed).length ?? 0;
          const bCount = b.iocAnalysis?.iocs.filter((i) => !i.dismissed).length ?? 0;
          return dir === 'asc' ? aCount - bCount : bCount - aCount;
        }

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

  const emptyTrash = useCallback(async () => {
    const trashedIds = notes.filter((n) => n.trashed).map((n) => n.id);
    if (trashedIds.length === 0) return;
    try {
      await db.notes.bulkDelete(trashedIds);
      // Clean orphaned links from other entities
      const idSet = new Set(trashedIds);
      await db.notes.filter(n => n.linkedNoteIds?.some(nid => idSet.has(nid)) ?? false).modify(n => {
        n.linkedNoteIds = (n.linkedNoteIds ?? []).filter(nid => !idSet.has(nid));
      });
      await db.tasks.filter(t => t.linkedNoteIds?.some(nid => idSet.has(nid)) ?? false).modify(t => {
        t.linkedNoteIds = (t.linkedNoteIds ?? []).filter(nid => !idSet.has(nid));
      });
      await db.timelineEvents.filter(e => e.linkedNoteIds.some(nid => idSet.has(nid))).modify(e => {
        e.linkedNoteIds = e.linkedNoteIds.filter(nid => !idSet.has(nid));
      });
    } catch (err) {
      console.error('Failed to empty trash:', err);
      throw err;
    }
    setNotes((prev) => prev.filter((n) => !n.trashed));
  }, [notes]);

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
    emptyTrash,
    reload: loadNotes,
  };
}
