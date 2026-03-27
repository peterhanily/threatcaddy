import { FileText, ListChecks, Clock, PenTool, Shield } from 'lucide-react';
import { cn } from '../../lib/utils';

type EntityTab = 'notes' | 'tasks' | 'events' | 'whiteboards' | 'iocs';

interface ExecEntityNavProps {
  counts: Record<EntityTab, number>;
  activeTab?: EntityTab;
  onTap: (tab: EntityTab) => void;
}

const TABS: { key: EntityTab; icon: typeof FileText; color: string; activeColor: string }[] = [
  { key: 'notes', icon: FileText, color: 'text-text-muted', activeColor: 'text-accent-blue' },
  { key: 'tasks', icon: ListChecks, color: 'text-text-muted', activeColor: 'text-accent-amber' },
  { key: 'events', icon: Clock, color: 'text-text-muted', activeColor: 'text-accent-green' },
  { key: 'whiteboards', icon: PenTool, color: 'text-text-muted', activeColor: 'text-accent-pink' },
  { key: 'iocs', icon: Shield, color: 'text-text-muted', activeColor: 'text-red-400' },
];

export function ExecEntityNav({ counts, activeTab, onTap }: ExecEntityNavProps) {
  return (
    <div className="flex items-center justify-around bg-bg-surface border-b border-border-subtle py-1.5 shrink-0">
      {TABS.map((tab) => {
        const isActive = activeTab === tab.key;
        return (
          <button
            key={tab.key}
            onClick={() => onTap(tab.key)}
            className={cn(
              'flex flex-col items-center gap-0.5 px-2 py-1 rounded-lg transition-colors min-w-[48px]',
              isActive ? 'bg-bg-hover' : 'active:bg-bg-hover',
            )}
          >
            <tab.icon size={14} className={isActive ? tab.activeColor : tab.color} />
            <span className={cn('text-[10px] font-bold', isActive ? tab.activeColor : 'text-text-primary')}>
              {counts[tab.key]}
            </span>
          </button>
        );
      })}
    </div>
  );
}
