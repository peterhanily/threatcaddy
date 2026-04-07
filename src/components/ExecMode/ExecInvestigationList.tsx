import { useState, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { FileText, ListChecks, Clock, PenTool, Shield } from 'lucide-react';
import type { Folder, Note, Task, TimelineEvent, Whiteboard, StandaloneIOC, InvestigationStatus } from '../../types';
import { cn, currentLocale } from '../../lib/utils';

type FilterStatus = 'all' | InvestigationStatus;

interface ExecInvestigationListProps {
  folders: Folder[];
  allNotes: Note[];
  allTasks: Task[];
  allEvents: TimelineEvent[];
  allWhiteboards: Whiteboard[];
  allIOCs: StandaloneIOC[];
  onSelect: (folderId: string) => void;
  filterText?: string;
}

const FILTER_OPTIONS: { value: FilterStatus; labelKey: string }[] = [
  { value: 'all', labelKey: 'investigations.all' },
  { value: 'active', labelKey: 'investigations.active' },
  { value: 'closed', labelKey: 'investigations.closed' },
  { value: 'archived', labelKey: 'investigations.archived' },
];

const STATUS_COLORS: Record<string, string> = {
  active: 'bg-accent-green',
  closed: 'bg-accent-amber',
  archived: 'bg-text-muted',
};

export function ExecInvestigationList({ folders, allNotes, allTasks, allEvents, allWhiteboards, allIOCs, onSelect, filterText }: ExecInvestigationListProps) {
  const { t } = useTranslation('exec');
  const [filter, setFilter] = useState<FilterStatus>('all');

  const filtered = useMemo(() => {
    let result = folders.filter((f) => filter === 'all' || (f.status || 'active') === filter);
    if (filterText) {
      const q = filterText.toLowerCase();
      result = result.filter((f) => f.name.toLowerCase().includes(q) || (f.description || '').toLowerCase().includes(q));
    }
    return result;
  }, [folders, filter, filterText]);

  const countsMap = useMemo(() => {
    const ids = new Set(folders.map((f) => f.id));
    const counts = new Map<string, { notes: number; tasks: number; events: number; whiteboards: number; iocs: number }>();
    for (const id of ids) counts.set(id, { notes: 0, tasks: 0, events: 0, whiteboards: 0, iocs: 0 });
    for (const n of allNotes) { const c = counts.get(n.folderId ?? ''); if (c) c.notes++; }
    for (const t of allTasks) { const c = counts.get(t.folderId ?? ''); if (c) c.tasks++; }
    for (const e of allEvents) { const c = counts.get(e.folderId ?? ''); if (c) c.events++; }
    for (const w of allWhiteboards) { const c = counts.get(w.folderId ?? ''); if (c) c.whiteboards++; }
    for (const i of allIOCs) { const c = counts.get(i.folderId ?? ''); if (c) c.iocs++; }
    return counts;
  }, [folders, allNotes, allTasks, allEvents, allWhiteboards, allIOCs]);

  const stats = [
    { label: t('investigations.notes'), icon: FileText, color: 'text-accent-blue', key: 'notes' as const },
    { label: t('investigations.tasks'), icon: ListChecks, color: 'text-accent-amber', key: 'tasks' as const },
    { label: t('investigations.events'), icon: Clock, color: 'text-accent-green', key: 'events' as const },
    { label: t('investigations.boards'), icon: PenTool, color: 'text-accent-pink', key: 'whiteboards' as const },
    { label: t('investigations.iocs'), icon: Shield, color: 'text-red-400', key: 'iocs' as const },
  ];

  return (
    <div className="flex flex-col gap-4">
      {/* Filter pills */}
      <div className="flex gap-2">
        {FILTER_OPTIONS.map((opt) => (
          <button
            key={opt.value}
            onClick={() => setFilter(opt.value)}
            className={cn(
              'px-3 py-1.5 rounded-full text-xs font-medium transition-colors',
              filter === opt.value
                ? 'bg-accent text-white'
                : 'bg-bg-raised text-text-secondary hover:bg-bg-hover',
            )}
          >
            {t(opt.labelKey)}
          </button>
        ))}
      </div>

      {/* Investigation cards */}
      <div className="flex flex-col gap-3">
        {filtered.length === 0 && (
          <p className="text-text-muted text-sm text-center py-8">{t('investigations.noInvestigationsFound')}</p>
        )}
        {filtered.map((folder) => {
          const status = folder.status || 'active';
          const c = countsMap.get(folder.id) ?? { notes: 0, tasks: 0, events: 0, whiteboards: 0, iocs: 0 };
          return (
            <button
              key={folder.id}
              onClick={() => onSelect(folder.id)}
              className="bg-bg-raised rounded-xl p-4 text-left active:bg-bg-hover transition-colors"
            >
              {/* Name + status */}
              <div className="flex items-center gap-2">
                <span
                  className={cn(
                    'w-2.5 h-2.5 rounded-full shrink-0',
                    STATUS_COLORS[status] ?? 'bg-text-muted',
                    status === 'active' && 'animate-pulse',
                  )}
                />
                <span className="text-text-primary font-semibold text-base truncate">{folder.name}</span>
              </div>

              {/* Status label + date */}
              <div className="flex items-center gap-2 mt-1.5">
                <span className="text-xs text-text-muted capitalize">{status}</span>
                <span className="text-xs text-text-muted">·</span>
                <span className="text-xs text-text-muted">
                  {new Date(folder.createdAt).toLocaleDateString(currentLocale(), { month: 'short', day: 'numeric', year: 'numeric' })}
                </span>
              </div>

              {/* Entity counts grid */}
              <div className="grid grid-cols-5 gap-1 mt-3">
                {stats.map((s) => (
                  <div key={s.key} className="flex flex-col items-center rounded-md py-1.5">
                    <s.icon size={12} className={s.color} />
                    <span className="text-sm font-bold mt-0.5 text-text-primary">{c[s.key]}</span>
                    <span className="text-[8px] font-medium text-text-muted uppercase tracking-wide mt-0.5">{s.label}</span>
                  </div>
                ))}
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}
