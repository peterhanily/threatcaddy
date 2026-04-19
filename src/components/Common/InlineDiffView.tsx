import { useMemo } from 'react';
import { computeDiff } from '../../lib/inline-diff';
import type { DiffSegment, FieldDiff } from '../../lib/inline-diff';

interface InlineDiffViewProps {
  localText: string;
  remoteText: string;
  maxHeight?: string;
}

/**
 * Renders an inline character-level diff between local and remote text.
 * Deletions (local text that would be lost) shown in red, insertions (remote additions) in green.
 */
export function InlineDiffView({ localText, remoteText, maxHeight = '200px' }: InlineDiffViewProps) {
  const segments = useMemo(() => computeDiff(localText, remoteText), [localText, remoteText]);

  return (
    <div
      className="overflow-auto rounded bg-gray-950/60 border border-gray-700/50 p-3 text-sm font-mono whitespace-pre-wrap leading-relaxed"
      style={{ maxHeight }}
    >
      {segments.map((seg, i) => (
        <DiffSpan key={i} segment={seg} />
      ))}
    </div>
  );
}

function DiffSpan({ segment }: { segment: DiffSegment }) {
  if (segment.type === 'equal') {
    return <span className="text-gray-400">{segment.text}</span>;
  }
  if (segment.type === 'delete') {
    return (
      <span className="bg-red-900/40 text-red-300 line-through decoration-red-500/50">
        {segment.text}
      </span>
    );
  }
  // insert
  return (
    <span className="bg-green-900/40 text-green-300">
      {segment.text}
    </span>
  );
}

interface FieldDiffViewProps {
  diffs: FieldDiff[];
}

/**
 * Renders field-level diffs for structured entities (tasks, IOCs, etc).
 */
export function FieldDiffView({ diffs }: FieldDiffViewProps) {
  if (diffs.length === 0) return null;

  return (
    <div className="space-y-1.5 text-sm">
      {diffs.map((d) => (
        <div key={d.field} className="flex items-baseline gap-2 text-xs">
          <span className="text-gray-500 font-medium shrink-0 w-20 text-end">{d.label}:</span>
          <span className="bg-red-900/30 text-red-300 line-through px-1 rounded truncate max-w-[40%]">
            {d.oldValue || '(empty)'}
          </span>
          <span className="text-gray-600">&rarr;</span>
          <span className="bg-green-900/30 text-green-300 px-1 rounded truncate max-w-[40%]">
            {d.newValue || '(empty)'}
          </span>
        </div>
      ))}
    </div>
  );
}
