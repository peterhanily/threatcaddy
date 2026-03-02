import { useMemo } from 'react';
import { FileText, ListChecks, Clock, PenTool, FolderOpen, Tag, Shield, Cloud, Database, MessageSquare } from 'lucide-react';
import type { ActivityLogEntry, ActivityCategory } from '../../types';
import { ACTIVITY_CATEGORY_LABELS } from '../../types';
import { formatDate } from '../../lib/utils';
import { isEncryptedEnvelope } from '../../lib/crypto';

function safeText(value: unknown): string {
  if (value == null) return '';
  if (isEncryptedEnvelope(value)) return '[Encrypted]';
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}

interface ExecActivityFeedProps {
  entries: ActivityLogEntry[];
  limit?: number;
}

const CATEGORY_ICONS: Record<ActivityCategory, typeof FileText> = {
  note: FileText,
  task: ListChecks,
  timeline: Clock,
  whiteboard: PenTool,
  folder: FolderOpen,
  tag: Tag,
  ioc: Shield,
  sync: Cloud,
  data: Database,
  chat: MessageSquare,
};

function getTimePeriod(timestamp: number): string {
  const now = new Date();
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const yesterdayStart = todayStart - 86400000;
  const weekStart = todayStart - 6 * 86400000;
  if (timestamp >= todayStart) return 'Today';
  if (timestamp >= yesterdayStart) return 'Yesterday';
  if (timestamp >= weekStart) return 'This Week';
  return 'Older';
}

function groupByTimePeriod(entries: ActivityLogEntry[]): { period: string; entries: ActivityLogEntry[] }[] {
  const groups = new Map<string, ActivityLogEntry[]>();
  const order = ['Today', 'Yesterday', 'This Week', 'Older'];
  for (const entry of entries) {
    const period = getTimePeriod(entry.timestamp);
    if (!groups.has(period)) groups.set(period, []);
    const arr = groups.get(period);
    if (arr) arr.push(entry);
  }
  return order
    .filter((p) => groups.has(p))
    .map((period) => ({ period, entries: groups.get(period) ?? [] }));
}

export function ExecActivityFeed({ entries, limit = 50 }: ExecActivityFeedProps) {
  const grouped = useMemo(
    () => groupByTimePeriod(entries.slice(0, limit)),
    [entries, limit],
  );

  if (entries.length === 0) {
    return <p className="text-text-muted text-sm text-center py-8">No recent activity</p>;
  }

  return (
    <div className="flex flex-col gap-5">
      {grouped.map((group) => (
        <div key={group.period}>
          <h3 className="text-xs font-semibold text-text-muted uppercase tracking-wider mb-2.5">{group.period}</h3>
          <div className="flex flex-col gap-2">
            {group.entries.map((entry) => {
              const Icon = CATEGORY_ICONS[entry.category] ?? FileText;
              const cat = ACTIVITY_CATEGORY_LABELS[entry.category];
              return (
                <div key={entry.id} className="flex items-start gap-3 py-1.5">
                  <div
                    className="w-7 h-7 rounded-lg flex items-center justify-center shrink-0 mt-0.5"
                    style={{ backgroundColor: `${cat?.color ?? '#6b7280'}20` }}
                  >
                    <Icon size={14} style={{ color: cat?.color ?? '#6b7280' }} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm text-text-primary leading-snug">{safeText(entry.detail)}</p>
                    <p className="text-[11px] text-text-muted mt-0.5">{formatDate(entry.timestamp)}</p>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}
