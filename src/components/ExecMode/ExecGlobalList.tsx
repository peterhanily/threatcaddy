import { useMemo, useState } from 'react';
import { ChevronRight } from 'lucide-react';
import type { Note, Task, TimelineEvent, StandaloneIOC, Folder } from '../../types';
import { PRIORITY_COLORS, TIMELINE_EVENT_TYPE_LABELS, IOC_TYPE_LABELS, CONFIDENCE_LEVELS } from '../../types';
import { formatDate } from '../../lib/utils';

type GlobalMode = 'notes' | 'tasks' | 'events' | 'iocs';

interface ExecGlobalListProps {
  mode: GlobalMode;
  folders: Folder[];
  allNotes: Note[];
  allTasks: Task[];
  allEvents: TimelineEvent[];
  allIOCs: StandaloneIOC[];
  filterText?: string;
  onSelectNote?: (noteId: string, folderId: string) => void;
  onSelectTask?: (taskId: string, folderId: string) => void;
  onSelectEvent?: (eventId: string, folderId: string) => void;
  onSelectIOC?: (iocId: string, folderId: string) => void;
}

export function ExecGlobalList({
  mode, folders, allNotes, allTasks, allEvents, allIOCs, filterText,
  onSelectNote, onSelectTask, onSelectEvent, onSelectIOC,
}: ExecGlobalListProps) {
  const q = (filterText || '').toLowerCase();
  const folderNames = useMemo(() => {
    const map = new Map<string, string>();
    for (const f of folders) map.set(f.id, f.name);
    return map;
  }, [folders]);

  const notes = useMemo(() => {
    let list = allNotes.filter((n) => !n.trashed && !n.archived).sort((a, b) => b.updatedAt - a.updatedAt);
    if (q) list = list.filter((n) => (n.title || '').toLowerCase().includes(q) || (n.content || '').toLowerCase().includes(q));
    return list;
  }, [allNotes, q]);

  const tasks = useMemo(() => {
    let list = allTasks.filter((t) => !t.trashed && !t.archived && t.status !== 'done').sort((a, b) => b.updatedAt - a.updatedAt);
    if (q) list = list.filter((t) => (t.title || '').toLowerCase().includes(q) || (t.description || '').toLowerCase().includes(q));
    return list;
  }, [allTasks, q]);

  const [now] = useState(() => Date.now());
  const events = useMemo(() => {
    const weekAgo = now - 7 * 86400000;
    let list = allEvents.filter((e) => !e.trashed && e.createdAt >= weekAgo).sort((a, b) => b.timestamp - a.timestamp);
    if (q) list = list.filter((e) => (e.title || '').toLowerCase().includes(q) || (e.description || '').toLowerCase().includes(q));
    return list;
  }, [allEvents, now, q]);

  const iocs = useMemo(() => {
    let list = allIOCs.filter((i) => !i.trashed && !i.archived && i.iocStatus !== 'dismissed').sort((a, b) => b.createdAt - a.createdAt);
    if (q) list = list.filter((i) => i.value.toLowerCase().includes(q) || (i.analystNotes || '').toLowerCase().includes(q));
    return list;
  }, [allIOCs, q]);

  const items = mode === 'notes' ? notes : mode === 'tasks' ? tasks : mode === 'events' ? events : iocs;

  return (
    <div className="flex flex-col gap-1.5">
      {items.length === 0 && (
        <p className="text-sm text-text-muted text-center py-8">No items found</p>
      )}

      {mode === 'notes' && notes.map((note) => (
        <button key={note.id} onClick={() => onSelectNote?.(note.id, note.folderId || '')}
          className="flex items-center gap-3 bg-bg-raised rounded-xl px-4 py-3 active:bg-bg-hover text-left">
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium text-text-primary truncate">{note.title || 'Untitled'}</p>
            <p className="text-[10px] text-text-muted mt-0.5">
              {folderNames.get(note.folderId || '') || 'Unfiled'} · {formatDate(note.updatedAt)}
            </p>
          </div>
          {note.clsLevel && <span className="text-[9px] font-semibold text-accent-amber bg-accent-amber/10 px-1.5 py-0.5 rounded shrink-0">{note.clsLevel}</span>}
          <ChevronRight size={14} className="text-text-muted shrink-0" />
        </button>
      ))}

      {mode === 'tasks' && tasks.map((task) => (
        <button key={task.id} onClick={() => onSelectTask?.(task.id, task.folderId || '')}
          className="flex items-center gap-3 bg-bg-raised rounded-xl px-4 py-3 active:bg-bg-hover text-left">
          <div className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: PRIORITY_COLORS[task.priority] || '#6b7280' }} />
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium text-text-primary truncate">{task.title || 'Untitled'}</p>
            <p className="text-[10px] text-text-muted mt-0.5">
              {folderNames.get(task.folderId || '') || 'Unfiled'} · <span className="capitalize">{task.status}</span>
            </p>
          </div>
          <ChevronRight size={14} className="text-text-muted shrink-0" />
        </button>
      ))}

      {mode === 'events' && events.map((event) => {
        const typeInfo = TIMELINE_EVENT_TYPE_LABELS[event.eventType];
        return (
          <button key={event.id} onClick={() => onSelectEvent?.(event.id, event.folderId || '')}
            className="flex items-center gap-3 bg-bg-raised rounded-xl px-4 py-3 active:bg-bg-hover text-left">
            <div className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: typeInfo?.color ?? '#6b7280' }} />
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-text-primary truncate">{event.title || 'Untitled'}</p>
              <p className="text-[10px] text-text-muted mt-0.5">
                {folderNames.get(event.folderId || '') || 'Unfiled'} · {typeInfo?.label ?? event.eventType}
              </p>
            </div>
            <ChevronRight size={14} className="text-text-muted shrink-0" />
          </button>
        );
      })}

      {mode === 'iocs' && iocs.map((ioc) => {
        const typeInfo = IOC_TYPE_LABELS[ioc.type];
        const confInfo = CONFIDENCE_LEVELS[ioc.confidence];
        return (
          <button key={ioc.id} onClick={() => onSelectIOC?.(ioc.id, ioc.folderId || '')}
            className="flex items-center gap-3 bg-bg-raised rounded-xl px-4 py-3 active:bg-bg-hover text-left">
            <span className="text-[9px] font-bold px-1.5 py-0.5 rounded shrink-0" style={{ backgroundColor: typeInfo?.color + '22', color: typeInfo?.color }}>{typeInfo?.label}</span>
            <div className="flex-1 min-w-0">
              <p className="text-xs font-mono text-text-primary truncate">{ioc.value}</p>
              <p className="text-[10px] text-text-muted mt-0.5">{folderNames.get(ioc.folderId || '') || 'Unfiled'}</p>
            </div>
            <span className="text-[9px] px-1.5 py-0.5 rounded shrink-0" style={{ backgroundColor: confInfo?.color + '22', color: confInfo?.color }}>{confInfo?.label}</span>
            <ChevronRight size={14} className="text-text-muted shrink-0" />
          </button>
        );
      })}
    </div>
  );
}
