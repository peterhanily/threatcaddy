import { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { Search, X, FileText, Paperclip, ListChecks, Save } from 'lucide-react';
import { cn } from '../../lib/utils';
import { formatDate } from '../../lib/utils';
import { unifiedSearch, type SearchMode, type SearchResult, type SearchResultType } from '../../lib/search';
import { useSavedSearches } from '../../hooks/useSavedSearches';
import type { Note, Task } from '../../types';

interface SearchOverlayProps {
  open: boolean;
  onClose: () => void;
  notes: Note[];
  tasks: Task[];
  clipsFolderId: string | undefined;
  onNavigateToNote: (id: string) => void;
  onNavigateToTask: (id: string) => void;
}

const TYPE_ICONS: Record<SearchResultType, typeof FileText> = {
  note: FileText,
  clip: Paperclip,
  task: ListChecks,
};

const TYPE_LABELS: Record<SearchResultType, string> = {
  note: 'Notes',
  clip: 'Clips',
  task: 'Tasks',
};

export function SearchOverlay({
  open,
  onClose,
  notes,
  tasks,
  clipsFolderId,
  onNavigateToNote,
  onNavigateToTask,
}: SearchOverlayProps) {
  const [query, setQuery] = useState('');
  const [mode, setMode] = useState<SearchMode>('simple');
  const [debouncedQuery, setDebouncedQuery] = useState('');
  const [activeIndex, setActiveIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const resultsRef = useRef<HTMLDivElement>(null);
  const { searches, saveSearch, deleteSearch, clearAll } = useSavedSearches();

  // Debounce query
  useEffect(() => {
    const timer = setTimeout(() => setDebouncedQuery(query), 150);
    return () => clearTimeout(timer);
  }, [query]);

  // Auto-focus input when overlay opens
  useEffect(() => {
    if (open) {
      // Small delay to ensure DOM is ready
      requestAnimationFrame(() => inputRef.current?.focus());
    } else {
      setQuery('');
      setDebouncedQuery('');
      setActiveIndex(0);
    }
  }, [open]);

  // Search results
  const searchResult = useMemo(() => {
    if (!debouncedQuery.trim()) return { results: [], error: undefined };
    return unifiedSearch(notes, tasks, clipsFolderId, { mode, raw: debouncedQuery });
  }, [notes, tasks, clipsFolderId, mode, debouncedQuery]);

  const { results, error } = searchResult;

  // Group results by type
  const grouped = useMemo(() => {
    const groups: Partial<Record<SearchResultType, SearchResult[]>> = {};
    for (const r of results) {
      if (!groups[r.type]) groups[r.type] = [];
      groups[r.type]!.push(r);
    }
    return groups;
  }, [results]);

  // Flat list for keyboard navigation
  const flatResults = results;

  // Reset activeIndex when results change
  useEffect(() => {
    setActiveIndex(0);
  }, [results]);

  const handleSelect = useCallback((result: SearchResult) => {
    if (result.type === 'note' || result.type === 'clip') onNavigateToNote(result.id);
    else onNavigateToTask(result.id);
    onClose();
  }, [onNavigateToNote, onNavigateToTask, onClose]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActiveIndex((prev) => Math.min(prev + 1, flatResults.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActiveIndex((prev) => Math.max(prev - 1, 0));
    } else if (e.key === 'Enter' && flatResults[activeIndex]) {
      e.preventDefault();
      handleSelect(flatResults[activeIndex]);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      onClose();
    }
  }, [flatResults, activeIndex, handleSelect, onClose]);

  // Scroll active result into view
  useEffect(() => {
    if (!resultsRef.current) return;
    const activeEl = resultsRef.current.querySelector(`[data-index="${activeIndex}"]`);
    activeEl?.scrollIntoView({ block: 'nearest' });
  }, [activeIndex]);

  const handleSave = useCallback(() => {
    if (!query.trim()) return;
    saveSearch(query, { mode, raw: query });
  }, [query, mode, saveSearch]);

  const handleLoadSaved = useCallback((saved: { query: { mode: SearchMode; raw: string } }) => {
    setMode(saved.query.mode);
    setQuery(saved.query.raw);
  }, []);

  // Pre-compute a flat index map for keyboard navigation (avoids mutable counter during render)
  const indexMap = useMemo(() => {
    const map = new Map<string, number>();
    let idx = 0;
    for (const type of ['note', 'clip', 'task'] as SearchResultType[]) {
      const group = grouped[type];
      if (group) {
        for (const r of group) { map.set(r.id, idx++); }
      }
    }
    return map;
  }, [grouped]);

  if (!open) return null;

  const modes: { value: SearchMode; label: string }[] = [
    { value: 'simple', label: 'Simple' },
    { value: 'regex', label: 'Regex' },
    { value: 'advanced', label: 'Advanced' },
  ];

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center pt-[10vh]" onKeyDown={handleKeyDown}>
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />

      {/* Overlay panel */}
      <div className="relative w-full max-w-2xl mx-4 bg-gray-900 border border-gray-700 rounded-xl shadow-2xl flex flex-col max-h-[70vh] overflow-hidden">
        {/* Header: mode toggle + input */}
        <div className="p-3 border-b border-gray-800">
          <div className="flex items-center gap-2 mb-2">
            {/* Mode toggle */}
            <div className="flex rounded-lg border border-gray-700 overflow-hidden shrink-0">
              {modes.map((m) => (
                <button
                  key={m.value}
                  onClick={() => setMode(m.value)}
                  className={cn(
                    'px-2.5 py-1 text-xs font-medium transition-colors',
                    mode === m.value
                      ? 'bg-accent text-white'
                      : 'text-gray-400 hover:text-gray-200 hover:bg-gray-800'
                  )}
                >
                  {m.label}
                </button>
              ))}
            </div>

            {/* Search input */}
            <div className="relative flex-1">
              <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500" />
              <input
                ref={inputRef}
                type="text"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder={
                  mode === 'simple' ? 'Search all notes, clips, and tasks...' :
                  mode === 'regex' ? 'Enter regex pattern...' :
                  'title:contains("foo") AND tags:contains("bar")...'
                }
                className="w-full pl-9 pr-8 py-2 bg-gray-800 border border-gray-700 rounded-lg text-gray-200 placeholder-gray-500 focus:outline-none focus:border-accent focus:ring-1 focus:ring-accent text-sm"
              />
              {query && (
                <button
                  onClick={() => setQuery('')}
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-500 hover:text-gray-300"
                >
                  <X size={14} />
                </button>
              )}
            </div>
          </div>

          {/* Save / Clear buttons */}
          <div className="flex items-center gap-2">
            <button
              onClick={handleSave}
              disabled={!query.trim()}
              className="flex items-center gap-1 px-2 py-1 text-xs text-gray-400 hover:text-gray-200 hover:bg-gray-800 rounded transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
            >
              <Save size={12} />
              Save Search
            </button>
            <button
              onClick={() => setQuery('')}
              className="flex items-center gap-1 px-2 py-1 text-xs text-gray-400 hover:text-gray-200 hover:bg-gray-800 rounded transition-colors"
            >
              <X size={12} />
              Clear
            </button>
            {error && (
              <span className="text-xs text-red-400 ml-2">{error}</span>
            )}
            {debouncedQuery && !error && (
              <span className="text-xs text-gray-500 ml-auto">{results.length} result{results.length !== 1 ? 's' : ''}</span>
            )}
          </div>
        </div>

        {/* Results */}
        <div ref={resultsRef} className="flex-1 overflow-y-auto">
          {debouncedQuery && results.length === 0 && !error && (
            <div className="p-8 text-center text-gray-500 text-sm">
              No results found for "{debouncedQuery}"
            </div>
          )}

          {(['note', 'clip', 'task'] as SearchResultType[]).map((type) => {
            const group = grouped[type];
            if (!group || group.length === 0) return null;
            return (
              <div key={type}>
                <div className="px-3 py-1.5 text-xs font-semibold text-gray-500 uppercase tracking-wider bg-gray-900/80 sticky top-0">
                  {TYPE_LABELS[type]} ({group.length})
                </div>
                {group.map((result) => {
                  const idx = indexMap.get(result.id)!;
                  const Icon = TYPE_ICONS[result.type];
                  return (
                    <button
                      key={result.id}
                      data-index={idx}
                      onClick={() => handleSelect(result)}
                      onMouseEnter={() => setActiveIndex(idx)}
                      className={cn(
                        'w-full text-left px-3 py-2 flex items-start gap-3 transition-colors cursor-pointer',
                        idx === activeIndex ? 'bg-accent/10' : 'hover:bg-gray-800/50'
                      )}
                    >
                      <Icon size={16} className="text-gray-500 mt-0.5 shrink-0" />
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-medium text-gray-200 truncate">{result.title}</span>
                          <span className="text-xs text-gray-600 shrink-0">{formatDate(result.updatedAt)}</span>
                        </div>
                        {result.snippet && result.snippet !== result.title && (
                          <p className="text-xs text-gray-500 truncate mt-0.5">{result.snippet}</p>
                        )}
                        {result.tags.length > 0 && (
                          <div className="flex gap-1 mt-1 flex-wrap">
                            {result.tags.slice(0, 3).map((tag) => (
                              <span key={tag} className="px-1.5 py-0.5 text-[10px] rounded bg-gray-800 text-gray-400">
                                #{tag}
                              </span>
                            ))}
                          </div>
                        )}
                      </div>
                    </button>
                  );
                })}
              </div>
            );
          })}
        </div>

        {/* Saved searches */}
        {searches.length > 0 && (
          <div className="border-t border-gray-800 px-3 py-2">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-xs text-gray-500 shrink-0">Saved:</span>
              {searches.map((s) => (
                <button
                  key={s.id}
                  onClick={() => handleLoadSaved(s)}
                  className="group flex items-center gap-1 px-2 py-0.5 text-xs rounded-full bg-gray-800 text-gray-400 hover:text-gray-200 hover:bg-gray-700 transition-colors"
                >
                  <span className="truncate max-w-[120px]">{s.label}</span>
                  <span
                    onClick={(e) => { e.stopPropagation(); deleteSearch(s.id); }}
                    className="text-gray-600 hover:text-red-400 ml-0.5"
                  >
                    <X size={10} />
                  </span>
                </button>
              ))}
              <button
                onClick={clearAll}
                className="text-xs text-gray-600 hover:text-red-400 transition-colors ml-auto"
              >
                Clear All
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
