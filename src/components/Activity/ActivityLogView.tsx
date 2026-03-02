import { useState, useMemo } from 'react';
import {
  Activity, FileText, ListChecks, Clock, PenTool,
  FolderOpen, Tag, Shield, Cloud, Database, Trash2, MessageSquare,
} from 'lucide-react';
import type { ActivityLogEntry, ActivityCategory } from '../../types';
import { ACTIVITY_CATEGORY_LABELS } from '../../types';
import { formatDate, formatFullDate, cn } from '../../lib/utils';
import { isEncryptedEnvelope } from '../../lib/crypto';
import { ConfirmDialog } from '../Common/ConfirmDialog';

function safeText(value: unknown): string {
  if (value == null) return '';
  if (isEncryptedEnvelope(value)) return '[Encrypted]';
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}

interface ActivityLogViewProps {
  entries: ActivityLogEntry[];
  getFiltered: (opts: { category?: ActivityCategory; search?: string }) => ActivityLogEntry[];
  onClear: () => void;
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

const ALL_CATEGORIES: ActivityCategory[] = [
  'note', 'task', 'timeline', 'whiteboard', 'folder', 'tag', 'ioc', 'sync', 'data', 'chat',
];

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
  const groups: Map<string, ActivityLogEntry[]> = new Map();
  const order = ['Today', 'Yesterday', 'This Week', 'Older'];

  for (const entry of entries) {
    const period = getTimePeriod(entry.timestamp);
    if (!groups.has(period)) groups.set(period, []);
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    groups.get(period)!.push(entry);
  }

  return order
    .filter((p) => groups.has(p))
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    .map((period) => ({ period, entries: groups.get(period)! }));
}

export function ActivityLogView({ entries, getFiltered, onClear }: ActivityLogViewProps) {
  const [search, setSearch] = useState('');
  const [selectedCategory, setSelectedCategory] = useState<ActivityCategory | undefined>();
  const [showConfirmClear, setShowConfirmClear] = useState(false);

  const filtered = useMemo(
    () => getFiltered({ category: selectedCategory, search: search || undefined }),
    [getFiltered, selectedCategory, search]
  );

  const grouped = useMemo(() => groupByTimePeriod(filtered), [filtered]);

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      {/* Header */}
      <div className="flex items-center gap-2 px-4 py-3 border-b border-gray-800 shrink-0">
        <Activity size={18} className="text-accent" />
        <span className="text-sm font-medium text-gray-200">Activity Log</span>
        <span className="text-xs text-gray-500">({filtered.length})</span>
        <div className="ml-auto">
          <button
            onClick={() => setShowConfirmClear(true)}
            disabled={entries.length === 0}
            className="flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs text-gray-400 hover:text-red-400 hover:bg-gray-800 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
          >
            <Trash2 size={12} />
            Clear
          </button>
        </div>
      </div>

      {/* Filter bar */}
      <div className="px-4 py-2 border-b border-gray-800 space-y-2 shrink-0">
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search activity..."
          className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-1.5 text-sm text-gray-200 placeholder-gray-500 focus:outline-none focus:border-accent"
        />
        <div className="flex items-center gap-1 flex-wrap">
          <button
            onClick={() => setSelectedCategory(undefined)}
            className={cn(
              'px-2 py-0.5 rounded-full text-[10px] font-medium transition-colors',
              !selectedCategory
                ? 'bg-accent/20 text-accent'
                : 'text-gray-500 hover:text-gray-300 hover:bg-gray-800'
            )}
          >
            All
          </button>
          {ALL_CATEGORIES.map((cat) => {
            const meta = ACTIVITY_CATEGORY_LABELS[cat];
            return (
              <button
                key={cat}
                onClick={() => setSelectedCategory(selectedCategory === cat ? undefined : cat)}
                className={cn(
                  'px-2 py-0.5 rounded-full text-[10px] font-medium transition-colors',
                  selectedCategory === cat
                    ? 'text-white'
                    : 'text-gray-500 hover:text-gray-300 hover:bg-gray-800'
                )}
                style={selectedCategory === cat ? { backgroundColor: meta.color + '33', color: meta.color } : undefined}
              >
                {meta.label}
              </button>
            );
          })}
        </div>
      </div>

      {/* Log entries */}
      <div className="flex-1 overflow-y-auto">
        {filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-gray-600">
            <Activity size={40} className="mb-3" />
            <p className="text-sm">No activity yet</p>
            <p className="text-xs mt-1 text-gray-700">Actions you take will appear here</p>
          </div>
        ) : (
          grouped.map((group) => (
            <div key={group.period}>
              <div className="sticky top-0 px-4 py-1.5 text-[10px] font-semibold text-gray-500 uppercase tracking-wider bg-gray-900/90 backdrop-blur-sm border-b border-gray-800/50">
                {group.period}
              </div>
              {group.entries.map((entry) => {
                const meta = ACTIVITY_CATEGORY_LABELS[entry.category];
                const Icon = CATEGORY_ICONS[entry.category];
                return (
                  <div
                    key={entry.id}
                    className="flex items-start gap-3 px-4 py-2.5 border-b border-gray-800/50 hover:bg-gray-800/30 transition-colors"
                  >
                    <div
                      className="mt-0.5 p-1 rounded"
                      style={{ backgroundColor: meta.color + '15' }}
                    >
                      <Icon size={14} style={{ color: meta.color }} />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm text-gray-200 leading-snug">{safeText(entry.detail)}</p>
                      <div className="flex items-center gap-2 mt-0.5">
                        <span
                          className="text-[10px] font-medium px-1.5 py-0.5 rounded"
                          style={{ backgroundColor: meta.color + '15', color: meta.color }}
                        >
                          {entry.action}
                        </span>
                        <span className="text-[10px] text-gray-600" title={formatFullDate(entry.timestamp)}>
                          {formatDate(entry.timestamp)}
                        </span>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          ))
        )}
      </div>

      <ConfirmDialog
        open={showConfirmClear}
        onClose={() => setShowConfirmClear(false)}
        onConfirm={() => { onClear(); setShowConfirmClear(false); }}
        title="Clear Activity Log"
        message="This will permanently delete all activity log entries. This cannot be undone."
        confirmLabel="Clear All"
        danger
      />
    </div>
  );
}
