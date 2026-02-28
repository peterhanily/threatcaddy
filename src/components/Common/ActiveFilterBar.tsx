import { Briefcase, Tag, FileText, ListChecks, Clock, PenTool, Search } from 'lucide-react';
import type { InvestigationStatus, ViewMode } from '../../types';
import { cn } from '../../lib/utils';

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
  activeView?: ViewMode;
  onViewChange?: (view: ViewMode) => void;
  entityCounts?: { notes: number; tasks: number; events: number; whiteboards: number; iocs: number } | null;
  onEditFolder?: () => void;
}

function EntityChip({ icon, count, active, onClick, title }: {
  icon: React.ReactNode;
  count: number;
  active: boolean;
  onClick: () => void;
  title: string;
}) {
  return (
    <button onClick={onClick} title={title} className={cn(
      'flex items-center gap-1 px-1.5 py-0.5 rounded text-[11px] font-medium transition-colors',
      active ? 'bg-accent/20 text-accent' : 'bg-gray-800/60 text-gray-400 hover:text-gray-200 hover:bg-gray-700'
    )}>
      {icon}
      <span className="tabular-nums">{count}</span>
    </button>
  );
}

export function ActiveFilterBar({ folderName, folderColor, folderStatus, tagName, tagColor, onClear, activeView, onViewChange, entityCounts, onEditFolder }: ActiveFilterBarProps) {
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
          {statusLabels[folderStatus]}
        </span>
      )}
      {entityCounts && onViewChange && (
        <div className="flex items-center gap-1 ml-1 flex-wrap">
          <EntityChip
            icon={<FileText size={11} />}
            count={entityCounts.notes}
            active={activeView === 'notes'}
            onClick={() => onViewChange('notes')}
            title="Notes"
          />
          <EntityChip
            icon={<ListChecks size={11} />}
            count={entityCounts.tasks}
            active={activeView === 'tasks'}
            onClick={() => onViewChange('tasks')}
            title="Tasks"
          />
          <EntityChip
            icon={<Clock size={11} />}
            count={entityCounts.events}
            active={activeView === 'timeline'}
            onClick={() => onViewChange('timeline')}
            title="Events"
          />
          <EntityChip
            icon={<PenTool size={11} />}
            count={entityCounts.whiteboards}
            active={activeView === 'whiteboard'}
            onClick={() => onViewChange('whiteboard')}
            title="Boards"
          />
          <EntityChip
            icon={<Search size={11} />}
            count={entityCounts.iocs}
            active={activeView === 'ioc-stats'}
            onClick={() => onViewChange('ioc-stats')}
            title="IOCs"
          />
        </div>
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
