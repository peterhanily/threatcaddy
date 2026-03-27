import { useMemo } from 'react';
import { ChevronRight, FileText, ListChecks, Clock, PenTool, Shield } from 'lucide-react';
import type { Note, Task, TimelineEvent, Whiteboard, StandaloneIOC } from '../../types';
import { PRIORITY_COLORS, TIMELINE_EVENT_TYPE_LABELS, IOC_TYPE_LABELS, CONFIDENCE_LEVELS } from '../../types';
import { cn, formatDate } from '../../lib/utils';

type EntityMode = 'notes' | 'tasks' | 'events' | 'whiteboards' | 'iocs';

interface ExecEntityListProps {
  mode: EntityMode;
  folderId: string;
  folderName: string;
  allNotes: Note[];
  allTasks: Task[];
  allEvents: TimelineEvent[];
  allWhiteboards: Whiteboard[];
  allIOCs: StandaloneIOC[];
  onBack: () => void;
  onSelectNote?: (id: string) => void;
  onSelectTask?: (id: string) => void;
  onSelectEvent?: (id: string) => void;
  onSelectIOC?: (id: string) => void;
  onSwitchToAnalystMode?: () => void;
  filterText?: string;
}

const MODE_META: Record<EntityMode, { label: string; icon: typeof FileText; color: string }> = {
  notes: { label: 'Notes', icon: FileText, color: 'text-accent-blue' },
  tasks: { label: 'Tasks', icon: ListChecks, color: 'text-accent-amber' },
  events: { label: 'Events', icon: Clock, color: 'text-accent-green' },
  whiteboards: { label: 'Whiteboards', icon: PenTool, color: 'text-accent-pink' },
  iocs: { label: 'IOCs', icon: Shield, color: 'text-red-400' },
};

export function ExecEntityList({
  mode, folderId, folderName,
  allNotes, allTasks, allEvents, allWhiteboards, allIOCs,
  onSelectNote, onSelectTask, onSelectEvent, onSelectIOC, onSwitchToAnalystMode,
  filterText,
}: ExecEntityListProps) {
  const meta = MODE_META[mode];
  const Icon = meta.icon;
  const q = (filterText || '').toLowerCase();

  const notes = useMemo(() => {
    let list = allNotes.filter((n) => n.folderId === folderId && !n.trashed).sort((a, b) => b.updatedAt - a.updatedAt);
    if (q) list = list.filter((n) => (n.title || '').toLowerCase().includes(q) || (n.content || '').toLowerCase().includes(q));
    return list;
  }, [allNotes, folderId, q]);
  const tasks = useMemo(() => {
    let list = allTasks.filter((t) => t.folderId === folderId && !t.trashed).sort((a, b) => a.order - b.order);
    if (q) list = list.filter((t) => (t.title || '').toLowerCase().includes(q) || (t.description || '').toLowerCase().includes(q));
    return list;
  }, [allTasks, folderId, q]);
  const events = useMemo(() => {
    let list = allEvents.filter((e) => e.folderId === folderId && !e.trashed).sort((a, b) => a.timestamp - b.timestamp);
    if (q) list = list.filter((e) => (e.title || '').toLowerCase().includes(q) || (e.description || '').toLowerCase().includes(q));
    return list;
  }, [allEvents, folderId, q]);
  const whiteboards = useMemo(() => {
    let list = allWhiteboards.filter((w) => w.folderId === folderId && !w.trashed).sort((a, b) => a.order - b.order);
    if (q) list = list.filter((w) => (w.name || '').toLowerCase().includes(q));
    return list;
  }, [allWhiteboards, folderId, q]);
  const iocs = useMemo(() => {
    let list = allIOCs.filter((i) => i.folderId === folderId && !i.trashed).sort((a, b) => b.createdAt - a.createdAt);
    if (q) list = list.filter((i) => i.value.toLowerCase().includes(q) || (i.analystNotes || '').toLowerCase().includes(q) || (i.attribution || '').toLowerCase().includes(q));
    return list;
  }, [allIOCs, folderId, q]);

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-2">
        <Icon size={18} className={meta.color} />
        <h2 className="text-lg font-bold text-text-primary">{meta.label}</h2>
        <span className="text-xs text-text-muted">in {folderName}</span>
      </div>

      <div className="flex flex-col gap-1.5">
        {mode === 'notes' && notes.map((note) => (
          <button key={note.id} onClick={() => onSelectNote?.(note.id)} className="flex items-center gap-3 bg-bg-raised rounded-xl px-4 py-3 active:bg-bg-hover text-left">
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-text-primary truncate">{note.title || 'Untitled'}</p>
              <p className="text-[10px] text-text-muted mt-0.5">{formatDate(note.updatedAt)}</p>
            </div>
            {note.clsLevel && <span className="text-[9px] font-semibold text-accent-amber bg-accent-amber/10 px-1.5 py-0.5 rounded shrink-0">{note.clsLevel}</span>}
            <ChevronRight size={14} className="text-text-muted shrink-0" />
          </button>
        ))}

        {mode === 'tasks' && tasks.map((task) => (
          <button key={task.id} onClick={() => onSelectTask?.(task.id)} className="flex items-center gap-3 bg-bg-raised rounded-xl px-4 py-3 active:bg-bg-hover text-left">
            <div className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: PRIORITY_COLORS[task.priority] || '#6b7280' }} />
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-text-primary truncate">{task.title || 'Untitled'}</p>
              <p className="text-[10px] text-text-muted mt-0.5 capitalize">{task.status}</p>
            </div>
            <ChevronRight size={14} className="text-text-muted shrink-0" />
          </button>
        ))}

        {mode === 'events' && events.map((event) => {
          const typeInfo = TIMELINE_EVENT_TYPE_LABELS[event.eventType];
          return (
            <button key={event.id} onClick={() => onSelectEvent?.(event.id)} className="flex items-center gap-3 bg-bg-raised rounded-xl px-4 py-3 active:bg-bg-hover text-left">
              <div className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: typeInfo?.color ?? '#6b7280' }} />
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-text-primary truncate">{event.title || 'Untitled'}</p>
                <p className="text-[10px] text-text-muted mt-0.5">{typeInfo?.label ?? event.eventType}</p>
              </div>
              <ChevronRight size={14} className="text-text-muted shrink-0" />
            </button>
          );
        })}

        {mode === 'whiteboards' && whiteboards.map((wb) => {
          let elemCount = 0;
          try { elemCount = JSON.parse(wb.elements || '[]').length; } catch { /* empty */ }
          return (
            <div key={wb.id} className="flex items-center gap-3 bg-bg-raised rounded-xl px-4 py-3">
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-text-primary truncate">{wb.name || 'Untitled'}</p>
                <p className="text-[10px] text-text-muted mt-0.5">{elemCount} element{elemCount !== 1 ? 's' : ''}</p>
              </div>
              {onSwitchToAnalystMode && (
                <button onClick={onSwitchToAnalystMode} className="text-[10px] text-accent font-medium bg-accent/10 px-2 py-1 rounded-lg shrink-0">
                  Open in Analyst
                </button>
              )}
            </div>
          );
        })}

        {mode === 'iocs' && iocs.map((ioc) => {
          const typeInfo = IOC_TYPE_LABELS[ioc.type];
          const confInfo = CONFIDENCE_LEVELS[ioc.confidence];
          return (
            <button key={ioc.id} onClick={() => onSelectIOC?.(ioc.id)} className="flex items-center gap-3 bg-bg-raised rounded-xl px-4 py-3 active:bg-bg-hover text-left">
              <span className="text-[9px] font-bold px-1.5 py-0.5 rounded shrink-0" style={{ backgroundColor: typeInfo?.color + '22', color: typeInfo?.color }}>{typeInfo?.label}</span>
              <p className="text-xs font-mono text-text-primary flex-1 min-w-0 truncate">{ioc.value}</p>
              <span className="text-[9px] px-1.5 py-0.5 rounded shrink-0" style={{ backgroundColor: confInfo?.color + '22', color: confInfo?.color }}>{confInfo?.label}</span>
              {ioc.iocStatus && <span className={cn('text-[9px] px-1.5 py-0.5 rounded bg-bg-deep text-text-muted shrink-0')}>{ioc.iocStatus}</span>}
              <ChevronRight size={14} className="text-text-muted shrink-0" />
            </button>
          );
        })}

        {/* Empty state */}
        {((mode === 'notes' && notes.length === 0) ||
          (mode === 'tasks' && tasks.length === 0) ||
          (mode === 'events' && events.length === 0) ||
          (mode === 'whiteboards' && whiteboards.length === 0) ||
          (mode === 'iocs' && iocs.length === 0)) && (
          <p className="text-sm text-text-muted text-center py-8">No {meta.label.toLowerCase()} in this investigation</p>
        )}
      </div>
    </div>
  );
}
