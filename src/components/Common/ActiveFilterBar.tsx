import { Briefcase, Tag } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { InvestigationStatus, PlaybookExecution } from '../../types';

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
  onEditFolder?: () => void;
  playbookExecution?: PlaybookExecution;
}

const STATUS_KEYS: Record<InvestigationStatus, string> = { active: 'hub.active', closed: 'hub.closed', archived: 'hub.archived' };

export function ActiveFilterBar({ folderName, folderColor, folderStatus, tagName, tagColor, onClear, onEditFolder, playbookExecution }: ActiveFilterBarProps) {
  const { t } = useTranslation('investigations');
  if (!folderName && !tagName) return null;

  const accentColor = folderColor || tagColor || '#6366f1';
  const pbCompleted = playbookExecution?.steps.filter(s => s.completed).length ?? 0;
  const pbTotal = playbookExecution?.steps.length ?? 0;
  const pbPct = pbTotal > 0 ? Math.round((pbCompleted / pbTotal) * 100) : 0;

  return (
    <div
      className="flex items-center gap-2 px-3 py-1 border-b border-gray-800 text-sm shrink-0"
      style={{
        borderLeftWidth: '3px',
        borderLeftColor: accentColor,
        backgroundColor: `color-mix(in srgb, ${accentColor} 8%, transparent)`,
      }}
    >
      {folderName && (
        <span className="flex items-center gap-1.5">
          <Briefcase size={14} style={{ color: folderColor }} />
          {onEditFolder ? (
            <button
              onClick={onEditFolder}
              className="text-gray-200 font-medium hover:text-accent transition-colors"
              title="View investigation details"
            >
              {folderName}
            </button>
          ) : (
            <span className="text-gray-200 font-medium">{folderName}</span>
          )}
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
          {t(STATUS_KEYS[folderStatus])}
        </span>
      )}
      {playbookExecution && pbTotal > 0 && (
        <span className="flex items-center gap-1.5 ml-1" title={`${playbookExecution.templateName}: ${pbCompleted}/${pbTotal} steps`}>
          <div className="w-16 h-1.5 bg-gray-700 rounded-full overflow-hidden">
            <div
              className="h-full rounded-full transition-all"
              style={{
                width: `${pbPct}%`,
                backgroundColor: pbPct === 100 ? '#22c55e' : '#6366f1',
              }}
            />
          </div>
          <span className="text-[10px] text-gray-500 tabular-nums">{pbCompleted}/{pbTotal}</span>
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
