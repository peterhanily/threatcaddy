import { useState } from 'react';
import { PenTool, Plus, Pencil, Trash2, Archive, RotateCcw } from 'lucide-react';
import type { Whiteboard, Folder } from '../../types';
import { ConfirmDialog } from '../Common/ConfirmDialog';
import { ClsBadge } from '../Common/ClsBadge';
import { formatDate, cn } from '../../lib/utils';

interface WhiteboardListProps {
  whiteboards: Whiteboard[];
  folders: Folder[];
  onSelect: (id: string) => void;
  onCreate: () => void;
  onDelete: (id: string) => void;
  onRename: (id: string, name: string) => void;
  onTrash?: (id: string) => void;
  onRestore?: (id: string) => void;
  onToggleArchive?: (id: string) => void;
}

export function WhiteboardList({ whiteboards, folders, onSelect, onCreate, onDelete, onRename, onTrash, onRestore, onToggleArchive }: WhiteboardListProps) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState('');
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const startRename = (wb: Whiteboard) => {
    setEditingId(wb.id);
    setEditName(wb.name);
  };

  const commitRename = (id: string) => {
    if (editName.trim()) {
      onRename(id, editName.trim());
    }
    setEditingId(null);
  };

  const getElementCount = (elements: string): number => {
    try {
      const arr = JSON.parse(elements);
      return Array.isArray(arr) ? arr.length : 0;
    } catch {
      return 0;
    }
  };

  const getFolderName = (folderId?: string) => {
    if (!folderId) return null;
    return folders.find((f) => f.id === folderId)?.name ?? null;
  };

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center justify-between p-4 border-b border-gray-800">
        <div className="flex items-center gap-2">
          <h2 className="text-lg font-semibold text-gray-200">Whiteboards</h2>
          <span className="text-xs text-gray-500 tabular-nums">{whiteboards.length}</span>
        </div>
        <button
          onClick={onCreate}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-accent/15 text-accent hover:bg-accent/25 text-sm font-medium transition-colors"
        >
          <Plus size={16} />
          New
        </button>
      </div>

      <div className="flex-1 overflow-y-auto p-4">
        {whiteboards.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-gray-600">
            <PenTool size={48} className="mb-3" />
            <p className="text-lg font-medium">No whiteboards yet</p>
            <p className="text-sm mt-1">Create one to start drawing</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {whiteboards.map((wb) => (
              <div
                key={wb.id}
                className={cn(
                  'group relative border border-gray-700 rounded-lg p-4 cursor-pointer transition-colors',
                  'hover:border-gray-600 hover:bg-gray-800/50'
                )}
                onClick={() => editingId !== wb.id && onSelect(wb.id)}
              >
                <div className="flex items-start justify-between gap-2 mb-2">
                  {editingId === wb.id ? (
                    <input
                      autoFocus
                      value={editName}
                      onChange={(e) => setEditName(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') commitRename(wb.id);
                        if (e.key === 'Escape') setEditingId(null);
                      }}
                      onBlur={() => commitRename(wb.id)}
                      onClick={(e) => e.stopPropagation()}
                      className="flex-1 bg-gray-800 border border-gray-600 rounded px-2 py-1 text-sm text-gray-200 focus:outline-none focus:border-accent"
                    />
                  ) : (
                    <h3 className="text-sm font-medium text-gray-200 truncate">{wb.name}</h3>
                  )}
                  <div className="flex items-center gap-1 opacity-40 group-hover:opacity-100 transition-opacity shrink-0">
                    {wb.trashed ? (
                      <>
                        {onRestore && (
                          <button
                            onClick={(e) => { e.stopPropagation(); onRestore(wb.id); }}
                            className="p-1 rounded hover:bg-gray-700 text-gray-500 hover:text-green-400"
                            title="Restore"
                          >
                            <RotateCcw size={14} />
                          </button>
                        )}
                        <button
                          onClick={(e) => { e.stopPropagation(); setDeletingId(wb.id); }}
                          className="p-1 rounded hover:bg-gray-700 text-gray-500 hover:text-red-400"
                          title="Delete permanently"
                        >
                          <Trash2 size={14} />
                        </button>
                      </>
                    ) : (
                      <>
                        <button
                          onClick={(e) => { e.stopPropagation(); startRename(wb); }}
                          className="p-1 rounded hover:bg-gray-700 text-gray-500 hover:text-gray-300"
                          title="Rename"
                        >
                          <Pencil size={14} />
                        </button>
                        {onToggleArchive && (
                          <button
                            onClick={(e) => { e.stopPropagation(); onToggleArchive(wb.id); }}
                            className="p-1 rounded hover:bg-gray-700 text-gray-500 hover:text-gray-300"
                            title={wb.archived ? 'Unarchive' : 'Archive'}
                          >
                            <Archive size={14} />
                          </button>
                        )}
                        {onTrash ? (
                          <button
                            onClick={(e) => { e.stopPropagation(); onTrash(wb.id); }}
                            className="p-1 rounded hover:bg-gray-700 text-gray-500 hover:text-red-400"
                            title="Move to trash"
                          >
                            <Trash2 size={14} />
                          </button>
                        ) : (
                          <button
                            onClick={(e) => { e.stopPropagation(); setDeletingId(wb.id); }}
                            className="p-1 rounded hover:bg-gray-700 text-gray-500 hover:text-red-400"
                            title="Delete"
                          >
                            <Trash2 size={14} />
                          </button>
                        )}
                      </>
                    )}
                  </div>
                </div>
                <div className="flex items-center gap-2 text-xs text-gray-500">
                  <span>{getElementCount(wb.elements)} elements</span>
                  {getFolderName(wb.folderId) && (
                    <span className="px-1.5 py-0.5 rounded bg-gray-800 text-gray-400">{getFolderName(wb.folderId)}</span>
                  )}
                  {wb.clsLevel && <ClsBadge level={wb.clsLevel} />}
                </div>
                {wb.tags.length > 0 && (
                  <div className="flex flex-wrap gap-1 mt-2">
                    {wb.tags.map((tag) => (
                      <span key={tag} className="px-1.5 py-0.5 rounded text-xs bg-gray-800 text-gray-400">#{tag}</span>
                    ))}
                  </div>
                )}
                <p className="text-xs text-gray-600 mt-2">{formatDate(wb.updatedAt)}</p>
              </div>
            ))}
          </div>
        )}
      </div>

      <ConfirmDialog
        open={deletingId !== null}
        onClose={() => setDeletingId(null)}
        onConfirm={() => { if (deletingId) { onDelete(deletingId); setDeletingId(null); } }}
        title="Delete Whiteboard"
        message="This whiteboard will be permanently deleted. This cannot be undone."
        confirmLabel="Delete Whiteboard"
        danger
      />

    </div>
  );
}
