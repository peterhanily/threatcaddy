import { useState, useCallback } from 'react';
import { AlertTriangle, Eye, EyeOff, Check, ArrowDownToLine, GitMerge } from 'lucide-react';
import { InlineDiffView, FieldDiffView } from './InlineDiffView';
import { computeFieldDiffs } from '../../lib/inline-diff';
import type { FieldDiff } from '../../lib/inline-diff';

export interface ConflictInfo {
  /** Entity ID that has a conflict */
  entityId: string;
  /** Table name for labeling */
  table?: string;
  /** Who made the remote change (if available from server data) */
  remoteUser?: string;
  /** Local version of the text content (for notes) */
  localContent?: string;
  /** Remote/server version of the text content (for notes) */
  remoteContent?: string;
  /** For structured entities: local data */
  localData?: Record<string, unknown>;
  /** For structured entities: server data */
  serverData?: Record<string, unknown>;
}

interface InlineConflictBannerProps {
  conflict: ConflictInfo;
  /** Accept the remote/server version */
  onAcceptTheirs: () => void;
  /** Keep the local version */
  onKeepMine: () => void;
  /** Restore local content into the editor for manual merge */
  onManualMerge?: () => void;
}

/**
 * Inline conflict banner shown at the top of an editor when a sync conflict occurs.
 * Replaces the old modal ConflictDialog with a compact, non-intrusive inline banner.
 * Stays visible until the user resolves the conflict — no auto-dismiss.
 */
export function InlineConflictBanner({
  conflict,
  onAcceptTheirs,
  onKeepMine,
  onManualMerge,
}: InlineConflictBannerProps) {
  const [showDiff, setShowDiff] = useState(false);

  const hasTextDiff = conflict.localContent != null && conflict.remoteContent != null;
  const fieldDiffs: FieldDiff[] = (conflict.localData && conflict.serverData)
    ? computeFieldDiffs(conflict.localData, conflict.serverData)
    : [];
  const hasFieldDiff = fieldDiffs.length > 0;
  const hasDiff = hasTextDiff || hasFieldDiff;

  const toggleDiff = useCallback(() => setShowDiff(v => !v), []);

  const userLabel = conflict.remoteUser || 'another user';

  return (
    <div className="shrink-0 border-b border-amber-700/30">
      {/* Compact single-line banner */}
      <div className="flex items-center gap-2 px-3 py-1.5 bg-amber-950/60">
        <AlertTriangle size={14} className="text-amber-400 shrink-0" />
        <span className="text-xs text-amber-200 flex-1 truncate">
          Edited by <span className="font-medium text-amber-100">{userLabel}</span> while you were editing
        </span>
        <div className="flex items-center gap-1 shrink-0">
          {hasDiff && (
            <button
              onClick={toggleDiff}
              className="flex items-center gap-1 px-2 py-0.5 text-[11px] font-medium rounded bg-amber-600/20 text-amber-200 hover:bg-amber-600/40 transition-colors"
              title={showDiff ? 'Hide changes' : 'View changes'}
            >
              {showDiff ? <EyeOff size={10} /> : <Eye size={10} />}
              {showDiff ? 'Hide' : 'Changes'}
            </button>
          )}
          <button
            onClick={onAcceptTheirs}
            className="flex items-center gap-1 px-2 py-0.5 text-[11px] font-medium rounded bg-gray-600/30 text-gray-300 hover:bg-gray-600/50 transition-colors"
            title="Accept the remote version"
          >
            <ArrowDownToLine size={10} /> Theirs
          </button>
          <button
            onClick={onKeepMine}
            className="flex items-center gap-1 px-2 py-0.5 text-[11px] font-medium rounded bg-blue-600/30 text-blue-200 hover:bg-blue-600/50 transition-colors"
            title="Keep your local version"
          >
            <Check size={10} /> Mine
          </button>
          {onManualMerge && (
            <button
              onClick={onManualMerge}
              className="flex items-center gap-1 px-2 py-0.5 text-[11px] font-medium rounded bg-purple-600/30 text-purple-200 hover:bg-purple-600/50 transition-colors"
              title="Manually merge both versions in the editor"
            >
              <GitMerge size={10} /> Merge
            </button>
          )}
        </div>
      </div>

      {/* Expandable diff view */}
      {showDiff && (
        <div className="px-3 py-2 bg-gray-900/50 border-t border-amber-900/30">
          <div className="flex items-center gap-3 mb-2 text-[10px] text-gray-500">
            <span className="flex items-center gap-1">
              <span className="inline-block w-2 h-2 rounded-sm bg-red-900/60" />
              Your version (removed)
            </span>
            <span className="flex items-center gap-1">
              <span className="inline-block w-2 h-2 rounded-sm bg-green-900/60" />
              Remote version (added)
            </span>
          </div>
          {hasTextDiff && (
            <InlineDiffView
              localText={conflict.localContent ?? ''}
              remoteText={conflict.remoteContent ?? ''}
              maxHeight="180px"
            />
          )}
          {hasFieldDiff && <FieldDiffView diffs={fieldDiffs} />}
        </div>
      )}
    </div>
  );
}
