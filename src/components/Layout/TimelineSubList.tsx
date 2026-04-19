import { useState } from 'react';
import { ChevronDown, Clock, Plus, X } from 'lucide-react';
import type { Timeline } from '../../types';
import { ConfirmDialog } from '../Common/ConfirmDialog';
import { NavItem } from './SidebarHelpers';

interface TimelineSubListProps {
  timelines: Timeline[];
  selectedTimelineId?: string;
  timelineCounts?: { total: number; starred: number };
  timelineEventCounts: Record<string, number>;
  onTimelineSelect?: (id?: string) => void;
  onCreateTimeline?: (name: string) => void;
  onDeleteTimeline?: (id: string) => void;
  onRenameTimeline?: (id: string, name: string) => void;
  onNavigate?: () => void;
}

export function TimelineSubList({
  timelines, selectedTimelineId, timelineCounts, timelineEventCounts,
  onTimelineSelect, onCreateTimeline, onDeleteTimeline, onRenameTimeline, onNavigate,
}: TimelineSubListProps) {
  const [open, setOpen] = useState(true);
  const [showNew, setShowNew] = useState(false);
  const [newName, setNewName] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState('');
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const nav = (fn: () => void) => { fn(); onNavigate?.(); };

  const handleCreate = () => {
    if (newName.trim() && onCreateTimeline) {
      onCreateTimeline(newName.trim());
      setNewName('');
      setShowNew(false);
    }
  };

  const handleRename = (id: string) => {
    if (editName.trim() && onRenameTimeline) {
      onRenameTimeline(id, editName.trim());
      setEditingId(null);
    }
  };

  return (
    <div className="pt-1">
      <div className="mx-0 mb-1.5 border-t border-border-subtle" />
      <div
        role="button"
        tabIndex={0}
        onClick={() => setOpen(!open)}
        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setOpen(!open); } }}
        className="flex items-center gap-1 w-full px-2 py-1 font-mono text-[10px] text-text-muted hover:text-text-secondary cursor-pointer transition-colors"
        aria-expanded={open}
      >
        <ChevronDown
          size={12}
          className="transition-transform duration-200"
          style={{ transform: open ? 'rotate(0deg)' : 'rotate(-90deg)' }}
        />
        Timelines
        <button
          onClick={(e) => { e.stopPropagation(); setShowNew(true); }}
          className="ms-auto p-0.5 rounded hover:bg-bg-hover text-text-muted hover:text-text-primary transition-colors"
          aria-label="Create timeline"
          title="Create timeline"
        >
          <Plus size={12} />
        </button>
      </div>

      {open && (
        <div className="mt-1 space-y-0.5">
          {showNew && (
            <div className="flex items-center gap-1 px-2">
              <input
                autoFocus
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') handleCreate(); if (e.key === 'Escape') setShowNew(false); }}
                placeholder="Timeline name"
                aria-label="New timeline name"
                className="flex-1 bg-bg-deep border border-border-medium rounded px-2 py-1 text-xs text-text-primary focus:outline-none focus:border-purple"
              />
              <button onClick={handleCreate} className="text-purple hover:text-accent-hover" aria-label="Confirm create timeline" title="Create timeline">
                <Plus size={14} />
              </button>
              <button onClick={() => setShowNew(false)} className="text-text-muted hover:text-text-primary" aria-label="Cancel" title="Cancel">
                <X size={14} />
              </button>
            </div>
          )}
          <NavItem
            compact
            icon={<Clock size={14} />}
            label="All Events"
            badge={timelineCounts?.total}
            active={!selectedTimelineId}
            onClick={() => nav(() => { onTimelineSelect?.(undefined); })}
          />
          {timelines.map((tl) => (
            <div key={tl.id} className="group relative">
              {editingId === tl.id ? (
                <div className="flex items-center gap-1 px-2">
                  <input
                    autoFocus
                    value={editName}
                    onChange={(e) => setEditName(e.target.value)}
                    onKeyDown={(e) => { if (e.key === 'Enter') handleRename(tl.id); if (e.key === 'Escape') setEditingId(null); }}
                    aria-label="Rename timeline"
                    className="flex-1 bg-bg-deep border border-border-medium rounded px-2 py-1 text-xs text-text-primary focus:outline-none focus:border-purple"
                  />
                </div>
              ) : (
                <NavItem
                  compact
                  icon={<Clock size={14} style={{ color: tl.color }} />}
                  label={tl.name}
                  badge={timelineEventCounts[tl.id] || 0}
                  active={selectedTimelineId === tl.id}
                  onClick={() => nav(() => { onTimelineSelect?.(tl.id); })}
                  onDoubleClick={() => { setEditingId(tl.id); setEditName(tl.name); }}
                  actions={
                    <button
                      onClick={(e) => { e.stopPropagation(); setDeletingId(tl.id); }}
                      className="opacity-40 group-hover:opacity-100 group-focus-within:opacity-100 p-0.5 rounded hover:bg-bg-hover text-text-muted hover:text-red-400 transition-all"
                      aria-label={`Delete timeline ${tl.name}`}
                      title="Delete timeline"
                    >
                      <X size={12} />
                    </button>
                  }
                />
              )}
            </div>
          ))}
        </div>
      )}

      <ConfirmDialog
        open={deletingId !== null}
        onClose={() => setDeletingId(null)}
        onConfirm={() => { if (deletingId) { onDeleteTimeline?.(deletingId); setDeletingId(null); } }}
        title="Delete Timeline"
        message="This timeline and all its events will be permanently deleted. This cannot be undone."
        confirmLabel="Delete Timeline"
        danger
      />
    </div>
  );
}
