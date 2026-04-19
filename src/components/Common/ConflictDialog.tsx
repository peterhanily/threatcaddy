import { useState, useCallback } from 'react';
import { AlertTriangle, ChevronDown, ChevronUp, Check, ArrowDownToLine, Eye, EyeOff, X } from 'lucide-react';
import type { SyncResult } from '../../lib/server-api';
import { computeFieldDiffs } from '../../lib/inline-diff';
import { FieldDiffView } from './InlineDiffView';

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

/**
 * Redesigned conflict notification — inline bar at top of screen with
 * per-entity field-level diffs. No modal overlay; compact and non-intrusive.
 * Auto-expands when there are few conflicts, stays collapsed for bulk.
 */
export function ConflictDialog({ conflicts, onResolve, onResolveAll, onClose }: ConflictDialogProps) {
  const [expanded, setExpanded] = useState(conflicts.length <= 3);
  const [resolvedIds, setResolvedIds] = useState<Set<string>>(new Set());
  const [diffOpenIds, setDiffOpenIds] = useState<Set<string>>(new Set());

  const handleResolve = useCallback((entityId: string, choice: 'mine' | 'theirs') => {
    onResolve(entityId, choice);
    setResolvedIds(prev => new Set(prev).add(entityId));
    setDiffOpenIds(prev => { const next = new Set(prev); next.delete(entityId); return next; });
  }, [onResolve]);

  const toggleDiff = useCallback((entityId: string) => {
    setDiffOpenIds(prev => {
      const next = new Set(prev);
      if (next.has(entityId)) next.delete(entityId);
      else next.add(entityId);
      return next;
    });
  }, []);

  const unresolvedConflicts = conflicts.filter(c => !resolvedIds.has(c.entityId));

  // Auto-close when all resolved
  if (unresolvedConflicts.length === 0 && resolvedIds.size > 0) {
    // Use setTimeout to avoid setState during render
    setTimeout(() => onClose(), 600);
  }

  if (conflicts.length === 0) return null;

  return (
    <div className="fixed top-0 left-0 right-0 z-[9999] pointer-events-none">
      <div className="max-w-3xl mx-auto px-4 pt-2 pointer-events-auto">
        <div className="bg-amber-950/90 backdrop-blur-sm border border-amber-700/50 rounded-lg shadow-lg overflow-hidden">
          {/* Summary bar */}
          <div className="flex items-center gap-3 px-4 py-2">
            <AlertTriangle size={14} className="text-amber-400 shrink-0" />
            <span className="text-xs text-amber-200 flex-1">
              {unresolvedConflicts.length === 0
                ? 'All conflicts resolved'
                : `${unresolvedConflicts.length} sync ${unresolvedConflicts.length === 1 ? 'conflict' : 'conflicts'}`}
              {resolvedIds.size > 0 && unresolvedConflicts.length > 0 && (
                <span className="text-amber-400/50 ms-1">({resolvedIds.size} resolved)</span>
              )}
            </span>
            <div className="flex items-center gap-1">
              {unresolvedConflicts.length > 1 && (
                <>
                  <button
                    onClick={() => onResolveAll('mine')}
                    className="flex items-center gap-1 px-2 py-0.5 text-[11px] font-medium rounded bg-blue-600/30 text-blue-200 hover:bg-blue-600/50 transition-colors"
                  >
                    <Check size={10} /> All Mine
                  </button>
                  <button
                    onClick={() => onResolveAll('theirs')}
                    className="flex items-center gap-1 px-2 py-0.5 text-[11px] font-medium rounded bg-gray-600/30 text-gray-300 hover:bg-gray-600/50 transition-colors"
                  >
                    <ArrowDownToLine size={10} /> All Theirs
                  </button>
                </>
              )}
              <button
                onClick={() => setExpanded(!expanded)}
                className="p-1 rounded hover:bg-amber-600/30 text-amber-300 transition-colors"
                title={expanded ? 'Collapse' : 'Expand details'}
              >
                {expanded ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
              </button>
              <button
                onClick={onClose}
                className="p-0.5 rounded hover:bg-amber-600/30 text-amber-400/40 hover:text-amber-300 transition-colors"
                title="Dismiss"
              >
                <X size={11} />
              </button>
            </div>
          </div>

          {/* Expanded conflict list with inline field diffs */}
          {expanded && (
            <div className="border-t border-amber-700/30 max-h-[50vh] overflow-y-auto">
              {conflicts.map((conflict) => {
                const resolved = resolvedIds.has(conflict.entityId);
                const diffOpen = diffOpenIds.has(conflict.entityId);
                const fieldDiffs = conflict.serverData
                  ? computeFieldDiffs({}, conflict.serverData)
                  : [];
                const hasDiffs = fieldDiffs.length > 0;

                return (
                  <div
                    key={conflict.entityId}
                    className={`border-b border-amber-900/40 last:border-b-0 transition-opacity ${
                      resolved ? 'opacity-30' : ''
                    }`}
                  >
                    <div className="flex items-center gap-2 px-4 py-1.5">
                      <div className={`w-1.5 h-1.5 rounded-full shrink-0 ${resolved ? 'bg-green-400' : 'bg-amber-400'}`} />
                      <span className="text-xs text-amber-100 truncate flex-1">{getEntityLabel(conflict)}</span>
                      {!resolved && (
                        <div className="flex gap-1 shrink-0">
                          {hasDiffs && (
                            <button
                              onClick={() => toggleDiff(conflict.entityId)}
                              className="flex items-center gap-1 px-1.5 py-0.5 text-[10px] font-medium rounded bg-amber-600/20 text-amber-200 hover:bg-amber-600/40 transition-colors"
                            >
                              {diffOpen ? <EyeOff size={9} /> : <Eye size={9} />}
                              {diffOpen ? 'Hide' : 'Diff'}
                            </button>
                          )}
                          <button
                            onClick={() => handleResolve(conflict.entityId, 'mine')}
                            className="flex items-center gap-1 px-1.5 py-0.5 text-[10px] font-medium rounded bg-blue-600/30 text-blue-200 hover:bg-blue-600/50 transition-colors"
                          >
                            <Check size={9} /> Mine
                          </button>
                          <button
                            onClick={() => handleResolve(conflict.entityId, 'theirs')}
                            className="flex items-center gap-1 px-1.5 py-0.5 text-[10px] font-medium rounded bg-gray-600/30 text-gray-300 hover:bg-gray-600/50 transition-colors"
                          >
                            <ArrowDownToLine size={9} /> Theirs
                          </button>
                        </div>
                      )}
                      {resolved && (
                        <span className="text-[10px] text-green-400 shrink-0">Resolved</span>
                      )}
                    </div>
                    {/* Inline field diff */}
                    {diffOpen && !resolved && hasDiffs && (
                      <div className="px-4 pb-2">
                        <FieldDiffView diffs={fieldDiffs} />
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
