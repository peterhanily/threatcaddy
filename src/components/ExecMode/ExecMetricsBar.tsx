import { useMemo, useState } from 'react';
import { FileText, ListChecks, Shield, Clock, MessageSquare, GitFork } from 'lucide-react';
import type { Note, Task, TimelineEvent, StandaloneIOC, ChatThread } from '../../types';

interface ExecMetricsBarProps {
  allNotes: Note[];
  allTasks: Task[];
  allEvents: TimelineEvent[];
  allIOCs: StandaloneIOC[];
  allChatThreads: ChatThread[];
  onTapNotes?: () => void;
  onTapTasks?: () => void;
  onTapIOCs?: () => void;
  onTapEvents?: () => void;
  onTapChats?: () => void;
  onTapGraph?: () => void;
}

export function ExecMetricsBar({ allNotes, allTasks, allEvents, allIOCs, allChatThreads, onTapNotes, onTapTasks, onTapIOCs, onTapEvents, onTapChats, onTapGraph }: ExecMetricsBarProps) {
  const [now] = useState(() => Date.now());

  const metrics = useMemo(() => {
    const noteCount = allNotes.filter((n) => !n.trashed && !n.archived).length;
    const openTasks = allTasks.filter((t) => !t.trashed && !t.archived && t.status !== 'done').length;
    const iocCount = allIOCs.filter((i) => !i.trashed && !i.archived && i.iocStatus !== 'dismissed').length;
    const weekAgo = now - 7 * 86400000;
    const eventsThisWeek = allEvents.filter((e) => !e.trashed && e.createdAt >= weekAgo).length;
    const chatCount = allChatThreads.filter((c) => !c.trashed).length;
    const graphNodes = iocCount + noteCount;

    return [
      { key: 'notes', label: 'Notes', value: noteCount, icon: FileText, color: 'text-accent-blue', bg: 'bg-accent-blue/10', onTap: onTapNotes },
      { key: 'tasks', label: 'Open Tasks', value: openTasks, icon: ListChecks, color: 'text-accent-green', bg: 'bg-accent-green/10', onTap: onTapTasks },
      { key: 'iocs', label: 'IOCs Tracked', value: iocCount, icon: Shield, color: 'text-red-400', bg: 'bg-red-400/10', onTap: onTapIOCs },
      { key: 'events', label: 'Events This Week', value: eventsThisWeek, icon: Clock, color: 'text-accent-amber', bg: 'bg-accent-amber/10', onTap: onTapEvents },
      { key: 'chats', label: 'AI Chats', value: chatCount, icon: MessageSquare, color: 'text-purple-400', bg: 'bg-purple-400/10', onTap: onTapChats },
      { key: 'graph', label: 'Graph Nodes', value: graphNodes, icon: GitFork, color: 'text-cyan-400', bg: 'bg-cyan-400/10', onTap: onTapGraph },
    ];
  }, [allNotes, allTasks, allEvents, allIOCs, allChatThreads, now, onTapNotes, onTapTasks, onTapIOCs, onTapEvents, onTapChats, onTapGraph]);

  return (
    <div className="grid grid-cols-3 gap-2.5">
      {metrics.map((m) => (
        <button
          key={m.key}
          onClick={m.onTap}
          className={`${m.bg} rounded-xl p-3 min-h-[80px] flex flex-col justify-center text-left active:opacity-80 transition-opacity`}
        >
          <m.icon size={18} className={m.color} />
          <span className={`text-2xl font-bold mt-1 ${m.color}`}>{m.value}</span>
          <span className="text-[10px] text-text-secondary mt-0.5 leading-tight">{m.label}</span>
        </button>
      ))}
    </div>
  );
}
