import React from 'react';
import { FileText, Archive, RotateCcw, X, Info, Cloud } from 'lucide-react';
import type { Folder } from '../../types';
import { cn, formatDate } from '../../lib/utils';

/* ─── NavItem: flat nav item with accent glow bar ─── */
export const NavItem = React.memo(function NavItem({
  icon,
  label,
  badge,
  badgeColor,
  active,
  onClick,
  onDoubleClick,
  actions,
  compact,
}: {
  icon: React.ReactNode;
  label: string;
  badge?: number;
  badgeColor?: string;
  active?: boolean;
  onClick: () => void;
  onDoubleClick?: () => void;
  actions?: React.ReactNode;
  compact?: boolean;
}) {
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onClick}
      onDoubleClick={onDoubleClick}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onClick(); } }}
      className={cn(
        'flex items-center w-full rounded-lg transition-colors group cursor-pointer relative',
        compact ? 'gap-1.5 px-2 py-0.5 text-xs' : 'gap-2 px-3 py-1.5 text-[13px] font-medium',
        active
          ? 'bg-bg-active text-text-primary'
          : 'text-text-secondary hover:bg-bg-hover hover:text-text-primary'
      )}
    >
      {active && (
        <span
          className="absolute left-0 top-1/2 -translate-y-1/2 w-[3px] h-4 rounded-r-full bg-purple"
          style={{ boxShadow: '0 0 8px 1px var(--color-purple)' }}
        />
      )}
      {icon}
      <span className="truncate flex-1 text-left">{label}</span>
      {badge !== undefined && badge > 0 && (
        <span className={cn(
          'font-mono text-[10px] px-1.5 py-0 rounded-full',
          badgeColor || 'bg-bg-raised text-text-muted'
        )}>
          {badge > 999 ? '999+' : badge}
        </span>
      )}
      {actions}
    </div>
  );
});

/* ─── InvestigationListItem: compact item for the investigations dropdown ─── */
export const InvestigationListItem = React.memo(function InvestigationListItem({
  folder,
  active,
  synced,
  onClick,
  onDoubleClick,
  onInfo,
  onArchive,
  onUnarchive,
  onDelete,
}: {
  folder: Folder;
  active?: boolean;
  synced?: boolean;
  onClick: () => void;
  onDoubleClick?: () => void;
  onInfo?: () => void;
  onArchive?: () => void;
  onUnarchive?: () => void;
  onDelete: () => void;
}) {
  const status = folder.status || 'active';
  const statusColor = status === 'active'
    ? 'bg-accent-green'
    : status === 'archived'
      ? 'bg-accent-amber'
      : 'bg-text-muted';

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onClick}
      onDoubleClick={onDoubleClick}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onClick(); } }}
      className={cn(
        'flex items-center gap-2 w-full rounded-lg px-2 py-1 cursor-pointer transition-colors group',
        active
          ? 'bg-bg-active text-text-primary'
          : 'text-text-secondary hover:bg-bg-hover hover:text-text-primary'
      )}
    >
      <span className={cn('w-1.5 h-1.5 rounded-full shrink-0', statusColor)} />
      <span className="truncate flex-1 text-left text-[12px]">{folder.name}</span>
      {synced && (
        <span title="Synced with team server">
          <Cloud size={10} className="shrink-0 text-purple/60" />
        </span>
      )}
      <span className="font-mono text-[10px] text-text-muted shrink-0">
        {formatDate(folder.createdAt)}
      </span>
      <span className="flex items-center gap-px shrink-0">
        {onInfo && (
          <button
            onClick={(e) => { e.stopPropagation(); onInfo(); }}
            className="opacity-0 group-hover:opacity-100 p-px rounded hover:bg-bg-hover text-text-muted hover:text-text-primary transition-all"
            aria-label={`Edit investigation ${folder.name}`}
            title="Edit investigation"
          >
            <Info size={10} />
          </button>
        )}
        {onArchive && (
          <button
            onClick={(e) => { e.stopPropagation(); onArchive(); }}
            className="opacity-0 group-hover:opacity-100 p-px rounded hover:bg-bg-hover text-text-muted hover:text-amber-400 transition-all"
            aria-label={`Archive investigation ${folder.name}`}
            title="Archive investigation"
          >
            <Archive size={10} />
          </button>
        )}
        {onUnarchive && (
          <button
            onClick={(e) => { e.stopPropagation(); onUnarchive(); }}
            className="opacity-0 group-hover:opacity-100 p-px rounded hover:bg-bg-hover text-text-muted hover:text-green-400 transition-all"
            aria-label={`Unarchive investigation ${folder.name}`}
            title="Unarchive investigation"
          >
            <RotateCcw size={10} />
          </button>
        )}
        <button
          onClick={(e) => { e.stopPropagation(); onDelete(); }}
          className="opacity-0 group-hover:opacity-100 p-px rounded hover:bg-bg-hover text-text-muted hover:text-red-400 transition-all"
          aria-label={`Delete investigation ${folder.name}`}
          title="Delete investigation"
        >
          <X size={10} />
        </button>
      </span>
    </div>
  );
});

/* ─── CollapsedIcon: icon button for collapsed sidebar rail ─── */
export const CollapsedIcon = React.memo(function CollapsedIcon({
  icon: Icon,
  label,
  active,
  badge,
  onClick,
  dataTour,
}: {
  icon: typeof FileText;
  label: string;
  active?: boolean;
  badge?: number;
  onClick: () => void;
  dataTour?: string;
}) {
  return (
    <div className="group relative" {...(dataTour ? { 'data-tour': dataTour } : {})}>
      <button
        onClick={onClick}
        className={cn(
          'w-9 h-9 flex items-center justify-center rounded-lg transition-colors relative',
          active
            ? 'bg-bg-active text-purple'
            : 'text-text-secondary hover:bg-bg-hover hover:text-text-primary'
        )}
        aria-label={label}
      >
        {active && (
          <span
            className="absolute left-0 top-1/2 -translate-y-1/2 w-[3px] h-4 rounded-r-full bg-purple"
            style={{ boxShadow: '0 0 8px 1px var(--color-purple)' }}
          />
        )}
        <Icon size={18} />
        {badge !== undefined && badge > 0 && (
          <span className="absolute -top-0.5 -right-0.5 min-w-[16px] h-4 rounded-full bg-purple/80 text-[9px] font-medium text-white flex items-center justify-center px-1 leading-none">
            {badge > 999 ? '999+' : badge}
          </span>
        )}
      </button>
      <div className="pointer-events-none absolute left-full top-1/2 -translate-y-1/2 ml-2 px-2 py-1 rounded bg-bg-raised border border-border-medium text-xs text-text-primary whitespace-nowrap opacity-0 group-hover:opacity-100 transition-opacity z-50 shadow-lg">
        {label}
      </div>
    </div>
  );
});
