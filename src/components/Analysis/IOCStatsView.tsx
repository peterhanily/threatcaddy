import { useEffect, useMemo, useState } from 'react';
import { ChevronDown, ChevronRight, Search } from 'lucide-react';
import type { Note, Task, TimelineEvent, StandaloneIOC, Settings, IOCEntry, IOCType, ConfidenceLevel } from '../../types';
import { IOC_TYPE_LABELS, CONFIDENCE_LEVELS } from '../../types';

interface IOCStatsViewProps {
  notes: Note[];
  tasks: Task[];
  timelineEvents: TimelineEvent[];
  standaloneIOCs?: StandaloneIOC[];
  settings: Settings;
  scopedNotes?: Note[];
  scopedTasks?: Task[];
  scopedTimelineEvents?: TimelineEvent[];
  scopedStandaloneIOCs?: StandaloneIOC[];
  selectedFolderId?: string;
  selectedFolderName?: string;
}

interface UniqueIOC {
  type: IOCType;
  value: string;
  confidence: ConfidenceLevel;
  attribution?: string;
  firstSeen: number;
  entityCount: number;
  sourceTypes: Set<'note' | 'task' | 'event' | 'standalone'>;
}

export function IOCStatsView({ notes, tasks, timelineEvents, standaloneIOCs = [], scopedNotes, scopedTasks, scopedTimelineEvents, scopedStandaloneIOCs, selectedFolderId, selectedFolderName }: IOCStatsViewProps) {
  const [actorsExpanded, setActorsExpanded] = useState(false);
  const [scopeMode, setScopeMode] = useState<'investigation' | 'global'>('investigation');

  // Reset scope when investigation changes
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setScopeMode('investigation');
  }, [selectedFolderId]);

  const effectiveNotes = selectedFolderId && scopeMode === 'investigation' && scopedNotes ? scopedNotes : notes;
  const effectiveTasks = selectedFolderId && scopeMode === 'investigation' && scopedTasks ? scopedTasks : tasks;
  const effectiveEvents = selectedFolderId && scopeMode === 'investigation' && scopedTimelineEvents ? scopedTimelineEvents : timelineEvents;
  const effectiveStandaloneIOCs = selectedFolderId && scopeMode === 'investigation' && scopedStandaloneIOCs ? scopedStandaloneIOCs : standaloneIOCs;

  const { uniqueIOCs, entitiesWithIOCs } = useMemo(() => {
    const iocMap = new Map<string, UniqueIOC>();
    const entityIds = new Set<string>();

    const processIOCs = (iocs: IOCEntry[], entityId: string, sourceType: 'note' | 'task' | 'event' | 'standalone') => {
      let hasActiveIOC = false;
      for (const ioc of iocs) {
        if (ioc.dismissed) continue;
        hasActiveIOC = true;
        const key = `${ioc.type}:${ioc.value.toLowerCase()}`;
        const existing = iocMap.get(key);
        if (existing) {
          existing.entityCount++;
          existing.sourceTypes.add(sourceType);
          if (ioc.firstSeen < existing.firstSeen) existing.firstSeen = ioc.firstSeen;
          if (ioc.attribution && !existing.attribution) existing.attribution = ioc.attribution;
          // Prefer higher confidence
          const levels: ConfidenceLevel[] = ['low', 'medium', 'high', 'confirmed'];
          if (levels.indexOf(ioc.confidence) > levels.indexOf(existing.confidence)) {
            existing.confidence = ioc.confidence;
          }
        } else {
          iocMap.set(key, {
            type: ioc.type,
            value: ioc.value,
            confidence: ioc.confidence,
            attribution: ioc.attribution,
            firstSeen: ioc.firstSeen,
            entityCount: 1,
            sourceTypes: new Set([sourceType]),
          });
        }
      }
      if (hasActiveIOC) entityIds.add(entityId);
    };

    for (const note of effectiveNotes) {
      if (note.trashed) continue;
      if (note.iocAnalysis?.iocs) processIOCs(note.iocAnalysis.iocs, note.id, 'note');
    }
    for (const task of effectiveTasks) {
      if (task.iocAnalysis?.iocs) processIOCs(task.iocAnalysis.iocs, task.id, 'task');
    }
    for (const event of effectiveEvents) {
      if (event.iocAnalysis?.iocs) processIOCs(event.iocAnalysis.iocs, event.id, 'event');
    }
    // Standalone IOCs — treat each as a single-IOC entity
    for (const si of effectiveStandaloneIOCs) {
      if (si.trashed) continue;
      const syntheticEntry: IOCEntry = {
        id: si.id,
        type: si.type,
        value: si.value,
        confidence: si.confidence,
        attribution: si.attribution,
        firstSeen: si.createdAt,
        dismissed: false,
      };
      processIOCs([syntheticEntry], si.id, 'standalone');
    }

    return { uniqueIOCs: Array.from(iocMap.values()), entitiesWithIOCs: entityIds.size };
  }, [effectiveNotes, effectiveTasks, effectiveEvents, effectiveStandaloneIOCs]);

  // IOCs by type
  const byType = useMemo(() => {
    const counts = new Map<IOCType, number>();
    for (const ioc of uniqueIOCs) counts.set(ioc.type, (counts.get(ioc.type) || 0) + 1);
    const entries = Array.from(counts.entries()).sort((a, b) => b[1] - a[1]);
    const max = entries.length > 0 ? entries[0][1] : 1;
    return { entries, max };
  }, [uniqueIOCs]);

  // Confidence distribution
  const byConfidence = useMemo(() => {
    const counts: Record<ConfidenceLevel, number> = { low: 0, medium: 0, high: 0, confirmed: 0 };
    for (const ioc of uniqueIOCs) counts[ioc.confidence]++;
    return counts;
  }, [uniqueIOCs]);

  // Top actors
  const topActors = useMemo(() => {
    const actorMap = new Map<string, { count: number; types: Map<IOCType, number> }>();
    for (const ioc of uniqueIOCs) {
      if (!ioc.attribution) continue;
      let entry = actorMap.get(ioc.attribution);
      if (!entry) { entry = { count: 0, types: new Map() }; actorMap.set(ioc.attribution, entry); }
      entry.count++;
      entry.types.set(ioc.type, (entry.types.get(ioc.type) || 0) + 1);
    }
    return Array.from(actorMap.entries())
      .map(([name, data]) => ({
        name,
        count: data.count,
        topTypes: Array.from(data.types.entries()).sort((a, b) => b[1] - a[1]).slice(0, 3).map(([t]) => t),
      }))
      .sort((a, b) => b.count - a.count);
  }, [uniqueIOCs]);

  // IOCs over time
  const overTime = useMemo(() => {
    if (uniqueIOCs.length === 0) return [];
    const sorted = [...uniqueIOCs].sort((a, b) => a.firstSeen - b.firstSeen);
    const minTs = sorted[0].firstSeen;
    const maxTs = sorted[sorted.length - 1].firstSeen;
    const rangeMs = maxTs - minTs;

    // Choose bucket size
    const DAY = 86400000;
    const WEEK = 7 * DAY;
    const MONTH = 30 * DAY;
    let bucketSize = DAY;
    let bucketLabel = 'day';
    if (rangeMs > 365 * DAY) { bucketSize = MONTH; bucketLabel = 'month'; }
    else if (rangeMs > 60 * DAY) { bucketSize = WEEK; bucketLabel = 'week'; }

    const buckets = new Map<number, number>();
    for (const ioc of sorted) {
      const bucket = Math.floor(ioc.firstSeen / bucketSize) * bucketSize;
      buckets.set(bucket, (buckets.get(bucket) || 0) + 1);
    }

    const entries = Array.from(buckets.entries()).sort((a, b) => a[0] - b[0]);
    const max = Math.max(1, ...entries.map(([, c]) => c));
    return entries.map(([ts, count]) => ({
      label: bucketLabel === 'month'
        ? new Date(ts).toLocaleDateString(undefined, { month: 'short', year: 'numeric' })
        : new Date(ts).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }),
      count,
      pct: (count / max) * 100,
    }));
  }, [uniqueIOCs]);

  // Top IOCs by frequency
  const topIOCs = useMemo(() => {
    return [...uniqueIOCs].sort((a, b) => b.entityCount - a.entityCount).slice(0, 20);
  }, [uniqueIOCs]);

  // Source distribution
  const sourceDist = useMemo(() => {
    let fromNotes = 0, fromTasks = 0, fromEvents = 0, fromStandalone = 0;
    for (const ioc of uniqueIOCs) {
      if (ioc.sourceTypes.has('note')) fromNotes++;
      if (ioc.sourceTypes.has('task')) fromTasks++;
      if (ioc.sourceTypes.has('event')) fromEvents++;
      if (ioc.sourceTypes.has('standalone')) fromStandalone++;
    }
    return { notes: fromNotes, tasks: fromTasks, events: fromEvents, standalone: fromStandalone };
  }, [uniqueIOCs]);

  // Summary cards
  const mostCommonType = byType.entries.length > 0 ? byType.entries[0] : null;
  const topActor = topActors.length > 0 ? topActors[0] : null;

  if (uniqueIOCs.length === 0) {
    return (
      <div className="flex-1 flex flex-col overflow-hidden">
        <div data-tour="ioc-stats-header" className="flex items-center gap-2 px-4 py-3 border-b border-gray-800 shrink-0">
          <Search size={16} />
          <span className="text-sm font-medium text-gray-200">IOC Statistics</span>
        </div>
        <div className="flex flex-col items-center justify-center flex-1 text-gray-600">
          <Search size={36} className="mb-3" />
          <p className="text-lg font-medium">No IOCs found</p>
          <p className="text-sm mt-1">Analyze notes, tasks, or timeline events to extract indicators.</p>
        </div>
      </div>
    );
  }

  const displayedActors = actorsExpanded ? topActors : topActors.slice(0, 10);

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      {/* Header */}
      <div data-tour="ioc-stats-header" className="flex items-center gap-2 px-4 py-3 border-b border-gray-800 shrink-0">
        <Search size={16} />
        <span className="text-sm font-medium text-gray-200">IOC Statistics</span>
        {selectedFolderId && (
          <div className="flex rounded-lg overflow-hidden border border-gray-700 ml-2">
            <button
              onClick={() => setScopeMode('investigation')}
              className={`px-2 py-0.5 text-[10px] font-medium transition-colors ${scopeMode === 'investigation' ? 'bg-accent/20 text-accent' : 'text-gray-500 hover:text-gray-300'}`}
            >
              {selectedFolderName || 'Investigation'}
            </button>
            <button
              onClick={() => setScopeMode('global')}
              className={`px-2 py-0.5 text-[10px] font-medium transition-colors ${scopeMode === 'global' ? 'bg-accent/20 text-accent' : 'text-gray-500 hover:text-gray-300'}`}
            >
              Global
            </button>
          </div>
        )}
        <span className="text-xs text-gray-500">({uniqueIOCs.length} unique IOCs)</span>
      </div>

      {/* Scrollable content */}
      <div className="flex-1 overflow-y-auto p-4 space-y-6">
        {/* Summary Cards */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <SummaryCard label="Unique IOCs" value={uniqueIOCs.length} color="#f59e0b" />
          <SummaryCard label="Entities with IOCs" value={entitiesWithIOCs} color="#3b82f6" />
          <SummaryCard label="Most Common Type" value={mostCommonType ? IOC_TYPE_LABELS[mostCommonType[0]].label : '—'} sub={mostCommonType ? `${mostCommonType[1]}` : undefined} color={mostCommonType ? IOC_TYPE_LABELS[mostCommonType[0]].color : '#6b7280'} />
          <SummaryCard label="Top Actor" value={topActor?.name ?? '—'} sub={topActor ? `${topActor.count} IOCs` : undefined} color="#a855f7" />
        </div>

        {/* IOCs by Type */}
        <Section title="IOCs by Type">
          <div className="space-y-1.5">
            {byType.entries.map(([type, count]) => {
              const info = IOC_TYPE_LABELS[type];
              const pct = ((count / uniqueIOCs.length) * 100).toFixed(1);
              return (
                <div key={type} className="flex items-center gap-2">
                  <span className="w-20 text-right text-[11px] text-gray-400 truncate shrink-0">{info.label}</span>
                  <div className="flex-1 h-5 bg-gray-800 rounded-sm overflow-hidden">
                    <div className="h-full rounded-sm transition-all" style={{ width: `${(count / byType.max) * 100}%`, backgroundColor: info.color + '99' }} />
                  </div>
                  <span className="w-14 text-right text-[11px] font-mono text-gray-400 shrink-0">{count} ({pct}%)</span>
                </div>
              );
            })}
          </div>
        </Section>

        {/* Confidence Distribution */}
        <Section title="Confidence Distribution">
          <div className="space-y-1.5">
            {(Object.entries(byConfidence) as [ConfidenceLevel, number][]).filter(([, c]) => c > 0).map(([level, count]) => {
              const info = CONFIDENCE_LEVELS[level];
              const pct = ((count / uniqueIOCs.length) * 100).toFixed(1);
              return (
                <div key={level} className="flex items-center gap-2">
                  <span className="w-20 text-right text-[11px] text-gray-400 shrink-0">{info.label}</span>
                  <div className="flex-1 h-5 bg-gray-800 rounded-sm overflow-hidden">
                    <div className="h-full rounded-sm transition-all" style={{ width: `${(count / uniqueIOCs.length) * 100}%`, backgroundColor: info.color + '99' }} />
                  </div>
                  <span className="w-14 text-right text-[11px] font-mono text-gray-400 shrink-0">{count} ({pct}%)</span>
                </div>
              );
            })}
          </div>
        </Section>

        {/* Top Attributed Actors */}
        {topActors.length > 0 && (
          <Section title="Top Attributed Actors">
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-gray-800">
                    <th className="text-left text-gray-500 font-medium py-1.5 pr-4">Actor</th>
                    <th className="text-right text-gray-500 font-medium py-1.5 px-2">IOCs</th>
                    <th className="text-left text-gray-500 font-medium py-1.5 pl-4">Top Types</th>
                  </tr>
                </thead>
                <tbody>
                  {displayedActors.map((actor) => (
                    <tr key={actor.name} className="border-b border-gray-800/50">
                      <td className="py-1.5 pr-4 text-purple-400 font-medium">{actor.name}</td>
                      <td className="py-1.5 px-2 text-right text-gray-300 tabular-nums">{actor.count}</td>
                      <td className="py-1.5 pl-4">
                        <div className="flex gap-1">
                          {actor.topTypes.map((t) => (
                            <span key={t} className="text-[10px] px-1.5 py-0.5 rounded" style={{ backgroundColor: IOC_TYPE_LABELS[t].color + '22', color: IOC_TYPE_LABELS[t].color }}>
                              {IOC_TYPE_LABELS[t].label}
                            </span>
                          ))}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {topActors.length > 10 && (
              <button onClick={() => setActorsExpanded(!actorsExpanded)} className="flex items-center gap-1 mt-2 text-[11px] text-gray-500 hover:text-gray-300">
                {actorsExpanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
                {actorsExpanded ? 'Show less' : `Show all ${topActors.length} actors`}
              </button>
            )}
          </Section>
        )}

        {/* IOCs Over Time */}
        {overTime.length > 1 && (
          <Section title="IOCs Over Time">
            <div className="space-y-1">
              {overTime.map((bucket, i) => (
                <div key={i} className="flex items-center gap-2">
                  <span className="w-20 text-right text-[11px] text-gray-400 truncate shrink-0">{bucket.label}</span>
                  <div className="flex-1 h-4 bg-gray-800 rounded-sm overflow-hidden">
                    <div className="h-full bg-accent/60 rounded-sm transition-all" style={{ width: `${bucket.pct}%` }} />
                  </div>
                  <span className="w-6 text-right text-[11px] font-mono text-gray-400 shrink-0">{bucket.count}</span>
                </div>
              ))}
            </div>
          </Section>
        )}

        {/* Top IOCs by Frequency */}
        <Section title="Top IOCs by Frequency">
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-gray-800">
                  <th className="text-left text-gray-500 font-medium py-1.5 pr-2">Value</th>
                  <th className="text-left text-gray-500 font-medium py-1.5 px-2">Type</th>
                  <th className="text-right text-gray-500 font-medium py-1.5 px-2">Entities</th>
                  <th className="text-left text-gray-500 font-medium py-1.5 px-2">Confidence</th>
                  <th className="text-left text-gray-500 font-medium py-1.5 pl-2">Attribution</th>
                </tr>
              </thead>
              <tbody>
                {topIOCs.map((ioc, i) => {
                  const typeInfo = IOC_TYPE_LABELS[ioc.type];
                  const confInfo = CONFIDENCE_LEVELS[ioc.confidence];
                  return (
                    <tr key={i} className="border-b border-gray-800/50">
                      <td className="py-1.5 pr-2 text-gray-200 font-mono max-w-[200px] truncate">{ioc.value}</td>
                      <td className="py-1.5 px-2">
                        <span className="text-[10px] px-1.5 py-0.5 rounded" style={{ backgroundColor: typeInfo.color + '22', color: typeInfo.color }}>
                          {typeInfo.label}
                        </span>
                      </td>
                      <td className="py-1.5 px-2 text-right text-gray-300 tabular-nums">{ioc.entityCount}</td>
                      <td className="py-1.5 px-2">
                        <span className="text-[10px] px-1.5 py-0.5 rounded" style={{ backgroundColor: confInfo.color + '22', color: confInfo.color }}>
                          {confInfo.label}
                        </span>
                      </td>
                      <td className="py-1.5 pl-2 text-gray-400">{ioc.attribution || '—'}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Section>

        {/* Source Distribution */}
        <Section title="Source Distribution">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <div className="bg-gray-800/50 rounded-lg p-3 text-center">
              <div className="text-xl font-bold text-blue-400 tabular-nums">{sourceDist.notes}</div>
              <div className="text-[10px] text-gray-500 uppercase tracking-wider mt-0.5">From Notes</div>
            </div>
            <div className="bg-gray-800/50 rounded-lg p-3 text-center">
              <div className="text-xl font-bold text-green-400 tabular-nums">{sourceDist.tasks}</div>
              <div className="text-[10px] text-gray-500 uppercase tracking-wider mt-0.5">From Tasks</div>
            </div>
            <div className="bg-gray-800/50 rounded-lg p-3 text-center">
              <div className="text-xl font-bold text-indigo-400 tabular-nums">{sourceDist.events}</div>
              <div className="text-[10px] text-gray-500 uppercase tracking-wider mt-0.5">From Events</div>
            </div>
            <div className="bg-gray-800/50 rounded-lg p-3 text-center">
              <div className="text-xl font-bold text-amber-400 tabular-nums">{sourceDist.standalone}</div>
              <div className="text-[10px] text-gray-500 uppercase tracking-wider mt-0.5">Standalone</div>
            </div>
          </div>
        </Section>
      </div>
    </div>
  );
}

function SummaryCard({ label, value, sub, color }: { label: string; value: string | number; sub?: string; color: string }) {
  return (
    <div className="bg-gray-800/50 rounded-lg p-3 border border-gray-700/50">
      <div className="text-[10px] text-gray-500 uppercase tracking-wider">{label}</div>
      <div className="text-lg font-bold mt-0.5 truncate" style={{ color }}>{value}</div>
      {sub && <div className="text-[10px] text-gray-500 mt-0.5">{sub}</div>}
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <h3 className="text-sm font-semibold text-gray-300 mb-3">{title}</h3>
      {children}
    </div>
  );
}
