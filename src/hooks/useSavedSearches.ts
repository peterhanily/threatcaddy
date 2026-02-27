import { useState, useCallback } from 'react';
import { nanoid } from 'nanoid';
import type { SearchMode } from '../lib/search';

const STORAGE_KEY = 'threatcaddy-saved-searches';
const MAX_SAVED = 20;

export interface SavedSearch {
  id: string;
  label: string;
  query: { mode: SearchMode; raw: string };
  createdAt: number;
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

export function useSavedSearches() {
  const [searches, setSearches] = useState<SavedSearch[]>(loadSearches);

  const saveSearch = useCallback((label: string, query: { mode: SearchMode; raw: string }) => {
    setSearches((prev) => {
      const next: SavedSearch[] = [
        { id: nanoid(), label, query, createdAt: Date.now() },
        ...prev,
      ].slice(0, MAX_SAVED);
      persistSearches(next);
      return next;
    });
  }, []);

  const deleteSearch = useCallback((id: string) => {
    setSearches((prev) => {
      const next = prev.filter((s) => s.id !== id);
      persistSearches(next);
      return next;
    });
  }, []);

  const clearAll = useCallback(() => {
    setSearches([]);
    persistSearches([]);
  }, []);

  return { searches, saveSearch, deleteSearch, clearAll };
}
