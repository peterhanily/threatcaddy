import { useState } from 'react';
import { ChevronDown, X } from 'lucide-react';
import type { Tag as TagType } from '../../types';
import { ConfirmDialog } from '../Common/ConfirmDialog';
import { cn } from '../../lib/utils';

interface TagSubListProps {
  tags: TagType[];
  selectedTag?: string;
  onTagSelect: (name?: string) => void;
  onFolderSelect: (id?: string) => void;
  onShowTrash: (show: boolean) => void;
  onShowArchive: (show: boolean) => void;
  onRenameTag?: (id: string, name: string) => void;
  onDeleteTag?: (id: string) => void;
  onNavigate?: () => void;
}

export function TagSubList({
  tags, selectedTag, onTagSelect, onFolderSelect,
  onShowTrash, onShowArchive, onRenameTag, onDeleteTag, onNavigate,
}: TagSubListProps) {
  const [open, setOpen] = useState(true);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState('');
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const nav = (fn: () => void) => { fn(); onNavigate?.(); };

  const handleRename = (id: string) => {
    if (editName.trim() && onRenameTag) {
      onRenameTag(id, editName.trim());
      setEditingId(null);
    }
  };

  return (
    <div className="pt-1">
      <div className="mx-0 mb-1 border-t border-border-subtle" />
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
        Tags
      </div>

      {open && (
        <div className="mt-1 flex flex-wrap gap-1 px-2" data-tour="tags-folders">
          {tags.map((tag) => (
            <div key={tag.id} className="group relative">
              {editingId === tag.id ? (
                <input
                  autoFocus
                  value={editName}
                  onChange={(e) => setEditName(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter') handleRename(tag.id); if (e.key === 'Escape') setEditingId(null); }}
                  aria-label="Rename tag"
                  className="bg-bg-deep border border-border-medium rounded px-2 py-0.5 text-xs text-text-primary focus:outline-none focus:border-purple w-24"
                />
              ) : (
                <button
                  onClick={() => nav(() => { onTagSelect(tag.name); onFolderSelect(undefined); onShowTrash(false); onShowArchive(false); })}
                  onDoubleClick={() => { setEditingId(tag.id); setEditName(tag.name); }}
                  className={cn(
                    'flex items-center gap-1.5 px-2 py-0.5 rounded-full text-xs transition-colors',
                    selectedTag === tag.name
                      ? 'bg-purple/20 text-purple'
                      : 'bg-bg-raised text-text-secondary hover:bg-bg-hover hover:text-text-primary'
                  )}
                >
                  <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: tag.color }} />
                  {tag.name}
                  <button
                    onClick={(e) => { e.stopPropagation(); setDeletingId(tag.id); }}
                    className="opacity-40 group-hover:opacity-100 p-0 hover:text-red-400 transition-all"
                    aria-label={`Delete tag ${tag.name}`}
                    title="Delete tag"
                  >
                    <X size={10} />
                  </button>
                </button>
              )}
            </div>
          ))}
          {tags.length === 0 && (
            <p className="text-[10px] text-text-muted font-mono">No tags yet</p>
          )}
        </div>
      )}

      <ConfirmDialog
        open={deletingId !== null}
        onClose={() => setDeletingId(null)}
        onConfirm={() => { if (deletingId) { onDeleteTag?.(deletingId); setDeletingId(null); } }}
        title="Delete Tag"
        message="This tag will be removed from all notes, tasks, timeline events, and whiteboards."
        confirmLabel="Delete Tag"
        danger
      />
    </div>
  );
}
