import { useState, useEffect, useCallback, useRef } from 'react';
import { db } from '../db';
import type { Note, SortOption, SortDirection, IOCType } from '../types';
import { nanoid } from 'nanoid';
import { purgeOldTrash } from '../lib/trash-purge';

/** Manages CRUD operations and state for investigation notes stored in IndexedDB. Returns notes array, loading flag, and mutation helpers. */
export function useNotes() {
  const [notes, setNotes] = useState<Note[]>([]);
  const [loading, setLoading] = useState(true);
  // Cache of full note content keyed by note id (used by search when content isn't in state)
  const contentCacheRef = useRef<Map<string, string>>(new Map());

  const loadNotes = useCallback(async () => {
    const allNotes = await db.notes.toArray();
    const remaining = await purgeOldTrash(allNotes, db.notes);
    const cache = contentCacheRef.current;
    for (const note of remaining) {
      cache.set(note.id, note.content);
    }
    // Clean up cache entries for deleted/purged notes
    const activeIds = new Set(remaining.map(n => n.id));
    for (const id of cache.keys()) {
      if (!activeIds.has(id)) cache.delete(id);
    }
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
    contentCacheRef.current.set(note.id, note.content);
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
    if (patched.content !== undefined) {
      contentCacheRef.current.set(id, patched.content);
    }
    setNotes((prev) => prev.map((n) => (n.id === id ? { ...n, ...patched } : n)));
  }, []);

  const deleteNote = useCallback(async (id: string) => {
    try {
      await db.notes.delete(id);
      // Batch orphan link cleanup: collect IDs from affected tables then modify in bulk
      const [linkedNotes, linkedTasks, linkedEvents] = await Promise.all([
        db.notes.toArray().then(items => items.filter(n => n.linkedNoteIds?.includes(id))),
        db.tasks.toArray().then(items => items.filter(t => t.linkedNoteIds?.includes(id))),
        db.timelineEvents.toArray().then(items => items.filter(e => e.linkedNoteIds.includes(id))),
      ]);
      const ops: Promise<unknown>[] = [];
      for (const n of linkedNotes) {
        ops.push(db.notes.update(n.id, { linkedNoteIds: (n.linkedNoteIds ?? []).filter(nid => nid !== id) }));
      }
      for (const t of linkedTasks) {
        ops.push(db.tasks.update(t.id, { linkedNoteIds: (t.linkedNoteIds ?? []).filter(nid => nid !== id) }));
      }
      for (const e of linkedEvents) {
        ops.push(db.timelineEvents.update(e.id, { linkedNoteIds: e.linkedNoteIds.filter(nid => nid !== id) }));
      }
      await Promise.all(ops);
    } catch (err) {
      console.error('Failed to delete note:', err);
      throw err;
    }
    contentCacheRef.current.delete(id);
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
          (n) => {
            if (n.title.toLowerCase().includes(lower)) return true;
            // Use cached content for search if the note's content is stripped
            const content = n.content || contentCacheRef.current.get(n.id) || '';
            return content.toLowerCase().includes(lower);
          }
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
      // Batch orphan link cleanup in a single pass per table
      const idSet = new Set(trashedIds);
      const [allNotes, allTasks, allEvents] = await Promise.all([
        db.notes.toArray(),
        db.tasks.toArray(),
        db.timelineEvents.toArray(),
      ]);
      const ops: Promise<unknown>[] = [];
      for (const n of allNotes) {
        if (n.linkedNoteIds?.some(nid => idSet.has(nid))) {
          ops.push(db.notes.update(n.id, { linkedNoteIds: n.linkedNoteIds.filter(nid => !idSet.has(nid)) }));
        }
      }
      for (const t of allTasks) {
        if (t.linkedNoteIds?.some(nid => idSet.has(nid))) {
          ops.push(db.tasks.update(t.id, { linkedNoteIds: (t.linkedNoteIds ?? []).filter(nid => !idSet.has(nid)) }));
        }
      }
      for (const e of allEvents) {
        if (e.linkedNoteIds.some(nid => idSet.has(nid))) {
          ops.push(db.timelineEvents.update(e.id, { linkedNoteIds: e.linkedNoteIds.filter(nid => !idSet.has(nid)) }));
        }
      }
      await Promise.all(ops);
      for (const id of trashedIds) contentCacheRef.current.delete(id);
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
