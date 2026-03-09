import { useState, useEffect, useRef, useCallback } from 'react';
import {
  FileText, CheckSquare, Search, Clock, Layout, MessageSquare,
  Download, CloudOff, MoreVertical, Settings, Archive, Trash2,
} from 'lucide-react';
import type { InvestigationDataMode } from '../../types';
import { formatDate, cn } from '../../lib/utils';

export interface InvestigationCardProps {
  folderId: string;
  name: string;
  status: 'active' | 'closed' | 'archived';
  color?: string;
  icon?: string;
  description?: string;
  clsLevel?: string;
  entityCounts: {
    notes: number;
    tasks: number;
    iocs: number;
    events: number;
    whiteboards: number;
    chats: number;
  };
  memberCount?: number;
  role?: 'owner' | 'editor' | 'viewer';
  dataMode: InvestigationDataMode;
  updatedAt?: string | number;
  active?: boolean;
  onOpen: (folderId: string) => void;
  onSync?: (folderId: string) => void;
  onUnsync?: (folderId: string) => void;
  onSettings?: (folderId: string) => void;
  onArchive?: (folderId: string) => void;
  onUnarchive?: (folderId: string) => void;
  onDelete?: (folderId: string) => void;
}

const STATUS_STYLES: Record<string, { dot: string; text: string }> = {
  active:   { dot: 'bg-accent-green', text: 'text-accent-green' },
  closed:   { dot: 'bg-text-muted',   text: 'text-text-muted' },
  archived: { dot: 'bg-accent-amber', text: 'text-accent-amber' },
};

const DATA_MODE_BADGE: Record<InvestigationDataMode, { label: string; classes: string }> = {
  local:  { label: 'Local',    classes: 'bg-blue-500/15 text-blue-400' },
  synced: { label: 'Synced',   classes: 'bg-green-500/15 text-green-400' },
  remote: { label: 'Remote',   classes: 'bg-amber-500/15 text-amber-400' },
};

const ENTITY_STATS = [
  { key: 'notes'       as const, label: 'Notes',   icon: FileText,      color: 'text-accent-blue',  bg: 'bg-accent-blue/10' },
  { key: 'tasks'       as const, label: 'Tasks',   icon: CheckSquare,   color: 'text-accent-amber', bg: 'bg-accent-amber/10' },
  { key: 'iocs'        as const, label: 'IOCs',    icon: Search,        color: 'text-accent-green', bg: 'bg-accent-green/10' },
  { key: 'events'      as const, label: 'Events',  icon: Clock,         color: 'text-purple',       bg: 'bg-purple/10' },
  { key: 'whiteboards' as const, label: 'Whiteboards',  icon: Layout,        color: 'text-accent-pink',  bg: 'bg-accent-pink/10' },
  { key: 'chats'       as const, label: 'Chats',   icon: MessageSquare, color: 'text-purple',       bg: 'bg-purple/10' },
];

export function InvestigationCard({
  folderId,
  name,
  status,
  color,
  icon,
  description,
  clsLevel,
  entityCounts,
  memberCount,
  role,
  dataMode,
  updatedAt,
  active,
  onOpen,
  onSync,
  onUnsync,
  onSettings,
  onArchive,
  onUnarchive,
  onDelete,
}: InvestigationCardProps) {
  const sty = STATUS_STYLES[status] ?? STATUS_STYLES.active;
  const modeBadge = DATA_MODE_BADGE[dataMode];
  const statusLabel = status.charAt(0).toUpperCase() + status.slice(1);

  const formattedUpdate = updatedAt
    ? typeof updatedAt === 'number'
      ? formatDate(updatedAt)
      : formatDate(new Date(updatedAt).getTime())
    : null;

  const handleActionClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (dataMode === 'remote' && onSync) onSync(folderId);
    if (dataMode === 'synced' && onUnsync) onUnsync(folderId);
  };

  // Context menu (three-dot)
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  const closeMenu = useCallback(() => setMenuOpen(false), []);
  useEffect(() => {
    if (!menuOpen) return;
    const handler = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) closeMenu();
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [menuOpen, closeMenu]);

  const isLocal = dataMode === 'local';
  const isSynced = dataMode === 'synced';
  const isRemote = dataMode === 'remote';
  const showMenuButton = isLocal || isSynced || (isRemote && !!onSettings);

  const handleMenuItemClick = (e: React.MouseEvent, action: () => void) => {
    e.stopPropagation();
    action();
    closeMenu();
  };

  return (
    <button
      onClick={() => onOpen(folderId)}
      className={cn(
        'w-full text-left rounded-lg border transition-all duration-200 cursor-pointer',
        'hover:scale-[1.01] hover:shadow-lg',
        active
          ? 'border-purple bg-purple/5 shadow-md'
          : 'border-border-subtle bg-bg-raised hover:border-border-medium',
      )}
    >
      {/* Color strip */}
      {color && (
        <div
          className="h-1 rounded-t-lg"
          style={{ backgroundColor: color }}
        />
      )}

      <div className="p-3">
        {/* Header: name + status badge */}
        <div className="flex items-center gap-2 min-w-0">
          {icon && (
            <span className="text-base shrink-0" role="img" aria-hidden="true">
              {icon}
            </span>
          )}
          <span
            className={cn('w-2 h-2 rounded-full shrink-0', sty.dot)}
            style={status === 'active' ? { animation: 'status-pulse 2s ease-in-out infinite' } : undefined}
          />
          <span className="text-sm font-semibold text-text-primary truncate flex-1">
            {name}
          </span>
          <span className={cn('text-[10px] font-medium uppercase tracking-wide shrink-0', sty.text)}>
            {statusLabel}
          </span>

          {/* Context menu */}
          {showMenuButton && (
            <div ref={menuRef} className="relative shrink-0">
              <span
                role="button"
                tabIndex={0}
                onClick={(e) => { e.stopPropagation(); setMenuOpen((v) => !v); }}
                onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); e.stopPropagation(); setMenuOpen((v) => !v); } }}
                className="p-0.5 rounded hover:bg-bg-deep transition-colors text-text-muted hover:text-text-secondary"
                title="Actions"
              >
                <MoreVertical size={14} />
              </span>
              {menuOpen && (
                <div className="absolute right-0 top-full mt-1 z-50 w-40 rounded-lg border border-border-subtle bg-bg-raised shadow-xl py-1">
                  {onSettings && (
                    <button
                      onClick={(e) => handleMenuItemClick(e, () => onSettings(folderId))}
                      className="flex items-center gap-2 w-full px-3 py-1.5 text-xs text-text-secondary hover:bg-bg-deep hover:text-text-primary transition-colors"
                    >
                      <Settings size={12} />
                      Settings
                    </button>
                  )}
                  {(isLocal || isSynced) && status !== 'archived' && onArchive && (
                    <button
                      onClick={(e) => handleMenuItemClick(e, () => onArchive(folderId))}
                      className="flex items-center gap-2 w-full px-3 py-1.5 text-xs text-text-secondary hover:bg-bg-deep hover:text-text-primary transition-colors"
                    >
                      <Archive size={12} />
                      Archive
                    </button>
                  )}
                  {(isLocal || isSynced) && status === 'archived' && onUnarchive && (
                    <button
                      onClick={(e) => handleMenuItemClick(e, () => onUnarchive(folderId))}
                      className="flex items-center gap-2 w-full px-3 py-1.5 text-xs text-text-secondary hover:bg-bg-deep hover:text-text-primary transition-colors"
                    >
                      <Archive size={12} />
                      Unarchive
                    </button>
                  )}
                  {(isLocal || isSynced) && onDelete && (
                    <button
                      onClick={(e) => handleMenuItemClick(e, () => onDelete(folderId))}
                      className="flex items-center gap-2 w-full px-3 py-1.5 text-xs text-red-400 hover:bg-red-500/10 transition-colors"
                    >
                      <Trash2 size={12} />
                      Delete
                    </button>
                  )}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Description */}
        {description && (
          <p className="text-xs text-text-secondary mt-1.5 line-clamp-2 ml-0.5">
            {description}
          </p>
        )}

        {/* CLS level */}
        {clsLevel && (
          <span className="inline-block mt-1.5 text-[10px] font-mono px-1.5 py-0.5 rounded bg-red-500/10 text-red-400">
            {clsLevel}
          </span>
        )}

        {/* Entity counts 2x3 grid */}
        <div className="grid grid-cols-3 gap-1 mt-2.5">
          {ENTITY_STATS.map((s) => {
            const Icon = s.icon;
            const val = entityCounts[s.key];
            return (
              <div
                key={s.key}
                className={cn(
                  'flex flex-col items-center rounded-md py-1.5',
                  val > 0 ? s.bg : 'bg-bg-deep/50',
                )}
              >
                <Icon size={12} className={val > 0 ? s.color : 'text-text-muted'} />
                <span className={cn('text-sm font-bold mt-0.5', val > 0 ? s.color : 'text-text-muted')}>
                  {val}
                </span>
                <span className="text-[8px] font-medium text-text-muted uppercase tracking-wide mt-0.5">
                  {s.label}
                </span>
              </div>
            );
          })}
        </div>

        {/* Bottom row: data mode + role + updated + action */}
        <div className="flex items-center gap-2 mt-2.5 flex-wrap">
          {/* Data mode badge */}
          <span className={cn('text-[10px] font-medium px-1.5 py-0.5 rounded', modeBadge.classes)}>
            {modeBadge.label}{dataMode === 'synced' ? ' \u2195' : ''}
          </span>

          {/* Role badge */}
          {role && (
            <span className="text-[10px] font-medium px-1.5 py-0.5 rounded bg-bg-deep text-text-secondary">
              {role.charAt(0).toUpperCase() + role.slice(1)}
            </span>
          )}

          {/* Member count */}
          {memberCount != null && memberCount > 0 && (
            <span className="text-[10px] font-mono text-text-muted">
              {memberCount} member{memberCount !== 1 ? 's' : ''}
            </span>
          )}

          <span className="flex-1" />

          {/* Updated timestamp */}
          {formattedUpdate && (
            <span className="text-[10px] font-mono text-text-muted shrink-0">
              {formattedUpdate}
            </span>
          )}

          {/* Action button */}
          {dataMode === 'remote' && onSync && (
            <span
              role="button"
              tabIndex={0}
              onClick={handleActionClick}
              onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); handleActionClick(e as unknown as React.MouseEvent); } }}
              className="flex items-center gap-1 text-[10px] font-medium px-1.5 py-0.5 rounded bg-blue-500/15 text-blue-400 hover:bg-blue-500/25 transition-colors shrink-0"
              title="Sync locally"
            >
              <Download size={10} />
              Sync
            </span>
          )}
          {dataMode === 'synced' && onUnsync && (
            <span
              role="button"
              tabIndex={0}
              onClick={handleActionClick}
              onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); handleActionClick(e as unknown as React.MouseEvent); } }}
              className="flex items-center gap-1 text-[10px] font-medium px-1.5 py-0.5 rounded bg-text-muted/15 text-text-secondary hover:bg-text-muted/25 transition-colors shrink-0"
              title="Remove local copy"
            >
              <CloudOff size={10} />
              Unsync
            </span>
          )}
        </div>
      </div>
    </button>
  );
}
