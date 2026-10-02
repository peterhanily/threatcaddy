import { useState } from 'react';
import { AlertTriangle, ChevronDown, ChevronUp, X } from 'lucide-react';
import type { SyncResult } from '../../lib/server-api';
import { computeFieldDiffs } from '../../lib/inline-diff';
import { FieldDiffView } from './InlineDiffView';

const TABLE_LABELS: Record<string, string> = {
  notes: 'Note', tasks: 'Task', folders: 'Investigation', tags: 'Tag', timelineEvents: 'Timeline Event',
  timelines: 'Timeline', whiteboards: 'Whiteboard', standaloneIOCs: 'IOC', chatThreads: 'Chat Thread', evidenceItems: 'Evidence',
};
const conflictKey = (conflict: SyncResult) => JSON.stringify([conflict.table, conflict.entityId]);
const label = (conflict: SyncResult) => (TABLE_LABELS[conflict.table ?? ''] ?? 'Item') + ': ' +
  String(conflict.localData?.title ?? conflict.serverData?.title ?? conflict.localData?.name ?? conflict.serverData?.name ?? conflict.entityId.slice(0, 8));
const LONG_VALUE_PREVIEW = 20_000;
const MAX_LONG_FIELDS = 10;
const META_FIELDS = new Set(['id', 'createdAt', 'updatedAt', 'version', 'folderId', 'syncedAt', 'trashedAt']);
function longFieldChanges(conflict: SyncResult) {
  if (!conflict.serverData) return [];
  const local = conflict.localData ?? {};
  return [...new Set([...Object.keys(local), ...Object.keys(conflict.serverData)])].filter(field => {
    if (META_FIELDS.has(field)) return false;
    const mine = local[field]; const theirs = conflict.serverData![field];
    return mine !== theirs && (typeof mine === 'string' && mine.length > 500 || typeof theirs === 'string' && theirs.length > 500);
  });
}
const textValue = (value: unknown): string => value == null ? '' : typeof value === 'string' ? value : JSON.stringify(value);
function downloadFullComparison(conflict: SyncResult) {
  const blob = new Blob([JSON.stringify({ table: conflict.table, entityId: conflict.entityId,
    local: conflict.localData ?? {}, remote: conflict.serverData ?? {} }, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url; anchor.download = 'threatcaddy-conflict-comparison.json'; anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

interface ConflictDialogProps {
  conflicts: SyncResult[];
  onResolve: (entityId: string, choice: 'mine' | 'theirs', table?: string) => void | Promise<void>;
  onResolveAll: (choice: 'mine' | 'theirs') => void | Promise<void>;
  onClose: () => void;
}

/** Resolution stays visible until its transaction succeeds. Identity includes
 * table: a note and a task may legitimately share an ID. */
export function ConflictDialog({ conflicts, onResolve, onResolveAll, onClose }: ConflictDialogProps) {
  const [expanded, setExpanded] = useState(conflicts.length <= 3);
  const [diffOpen, setDiffOpen] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const resolve = async (action: () => void | Promise<void>) => {
    setBusy(true); setError('');
    try { await action(); }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'Resolution failed; the local change was retained.'); }
    finally { setBusy(false); }
  };
  if (!conflicts.length) return null;
  const resolvable = conflicts.filter(conflict => conflict.status === 'conflict');
  return <section aria-label="Sync conflicts" className="fixed top-0 left-0 right-0 z-[9999] pointer-events-none">
    <div className="max-w-3xl mx-auto px-4 pt-2 pointer-events-auto">
      <div className="bg-amber-950/95 border border-amber-700/50 rounded-lg shadow-lg overflow-hidden">
        <div className="flex items-center gap-3 px-4 py-2">
          <AlertTriangle size={14} aria-hidden="true" className="text-amber-400 shrink-0" />
          <span className="text-xs text-amber-200 flex-1">{conflicts.length} sync changes need attention</span>
          {resolvable.length > 1 && <>
            <button disabled={busy} onClick={() => void resolve(() => onResolveAll('mine'))} className="px-2 py-1 text-xs text-blue-200">All Mine</button>
            <button disabled={busy} onClick={() => void resolve(() => onResolveAll('theirs'))} className="px-2 py-1 text-xs text-gray-200">All Theirs</button>
          </>}
          <button onClick={() => setExpanded(value => !value)} aria-expanded={expanded} aria-label={expanded ? 'Collapse conflicts' : 'Expand conflicts'} className="p-1 text-amber-200">
            {expanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
          </button>
          <button disabled={busy} onClick={onClose} aria-label="Dismiss conflict notice" className="p-1 text-amber-200"><X size={14} /></button>
        </div>
        {error && <p role="alert" className="px-4 pb-2 text-xs text-red-200">{error}</p>}
        {expanded && <div className="border-t border-amber-700/30 max-h-[50vh] overflow-y-auto">
          {conflicts.map(conflict => {
            const key = conflictKey(conflict);
            const diffs = conflict.serverData ? computeFieldDiffs(conflict.localData ?? {}, conflict.serverData) : [];
            const longFields = longFieldChanges(conflict);
            return <div key={key} className="border-b border-amber-900/40 px-4 py-2">
              <div className="flex items-center gap-2">
                <span className="text-xs text-amber-100 truncate flex-1">{label(conflict)}</span>
                {conflict.status === 'conflict' && <>
                  {(diffs.length > 0 || longFields.length > 0) && <button disabled={busy} onClick={() => setDiffOpen(diffOpen === key ? null : key)} aria-expanded={diffOpen === key} className="text-xs text-amber-200">{diffOpen === key ? 'Hide diff' : 'Diff'}</button>}
                  <button disabled={busy} onClick={() => void resolve(() => onResolve(conflict.entityId, 'mine', conflict.table))} className="px-2 py-1 text-xs text-blue-200">Mine</button>
                  <button disabled={busy} onClick={() => void resolve(() => onResolve(conflict.entityId, 'theirs', conflict.table))} className="px-2 py-1 text-xs text-gray-200">Theirs</button>
                </>}
              </div>
              {conflict.status === 'rejected' && <p className="mt-1 text-xs text-amber-200">The server rejected this change. It remains saved locally; check your permissions before retrying.</p>}
              {diffOpen === key && <div className="pt-2 space-y-3">
                <FieldDiffView diffs={diffs} />
                {longFields.slice(0, MAX_LONG_FIELDS).map(field => {
                  const mine = textValue(conflict.localData?.[field]); const theirs = textValue(conflict.serverData?.[field]);
                  return <section key={field} aria-label={`${field} comparison`} className="space-y-1 text-xs">
                    <h3 className="font-medium text-amber-100">{field}</h3>
                    <div className="grid gap-2 sm:grid-cols-2">
                      <div><h4 className="text-red-200">Local</h4><pre className="whitespace-pre-wrap break-words max-h-48 overflow-auto text-red-100">{mine.slice(0, LONG_VALUE_PREVIEW) || '(empty)'}</pre></div>
                      <div><h4 className="text-green-200">Remote</h4><pre className="whitespace-pre-wrap break-words max-h-48 overflow-auto text-green-100">{theirs.slice(0, LONG_VALUE_PREVIEW) || '(empty)'}</pre></div>
                    </div>
                    {(mine.length > LONG_VALUE_PREVIEW || theirs.length > LONG_VALUE_PREVIEW) && <p className="text-amber-200">Preview limited to the first 20,000 characters per value. Download the complete comparison before resolving changes beyond this preview.</p>}
                  </section>;
                })}
                {longFields.length > MAX_LONG_FIELDS && <p className="text-xs text-amber-200">Only the first 10 long fields are shown. Download the complete comparison to review every field.</p>}
                {longFields.length > 0 && <button disabled={busy} onClick={() => downloadFullComparison(conflict)} className="text-xs underline text-amber-200">Download complete comparison (unencrypted JSON)</button>}
              </div>}
            </div>;
          })}
        </div>}
      </div>
    </div>
  </section>;
}
