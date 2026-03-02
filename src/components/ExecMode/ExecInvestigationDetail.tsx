import { useMemo } from 'react';
import { ArrowLeft, FileText, ListChecks, Clock, PenTool, Shield, ExternalLink, Share2 } from 'lucide-react';
import type { Folder, Note, Task, TimelineEvent, Whiteboard, StandaloneIOC, ActivityLogEntry } from '../../types';
import { ACTIVITY_CATEGORY_LABELS } from '../../types';
import { cn } from '../../lib/utils';
import { formatDate } from '../../lib/utils';
import { isEncryptedEnvelope } from '../../lib/crypto';

function safeText(value: unknown): string {
  if (value == null) return '';
  if (isEncryptedEnvelope(value)) return '[Encrypted]';
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}

interface ExecInvestigationDetailProps {
  folder: Folder;
  allNotes: Note[];
  allTasks: Task[];
  allEvents: TimelineEvent[];
  allWhiteboards: Whiteboard[];
  allIOCs: StandaloneIOC[];
  activityEntries: ActivityLogEntry[];
  onBack: () => void;
  onOpenAnalystMode: () => void;
  onTapNotes?: () => void;
  onTapTasks?: () => void;
  onTapEvents?: () => void;
  onTapWhiteboards?: () => void;
  onTapIOCs?: () => void;
  onShare?: () => void;
}

const STATUS_COLORS: Record<string, string> = {
  active: 'bg-accent-green',
  closed: 'bg-accent-amber',
  archived: 'bg-text-muted',
};

export function ExecInvestigationDetail({
  folder,
  allNotes,
  allTasks,
  allEvents,
  allWhiteboards,
  allIOCs,
  activityEntries,
  onBack,
  onOpenAnalystMode,
  onTapNotes,
  onTapTasks,
  onTapEvents,
  onTapWhiteboards,
  onTapIOCs,
  onShare,
}: ExecInvestigationDetailProps) {
  const status = folder.status || 'active';

  const counts = useMemo(() => ({
    notes: allNotes.filter((n) => n.folderId === folder.id).length,
    tasks: allTasks.filter((t) => t.folderId === folder.id).length,
    events: allEvents.filter((e) => e.folderId === folder.id).length,
    whiteboards: allWhiteboards.filter((w) => w.folderId === folder.id).length,
    iocs: allIOCs.filter((i) => i.folderId === folder.id).length,
  }), [folder.id, allNotes, allTasks, allEvents, allWhiteboards, allIOCs]);

  const taskBreakdown = useMemo(() => {
    const folderTasks = allTasks.filter((t) => t.folderId === folder.id && !t.trashed);
    return {
      todo: folderTasks.filter((t) => t.status === 'todo').length,
      inProgress: folderTasks.filter((t) => t.status === 'in-progress').length,
      done: folderTasks.filter((t) => t.status === 'done').length,
      total: folderTasks.length,
    };
  }, [folder.id, allTasks]);

  // Recent activity related to this investigation's entities
  const recentActivity = useMemo(() => {
    const noteIds = new Set(allNotes.filter((n) => n.folderId === folder.id).map((n) => n.id));
    const taskIds = new Set(allTasks.filter((t) => t.folderId === folder.id).map((t) => t.id));
    const eventIds = new Set(allEvents.filter((e) => e.folderId === folder.id).map((e) => e.id));
    const iocIds = new Set(allIOCs.filter((i) => i.folderId === folder.id).map((i) => i.id));

    return activityEntries
      .filter((entry) => {
        if (entry.itemId === folder.id && entry.category === 'folder') return true;
        if (entry.itemId && noteIds.has(entry.itemId)) return true;
        if (entry.itemId && taskIds.has(entry.itemId)) return true;
        if (entry.itemId && eventIds.has(entry.itemId)) return true;
        if (entry.itemId && iocIds.has(entry.itemId)) return true;
        return false;
      })
      .slice(0, 15);
  }, [folder.id, activityEntries, allNotes, allTasks, allEvents, allIOCs]);

  const metricItems = [
    { key: 'notes' as const, label: 'Notes', value: counts.notes, icon: FileText, color: 'text-accent-blue', onTap: onTapNotes },
    { key: 'tasks' as const, label: 'Tasks', value: counts.tasks, icon: ListChecks, color: 'text-accent-amber', onTap: onTapTasks },
    { key: 'events' as const, label: 'Events', value: counts.events, icon: Clock, color: 'text-accent-green', onTap: onTapEvents },
    { key: 'boards' as const, label: 'Boards', value: counts.whiteboards, icon: PenTool, color: 'text-accent-pink', onTap: onTapWhiteboards },
    { key: 'iocs' as const, label: 'IOCs', value: counts.iocs, icon: Shield, color: 'text-red-400', onTap: onTapIOCs },
  ];

  return (
    <div className="flex flex-col gap-4">
      {/* Back button + title */}
      <div className="flex items-center justify-between">
        <button onClick={onBack} className="flex items-center gap-2 text-text-secondary active:text-text-primary -ml-1">
          <ArrowLeft size={18} />
          <span className="text-sm">Back</span>
        </button>
        {onShare && (
          <button onClick={onShare} className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-accent bg-accent/10 active:bg-accent/20 text-xs font-medium">
            <Share2 size={14} />
            Share
          </button>
        )}
      </div>

      <div className="flex items-center gap-2.5">
        <span
          className={cn(
            'w-3 h-3 rounded-full shrink-0',
            STATUS_COLORS[status] ?? 'bg-text-muted',
            status === 'active' && 'animate-pulse',
          )}
        />
        <h2 className="text-xl font-bold text-text-primary">{folder.name}</h2>
      </div>

      {/* Meta info */}
      <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-text-muted">
        <span className="capitalize">{status}</span>
        {folder.clsLevel && <span>CLS: {folder.clsLevel}</span>}
        <span>Created {new Date(folder.createdAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}</span>
      </div>

      {folder.description && (
        <p className="text-sm text-text-secondary leading-relaxed">{folder.description}</p>
      )}

      {/* Metrics row — clickable */}
      <div className="grid grid-cols-5 gap-1 bg-bg-raised rounded-xl p-3">
        {metricItems.map((m) => (
          <button
            key={m.key}
            onClick={m.onTap}
            className="flex flex-col items-center py-1 rounded-lg active:bg-bg-hover transition-colors"
          >
            <m.icon size={14} className={m.color} />
            <span className="text-lg font-bold mt-0.5 text-text-primary">{m.value}</span>
            <span className="text-[8px] font-medium text-text-muted uppercase tracking-wide">{m.label}</span>
          </button>
        ))}
      </div>

      {/* Task breakdown */}
      {taskBreakdown.total > 0 && (
        <div className="bg-bg-raised rounded-xl p-4">
          <h3 className="text-sm font-semibold text-text-primary mb-3">Task Progress</h3>
          {/* Progress bar */}
          <div className="flex rounded-full h-3 overflow-hidden bg-bg-deep">
            {taskBreakdown.done > 0 && (
              <div className="bg-accent-green" style={{ width: `${(taskBreakdown.done / taskBreakdown.total) * 100}%` }} />
            )}
            {taskBreakdown.inProgress > 0 && (
              <div className="bg-accent-amber" style={{ width: `${(taskBreakdown.inProgress / taskBreakdown.total) * 100}%` }} />
            )}
            {taskBreakdown.todo > 0 && (
              <div className="bg-text-muted" style={{ width: `${(taskBreakdown.todo / taskBreakdown.total) * 100}%` }} />
            )}
          </div>
          <div className="flex gap-4 mt-2 text-xs">
            <span className="text-accent-green">{taskBreakdown.done} done</span>
            <span className="text-accent-amber">{taskBreakdown.inProgress} in progress</span>
            <span className="text-text-muted">{taskBreakdown.todo} todo</span>
          </div>
        </div>
      )}

      {/* Recent activity */}
      {recentActivity.length > 0 && (
        <div className="bg-bg-raised rounded-xl p-4">
          <h3 className="text-sm font-semibold text-text-primary mb-3">Recent Activity</h3>
          <div className="flex flex-col gap-2.5">
            {recentActivity.map((entry) => {
              const cat = ACTIVITY_CATEGORY_LABELS[entry.category];
              return (
                <div key={entry.id} className="flex items-start gap-2.5">
                  <div
                    className="w-2 h-2 rounded-full mt-1.5 shrink-0"
                    style={{ backgroundColor: cat?.color ?? '#6b7280' }}
                  />
                  <div className="flex-1 min-w-0">
                    <p className="text-xs text-text-primary truncate">{safeText(entry.detail)}</p>
                    <p className="text-[10px] text-text-muted mt-0.5">{formatDate(entry.timestamp)}</p>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* CTA */}
      <button
        onClick={onOpenAnalystMode}
        className="flex items-center justify-center gap-2 bg-accent text-white rounded-xl py-3.5 font-medium text-sm active:bg-accent-dim transition-colors"
      >
        <ExternalLink size={16} />
        Open in Analyst Mode
      </button>
    </div>
  );
}
