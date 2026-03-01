import { useMemo, useState } from 'react';
import { FolderOpen, ListChecks, Shield, Clock } from 'lucide-react';
import type { Folder, Note, Task, TimelineEvent, StandaloneIOC } from '../../types';

interface ExecMetricsBarProps {
  folders: Folder[];
  allNotes: Note[];
  allTasks: Task[];
  allEvents: TimelineEvent[];
  allIOCs: StandaloneIOC[];
}

export function ExecMetricsBar({ folders, allTasks, allEvents, allIOCs }: ExecMetricsBarProps) {
  const [now] = useState(() => Date.now());

  const metrics = useMemo(() => {
    const activeInvestigations = folders.filter((f) => (f.status || 'active') === 'active').length;

    const openTasks = allTasks.filter((t) => !t.trashed && !t.archived && t.status !== 'done').length;

    const iocCount = allIOCs.filter((i) => !i.trashed && !i.archived && i.iocStatus !== 'dismissed').length;

    const weekAgo = now - 7 * 86400000;
    const eventsThisWeek = allEvents.filter((e) => !e.trashed && e.createdAt >= weekAgo).length;

    return [
      { label: 'Active Investigations', value: activeInvestigations, icon: FolderOpen, color: 'text-accent-amber', bg: 'bg-accent-amber/10' },
      { label: 'Open Tasks', value: openTasks, icon: ListChecks, color: 'text-accent-green', bg: 'bg-accent-green/10' },
      { label: 'IOCs Tracked', value: iocCount, icon: Shield, color: 'text-red-400', bg: 'bg-red-400/10' },
      { label: 'Events This Week', value: eventsThisWeek, icon: Clock, color: 'text-accent-blue', bg: 'bg-accent-blue/10' },
    ];
  }, [folders, allTasks, allEvents, allIOCs, now]);

  return (
    <div className="grid grid-cols-2 gap-3">
      {metrics.map((m) => (
        <div key={m.label} className={`${m.bg} rounded-xl p-4 min-h-[88px] flex flex-col justify-center`}>
          <m.icon size={20} className={m.color} />
          <span className={`text-3xl font-bold mt-1 ${m.color}`}>{m.value}</span>
          <span className="text-xs text-text-secondary mt-0.5">{m.label}</span>
        </div>
      ))}
    </div>
  );
}
