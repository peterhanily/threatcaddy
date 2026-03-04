import { useEffect, useRef, useCallback } from 'react';
import { X, AlertTriangle, Check, ArrowDownToLine } from 'lucide-react';
import type { SyncResult } from '../../lib/server-api';

const TABLE_LABELS: Record<string, string> = {
  notes: 'Note',
  tasks: 'Task',
  folders: 'Investigation',
  tags: 'Tag',
  timelineEvents: 'Timeline Event',
  timelines: 'Timeline',
  whiteboards: 'Whiteboard',
  standaloneIOCs: 'IOC',
  chatThreads: 'Chat Thread',
};

function getEntityLabel(conflict: SyncResult): string {
  const tableLabel = conflict.table ? (TABLE_LABELS[conflict.table] || conflict.table) : 'Item';
  const name =
    (conflict.serverData?.title as string) ||
    (conflict.serverData?.name as string) ||
    (conflict.serverData?.content as string)?.slice(0, 40) ||
    conflict.entityId.slice(0, 8);
  return `${tableLabel}: ${name}`;
}

interface ConflictDialogProps {
  conflicts: SyncResult[];
  onResolve: (entityId: string, choice: 'mine' | 'theirs') => void;
  onResolveAll: (choice: 'mine' | 'theirs') => void;
  onClose: () => void;
}

export function ConflictDialog({ conflicts, onResolve, onResolveAll, onClose }: ConflictDialogProps) {
  const overlayRef = useRef<HTMLDivElement>(null);

  const onCloseRef = useRef(onClose);
  useEffect(() => { onCloseRef.current = onClose; });

  const handleKeyDown = useCallback((e: KeyboardEvent) => {
    if (e.key === 'Escape') onCloseRef.current();
  }, []);

  useEffect(() => {
    document.addEventListener('keydown', handleKeyDown);
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', handleKeyDown);
      document.body.style.overflow = '';
    };
  }, [handleKeyDown]);

  if (conflicts.length === 0) return null;

  return (
    <div
      ref={overlayRef}
      className="fixed inset-0 z-[10000] flex items-center justify-center bg-black/60 p-4"
      onClick={(e) => { if (e.target === overlayRef.current) onClose(); }}
      role="dialog"
      aria-modal="true"
      aria-labelledby="conflict-dialog-title"
    >
      <div className="bg-gray-900 rounded-xl shadow-2xl border border-gray-700 w-full max-w-md max-h-[90vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center gap-3 p-4 border-b border-gray-700">
          <div className="w-8 h-8 rounded-lg bg-amber-500/15 flex items-center justify-center shrink-0">
            <AlertTriangle size={16} className="text-amber-400" />
          </div>
          <div className="flex-1 min-w-0">
            <h2 id="conflict-dialog-title" className="text-sm font-semibold text-gray-100">Sync Conflicts</h2>
            <p className="text-xs text-gray-500">
              {conflicts.length} {conflicts.length === 1 ? 'item has' : 'items have'} conflicting changes
            </p>
          </div>
          <button
            onClick={onClose}
            className="p-1 rounded-lg hover:bg-gray-700 text-gray-400 hover:text-gray-200 transition-colors"
            aria-label="Close"
          >
            <X size={20} />
          </button>
        </div>

        {/* Bulk actions */}
        <div className="flex gap-2 px-4 py-3 border-b border-gray-700">
          <button
            onClick={() => onResolveAll('mine')}
            className="flex-1 flex items-center justify-center gap-1.5 px-3 py-2 text-xs font-medium rounded-lg bg-accent hover:bg-accent-hover text-white transition-colors"
          >
            <Check size={14} /> Keep All Mine
          </button>
          <button
            onClick={() => onResolveAll('theirs')}
            className="flex-1 flex items-center justify-center gap-1.5 px-3 py-2 text-xs font-medium rounded-lg bg-gray-700 hover:bg-gray-600 text-gray-200 transition-colors"
          >
            <ArrowDownToLine size={14} /> Accept All Theirs
          </button>
        </div>

        {/* Conflict list */}
        <div className="overflow-y-auto flex-1">
          {conflicts.map((conflict) => (
            <div
              key={conflict.entityId}
              className="px-4 py-3 border-b border-gray-800 last:border-b-0 hover:bg-gray-800/50 transition-colors"
            >
              <div className="text-sm font-medium text-gray-100 mb-0.5 truncate">
                {getEntityLabel(conflict)}
              </div>
              {conflict.serverVersion && (
                <div className="text-[11px] text-gray-500 mb-2">
                  Server version: v{conflict.serverVersion}
                </div>
              )}
              <div className="flex gap-2">
                <button
                  onClick={() => onResolve(conflict.entityId, 'mine')}
                  className="px-3 py-1.5 text-xs font-medium rounded-lg bg-accent/15 text-accent hover:bg-accent/25 transition-colors"
                >
                  Keep Mine
                </button>
                <button
                  onClick={() => onResolve(conflict.entityId, 'theirs')}
                  className="px-3 py-1.5 text-xs font-medium rounded-lg bg-gray-700 text-gray-300 hover:bg-gray-600 transition-colors"
                >
                  Use Theirs
                </button>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
