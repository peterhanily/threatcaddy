import { useState, useRef, useEffect } from 'react';
import { Copy, Check, ChevronDown, ChevronRight, X, RotateCcw } from 'lucide-react';
import type { IOCEntry, ConfidenceLevel } from '../../types';
import { CONFIDENCE_LEVELS } from '../../types';
import { AttributionComboInput } from './AttributionComboInput';
import { cn } from '../../lib/utils';

interface IOCItemProps {
  ioc: IOCEntry;
  onUpdate: (id: string, updates: Partial<IOCEntry>) => void;
  onDismiss: (id: string) => void;
  onRestore: (id: string) => void;
  attributionActors?: string[];
}

export function IOCItem({ ioc, onUpdate, onDismiss, onRestore, attributionActors = [] }: IOCItemProps) {
  const [copied, setCopied] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const copyTimer = useRef<ReturnType<typeof setTimeout>>(undefined);

  useEffect(() => () => clearTimeout(copyTimer.current), []);

  const handleCopy = async () => {
    await navigator.clipboard.writeText(ioc.value);
    setCopied(true);
    clearTimeout(copyTimer.current);
    copyTimer.current = setTimeout(() => setCopied(false), 1500);
  };

  const confidenceColor = CONFIDENCE_LEVELS[ioc.confidence].color;

  return (
    <div className={cn('border border-gray-800 rounded-lg', ioc.dismissed && 'opacity-50')}>
      <div className="flex items-center gap-2 px-2 py-1.5">
        <button
          onClick={() => setExpanded(!expanded)}
          className="text-gray-500 hover:text-gray-300 shrink-0"
          aria-label={expanded ? 'Collapse' : 'Expand'}
        >
          {expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
        </button>

        <span className="font-mono text-xs text-gray-200 truncate flex-1" title={ioc.value}>
          {ioc.value}
        </span>

        <button
          onClick={handleCopy}
          className="text-gray-500 hover:text-gray-300 shrink-0"
          title="Copy value"
          aria-label="Copy IOC value"
        >
          {copied ? <Check size={12} className="text-green-400" /> : <Copy size={12} />}
        </button>

        <select
          value={ioc.confidence}
          onChange={(e) => onUpdate(ioc.id, { confidence: e.target.value as ConfidenceLevel })}
          className="bg-gray-800 text-xs rounded px-1 py-0.5 border-0 focus:outline-none cursor-pointer"
          style={{ color: confidenceColor }}
          aria-label="Confidence level"
        >
          {(Object.entries(CONFIDENCE_LEVELS) as [ConfidenceLevel, { label: string }][]).map(([value, { label }]) => (
            <option key={value} value={value}>{label}</option>
          ))}
        </select>

        {ioc.dismissed ? (
          <button
            onClick={() => onRestore(ioc.id)}
            className="text-gray-500 hover:text-green-400 shrink-0"
            title="Restore"
            aria-label="Restore IOC"
          >
            <RotateCcw size={12} />
          </button>
        ) : (
          <button
            onClick={() => onDismiss(ioc.id)}
            className="text-gray-500 hover:text-red-400 shrink-0"
            title="Dismiss"
            aria-label="Dismiss IOC"
          >
            <X size={12} />
          </button>
        )}
      </div>

      {expanded && (
        <div className="px-3 pb-2 space-y-2 border-t border-gray-800 pt-2">
          <div>
            <label className="text-[10px] text-gray-500 uppercase tracking-wider">Analyst Notes</label>
            <textarea
              value={ioc.analystNotes || ''}
              onChange={(e) => onUpdate(ioc.id, { analystNotes: e.target.value })}
              className="w-full bg-gray-800/50 text-xs text-gray-300 rounded p-1.5 mt-0.5 focus:outline-none focus:ring-1 focus:ring-gray-600 resize-none"
              rows={2}
              placeholder="Add notes..."
            />
          </div>
          <div>
            <label className="text-[10px] text-gray-500 uppercase tracking-wider">Attribution</label>
            <AttributionComboInput
              value={ioc.attribution || ''}
              onChange={(v) => onUpdate(ioc.id, { attribution: v })}
              actors={attributionActors}
            />
          </div>
        </div>
      )}
    </div>
  );
}
