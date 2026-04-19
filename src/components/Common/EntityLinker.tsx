import { useState, useRef, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, Search, X, FileText, CheckSquare, Clock } from 'lucide-react';
import type { Note, Task, TimelineEvent } from '../../types';
import { cn } from '../../lib/utils';

interface EntityLinkerProps {
  currentEntityId: string;
  linkedNoteIds: string[];
  linkedTaskIds: string[];
  linkedTimelineEventIds: string[];
  allNotes: Note[];
  allTasks: Task[];
  allTimelineEvents: TimelineEvent[];
  onUpdateLinks: (links: {
    linkedNoteIds: string[];
    linkedTaskIds: string[];
    linkedTimelineEventIds: string[];
  }) => void;
}

type EntityItem = {
  id: string;
  title: string;
  type: 'note' | 'task' | 'timeline-event';
};

const TYPE_ICONS = {
  note: FileText,
  task: CheckSquare,
  'timeline-event': Clock,
} as const;

const TYPE_COLORS = {
  note: 'text-blue-400 bg-blue-400/10',
  task: 'text-green-400 bg-green-400/10',
  'timeline-event': 'text-purple-400 bg-purple-400/10',
} as const;

const TYPE_LABEL_KEYS = {
  note: 'entityLinker.note',
  task: 'entityLinker.task',
  'timeline-event': 'entityLinker.event',
} as const;

export function EntityLinker({
  currentEntityId,
  linkedNoteIds,
  linkedTaskIds,
  linkedTimelineEventIds,
  allNotes,
  allTasks,
  allTimelineEvents,
  onUpdateLinks,
}: EntityLinkerProps) {
  const { t } = useTranslation('common');
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const ref = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const linkedCount = linkedNoteIds.length + linkedTaskIds.length + linkedTimelineEventIds.length;

  useEffect(() => {
    if (!open) return;
    function handleMouseDown(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener('mousedown', handleMouseDown);
    return () => document.removeEventListener('mousedown', handleMouseDown);
  }, [open]);

  useEffect(() => {
    if (open) inputRef.current?.focus();
  }, [open]);

  const isLinked = (type: EntityItem['type'], id: string) => {
    switch (type) {
      case 'note': return linkedNoteIds.includes(id);
      case 'task': return linkedTaskIds.includes(id);
      case 'timeline-event': return linkedTimelineEventIds.includes(id);
    }
  };

  const toggleLink = (type: EntityItem['type'], id: string) => {
    const update = {
      linkedNoteIds: [...linkedNoteIds],
      linkedTaskIds: [...linkedTaskIds],
      linkedTimelineEventIds: [...linkedTimelineEventIds],
    };
    switch (type) {
      case 'note':
        update.linkedNoteIds = linkedNoteIds.includes(id)
          ? linkedNoteIds.filter((x) => x !== id)
          : [...linkedNoteIds, id];
        break;
      case 'task':
        update.linkedTaskIds = linkedTaskIds.includes(id)
          ? linkedTaskIds.filter((x) => x !== id)
          : [...linkedTaskIds, id];
        break;
      case 'timeline-event':
        update.linkedTimelineEventIds = linkedTimelineEventIds.includes(id)
          ? linkedTimelineEventIds.filter((x) => x !== id)
          : [...linkedTimelineEventIds, id];
        break;
    }
    onUpdateLinks(update);
  };

  const query = search.toLowerCase();
  const searchResults: EntityItem[] = [];
  if (query) {
    const PER_TYPE = 7;
    const noteResults: EntityItem[] = [];
    const taskResults: EntityItem[] = [];
    const eventResults: EntityItem[] = [];
    for (const n of allNotes) {
      if (n.id !== currentEntityId && !n.trashed && n.title.toLowerCase().includes(query)) {
        noteResults.push({ id: n.id, title: n.title || t('untitled'), type: 'note' });
      }
      if (noteResults.length >= PER_TYPE) break;
    }
    for (const tk of allTasks) {
      if (tk.id !== currentEntityId && tk.title.toLowerCase().includes(query)) {
        taskResults.push({ id: tk.id, title: tk.title || t('untitled'), type: 'task' });
      }
      if (taskResults.length >= PER_TYPE) break;
    }
    for (const e of allTimelineEvents) {
      if (e.id !== currentEntityId && e.title.toLowerCase().includes(query)) {
        eventResults.push({ id: e.id, title: e.title || t('untitled'), type: 'timeline-event' });
      }
      if (eventResults.length >= PER_TYPE) break;
    }
    searchResults.push(...noteResults, ...taskResults, ...eventResults);
  }

  // Resolve linked entities for display
  const linkedEntities: EntityItem[] = [];
  for (const id of linkedNoteIds) {
    const n = allNotes.find((x) => x.id === id);
    if (n) linkedEntities.push({ id: n.id, title: n.title || t('untitled'), type: 'note' });
  }
  for (const id of linkedTaskIds) {
    const tk = allTasks.find((x) => x.id === id);
    if (tk) linkedEntities.push({ id: tk.id, title: tk.title || t('untitled'), type: 'task' });
  }
  for (const id of linkedTimelineEventIds) {
    const e = allTimelineEvents.find((x) => x.id === id);
    if (e) linkedEntities.push({ id: e.id, title: e.title || t('untitled'), type: 'timeline-event' });
  }

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className={cn(
          'p-1.5 rounded flex items-center gap-1',
          open ? 'bg-gray-700 text-accent' : 'text-gray-500 hover:text-gray-300',
        )}
        title={t('entityLinker.linkEntities')}
        aria-label={t('entityLinker.linkEntities')}
      >
        <Link size={14} />
        {linkedCount > 0 && (
          <span className="text-[10px] bg-accent/20 text-accent px-1 rounded-full">{linkedCount}</span>
        )}
      </button>

      {open && (
        <div className="absolute top-full left-0 mt-1 z-20 w-72 bg-gray-800 border border-gray-700 rounded-lg shadow-xl overflow-hidden">
          {/* Search */}
          <div className="p-2 border-b border-gray-700">
            <div className="relative">
              <Search size={12} className="absolute left-2 top-1/2 -translate-y-1/2 text-gray-500" />
              <input
                ref={inputRef}
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder={t('entityLinker.searchPlaceholder')}
                className="w-full ps-7 pe-2 py-1.5 bg-gray-900 border border-gray-700 rounded text-xs text-gray-200 focus:outline-none focus:border-accent"
              />
            </div>
          </div>

          {/* Search results */}
          {query && (
            <div className="max-h-40 overflow-y-auto">
              {searchResults.length === 0 ? (
                <p className="text-xs text-gray-500 p-2">{t('noResults')}</p>
              ) : (
                searchResults.map((item) => {
                  const Icon = TYPE_ICONS[item.type];
                  const linked = isLinked(item.type, item.id);
                  return (
                    <button
                      key={`${item.type}:${item.id}`}
                      type="button"
                      onClick={() => toggleLink(item.type, item.id)}
                      className={cn(
                        'w-full flex items-center gap-2 px-2 py-1.5 text-start text-xs hover:bg-gray-700 transition-colors',
                        linked && 'bg-gray-700/50',
                      )}
                    >
                      <Icon size={12} className={TYPE_COLORS[item.type].split(' ')[0]} />
                      <span className={cn('px-1 py-0.5 rounded text-[10px]', TYPE_COLORS[item.type])}>
                        {t(TYPE_LABEL_KEYS[item.type])}
                      </span>
                      <span className="text-gray-300 truncate flex-1">{item.title}</span>
                      {linked && <span className="text-accent text-[10px]">{t('entityLinker.linked')}</span>}
                    </button>
                  );
                })
              )}
            </div>
          )}

          {/* Currently linked */}
          {linkedEntities.length > 0 && (
            <div className="border-t border-gray-700">
              <p className="text-[10px] text-gray-500 uppercase tracking-wider font-semibold px-2 pt-2 pb-1">
                {t('entityLinker.linkedCount', { count: linkedEntities.length })}
              </p>
              <div className="max-h-32 overflow-y-auto pb-1">
                {linkedEntities.map((item) => {
                  const Icon = TYPE_ICONS[item.type];
                  return (
                    <div
                      key={`${item.type}:${item.id}`}
                      className="flex items-center gap-2 px-2 py-1 text-xs"
                    >
                      <Icon size={12} className={TYPE_COLORS[item.type].split(' ')[0]} />
                      <span className={cn('px-1 py-0.5 rounded text-[10px]', TYPE_COLORS[item.type])}>
                        {t(TYPE_LABEL_KEYS[item.type])}
                      </span>
                      <span className="text-gray-300 truncate flex-1">{item.title}</span>
                      <button
                        type="button"
                        onClick={() => toggleLink(item.type, item.id)}
                        className="p-0.5 rounded text-gray-600 hover:text-red-400"
                        title={t('entityLinker.removeLink')}
                        aria-label={t('entityLinker.removeLink')}
                      >
                        <X size={12} />
                      </button>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
