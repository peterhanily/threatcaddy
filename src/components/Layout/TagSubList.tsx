import { useEffect, useId, useRef, useState } from 'react';
import { Check, ChevronDown, Pencil, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { Tag as TagType } from '../../types';
import { ConfirmDialog } from '../Common/ConfirmDialog';
import { cn } from '../../lib/utils';
import { useScreenshare } from '../../hooks/ScreenshareContext';

interface TagSubListProps {
  tags: TagType[];
  selectedTag?: string;
  onTagSelect: (name?: string) => void;
  onFolderSelect: (id?: string) => void;
  onShowTrash: (show: boolean) => void;
  onShowArchive: (show: boolean) => void;
  onRenameTag?: (id: string, name: string) => void | Promise<void>;
  onDeleteTag?: (id: string) => void | Promise<void>;
  onNavigate?: () => void;
}

export function TagSubList({
  tags, selectedTag, onTagSelect, onFolderSelect,
  onShowTrash, onShowArchive, onRenameTag, onDeleteTag, onNavigate,
}: TagSubListProps) {
  const { t } = useTranslation('common');
  const { maxLevel } = useScreenshare();
  const sharing = maxLevel !== null;
  const listId = useId();
  const [open, setOpen] = useState(true);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState('');
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [renameError, setRenameError] = useState('');
  const [deleteError, setDeleteError] = useState('');
  const toggleRef = useRef<HTMLButtonElement>(null);
  const editInputRef = useRef<HTMLInputElement>(null);
  const renameButtons = useRef(new Map<string, HTMLButtonElement>());
  const deleteButtons = useRef(new Map<string, HTMLButtonElement>());
  const pendingFocus = useRef<{ action: 'rename' | 'delete'; id: string } | 'toggle' | null>(null);
  const deleteConfirmed = useRef(false);
  const busyRef = useRef(false);
  const mountedRef = useRef(false);
  const selectedTagRef = useRef(selectedTag);
  useEffect(() => { selectedTagRef.current = selectedTag; }, [selectedTag]);
  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);
  useEffect(() => {
    const target = pendingFocus.current;
    if (!target || deletingId !== null || (target !== 'toggle' && target.action === 'rename' && editingId !== null)) return;
    pendingFocus.current = null;
    const button = target === 'toggle' ? toggleRef.current
      : (target.action === 'rename' ? renameButtons : deleteButtons).current.get(target.id);
    (button ?? toggleRef.current)?.focus();
  }, [editingId, deletingId, tags, open]);
  useEffect(() => {
    if (!busy && !sharing && renameError && editingId) editInputRef.current?.focus();
  }, [busy, sharing, renameError, editingId]);

  const nav = (fn: () => void) => { fn(); onNavigate?.(); };

  const stopRenaming = (id: string) => {
    if (busyRef.current) return;
    pendingFocus.current = { action: 'rename', id };
    setEditingId(null);
    setRenameError('');
  };

  const handleRename = async (tag: TagType) => {
    if (sharing || busyRef.current || !onRenameTag) return;
    const name = editName.trim();
    if (!name) {
      setRenameError(t('sidebar.tagNameRequired', { defaultValue: 'Enter a tag name.' }));
      return;
    }
    if (tags.some(other => other.id !== tag.id && other.name.trim().toLowerCase() === name.toLowerCase())) {
      setRenameError(t('sidebar.tagNameExists', { defaultValue: 'A tag with that name already exists.' }));
      return;
    }
    if (name === tag.name) { stopRenaming(tag.id); return; }
    busyRef.current = true;
    setBusy(true);
    setRenameError('');
    try {
      await onRenameTag(tag.id, name);
      if (!mountedRef.current) return;
      if (selectedTagRef.current === tag.name) onTagSelect(name);
      pendingFocus.current = { action: 'rename', id: tag.id };
      setEditingId(null);
    } catch {
      if (mountedRef.current) setRenameError(t('sidebar.tagRenameFailed', { defaultValue: 'Could not rename the tag. Your edit is still here; please try again.' }));
    } finally {
      busyRef.current = false;
      if (mountedRef.current) setBusy(false);
    }
  };

  const closeDelete = () => {
    if (deletingId) pendingFocus.current = deleteConfirmed.current ? 'toggle' : { action: 'delete', id: deletingId };
    deleteConfirmed.current = false;
    setDeletingId(null);
  };

  const handleDelete = async () => {
    if (sharing || !deletingId || !onDeleteTag || busyRef.current) return;
    const deletedName = tags.find(tag => tag.id === deletingId)?.name;
    deleteConfirmed.current = true;
    busyRef.current = true;
    setBusy(true);
    setDeleteError('');
    try {
      await onDeleteTag(deletingId);
      if (mountedRef.current && deletedName && selectedTagRef.current === deletedName) onTagSelect(undefined);
    } catch {
      if (mountedRef.current) setDeleteError(t('sidebar.tagDeleteFailed', { defaultValue: 'Could not delete the tag. Please try again.' }));
    } finally {
      busyRef.current = false;
      if (mountedRef.current) setBusy(false);
    }
  };

  return (
    <div className="pt-1">
      <div className="mx-0 mb-1 border-t border-border-subtle" />
      <button
        ref={toggleRef}
        type="button"
        onClick={() => setOpen(!open)}
        className="flex items-center gap-1 w-full px-2 py-1 rounded font-mono text-[10px] text-text-muted hover:text-text-secondary transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-purple"
        aria-expanded={open}
        aria-controls={listId}
      >
        <ChevronDown
          size={12}
          className="transition-transform duration-200"
          style={{ transform: open ? 'rotate(0deg)' : 'rotate(-90deg)' }}
        />
        {t('sidebar.tags', { defaultValue: 'Tags' })}
      </button>

      {open && (
        <div id={listId} className="mt-1 flex flex-wrap gap-1 px-2" data-tour="tags-folders">
          {tags.map((tag) => (
            <div key={tag.id} className="group relative">
              {editingId === tag.id ? (
                <form hidden={sharing} inert={sharing} aria-hidden={sharing || undefined} style={sharing ? { display: 'none' } : undefined} onSubmit={event => { event.preventDefault(); void handleRename(tag); }} className="flex flex-wrap items-center gap-1">
                <input
                  ref={editInputRef}
                  autoFocus
                  disabled={busy}
                  value={editName}
                  onChange={(e) => { setEditName(e.target.value); setRenameError(''); }}
                  onKeyDown={(e) => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); stopRenaming(tag.id); } }}
                  aria-label={t('sidebar.tagNewName', { defaultValue: 'New name for tag {{name}}', name: tag.name })}
                  aria-invalid={!!renameError}
                  aria-describedby={renameError ? `${listId}-rename-error` : undefined}
                  className="bg-bg-deep border border-border-medium rounded px-2 py-0.5 text-xs text-text-primary focus:outline-none focus:border-purple w-24"
                />
                <button type="submit" disabled={busy || sharing} className="inline-flex min-h-6 min-w-6 items-center justify-center p-1 rounded text-purple focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-purple disabled:opacity-50" aria-label={t('sidebar.tagSaveName', { defaultValue: 'Save tag name' })}><Check size={14} /></button>
                <button type="button" disabled={busy || sharing} onClick={() => stopRenaming(tag.id)} className="inline-flex min-h-6 min-w-6 items-center justify-center p-1 rounded text-text-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-purple disabled:opacity-50" aria-label={t('sidebar.tagCancelRename', { defaultValue: 'Cancel renaming tag' })}><X size={14} /></button>
                {renameError && <p id={`${listId}-rename-error`} role="alert" className="basis-full max-w-52 text-xs text-red-400">{renameError}</p>}
                </form>
              ) : (
                <div className={cn('flex items-center rounded-full text-xs', selectedTag === tag.name ? 'bg-purple/20 text-purple' : 'bg-bg-raised text-text-secondary')}>
                <button
                  type="button"
                  onClick={() => nav(() => { onTagSelect(tag.name); onFolderSelect(undefined); onShowTrash(false); onShowArchive(false); })}
                  aria-pressed={selectedTag === tag.name}
                  className="flex items-center gap-1.5 px-2 py-1 rounded-full transition-colors hover:bg-bg-hover hover:text-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-purple"
                >
                  <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: tag.color }} />
                  {tag.name}
                </button>
                {onRenameTag && <button
                  ref={element => { if (element) renameButtons.current.set(tag.id, element); else renameButtons.current.delete(tag.id); }}
                  type="button" disabled={busy || sharing}
                  onClick={() => { setEditingId(tag.id); setEditName(tag.name); setRenameError(''); }}
                  className="inline-flex min-h-6 min-w-6 items-center justify-center p-1 rounded text-text-muted hover:text-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-purple disabled:opacity-50"
                  aria-label={t('sidebar.tagRename', { defaultValue: 'Rename tag {{name}}', name: tag.name })}
                  title={t('sidebar.tagRename', { defaultValue: 'Rename tag {{name}}', name: tag.name })}
                ><Pencil size={12} /></button>}
                {onDeleteTag && <button
                  ref={element => { if (element) deleteButtons.current.set(tag.id, element); else deleteButtons.current.delete(tag.id); }}
                  type="button" disabled={busy || sharing}
                  onClick={() => { setDeletingId(tag.id); setDeleteError(''); }}
                  className="inline-flex min-h-6 min-w-6 items-center justify-center p-1 rounded text-text-muted hover:text-red-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-purple disabled:opacity-50"
                  aria-label={t('sidebar.tagDelete', { defaultValue: 'Delete tag {{name}}', name: tag.name })}
                  title={t('sidebar.tagDelete', { defaultValue: 'Delete tag {{name}}', name: tag.name })}
                ><X size={12} /></button>}
                </div>
              )}
            </div>
          ))}
          {tags.length === 0 && (
            <p className="text-[10px] text-text-muted font-mono">{t('sidebar.noTags', { defaultValue: 'No tags yet' })}</p>
          )}
        </div>
      )}
      {deleteError && <p role="alert" className="px-2 text-xs text-red-400">{deleteError}</p>}

      <ConfirmDialog
        open={deletingId !== null}
        onClose={closeDelete}
        onConfirm={() => { void handleDelete(); }}
        title={t('sidebar.tagDeleteTitle', { defaultValue: 'Delete Tag' })}
        message={t('sidebar.tagDeleteMessage', { defaultValue: 'This tag will be removed from all investigations and items that use it.' })}
        confirmLabel={t('sidebar.tagDeleteTitle', { defaultValue: 'Delete Tag' })}
        danger
      />
    </div>
  );
}
