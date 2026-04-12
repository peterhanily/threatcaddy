import { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { Search, X, FileText, Paperclip, ListChecks, Clock, PenTool, Save, Briefcase, ChevronDown, Shield, MessageSquare, Calendar, Pencil } from 'lucide-react';
import { cn } from '../../lib/utils';
import { formatDate } from '../../lib/utils';
import { unifiedSearch, type SearchMode, type SearchQuery, type SearchResult, type SearchResultType, type UnifiedSearchResult } from '../../lib/search';
import { useSavedSearches } from '../../hooks/useSavedSearches';
import type { Note, Task, TimelineEvent, Whiteboard, StandaloneIOC, ChatThread, Folder } from '../../types';
import { TagPills } from '../Common/TagPills';
import SearchWorker from '../../workers/search.worker?worker';

interface SearchOverlayProps {
  open: boolean;
  onClose: () => void;
  notes: Note[];
  tasks: Task[];
  clipsFolderId: string | undefined;
  onNavigateToNote: (id: string) => void;
  onNavigateToTask: (id: string) => void;
  timelineEvents?: TimelineEvent[];
  whiteboards?: Whiteboard[];
  onNavigateToTimeline?: (id: string) => void;
  onNavigateToWhiteboard?: (id: string) => void;
  standaloneIOCs?: StandaloneIOC[];
  chatThreads?: ChatThread[];
  onNavigateToIOC?: (id: string) => void;
  onNavigateToChat?: (id: string) => void;
  selectedFolderId?: string;
  scopedNotes?: Note[];
  scopedTasks?: Task[];
  scopedTimelineEvents?: TimelineEvent[];
  scopedWhiteboards?: Whiteboard[];
  folders?: Folder[];
}

const TYPE_ICONS: Record<SearchResultType, typeof FileText> = {
  note: FileText,
  clip: Paperclip,
  task: ListChecks,
  timeline: Clock,
  whiteboard: PenTool,
  ioc: Shield,
  chat: MessageSquare,
};

const TYPE_LABEL_KEYS: Record<SearchResultType, string> = {
  note: 'notes',
  clip: 'clips',
  task: 'tasks',
  timeline: 'timelineEvents',
  whiteboard: 'whiteboards',
  ioc: 'iocs',
  chat: 'chatThreads',
};

export function SearchOverlay({
  open,
  onClose,
  notes,
  tasks,
  clipsFolderId,
  onNavigateToNote,
  onNavigateToTask,
  timelineEvents,
  whiteboards,
  onNavigateToTimeline,
  onNavigateToWhiteboard,
  standaloneIOCs,
  chatThreads,
  onNavigateToIOC,
  onNavigateToChat,
  selectedFolderId,
  // scopedNotes, scopedTasks, scopedTimelineEvents, scopedWhiteboards — kept in interface for backwards compat
  folders = [],
}: SearchOverlayProps) {
  const { t } = useTranslation('search');
  const [query, setQuery] = useState('');
  const [mode, setMode] = useState<SearchMode>('simple');
  const [debouncedQuery, setDebouncedQuery] = useState('');
  const [activeIndex, setActiveIndex] = useState(0);
  const [searchFolderId, setSearchFolderId] = useState<string | undefined>(undefined);
  const [folderQuery, setFolderQuery] = useState('');
  const [folderDropdownOpen, setFolderDropdownOpen] = useState(false);
  const [activeTypes, setActiveTypes] = useState<Set<SearchResultType>>(new Set(['note', 'clip', 'task', 'timeline', 'whiteboard', 'ioc', 'chat']));
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [dateField, setDateField] = useState<'createdAt' | 'updatedAt'>('createdAt');
  const [dateFilterOpen, setDateFilterOpen] = useState(false);
  const [editingSearchId, setEditingSearchId] = useState<string | null>(null);
  const [editingSearchLabel, setEditingSearchLabel] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);
  const folderInputRef = useRef<HTMLInputElement>(null);
  const folderDropdownRef = useRef<HTMLDivElement>(null);
  const resultsRef = useRef<HTMLDivElement>(null);
  const rafRef = useRef<number>(undefined);
  const { searches, saveSearch, deleteSearch, renameSearch, clearAll } = useSavedSearches();

  // Debounce query
  useEffect(() => {
    const timer = setTimeout(() => setDebouncedQuery(query), 150);
    return () => clearTimeout(timer);
  }, [query]);

  // Auto-focus input when overlay opens; auto-scope to current investigation
  useEffect(() => {
    if (open) {
      // Small delay to ensure DOM is ready
      rafRef.current = requestAnimationFrame(() => inputRef.current?.focus());
      // eslint-disable-next-line react-hooks/set-state-in-effect
      if (selectedFolderId) setSearchFolderId(selectedFolderId);
    } else {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setQuery('');
      setDebouncedQuery('');
      setActiveIndex(0);
      setSearchFolderId(undefined);
      setFolderQuery('');
      setFolderDropdownOpen(false);
      setDateFrom('');
      setDateTo('');
      setDateField('createdAt');
      setDateFilterOpen(false);
      setEditingSearchId(null);
      setEditingSearchLabel('');
    }
    return () => { if (rafRef.current !== undefined) cancelAnimationFrame(rafRef.current); };
  }, [open, selectedFolderId]);

  // Close folder dropdown on outside click
  useEffect(() => {
    if (!folderDropdownOpen) return;
    const handleClick = (e: MouseEvent) => {
      if (folderDropdownRef.current && !folderDropdownRef.current.contains(e.target as Node)) {
        setFolderDropdownOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [folderDropdownOpen]);

  // Filtered folders for autocomplete
  const filteredFolders = useMemo(() => {
    if (!folderQuery.trim()) return folders.filter((f) => (f.status || 'active') !== 'archived');
    const q = folderQuery.toLowerCase();
    return folders.filter((f) => f.name.toLowerCase().includes(q));
  }, [folders, folderQuery]);

  const selectedSearchFolder = searchFolderId ? folders.find((f) => f.id === searchFolderId) : undefined;

  // Build dateFilter from date inputs
  const dateFilter = useMemo<SearchQuery['dateFilter']>(() => {
    if (!dateFrom && !dateTo) return undefined;
    return {
      field: dateField,
      from: dateFrom ? new Date(dateFrom).getTime() : undefined,
      to: dateTo ? new Date(dateTo + 'T23:59:59.999').getTime() : undefined,
    };
  }, [dateFrom, dateTo, dateField]);

  // Worker-based search
  const workerRef = useRef<Worker | null>(null);
  const requestIdRef = useRef(0);
  const [searchResult, setSearchResult] = useState<UnifiedSearchResult>({ results: [] });
  const workerSupported = useRef(true);

  // Initialize worker once
  useEffect(() => {
    try {
      const w = new SearchWorker();
      w.onmessage = (e: MessageEvent<{ id: number; result: UnifiedSearchResult }>) => {
        if (e.data.id === requestIdRef.current) {
          setSearchResult(e.data.result);
        }
      };
      workerRef.current = w;
    } catch {
      workerSupported.current = false;
    }
    return () => { workerRef.current?.terminate(); };
  }, []);

  // Send data to worker when source arrays change (heavy clone happens only on real data change, not scope change)
  useEffect(() => {
    if (!workerRef.current || !workerSupported.current) return;
    workerRef.current.postMessage({
      type: 'data',
      notes,
      tasks,
      clipsFolderId,
      timelineEvents,
      whiteboards,
      standaloneIOCs,
      chatThreads,
    });
  }, [notes, tasks, clipsFolderId, timelineEvents, whiteboards, standaloneIOCs, chatThreads]);

  // Post lightweight query to worker when search or scope changes
  useEffect(() => {
    if (!debouncedQuery.trim()) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- intentional: clearing results when query is empty
      setSearchResult({ results: [] });
      return;
    }
    const id = ++requestIdRef.current;
    const searchQuery: SearchQuery = { mode, raw: debouncedQuery, dateFilter };
    if (workerRef.current && workerSupported.current) {
      workerRef.current.postMessage({ type: 'query', id, query: searchQuery, folderId: searchFolderId });
    } else {
      // Fallback: direct call (standalone/CSP issues) — filter inline
      const fid = searchFolderId;
      const n = fid ? notes.filter((x) => x.folderId === fid) : notes;
      const t = fid ? tasks.filter((x) => x.folderId === fid) : tasks;
      const ev = fid && timelineEvents ? timelineEvents.filter((x) => x.folderId === fid) : timelineEvents;
      const wb = fid && whiteboards ? whiteboards.filter((x) => x.folderId === fid) : whiteboards;
      const iocs = fid && standaloneIOCs ? standaloneIOCs.filter((x) => x.folderId === fid) : standaloneIOCs;
      const chats = fid && chatThreads ? chatThreads.filter((x) => x.folderId === fid) : chatThreads;
      setSearchResult(unifiedSearch(n, t, clipsFolderId, searchQuery, ev, wb, iocs, chats));
    }
  }, [notes, tasks, clipsFolderId, mode, debouncedQuery, dateFilter, timelineEvents, whiteboards, standaloneIOCs, chatThreads, searchFolderId]);

  const { results, error } = searchResult;

  // Group results by type
  const grouped = useMemo(() => {
    const groups: Partial<Record<SearchResultType, SearchResult[]>> = {};
    for (const r of results) {
      if (!groups[r.type]) groups[r.type] = [];
      // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
      groups[r.type]!.push(r);
    }
    return groups;
  }, [results]);

  // Flat list for keyboard navigation (filtered by active types)
  const flatResults = useMemo(() => results.filter(r => activeTypes.has(r.type)), [results, activeTypes]);

  // Reset activeIndex when results change
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setActiveIndex(0);
  }, [results]);

  const handleSelect = useCallback((result: SearchResult) => {
    if (result.type === 'note' || result.type === 'clip') onNavigateToNote(result.id);
    else if (result.type === 'timeline') onNavigateToTimeline?.(result.id);
    else if (result.type === 'whiteboard') onNavigateToWhiteboard?.(result.id);
    else if (result.type === 'ioc') onNavigateToIOC?.(result.id);
    else if (result.type === 'chat') onNavigateToChat?.(result.id);
    else onNavigateToTask(result.id);
    onClose();
  }, [onNavigateToNote, onNavigateToTask, onNavigateToTimeline, onNavigateToWhiteboard, onNavigateToIOC, onNavigateToChat, onClose]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    // Don't intercept keys when the folder dropdown is open
    if (folderDropdownOpen) {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        setFolderDropdownOpen(false);
      }
      return;
    }
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
  }, [flatResults, activeIndex, handleSelect, onClose, folderDropdownOpen]);

  // Scroll active result into view
  useEffect(() => {
    if (!resultsRef.current) return;
    const activeEl = resultsRef.current.querySelector(`[data-index="${activeIndex}"]`);
    activeEl?.scrollIntoView({ block: 'nearest' });
  }, [activeIndex]);

  const handleSave = useCallback(() => {
    if (!query.trim()) return;
    saveSearch(query, { mode, raw: query, dateFilter });
  }, [query, mode, dateFilter, saveSearch]);

  const handleLoadSaved = useCallback((saved: { query: SearchQuery }) => {
    setMode(saved.query.mode);
    setQuery(saved.query.raw);
    if (saved.query.dateFilter) {
      setDateField(saved.query.dateFilter.field);
      setDateFrom(saved.query.dateFilter.from ? new Date(saved.query.dateFilter.from).toISOString().slice(0, 10) : '');
      setDateTo(saved.query.dateFilter.to ? new Date(saved.query.dateFilter.to).toISOString().slice(0, 10) : '');
      setDateFilterOpen(true);
    } else {
      setDateFrom('');
      setDateTo('');
      setDateField('createdAt');
      setDateFilterOpen(false);
    }
  }, []);

  const toggleType = useCallback((type: SearchResultType) => {
    setActiveTypes(prev => {
      const next = new Set(prev);
      if (next.has(type)) {
        if (next.size > 1) next.delete(type); // don't allow empty
      } else {
        next.add(type);
      }
      return next;
    });
  }, []);

  // Pre-compute a flat index map for keyboard navigation (avoids mutable counter during render)
  const indexMap = useMemo(() => {
    const map = new Map<string, number>();
    let idx = 0;
    for (const type of ['note', 'clip', 'task', 'timeline', 'whiteboard', 'ioc', 'chat'] as SearchResultType[]) {
      if (!activeTypes.has(type)) continue;
      const group = grouped[type];
      if (group) {
        for (const r of group) { map.set(r.id, idx++); }
      }
    }
    return map;
  }, [grouped, activeTypes]);

  if (!open) return null;

  const modes: { value: SearchMode; label: string }[] = [
    { value: 'simple', label: t('simple') },
    { value: 'regex', label: t('regex') },
    { value: 'advanced', label: t('advanced') },
  ];

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center pt-[5vh] sm:pt-[10vh]" role="dialog" aria-modal="true" aria-label="Search" onKeyDown={handleKeyDown}>
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />

      {/* Overlay panel */}
      <div className="relative w-full max-w-2xl mx-2 sm:mx-4 bg-gray-900 border border-gray-700 rounded-xl shadow-2xl flex flex-col max-h-[85vh] sm:max-h-[70vh]">
        {/* Header: mode toggle + input */}
        <div className="p-3 border-b border-gray-800">
          <div className="flex flex-wrap items-center gap-2 mb-2">
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

            {/* Investigation scope picker */}
            <div className="relative shrink-0" ref={folderDropdownRef}>
              <button
                onClick={() => { setFolderDropdownOpen(!folderDropdownOpen); setTimeout(() => folderInputRef.current?.focus(), 50); }}
                className={cn(
                  'flex items-center gap-1 px-2 py-1.5 rounded-lg border text-xs transition-colors max-w-[160px]',
                  searchFolderId
                    ? 'border-accent/40 bg-accent/10 text-accent'
                    : 'border-gray-700 text-gray-400 hover:text-gray-200 hover:bg-gray-800'
                )}
                title={selectedSearchFolder ? `Scoped to: ${selectedSearchFolder.name}` : 'Search all investigations'}
              >
                <Briefcase size={12} />
                <span className="truncate">{selectedSearchFolder?.name || 'All'}</span>
                <ChevronDown size={10} className={cn('transition-transform', folderDropdownOpen && 'rotate-180')} />
              </button>

              {folderDropdownOpen && (
                <div className="absolute top-full left-0 mt-1 w-56 bg-gray-900 border border-gray-700 rounded-lg shadow-xl z-50 overflow-hidden">
                  <div className="p-1.5">
                    <input
                      ref={folderInputRef}
                      value={folderQuery}
                      onChange={(e) => setFolderQuery(e.target.value)}
                      placeholder="Filter investigations..."
                      className="w-full px-2 py-1.5 bg-gray-800 border border-gray-700 rounded text-xs text-gray-200 placeholder-gray-500 focus:outline-none focus:border-accent"
                    />
                  </div>
                  <div className="max-h-48 overflow-y-auto">
                    <button
                      onClick={() => { setSearchFolderId(undefined); setFolderQuery(''); setFolderDropdownOpen(false); }}
                      className={cn(
                        'w-full text-left px-3 py-1.5 text-xs transition-colors flex items-center gap-2',
                        !searchFolderId ? 'bg-accent/10 text-accent' : 'text-gray-400 hover:bg-gray-800 hover:text-gray-200'
                      )}
                    >
                      <Briefcase size={12} />
                      {t('allInvestigations')}
                    </button>
                    {filteredFolders.map((f) => (
                      <button
                        key={f.id}
                        onClick={() => { setSearchFolderId(f.id); setFolderQuery(''); setFolderDropdownOpen(false); }}
                        className={cn(
                          'w-full text-left px-3 py-1.5 text-xs transition-colors flex items-center gap-2 min-w-0',
                          searchFolderId === f.id ? 'bg-accent/10 text-accent' : 'text-gray-400 hover:bg-gray-800 hover:text-gray-200'
                        )}
                      >
                        <span className={cn(
                          'w-1.5 h-1.5 rounded-full shrink-0',
                          (f.status || 'active') === 'active' ? 'bg-green-400' : (f.status === 'archived' ? 'bg-amber-400' : 'bg-gray-500')
                        )} />
                        <span className="truncate">{f.name}</span>
                      </button>
                    ))}
                    {filteredFolders.length === 0 && (
                      <div className="px-3 py-2 text-xs text-gray-600">{t('noMatches')}</div>
                    )}
                  </div>
                </div>
              )}
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
                  mode === 'simple' ? 'Search notes, tasks, timeline, whiteboards, IOCs, chats...' :
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
              className="flex items-center gap-1 px-2 py-1 text-xs text-gray-400 hover:text-gray-200 hover:bg-gray-800 rounded transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <Save size={12} />
              {t('saveSearch')}
            </button>
            <button
              onClick={() => setQuery('')}
              className="flex items-center gap-1 px-2 py-1 text-xs text-gray-400 hover:text-gray-200 hover:bg-gray-800 rounded transition-colors"
            >
              <X size={12} />
              {t('clear')}
            </button>
            {error && (
              <span className="text-xs text-red-400 ml-2">{error}</span>
            )}
            {debouncedQuery && !error && (
              <span className="text-xs text-gray-500 ml-auto">
                {results.filter(r => activeTypes.has(r.type)).length} result{results.filter(r => activeTypes.has(r.type)).length !== 1 ? 's' : ''}
              </span>
            )}
          </div>

          {/* Type filter chips */}
          <div className="flex items-center gap-1.5 mt-2 flex-wrap">
            <span className="text-[10px] text-gray-600 mr-1">{t('types')}:</span>
            {(['note', 'clip', 'task', 'timeline', 'whiteboard', 'ioc', 'chat'] as SearchResultType[]).map((type) => {
              const Icon = TYPE_ICONS[type];
              const active = activeTypes.has(type);
              return (
                <button
                  key={type}
                  onClick={() => toggleType(type)}
                  className={cn(
                    'flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-medium transition-colors border',
                    active
                      ? 'border-accent/40 bg-accent/10 text-accent'
                      : 'border-gray-700 text-gray-600 hover:text-gray-400 hover:border-gray-600'
                  )}
                >
                  <Icon size={10} />
                  {t(TYPE_LABEL_KEYS[type])}
                </button>
              );
            })}
          </div>

          {/* Date filter */}
          <div className="flex items-center gap-1.5 mt-2 flex-wrap">
            <button
              onClick={() => setDateFilterOpen((v) => !v)}
              className={cn(
                'flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-medium transition-colors border',
                dateFilterOpen || dateFrom || dateTo
                  ? 'border-accent/40 bg-accent/10 text-accent'
                  : 'border-gray-700 text-gray-600 hover:text-gray-400 hover:border-gray-600'
              )}
            >
              <Calendar size={10} />
              {t('date')}
            </button>
            {dateFilterOpen && (
              <>
                <div className="flex rounded-lg border border-gray-700 overflow-hidden shrink-0">
                  <button
                    onClick={() => setDateField('createdAt')}
                    className={cn(
                      'px-2 py-0.5 text-[11px] font-medium transition-colors',
                      dateField === 'createdAt'
                        ? 'bg-accent text-white'
                        : 'text-gray-400 hover:text-gray-200 hover:bg-gray-800'
                    )}
                  >
                    {t('created')}
                  </button>
                  <button
                    onClick={() => setDateField('updatedAt')}
                    className={cn(
                      'px-2 py-0.5 text-[11px] font-medium transition-colors',
                      dateField === 'updatedAt'
                        ? 'bg-accent text-white'
                        : 'text-gray-400 hover:text-gray-200 hover:bg-gray-800'
                    )}
                  >
                    {t('updated')}
                  </button>
                </div>
                <input
                  type="date"
                  value={dateFrom}
                  onChange={(e) => setDateFrom(e.target.value)}
                  className="px-1.5 py-0.5 bg-gray-800 border border-gray-700 rounded text-[11px] text-gray-200 focus:outline-none focus:border-accent"
                  placeholder="From"
                />
                <span className="text-[10px] text-gray-600">{t('to')}</span>
                <input
                  type="date"
                  value={dateTo}
                  onChange={(e) => setDateTo(e.target.value)}
                  className="px-1.5 py-0.5 bg-gray-800 border border-gray-700 rounded text-[11px] text-gray-200 focus:outline-none focus:border-accent"
                  placeholder="To"
                />
                {(dateFrom || dateTo) && (
                  <button
                    onClick={() => { setDateFrom(''); setDateTo(''); }}
                    className="text-gray-600 hover:text-gray-400"
                    title="Clear date filter"
                  >
                    <X size={10} />
                  </button>
                )}
              </>
            )}
          </div>
        </div>

        {/* Results */}
        <div ref={resultsRef} className="flex-1 overflow-y-auto min-h-0" aria-live="polite">
          {debouncedQuery && results.length === 0 && !error && (
            <div className="flex flex-col items-center justify-center gap-3 py-16 text-gray-500">
              <Search size={40} strokeWidth={1.5} className="text-gray-600" />
              <p className="text-sm">{t('noResults')}</p>
            </div>
          )}

          {(['note', 'clip', 'task', 'timeline', 'whiteboard', 'ioc', 'chat'] as SearchResultType[]).map((type) => {
            if (!activeTypes.has(type)) return null;
            const group = grouped[type];
            if (!group || group.length === 0) return null;
            return (
              <div key={type}>
                <div className="px-3 py-1.5 text-xs font-semibold text-gray-500 uppercase tracking-wider bg-gray-900/80 sticky top-0">
                  {t(TYPE_LABEL_KEYS[type])} ({group.length})
                </div>
                {group.map((result) => {
                  // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
                  const idx = indexMap.get(result.id)!;
                  const Icon = TYPE_ICONS[result.type];
                  return (
                    <button
                      key={result.id}
                      data-index={idx}
                      onClick={() => handleSelect(result)}
                      onMouseEnter={() => setActiveIndex(idx)}
                      aria-label={`${t(TYPE_LABEL_KEYS[result.type])}: ${result.title}`}
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
                          <div className="mt-1">
                            <TagPills tags={result.tags} />
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
              <span className="text-xs text-gray-500 shrink-0">{t('saved')}:</span>
              {searches.map((s) => (
                editingSearchId === s.id ? (
                  <input
                    key={s.id}
                    autoFocus
                    value={editingSearchLabel}
                    onChange={(e) => setEditingSearchLabel(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.stopPropagation();
                        if (editingSearchLabel.trim()) renameSearch(s.id, editingSearchLabel.trim());
                        setEditingSearchId(null);
                        setEditingSearchLabel('');
                      } else if (e.key === 'Escape') {
                        e.stopPropagation();
                        setEditingSearchId(null);
                        setEditingSearchLabel('');
                      }
                    }}
                    onBlur={() => {
                      if (editingSearchLabel.trim()) renameSearch(s.id, editingSearchLabel.trim());
                      setEditingSearchId(null);
                      setEditingSearchLabel('');
                    }}
                    className="px-2 py-0.5 text-xs rounded-full bg-gray-800 text-gray-200 border border-accent focus:outline-none max-w-[140px]"
                  />
                ) : (
                  <button
                    key={s.id}
                    onClick={() => handleLoadSaved(s)}
                    className="group flex items-center gap-1 px-2 py-0.5 text-xs rounded-full bg-gray-800 text-gray-400 hover:text-gray-200 hover:bg-gray-700 transition-colors"
                  >
                    <span className="truncate max-w-[120px]">{s.label}</span>
                    <span
                      onClick={(e) => { e.stopPropagation(); setEditingSearchId(s.id); setEditingSearchLabel(s.label); }}
                      className="text-gray-600 hover:text-accent ml-0.5 hidden group-hover:inline-flex"
                    >
                      <Pencil size={10} />
                    </span>
                    <span
                      onClick={(e) => { e.stopPropagation(); deleteSearch(s.id); }}
                      className="text-gray-600 hover:text-red-400 ml-0.5"
                    >
                      <X size={10} />
                    </span>
                  </button>
                )
              ))}
              <button
                onClick={clearAll}
                className="text-xs text-gray-600 hover:text-red-400 transition-colors ml-auto"
              >
                {t('clearAll')}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
