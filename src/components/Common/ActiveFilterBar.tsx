import { Briefcase, Tag } from 'lucide-react';
import type { InvestigationStatus } from '../../types';

const statusLabels: Record<InvestigationStatus, string> = {
  active: 'Active',
  closed: 'Closed',
  archived: 'Archived',
};

const statusColors: Record<InvestigationStatus, string> = {
  active: 'bg-green-500/20 text-green-400',
  closed: 'bg-gray-500/20 text-gray-400',
  archived: 'bg-yellow-500/20 text-yellow-400',
};

interface ActiveFilterBarProps {
  folderName?: string;
  folderColor?: string;
  folderStatus?: InvestigationStatus;
  tagName?: string;
  tagColor?: string;
  onClear: () => void;
}

export function ActiveFilterBar({ folderName, folderColor, folderStatus, tagName, tagColor, onClear }: ActiveFilterBarProps) {
  if (!folderName && !tagName) return null;

  const accentColor = folderColor || tagColor || '#6366f1';

  return (
    <div
      className="flex items-center gap-2 px-3 py-1.5 border-b border-gray-800 text-sm shrink-0"
      style={{
        borderLeftWidth: '3px',
        borderLeftColor: accentColor,
        backgroundColor: `color-mix(in srgb, ${accentColor} 8%, transparent)`,
      }}
    >
      <span className="text-gray-500 text-xs font-medium">Viewing:</span>
      {folderName && (
        <span className="flex items-center gap-1.5">
          <Briefcase size={14} style={{ color: folderColor }} />
          <span className="text-gray-200 font-medium">{folderName}</span>
        </span>
      )}
      {tagName && (
        <span className="flex items-center gap-1.5">
          <Tag size={14} style={{ color: tagColor }} />
          <span className="text-gray-200 font-medium">#{tagName}</span>
        </span>
      )}
      {folderStatus && (
        <span className={`px-1.5 py-0.5 rounded text-[10px] font-medium ${statusColors[folderStatus]}`}>
          {statusLabels[folderStatus]}
        </span>
      )}
      <button
        onClick={onClear}
        className="ml-auto px-2 py-0.5 rounded text-xs text-gray-400 hover:text-gray-200 hover:bg-gray-700 transition-colors"
        aria-label="Show all"
        title="Show all"
      >
        Show All
      </button>
    </div>
  );
}
