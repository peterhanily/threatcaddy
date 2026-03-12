import { useMemo } from 'react';
import { computeEnrichmentLabels } from '../../lib/enrichment-labels';

interface EnrichmentLabelsProps {
  enrichment: Record<string, Array<Record<string, unknown>>> | undefined;
  maxVisible?: number;
  compact?: boolean;
}

export function EnrichmentLabels({ enrichment, maxVisible, compact }: EnrichmentLabelsProps) {
  const labels = useMemo(() => computeEnrichmentLabels(enrichment), [enrichment]);

  if (labels.length === 0) {
    return <span className="text-gray-600">--</span>;
  }

  const visible = maxVisible ? labels.slice(0, maxVisible) : labels;
  const remaining = maxVisible ? labels.length - maxVisible : 0;

  return (
    <div className={`flex ${compact ? 'gap-0.5' : 'gap-1'} flex-wrap ${compact ? 'max-w-[180px]' : ''}`}>
      {visible.map((label, i) => (
        <span
          key={i}
          className="text-[10px] px-1.5 py-0.5 rounded whitespace-nowrap"
          style={{ backgroundColor: label.color + '22', color: label.color }}
          title={label.tooltip}
        >
          {label.text}
        </span>
      ))}
      {remaining > 0 && (
        <span className="text-[9px] text-gray-600">+{remaining}</span>
      )}
    </div>
  );
}
