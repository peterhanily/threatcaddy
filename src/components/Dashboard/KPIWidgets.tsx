import { useState, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Settings2, X, ChevronUp, ChevronDown, TrendingUp, TrendingDown } from 'lucide-react';
import type { Folder, Note, Task, TimelineEvent, StandaloneIOC, KPIMetricId } from '../../types';
import { AVAILABLE_KPI_METRICS, KPI_METRIC_LABELS, DEFAULT_DASHBOARD_KPIS } from '../../types';
import { isOverdue } from '../../lib/utils';

interface KPIWidgetsProps {
  folders: Folder[];
  allNotes: Note[];
  allTasks: Task[];
  allEvents: TimelineEvent[];
  allIOCs: StandaloneIOC[];
  selectedKPIs: KPIMetricId[];
  onUpdateKPIs: (kpis: KPIMetricId[]) => void;
}

const KPI_COLORS: Record<KPIMetricId, string> = {
  'open-investigations': '#3b82f6',
  'closed-this-month': '#22c55e',
  'avg-investigation-age': '#f59e0b',
  'tasks-pending': '#ef4444',
  'tasks-completed-week': '#10b981',
  'iocs-under-investigation': '#8b5cf6',
  'notes-created-week': '#06b6d4',
  'timeline-events-week': '#ec4899',
  'overdue-tasks': '#f97316',
};

function computeKPIValue(
  metric: KPIMetricId,
  folders: Folder[],
  notes: Note[],
  tasks: Task[],
  events: TimelineEvent[],
  iocs: StandaloneIOC[],
): { value: string | number; trend?: 'up' | 'down' | 'neutral' } {
  const now = Date.now();
  const DAY = 86400000;
  const WEEK = 7 * DAY;
  const startOfMonth = new Date();
  startOfMonth.setDate(1);
  startOfMonth.setHours(0, 0, 0, 0);
  const monthStart = startOfMonth.getTime();
  const weekAgo = now - WEEK;

  switch (metric) {
    case 'open-investigations': {
      const count = folders.filter(f => (f.status || 'active') === 'active').length;
      return { value: count };
    }
    case 'closed-this-month': {
      const count = folders.filter(f =>
        (f.status === 'closed' || f.status === 'archived') && f.closedAt && f.closedAt >= monthStart
      ).length;
      return { value: count };
    }
    case 'avg-investigation-age': {
      const openFolders = folders.filter(f => (f.status || 'active') === 'active');
      if (openFolders.length === 0) return { value: '--' };
      const totalDays = openFolders.reduce((sum, f) => sum + (now - f.createdAt) / DAY, 0);
      const avg = Math.round(totalDays / openFolders.length);
      return { value: `${avg}d` };
    }
    case 'tasks-pending': {
      const count = tasks.filter(t => !t.trashed && !t.completed && !t.archived).length;
      return { value: count };
    }
    case 'tasks-completed-week': {
      const count = tasks.filter(t => t.completed && t.completedAt && t.completedAt >= weekAgo).length;
      return { value: count };
    }
    case 'iocs-under-investigation': {
      const count = iocs.filter(i => !i.trashed && i.iocStatus === 'under-investigation').length;
      return { value: count };
    }
    case 'notes-created-week': {
      const count = notes.filter(n => !n.trashed && n.createdAt >= weekAgo).length;
      return { value: count };
    }
    case 'timeline-events-week': {
      const count = events.filter(e => !e.trashed && e.createdAt >= weekAgo).length;
      return { value: count };
    }
    case 'overdue-tasks': {
      const count = tasks.filter(t => !t.trashed && !t.completed && isOverdue(t.dueDate)).length;
      return { value: count, trend: count > 0 ? 'up' : 'neutral' };
    }
    default:
      return { value: '--' };
  }
}

export function KPIWidgets({ folders, allNotes, allTasks, allEvents, allIOCs, selectedKPIs, onUpdateKPIs }: KPIWidgetsProps) {
  const { t } = useTranslation('dashboard');
  const [showConfig, setShowConfig] = useState(false);

  const kpis = selectedKPIs.length > 0 ? selectedKPIs : DEFAULT_DASHBOARD_KPIS;

  const kpiData = useMemo(() => {
    return kpis.map(metric => ({
      metric,
      label: KPI_METRIC_LABELS[metric],
      color: KPI_COLORS[metric],
      ...computeKPIValue(metric, folders, allNotes, allTasks, allEvents, allIOCs),
    }));
  }, [kpis, folders, allNotes, allTasks, allEvents, allIOCs]);

  return (
    <div className="px-6 pt-4">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wider">{t('kpi.keyMetrics')}</h3>
        <button
          onClick={() => setShowConfig(true)}
          className="p-1 rounded hover:bg-gray-700 text-gray-500 hover:text-gray-300 transition-colors"
          title="Configure KPIs"
        >
          <Settings2 size={14} />
        </button>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
        {kpiData.map(kpi => (
          <div
            key={kpi.metric}
            className="bg-bg-raised rounded-lg p-3 border border-border-subtle"
            style={{ borderLeftColor: kpi.color + '60', borderLeftWidth: 3 }}
          >
            <div className="text-[10px] text-gray-500 uppercase tracking-wider">{kpi.label}</div>
            <div className="flex items-center gap-1.5 mt-1">
              <span className="text-2xl font-bold tabular-nums" style={{ color: kpi.color }}>
                {kpi.value}
              </span>
              {kpi.trend === 'up' && <TrendingUp size={14} className="text-red-400" />}
              {kpi.trend === 'down' && <TrendingDown size={14} className="text-green-400" />}
            </div>
          </div>
        ))}
      </div>

      {showConfig && (
        <KPIConfigModal
          selected={kpis}
          onSave={(newKpis) => { onUpdateKPIs(newKpis); setShowConfig(false); }}
          onClose={() => setShowConfig(false)}
        />
      )}
    </div>
  );
}

function KPIConfigModal({
  selected,
  onSave,
  onClose,
}: {
  selected: KPIMetricId[];
  onSave: (kpis: KPIMetricId[]) => void;
  onClose: () => void;
}) {
  const [draft, setDraft] = useState<KPIMetricId[]>([...selected]);

  const toggle = (metric: KPIMetricId) => {
    setDraft(prev => {
      if (prev.includes(metric)) return prev.filter(m => m !== metric);
      if (prev.length >= 8) return prev;
      return [...prev, metric];
    });
  };

  const moveUp = (index: number) => {
    if (index === 0) return;
    setDraft(prev => {
      const next = [...prev];
      [next[index - 1], next[index]] = [next[index], next[index - 1]];
      return next;
    });
  };

  const moveDown = (index: number) => {
    if (index >= draft.length - 1) return;
    setDraft(prev => {
      const next = [...prev];
      [next[index], next[index + 1]] = [next[index + 1], next[index]];
      return next;
    });
  };

  return (
    <div
      className="fixed inset-0 z-[10000] flex items-center justify-center bg-black/60 p-4"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="bg-gray-900 rounded-xl shadow-2xl border border-gray-700 w-full max-w-md max-h-[90vh] flex flex-col">
        <div className="flex items-center justify-between p-4 border-b border-gray-700">
          <h2 className="text-lg font-semibold text-gray-100">Configure KPIs</h2>
          <button onClick={onClose} className="p-1 rounded-lg hover:bg-gray-700 text-gray-400 hover:text-gray-200">
            <X size={20} />
          </button>
        </div>
        <div className="p-4 overflow-y-auto space-y-4">
          <p className="text-xs text-gray-500">Select up to 8 KPIs to display on the dashboard. Use arrows to reorder.</p>

          {/* Selected KPIs with reorder */}
          {draft.length > 0 && (
            <div className="space-y-1">
              <span className="text-[10px] text-gray-500 uppercase tracking-wide">Selected ({draft.length}/8)</span>
              {draft.map((metric, i) => (
                <div key={metric} className="flex items-center gap-2 px-2 py-1.5 rounded bg-gray-800 border border-gray-700">
                  <div className="flex flex-col">
                    <button onClick={() => moveUp(i)} className="text-gray-500 hover:text-gray-300" disabled={i === 0}>
                      <ChevronUp size={12} />
                    </button>
                    <button onClick={() => moveDown(i)} className="text-gray-500 hover:text-gray-300" disabled={i >= draft.length - 1}>
                      <ChevronDown size={12} />
                    </button>
                  </div>
                  <span className="flex-1 text-sm text-gray-200">{KPI_METRIC_LABELS[metric]}</span>
                  <button
                    onClick={() => toggle(metric)}
                    className="text-gray-500 hover:text-red-400 p-0.5"
                  >
                    <X size={14} />
                  </button>
                </div>
              ))}
            </div>
          )}

          {/* Available KPIs */}
          <div className="space-y-1">
            <span className="text-[10px] text-gray-500 uppercase tracking-wide">Available</span>
            {AVAILABLE_KPI_METRICS.filter(m => !draft.includes(m)).map(metric => (
              <button
                key={metric}
                onClick={() => toggle(metric)}
                disabled={draft.length >= 8}
                className="w-full flex items-center gap-2 px-2 py-1.5 rounded bg-gray-800/50 border border-gray-700/50 text-start hover:bg-gray-700/50 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <div className="w-2 h-2 rounded-full" style={{ backgroundColor: KPI_COLORS[metric] }} />
                <span className="flex-1 text-sm text-gray-400">{KPI_METRIC_LABELS[metric]}</span>
                <span className="text-[10px] text-gray-600">+ Add</span>
              </button>
            ))}
          </div>
        </div>
        <div className="flex justify-end gap-2 p-4 border-t border-gray-700">
          <button onClick={onClose} className="px-4 py-2 rounded-lg bg-gray-700 hover:bg-gray-600 text-gray-200 text-sm">
            Cancel
          </button>
          <button
            onClick={() => onSave(draft)}
            disabled={draft.length === 0}
            className="px-4 py-2 rounded-lg bg-accent hover:bg-accent-hover text-white text-sm font-medium disabled:opacity-50"
          >
            Save
          </button>
        </div>
      </div>
    </div>
  );
}
