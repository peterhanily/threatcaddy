import { useState, useEffect, useCallback, useRef } from 'react';
import Dexie from 'dexie';
import { db } from '../db';
import { deleteEntitiesWithReferences } from '../lib/entity-relations';
import type { Note, SortOption, SortDirection, IOCType } from '../types';
import { nanoid } from 'nanoid';
import { purgeOldTrash } from '../lib/trash-purge';

const CONTENT_CACHE_MAX = 200;

/** Resolves only after the complete write transaction has committed. */
export type NotePersistence = (note: Note) => Promise<void>;

type LRUCache<K, V> = {
  get(key: K): V | undefined;
  set(key: K, val: V): void;
  delete(key: K): void;
  keys(): IterableIterator<K>;
};

/** Create a size-bounded LRU cache that evicts least-recently-used entries when full */
function createLRUCache<K, V>(maxSize: number): LRUCache<K, V> {
  const map = new Map<K, V>();
  return {
    get(key) {
      if (!map.has(key)) return undefined;
      const val = map.get(key)!;
      map.delete(key);
      map.set(key, val);
      return val;
    },
    set(key, val) {
      if (map.has(key)) map.delete(key);
      map.set(key, val);
      if (map.size > maxSize) {
        map.delete(map.keys().next().value as K);
      }
    },
    delete(key) { map.delete(key); },
    keys() { return map.keys(); },
  };
}

/** Manages CRUD operations and state for investigation notes stored in IndexedDB. Returns notes array, loading flag, and mutation helpers.
 * Pass `folderId` to scope the initial load to a single investigation (uses compound index for performance).
 * Without `folderId`, all notes across all investigations are loaded (needed for search, graph, dashboard).
 */
export function useNotes(folderId?: string) {
  const [notes, setNotes] = useState<Note[]>([]);
  const [loading, setLoading] = useState(true);
  // Bounded LRU cache of full note content keyed by note id (used by search when content isn't in state)
  const contentCacheRef = useRef(createLRUCache<string, string>(CONTENT_CACHE_MAX));
  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  const loadNotes = useCallback(async () => {
    const allNotes = folderId
      ? await db.notes.where('[folderId+updatedAt]').between([folderId, Dexie.minKey], [folderId, Dexie.maxKey]).toArray()
      : await db.notes.toArray();
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
    if (!mountedRef.current) return;
    setNotes(remaining);
    setLoading(false);
  }, [folderId]);

  useEffect(() => {
    loadNotes();
  }, [loadNotes]);

  const createNote = useCallback(async (partial?: Partial<Note>, persist?: NotePersistence): Promise<Note> => {
    const { getCurrentUserName } = await import('../lib/utils');
    const note: Note = {
      id: nanoid(),
      title: 'Untitled Note',
      content: '',
      tags: [],
      pinned: false,
      archived: false,
      trashed: false,
      createdBy: partial?.createdBy || getCurrentUserName(),
      createdAt: Date.now(),
      updatedAt: Date.now(),
      ...partial,
    };
    try {
      if (persist) await persist(note);
      else await db.notes.add(note);
    } catch (err) {
      console.error('Failed to create note:', err);
      throw err;
    }
    if (mountedRef.current) {
      contentCacheRef.current.set(note.id, note.content);
      setNotes((prev) => [note, ...prev]);
    }
    return note;
  }, []);

  const updateNote = useCallback(async (id: string, updates: Partial<Note>) => {
    const patched = { ...updates, updatedAt: Date.now() };
    try {
      const updated = await db.notes.update(id, patched);
      if (!updated) throw new Error('This note no longer exists. The draft has not been saved.');
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
      await deleteEntitiesWithReferences({ notes: [id] });
    } catch (err) {
      console.error('Failed to delete note:', err);
      throw err;
    }
    contentCacheRef.current.delete(id);
    if (mountedRef.current) setNotes((prev) => prev.filter((n) => n.id !== id));
  }, []);

  const trashNote = useCallback(async (id: string) => {
    await updateNote(id, { trashed: true, trashedAt: Date.now() });
  }, [updateNote]);

  const restoreNote = useCallback(async (id: string) => {
    await updateNote(id, { trashed: false, trashedAt: undefined });
  }, [updateNote]);

  const togglePin = useCallback(async (id: string) => {
    const note = await db.notes.get(id);
    if (note) await updateNote(id, { pinned: !note.pinned });
  }, [updateNote]);

  const toggleArchive = useCallback(async (id: string) => {
    const note = await db.notes.get(id);
    if (note) await updateNote(id, { archived: !note.archived });
  }, [updateNote]);

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
      await deleteEntitiesWithReferences({ notes: trashedIds });
    } catch (err) {
      console.error('Failed to empty trash:', err);
      throw err;
    }
    if (mountedRef.current) setNotes((prev) => prev.filter((n) => !n.trashed));
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
