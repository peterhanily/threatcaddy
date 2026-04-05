import { useState } from 'react';
import { ChevronDown, PenTool, Plus, X } from 'lucide-react';
import type { Whiteboard } from '../../types';
import { ConfirmDialog } from '../Common/ConfirmDialog';
import { NavItem } from './SidebarHelpers';

interface WhiteboardSubListProps {
  whiteboards: Whiteboard[];
  selectedWhiteboardId?: string;
  onWhiteboardSelect?: (id: string) => void;
  onCreateWhiteboard?: (name?: string) => Promise<Whiteboard>;
  onDeleteWhiteboard?: (id: string) => void;
  onRenameWhiteboard?: (id: string, name: string) => void;
  onNavigate?: () => void;
}

export function WhiteboardSubList({
  whiteboards, selectedWhiteboardId, onWhiteboardSelect,
  onCreateWhiteboard, onDeleteWhiteboard, onRenameWhiteboard, onNavigate,
}: WhiteboardSubListProps) {
  const [open, setOpen] = useState(true);
  const [showNew, setShowNew] = useState(false);
  const [newName, setNewName] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState('');
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const nav = (fn: () => void) => { fn(); onNavigate?.(); };

  const handleCreate = () => {
    if (newName.trim() && onCreateWhiteboard) {
      onCreateWhiteboard(newName.trim());
      setNewName('');
      setShowNew(false);
    }
  };

  const handleRename = (id: string) => {
    if (editName.trim() && onRenameWhiteboard) {
      onRenameWhiteboard(id, editName.trim());
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
        Whiteboards
        <button
          onClick={(e) => { e.stopPropagation(); setShowNew(true); }}
          className="ml-auto p-0.5 rounded hover:bg-bg-hover text-text-muted hover:text-text-primary transition-colors"
          aria-label="Create whiteboard"
          title="Create whiteboard"
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
                placeholder="Whiteboard name"
                aria-label="New whiteboard name"
                className="flex-1 bg-bg-deep border border-border-medium rounded px-2 py-1 text-xs text-text-primary focus:outline-none focus:border-purple"
              />
              <button onClick={handleCreate} className="text-purple hover:text-accent-hover" aria-label="Confirm create whiteboard" title="Create whiteboard">
                <Plus size={14} />
              </button>
              <button onClick={() => setShowNew(false)} className="text-text-muted hover:text-text-primary" aria-label="Cancel" title="Cancel">
                <X size={14} />
              </button>
            </div>
          )}
          {whiteboards.map((wb) => (
            <div key={wb.id} className="group relative">
              {editingId === wb.id ? (
                <div className="flex items-center gap-1 px-2">
                  <input
                    autoFocus
                    value={editName}
                    onChange={(e) => setEditName(e.target.value)}
                    onKeyDown={(e) => { if (e.key === 'Enter') handleRename(wb.id); if (e.key === 'Escape') setEditingId(null); }}
                    aria-label="Rename whiteboard"
                    className="flex-1 bg-bg-deep border border-border-medium rounded px-2 py-1 text-xs text-text-primary focus:outline-none focus:border-purple"
                  />
                </div>
              ) : (
                <NavItem
                  compact
                  icon={<PenTool size={14} />}
                  label={wb.name}
                  active={selectedWhiteboardId === wb.id}
                  onClick={() => nav(() => { onWhiteboardSelect?.(wb.id); })}
                  onDoubleClick={() => { setEditingId(wb.id); setEditName(wb.name); }}
                  actions={
                    <button
                      onClick={(e) => { e.stopPropagation(); setDeletingId(wb.id); }}
                      className="opacity-40 group-hover:opacity-100 group-focus-within:opacity-100 p-0.5 rounded hover:bg-bg-hover text-text-muted hover:text-red-400 transition-all"
                      aria-label={`Delete whiteboard ${wb.name}`}
                      title="Delete whiteboard"
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
        onConfirm={() => { if (deletingId) { onDeleteWhiteboard?.(deletingId); setDeletingId(null); } }}
        title="Delete Whiteboard"
        message="This whiteboard will be permanently deleted. This cannot be undone."
        confirmLabel="Delete Whiteboard"
        danger
      />
    </div>
  );
}
