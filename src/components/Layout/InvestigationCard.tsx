import { FileText, ListChecks, Clock, PenTool, Shield, Cloud } from 'lucide-react';
import type { Folder } from '../../types';
import { formatDate, cn } from '../../lib/utils';

interface InvestigationCardProps {
  folder: Folder;
  counts: { notes: number; tasks: number; events: number; whiteboards: number; iocs: number };
  onEditFolder: (id: string) => void;
  synced?: boolean;
}

export function InvestigationCard({ folder, counts, onEditFolder, synced }: InvestigationCardProps) {
  const status = folder.status || 'active';
  const statusLabel = status.charAt(0).toUpperCase() + status.slice(1);
  const statusColor = status === 'active'
    ? 'bg-accent-green'
    : status === 'archived'
      ? 'bg-accent-amber'
      : 'bg-text-muted';
  const statusTextColor = status === 'active'
    ? 'text-accent-green'
    : status === 'archived'
      ? 'text-accent-amber'
      : 'text-text-muted';

  const stats: { label: string; value: number; color: string; bgColor: string; icon: typeof FileText }[] = [
    { label: 'Notes', value: counts.notes, color: 'text-accent-blue', bgColor: 'bg-accent-blue/10', icon: FileText },
    { label: 'Tasks', value: counts.tasks, color: 'text-accent-amber', bgColor: 'bg-accent-amber/10', icon: ListChecks },
    { label: 'Events', value: counts.events, color: 'text-accent-green', bgColor: 'bg-accent-green/10', icon: Clock },
    { label: 'Whiteboards', value: counts.whiteboards, color: 'text-accent-pink', bgColor: 'bg-accent-pink/10', icon: PenTool },
    { label: 'IOCs', value: counts.iocs, color: 'text-accent-green', bgColor: 'bg-accent-green/10', icon: Shield },
  ];

  return (
    <button
      onClick={() => onEditFolder(folder.id)}
      className={cn(
        'w-full text-start bg-bg-raised border border-border-subtle rounded-lg p-3',
        'hover:border-border-medium transition-colors cursor-pointer'
      )}
    >
      {/* Name + status row */}
      <div className="flex items-center gap-2 min-w-0">
        <span
          className={cn('w-2.5 h-2.5 rounded-full shrink-0', statusColor)}
          style={status === 'active' ? { animation: 'status-pulse 2s ease-in-out infinite' } : undefined}
        />
        <span className="text-sm font-semibold text-text-primary truncate flex-1">
          {folder.name}
        </span>
        {synced && (
          <span title="Synced with team server" className="shrink-0">
            <Cloud size={14} className="text-purple/60" />
          </span>
        )}
      </div>

      {/* Meta row */}
      <div className="flex items-center gap-2 mt-1 ms-[18px]">
        <span className={cn('text-[10px] font-medium uppercase tracking-wide', statusTextColor)}>
          {statusLabel}
        </span>
        <span className="text-text-muted text-[10px]">&middot;</span>
        <span className="font-mono text-[10px] text-text-muted">
          {formatDate(folder.createdAt)}
        </span>
      </div>

      {/* Entity counts grid */}
      <div className="grid grid-cols-5 gap-1 mt-2.5">
        {stats.map((s) => {
          const Icon = s.icon;
          return (
            <div
              key={s.label}
              className={cn(
                'flex flex-col items-center rounded-md py-1.5',
                s.value > 0 ? s.bgColor : 'bg-bg-deep/50'
              )}
            >
              <Icon size={12} className={s.value > 0 ? s.color : 'text-text-muted'} />
              <span className={cn('text-sm font-bold mt-0.5', s.value > 0 ? s.color : 'text-text-muted')}>
                {s.value}
              </span>
              <span className="text-[8px] font-medium text-text-muted uppercase tracking-wide mt-0.5">
                {s.label}
              </span>
            </div>
          );
        })}
      </div>
    </button>
  );
}
