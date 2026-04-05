import { useState } from 'react';
import {
  Trash2, Archive, RotateCcw, ChevronDown, ChevronRight,
  FileText, ListChecks, Clock, PenTool, Search,
} from 'lucide-react';
import type { Note, Task, TimelineEvent, Whiteboard, StandaloneIOC, Folder } from '../../types';
import { IOC_TYPE_LABELS } from '../../types';
import { ConfirmDialog } from '../Common/ConfirmDialog';
import { formatDate, cn } from '../../lib/utils';

interface TrashArchiveViewProps {
  mode: 'trash' | 'archive';
  notes: Note[];
  tasks: Task[];
  timelineEvents: TimelineEvent[];
  whiteboards: Whiteboard[];
  standaloneIOCs: StandaloneIOC[];
  folders: Folder[];
  // Note actions
  onRestoreNote: (id: string) => void;
  onDeleteNotePermanently: (id: string) => void;
  onTrashNote: (id: string) => void;
  onUnarchiveNote: (id: string) => void;
  // Task actions
  onRestoreTask: (id: string) => void;
  onDeleteTaskPermanently: (id: string) => void;
  onTrashTask: (id: string) => void;
  onUnarchiveTask: (id: string) => void;
  // Timeline event actions
  onRestoreEvent: (id: string) => void;
  onDeleteEventPermanently: (id: string) => void;
  onTrashEvent: (id: string) => void;
  onUnarchiveEvent: (id: string) => void;
  // Whiteboard actions
  onRestoreWhiteboard: (id: string) => void;
  onDeleteWhiteboardPermanently: (id: string) => void;
  onTrashWhiteboard: (id: string) => void;
  onUnarchiveWhiteboard: (id: string) => void;
  // IOC actions
  onRestoreIOC: (id: string) => void;
  onDeleteIOCPermanently: (id: string) => void;
  onTrashIOC: (id: string) => void;
  onUnarchiveIOC: (id: string) => void;
  // Empty all trash
  onEmptyAllTrash: () => void;
}

function EntitySection({
  icon,
  label,
  count,
  children,
}: {
  icon: React.ReactNode;
  label: string;
  count: number;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(true);
  if (count === 0) return null;

  return (
    <div className="mb-4">
      <button
        onClick={() => setOpen(!open)}
        className="flex items-center gap-2 w-full px-2 py-1.5 text-sm font-medium text-gray-300 hover:text-gray-100 transition-colors"
      >
        {open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
        {icon}
        <span>{label}</span>
        <span className="text-xs text-gray-500 tabular-nums">({count})</span>
      </button>
      {open && <div className="mt-1 space-y-1 pl-2">{children}</div>}
    </div>
  );
}

function ItemRow({
  icon,
  title,
  folderName,
  timestamp,
  primaryAction,
  secondaryAction,
}: {
  icon: React.ReactNode;
  title: string;
  folderName?: string;
  timestamp?: number;
  primaryAction: { icon: React.ReactNode; label: string; onClick: () => void; className: string };
  secondaryAction: { icon: React.ReactNode; label: string; onClick: () => void; className: string };
}) {
  return (
    <div className="group flex items-center gap-2 px-3 py-2 rounded-lg hover:bg-gray-800/50 transition-colors">
      <span className="text-gray-500 shrink-0">{icon}</span>
      <span className="text-sm text-gray-300 truncate flex-1">{title}</span>
      {folderName && (
        <span className="text-[10px] px-1.5 py-0.5 rounded bg-gray-800 text-gray-400 shrink-0 hidden sm:inline">
          {folderName}
        </span>
      )}
      {timestamp && (
        <span className="text-xs text-gray-600 shrink-0 hidden sm:inline">{formatDate(timestamp)}</span>
      )}
      <span className="flex items-center gap-1 opacity-40 group-hover:opacity-100 group-focus-within:opacity-100 transition-opacity shrink-0">
        <button
          onClick={primaryAction.onClick}
          className={cn('p-1 rounded', primaryAction.className)}
          title={primaryAction.label}
          aria-label={primaryAction.label}
        >
          {primaryAction.icon}
        </button>
        <button
          onClick={secondaryAction.onClick}
          className={cn('p-1 rounded', secondaryAction.className)}
          title={secondaryAction.label}
          aria-label={secondaryAction.label}
        >
          {secondaryAction.icon}
        </button>
      </span>
    </div>
  );
}

export function TrashArchiveView({
  mode,
  notes,
  tasks,
  timelineEvents,
  whiteboards,
  standaloneIOCs,
  folders,
  onRestoreNote,
  onDeleteNotePermanently,
  onTrashNote,
  onUnarchiveNote,
  onRestoreTask,
  onDeleteTaskPermanently,
  onTrashTask,
  onUnarchiveTask,
  onRestoreEvent,
  onDeleteEventPermanently,
  onTrashEvent,
  onUnarchiveEvent,
  onRestoreWhiteboard,
  onDeleteWhiteboardPermanently,
  onTrashWhiteboard,
  onUnarchiveWhiteboard,
  onRestoreIOC,
  onDeleteIOCPermanently,
  onTrashIOC,
  onUnarchiveIOC,
  onEmptyAllTrash,
}: TrashArchiveViewProps) {
  const [showEmptyConfirm, setShowEmptyConfirm] = useState(false);

  const isTrash = mode === 'trash';

  const trashedNotes = notes.filter((n) => n.trashed);
  const trashedTasks = tasks.filter((t) => t.trashed);
  const trashedEvents = timelineEvents.filter((e) => e.trashed);
  const trashedWhiteboards = whiteboards.filter((w) => w.trashed);
  const trashedIOCs = standaloneIOCs.filter((i) => i.trashed);

  const archivedNotes = notes.filter((n) => n.archived && !n.trashed);
  const archivedTasks = tasks.filter((t) => t.archived && !t.trashed);
  const archivedEvents = timelineEvents.filter((e) => e.archived && !e.trashed);
  const archivedWhiteboards = whiteboards.filter((w) => w.archived && !w.trashed);
  const archivedIOCs = standaloneIOCs.filter((i) => i.archived && !i.trashed);

  const items = isTrash
    ? { notes: trashedNotes, tasks: trashedTasks, events: trashedEvents, whiteboards: trashedWhiteboards, iocs: trashedIOCs }
    : { notes: archivedNotes, tasks: archivedTasks, events: archivedEvents, whiteboards: archivedWhiteboards, iocs: archivedIOCs };

  const totalCount = items.notes.length + items.tasks.length + items.events.length + items.whiteboards.length + items.iocs.length;

  const folderMap = new Map(folders.map((f) => [f.id, f.name]));
  const getFolderName = (folderId?: string) => folderId ? folderMap.get(folderId) : undefined;

  const makeActions = (
    id: string,
    restore: (id: string) => void,
    deletePerm: (id: string) => void,
    unarchive: (id: string) => void,
    trash: (id: string) => void,
  ) => {
    if (isTrash) {
      return {
        primary: {
          icon: <RotateCcw size={14} />,
          label: 'Restore',
          onClick: () => restore(id),
          className: 'hover:bg-gray-700 text-gray-500 hover:text-green-400',
        },
        secondary: {
          icon: <Trash2 size={14} />,
          label: 'Delete permanently',
          onClick: () => deletePerm(id),
          className: 'hover:bg-gray-700 text-gray-500 hover:text-red-400',
        },
      };
    }
    return {
      primary: {
        icon: <RotateCcw size={14} />,
        label: 'Unarchive',
        onClick: () => unarchive(id),
        className: 'hover:bg-gray-700 text-gray-500 hover:text-green-400',
      },
      secondary: {
        icon: <Trash2 size={14} />,
        label: 'Move to trash',
        onClick: () => trash(id),
        className: 'hover:bg-gray-700 text-gray-500 hover:text-red-400',
      },
    };
  };

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      {/* Header */}
      <div className="flex items-center gap-2 px-4 py-3 border-b border-gray-800 shrink-0">
        {isTrash ? <Trash2 size={18} className="text-gray-400" /> : <Archive size={18} className="text-gray-400" />}
        <h2 className="text-lg font-semibold text-gray-200">
          {isTrash ? 'Trash' : 'Archive'} ({totalCount})
        </h2>
        {isTrash && totalCount > 0 && (
          <button
            onClick={() => setShowEmptyConfirm(true)}
            className="ml-auto flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-red-600/20 hover:bg-red-600/30 text-red-400 text-sm font-medium transition-colors"
          >
            <Trash2 size={14} />
            Empty All Trash
          </button>
        )}
      </div>

      {isTrash && totalCount > 0 && (
        <div className="px-4 py-1.5 text-xs text-gray-600 border-b border-gray-800/50">
          Items auto-delete after 30 days
        </div>
      )}

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-4">
        {totalCount === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-gray-600">
            {isTrash ? <Trash2 size={48} className="mb-3" /> : <Archive size={48} className="mb-3" />}
            <p className="text-lg font-medium">{isTrash ? 'Trash is empty' : 'Archive is empty'}</p>
          </div>
        ) : (
          <>
            <EntitySection icon={<FileText size={16} />} label="Notes" count={items.notes.length}>
              {items.notes.map((note) => {
                const actions = makeActions(note.id, onRestoreNote, onDeleteNotePermanently, onUnarchiveNote, onTrashNote);
                return (
                  <ItemRow
                    key={note.id}
                    icon={<FileText size={14} />}
                    title={note.title || 'Untitled'}
                    folderName={getFolderName(note.folderId)}
                    timestamp={isTrash ? note.trashedAt : note.updatedAt}
                    primaryAction={actions.primary}
                    secondaryAction={actions.secondary}
                  />
                );
              })}
            </EntitySection>

            <EntitySection icon={<ListChecks size={16} />} label="Tasks" count={items.tasks.length}>
              {items.tasks.map((task) => {
                const actions = makeActions(task.id, onRestoreTask, onDeleteTaskPermanently, onUnarchiveTask, onTrashTask);
                return (
                  <ItemRow
                    key={task.id}
                    icon={<ListChecks size={14} />}
                    title={task.title || 'Untitled'}
                    folderName={getFolderName(task.folderId)}
                    timestamp={isTrash ? task.trashedAt : task.updatedAt}
                    primaryAction={actions.primary}
                    secondaryAction={actions.secondary}
                  />
                );
              })}
            </EntitySection>

            <EntitySection icon={<Clock size={16} />} label="Timeline Events" count={items.events.length}>
              {items.events.map((event) => {
                const actions = makeActions(event.id, onRestoreEvent, onDeleteEventPermanently, onUnarchiveEvent, onTrashEvent);
                return (
                  <ItemRow
                    key={event.id}
                    icon={<Clock size={14} />}
                    title={event.title || 'Untitled'}
                    folderName={getFolderName(event.folderId)}
                    timestamp={isTrash ? event.trashedAt : event.updatedAt}
                    primaryAction={actions.primary}
                    secondaryAction={actions.secondary}
                  />
                );
              })}
            </EntitySection>

            <EntitySection icon={<PenTool size={16} />} label="Whiteboards" count={items.whiteboards.length}>
              {items.whiteboards.map((wb) => {
                const actions = makeActions(wb.id, onRestoreWhiteboard, onDeleteWhiteboardPermanently, onUnarchiveWhiteboard, onTrashWhiteboard);
                return (
                  <ItemRow
                    key={wb.id}
                    icon={<PenTool size={14} />}
                    title={wb.name || 'Untitled'}
                    folderName={getFolderName(wb.folderId)}
                    timestamp={isTrash ? wb.trashedAt : wb.updatedAt}
                    primaryAction={actions.primary}
                    secondaryAction={actions.secondary}
                  />
                );
              })}
            </EntitySection>

            <EntitySection icon={<Search size={14} />} label="IOCs" count={items.iocs.length}>
              {items.iocs.map((ioc) => {
                const actions = makeActions(ioc.id, onRestoreIOC, onDeleteIOCPermanently, onUnarchiveIOC, onTrashIOC);
                const typeLabel = IOC_TYPE_LABELS[ioc.type]?.label || ioc.type;
                return (
                  <ItemRow
                    key={ioc.id}
                    icon={<Search size={14} />}
                    title={`${ioc.value} (${typeLabel})`}
                    folderName={getFolderName(ioc.folderId)}
                    timestamp={isTrash ? ioc.trashedAt : ioc.updatedAt}
                    primaryAction={actions.primary}
                    secondaryAction={actions.secondary}
                  />
                );
              })}
            </EntitySection>
          </>
        )}
      </div>

      <ConfirmDialog
        open={showEmptyConfirm}
        onClose={() => setShowEmptyConfirm(false)}
        onConfirm={() => { onEmptyAllTrash(); setShowEmptyConfirm(false); }}
        title="Empty All Trash"
        message={`Permanently delete all ${totalCount} trashed item(s) across all entity types? This cannot be undone.`}
        confirmLabel="Empty All Trash"
        danger
      />
    </div>
  );
}
