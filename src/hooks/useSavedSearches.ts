import { useState, useCallback, useEffect, useRef } from 'react';
import { nanoid } from 'nanoid';
import type { SearchQuery } from '../lib/search';
import { useAuth } from '../contexts/AuthContext';
import {
  fetchSavedSearches,
  createSavedSearch,
  deleteSavedSearch as deleteServerSearch,
  type ServerSavedSearch,
} from '../lib/server-api';

const STORAGE_KEY = 'threatcaddy-saved-searches';
const MAX_SAVED = 20;

export interface SavedSearch {
  id: string;
  label: string;
  query: SearchQuery;
  createdAt: number;
  /** Server-synced searches carry a userId to distinguish from local-only */
  userId?: string;
  /** Whether this search is shared with the team */
  isShared?: boolean;
}

function loadSearches(): SavedSearch[] {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) return JSON.parse(stored);
  } catch {
    // ignore
  }
  return [];
}

function persistSearches(searches: SavedSearch[]) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(searches));
}

function serverSearchToLocal(s: ServerSavedSearch): SavedSearch {
  let query: SearchQuery;
  try {
    query = JSON.parse(s.query) as SearchQuery;
  } catch {
    query = { mode: 'simple', raw: s.query };
  }
  return {
    id: s.id,
    label: s.name,
    query,
    createdAt: new Date(s.createdAt).getTime(),
    userId: s.userId,
    isShared: s.isShared,
  };
}

export function useSavedSearches() {
  const auth = useAuth();
  const [searches, setSearches] = useState<SavedSearch[]>(loadSearches);
  const fetchedRef = useRef(false);

  // Fetch server searches on mount when in team mode
  useEffect(() => {
    if (!auth.connected || fetchedRef.current) return;
    fetchedRef.current = true;

    fetchSavedSearches()
      .then(({ searches: serverSearches }) => {
        const remote = serverSearches.map(serverSearchToLocal);
        setSearches((prev) => {
          // Merge: keep local-only searches, add/update server-synced ones
          const serverIds = new Set(remote.map((s) => s.id));
          const localOnly = prev.filter((s) => !serverIds.has(s.id) && !s.userId);
          const merged = [...remote, ...localOnly].slice(0, MAX_SAVED);
          persistSearches(merged);
          return merged;
        });
      })
      .catch(() => {
        // Silently fail — use local searches
      });
  }, [auth.connected]);

  // Reset fetch flag when disconnecting
  useEffect(() => {
    if (!auth.connected) {
      fetchedRef.current = false;
    }
  }, [auth.connected]);

  const saveSearch = useCallback((label: string, query: SearchQuery) => {
    const id = nanoid();
    const newSearch: SavedSearch = { id, label, query, createdAt: Date.now() };

    setSearches((prev) => {
      const next: SavedSearch[] = [newSearch, ...prev].slice(0, MAX_SAVED);
      persistSearches(next);
      return next;
    });

    // Sync to server if in team mode
    if (auth.connected) {
      createSavedSearch({
        name: label,
        query: JSON.stringify(query),
        filters: {},
        isShared: false,
      }).then(({ search: serverSearch }) => {
        // Update with server-assigned ID
        setSearches((prev) => {
          const next = prev.map((s) =>
            s.id === id
              ? { ...s, id: serverSearch.id, userId: serverSearch.userId }
              : s
          );
          persistSearches(next);
          return next;
        });
      }).catch(() => {
        // Keep local copy even if server sync fails
      });
    }
  }, [auth.connected]);

  const deleteSearch = useCallback((id: string) => {
    setSearches((prev) => {
      const deleting = prev.find((s) => s.id === id);
      const next = prev.filter((s) => s.id !== id);
      persistSearches(next);

      // Sync to server if the search has a userId (is server-synced)
      if (auth.connected && deleting?.userId) {
        deleteServerSearch(id).catch(() => {});
      }

      return next;
    });
  }, [auth.connected]);

  const renameSearch = useCallback((id: string, newLabel: string) => {
    setSearches((prev) => {
      const next = prev.map((s) => (s.id === id ? { ...s, label: newLabel } : s));
      persistSearches(next);
      return next;
    });
  }, []);

  const clearAll = useCallback(() => {
    // Only clear local searches, not server-synced ones
    setSearches((prev) => {
      // If connected, try to delete server searches
      if (auth.connected) {
        prev.filter((s) => s.userId).forEach((s) => {
          deleteServerSearch(s.id).catch(() => {});
        });
      }
      persistSearches([]);
      return [];
    });
  }, [auth.connected]);

  return { searches, saveSearch, deleteSearch, renameSearch, clearAll };
}
