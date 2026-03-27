import { ChevronRight } from 'lucide-react';

export interface BreadcrumbSegment {
  label: string;
  onTap?: () => void;
}

interface ExecBreadcrumbProps {
  segments: BreadcrumbSegment[];
}

export function ExecBreadcrumb({ segments }: ExecBreadcrumbProps) {
  if (segments.length === 0) return null;
  return (
    <div className="flex items-center gap-1 overflow-x-auto scrollbar-hide py-1 -mx-1 px-1">
      {segments.map((seg, i) => {
        const isLast = i === segments.length - 1;
        return (
          <span key={i} className="flex items-center gap-1 shrink-0">
            {i > 0 && <ChevronRight size={12} className="text-text-muted shrink-0" />}
            {isLast ? (
              <span className="text-xs font-semibold text-text-primary max-w-[160px] truncate">{seg.label}</span>
            ) : (
              <button
                onClick={seg.onTap}
                className="text-xs text-text-muted active:text-accent transition-colors max-w-[120px] truncate"
              >
                {seg.label}
              </button>
            )}
          </span>
        );
      })}
    </div>
  );
}
