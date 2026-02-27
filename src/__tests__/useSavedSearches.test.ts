/* eslint-disable @typescript-eslint/no-non-null-assertion */
import { describe, it, expect, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useSavedSearches } from '../hooks/useSavedSearches';

const STORAGE_KEY = 'threatcaddy-saved-searches';

describe('useSavedSearches', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('starts with empty searches', () => {
    const { result } = renderHook(() => useSavedSearches());
    expect(result.current.searches).toEqual([]);
  });

  it('saves a search', () => {
    const { result } = renderHook(() => useSavedSearches());

    act(() => {
      result.current.saveSearch('my query', { mode: 'simple', raw: 'my query' });
    });

    expect(result.current.searches).toHaveLength(1);
    expect(result.current.searches[0].label).toBe('my query');
    expect(result.current.searches[0].query).toEqual({ mode: 'simple', raw: 'my query' });
  });

  it('persists to localStorage', () => {
    const { result } = renderHook(() => useSavedSearches());

    act(() => {
      result.current.saveSearch('test', { mode: 'regex', raw: 'test.*' });
    });

    const stored = JSON.parse(localStorage.getItem(STORAGE_KEY)!);
    expect(stored).toHaveLength(1);
    expect(stored[0].label).toBe('test');
  });

  it('loads persisted searches', () => {
    const data = [
      { id: 'x1', label: 'saved', query: { mode: 'simple', raw: 'saved' }, createdAt: Date.now() },
    ];
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data));

    const { result } = renderHook(() => useSavedSearches());
    expect(result.current.searches).toHaveLength(1);
    expect(result.current.searches[0].label).toBe('saved');
  });

  it('prepends new searches (newest first)', () => {
    const { result } = renderHook(() => useSavedSearches());

    act(() => {
      result.current.saveSearch('first', { mode: 'simple', raw: 'first' });
    });
    act(() => {
      result.current.saveSearch('second', { mode: 'simple', raw: 'second' });
    });

    expect(result.current.searches[0].label).toBe('second');
    expect(result.current.searches[1].label).toBe('first');
  });

  it('caps at 20 saved searches', () => {
    const { result } = renderHook(() => useSavedSearches());

    act(() => {
      for (let i = 0; i < 25; i++) {
        result.current.saveSearch(`q${i}`, { mode: 'simple', raw: `q${i}` });
      }
    });

    expect(result.current.searches).toHaveLength(20);
    // Newest should be first
    expect(result.current.searches[0].label).toBe('q24');
  });

  it('deletes a search', () => {
    const { result } = renderHook(() => useSavedSearches());

    act(() => {
      result.current.saveSearch('keep', { mode: 'simple', raw: 'keep' });
      result.current.saveSearch('delete-me', { mode: 'simple', raw: 'delete-me' });
    });

    const toDelete = result.current.searches.find((s) => s.label === 'delete-me')!;
    act(() => {
      result.current.deleteSearch(toDelete.id);
    });

    expect(result.current.searches).toHaveLength(1);
    expect(result.current.searches[0].label).toBe('keep');
  });

  it('clears all searches', () => {
    const { result } = renderHook(() => useSavedSearches());

    act(() => {
      result.current.saveSearch('one', { mode: 'simple', raw: 'one' });
      result.current.saveSearch('two', { mode: 'simple', raw: 'two' });
    });

    act(() => {
      result.current.clearAll();
    });

    expect(result.current.searches).toEqual([]);
    const stored = JSON.parse(localStorage.getItem(STORAGE_KEY)!);
    expect(stored).toEqual([]);
  });

  it('handles corrupted localStorage gracefully', () => {
    localStorage.setItem(STORAGE_KEY, 'not json');
    const { result } = renderHook(() => useSavedSearches());
    expect(result.current.searches).toEqual([]);
  });
});
