import { useEffect, useMemo, useState, forwardRef } from 'react';
import { ChevronDown, ChevronRight, Search, BarChart3, List, Plus, ListPlus, Clipboard, X, ChevronUp, Pencil, Trash2, Archive, RotateCcw, ExternalLink, Columns, GitMerge, Tag as TagIcon, Download } from 'lucide-react';
import type { Note, Task, TimelineEvent, StandaloneIOC, Settings, IOCEntry, IOCType, ConfidenceLevel, Folder, Tag, InvestigationMember } from '../../types';
import { IOC_TYPE_LABELS, CONFIDENCE_LEVELS, ALL_IOC_TABLE_COLUMNS, DEFAULT_IOC_TABLE_COLUMNS, IOC_STATUS_VALUES, IOC_STATUS_LABELS, IOC_STATUS_COLORS } from '../../types';
import { ConfirmDialog } from '../Common/ConfirmDialog';
import { StandaloneIOCForm } from './StandaloneIOCForm';
import { BulkIOCImportModal } from './BulkIOCImportModal';
import { STIXImportModal } from './STIXImportModal';
import { MISPImportModal } from './MISPImportModal';
import { IOCDeduplicator } from './IOCDeduplicator';
import { RunIntegrationMenu } from '../Integrations/RunIntegrationMenu';
import { useIntegrations } from '../../hooks/useIntegrations';
import { useTranslation } from 'react-i18next';
import { useToast } from '../../contexts/ToastContext';
import { formatDate } from '../../lib/utils';
import { EnrichmentLabels } from './EnrichmentLabels';
import { TableVirtuoso } from 'react-virtuoso';

// ─── Constants ─────────────────────────────────────────────────────

const STATUS_COLORS: Record<string, string> = IOC_STATUS_COLORS;
const STATUS_LABELS: Record<string, string> = IOC_STATUS_LABELS;
const STATUS_OPTIONS = IOC_STATUS_VALUES;
const CONFIDENCE_OPTIONS: ConfidenceLevel[] = ['low', 'medium', 'high', 'confirmed'];
const ALL_IOC_TYPES = Object.keys(IOC_TYPE_LABELS) as IOCType[];
const CONFIDENCE_ORDER: Record<string, number> = { low: 0, medium: 1, high: 2, confirmed: 3 };
/** Fallback for IOC types not in the IOC_TYPE_LABELS map (agent-created custom types). */
const UNKNOWN_TYPE_INFO = { label: 'Unknown', color: '#6b7280', icon: '❓' };
const UNKNOWN_CONF_INFO = { label: 'Unknown', color: '#6b7280' };
/** Safe lookup for IOC type info — never returns undefined. */
function getTypeInfo(type: string) { return IOC_TYPE_LABELS[type as IOCType] || UNKNOWN_TYPE_INFO; }
function getConfInfo(level: string) { return CONFIDENCE_LEVELS[level as ConfidenceLevel] || UNKNOWN_CONF_INFO; }

type SortField = 'value' | 'type' | 'confidence' | 'source' | 'iocStatus' | 'attribution';
type SortDir = 'asc' | 'desc';

// ─── Types ─────────────────────────────────────────────────────────

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
  // Standalone IOC management props
  folders?: Folder[];
  allTags?: Tag[];
  allStandaloneIOCs?: StandaloneIOC[];
  filteredStandaloneIOCs?: StandaloneIOC[];
  onCreateIOC?: (data: Partial<StandaloneIOC>) => Promise<StandaloneIOC>;
  onUpdateIOC?: (id: string, updates: Partial<StandaloneIOC>) => void;
  onDeleteIOC?: (id: string) => void;
  onTrashIOC?: (id: string) => void;
  onRestoreIOC?: (id: string) => void;
  onToggleArchiveIOC?: (id: string) => void;
  onOpenSettings?: () => void;
  onNavigateToSource?: (sourceType: 'note' | 'task' | 'event', sourceId: string) => void;
  investigationMembers?: InvestigationMember[];
  iocTableColumns?: string[];
  onUpdateTableColumns?: (columns: string[]) => void;
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

/** Unified row for the All IOCs table */
interface UnifiedIOCRow {
  id: string;
  value: string;
  type: IOCType;
  confidence: ConfidenceLevel;
  source: string;
  sourceType: 'note' | 'task' | 'event' | 'standalone';
  sourceId: string;
  iocStatus?: string;
  attribution?: string;
  standaloneIOC?: StandaloneIOC;
  updatedAt: number;
}

type TabId = 'overview' | 'all-iocs';

// ─── Main Component ────────────────────────────────────────────────

export function IOCStatsView({
  notes, tasks, timelineEvents, standaloneIOCs = [],
  scopedNotes, scopedTasks, scopedTimelineEvents, scopedStandaloneIOCs,
  selectedFolderId, selectedFolderName,
  folders = [], allTags, allStandaloneIOCs,
  filteredStandaloneIOCs = [],
  onCreateIOC, onUpdateIOC, onDeleteIOC,
  onTrashIOC, onRestoreIOC, onToggleArchiveIOC,
  onOpenSettings, onNavigateToSource, investigationMembers,
  iocTableColumns, onUpdateTableColumns,
}: IOCStatsViewProps) {
  const [actorsExpanded, setActorsExpanded] = useState(false);
  const [scopeMode, setScopeMode] = useState<'investigation' | 'global'>('investigation');
  const [activeTab, setActiveTab] = useState<TabId>('all-iocs');
  const [showHeaderForm, setShowHeaderForm] = useState(false);
  const [showHeaderBulkImport, setShowHeaderBulkImport] = useState(false);
  const [showHeaderSTIX, setShowHeaderSTIX] = useState(false);
  const [showHeaderMISP, setShowHeaderMISP] = useState(false);

  // Reset scope when investigation changes
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setScopeMode('investigation');
  }, [selectedFolderId]);

  const effectiveNotes = selectedFolderId && scopeMode === 'investigation' && scopedNotes ? scopedNotes : notes;
  const effectiveTasks = selectedFolderId && scopeMode === 'investigation' && scopedTasks ? scopedTasks : tasks;
  const effectiveEvents = selectedFolderId && scopeMode === 'investigation' && scopedTimelineEvents ? scopedTimelineEvents : timelineEvents;
  const effectiveStandaloneIOCs = selectedFolderId && scopeMode === 'investigation' && scopedStandaloneIOCs ? scopedStandaloneIOCs : standaloneIOCs;

  // ─── Compute unique IOCs (same as before) ─────────────────────
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
    for (const si of effectiveStandaloneIOCs) {
      if (si.trashed) continue;
      const syntheticEntry: IOCEntry = {
        id: si.id, type: si.type, value: si.value,
        confidence: si.confidence, attribution: si.attribution,
        firstSeen: si.createdAt, dismissed: false,
      };
      processIOCs([syntheticEntry], si.id, 'standalone');
    }

    return { uniqueIOCs: Array.from(iocMap.values()), entitiesWithIOCs: entityIds.size };
  }, [effectiveNotes, effectiveTasks, effectiveEvents, effectiveStandaloneIOCs]);

  // ─── Stats computations ───────────────────────────────────────
  const byType = useMemo(() => {
    const counts = new Map<IOCType, number>();
    for (const ioc of uniqueIOCs) counts.set(ioc.type, (counts.get(ioc.type) || 0) + 1);
    const entries = Array.from(counts.entries()).sort((a, b) => b[1] - a[1]);
    const max = entries.length > 0 ? entries[0][1] : 1;
    return { entries, max };
  }, [uniqueIOCs]);

  const byConfidence = useMemo(() => {
    const counts: Record<ConfidenceLevel, number> = { low: 0, medium: 0, high: 0, confirmed: 0 };
    for (const ioc of uniqueIOCs) counts[ioc.confidence]++;
    return counts;
  }, [uniqueIOCs]);

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
        name, count: data.count,
        topTypes: Array.from(data.types.entries()).sort((a, b) => b[1] - a[1]).slice(0, 3).map(([t]) => t),
      }))
      .sort((a, b) => b.count - a.count);
  }, [uniqueIOCs]);

  const overTime = useMemo(() => {
    if (uniqueIOCs.length === 0) return [];
    const sorted = [...uniqueIOCs].sort((a, b) => a.firstSeen - b.firstSeen);
    const minTs = sorted[0].firstSeen;
    const maxTs = sorted[sorted.length - 1].firstSeen;
    const rangeMs = maxTs - minTs;
    const DAY = 86400000; const WEEK = 7 * DAY; const MONTH = 30 * DAY;
    let bucketSize = DAY; let bucketLabel = 'day';
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
      count, pct: (count / max) * 100,
    }));
  }, [uniqueIOCs]);

  const topIOCs = useMemo(() => {
    return [...uniqueIOCs].sort((a, b) => b.entityCount - a.entityCount).slice(0, 20);
  }, [uniqueIOCs]);

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

  const mostCommonType = byType.entries.length > 0 ? byType.entries[0] : null;
  const topActor = topActors.length > 0 ? topActors[0] : null;
  const displayedActors = actorsExpanded ? topActors : topActors.slice(0, 10);

  // ─── Build unified IOC rows for the All IOCs tab ──────────────
  const unifiedRows = useMemo(() => {
    const rows: UnifiedIOCRow[] = [];

    // Extracted from notes
    for (const note of effectiveNotes) {
      if (note.trashed || !note.iocAnalysis?.iocs) continue;
      for (const ioc of note.iocAnalysis.iocs) {
        if (ioc.dismissed) continue;
        rows.push({
          id: `note-${note.id}-${ioc.id}`,
          value: ioc.value, type: ioc.type, confidence: ioc.confidence,
          source: `Note: ${note.title || 'Untitled'}`,
          sourceType: 'note', sourceId: note.id,
          iocStatus: ioc.iocStatus, attribution: ioc.attribution,
          updatedAt: note.updatedAt,
        });
      }
    }

    // Extracted from tasks
    for (const task of effectiveTasks) {
      if (!task.iocAnalysis?.iocs) continue;
      for (const ioc of task.iocAnalysis.iocs) {
        if (ioc.dismissed) continue;
        rows.push({
          id: `task-${task.id}-${ioc.id}`,
          value: ioc.value, type: ioc.type, confidence: ioc.confidence,
          source: `Task: ${task.title || 'Untitled'}`,
          sourceType: 'task', sourceId: task.id,
          iocStatus: ioc.iocStatus, attribution: ioc.attribution,
          updatedAt: task.updatedAt,
        });
      }
    }

    // Extracted from timeline events
    for (const event of effectiveEvents) {
      if (!event.iocAnalysis?.iocs) continue;
      for (const ioc of event.iocAnalysis.iocs) {
        if (ioc.dismissed) continue;
        rows.push({
          id: `event-${event.id}-${ioc.id}`,
          value: ioc.value, type: ioc.type, confidence: ioc.confidence,
          source: `Event: ${event.title || 'Untitled'}`,
          sourceType: 'event', sourceId: event.id,
          iocStatus: ioc.iocStatus, attribution: ioc.attribution,
          updatedAt: event.updatedAt,
        });
      }
    }

    // Standalone IOCs
    for (const si of filteredStandaloneIOCs) {
      if (si.trashed) continue;
      rows.push({
        id: `standalone-${si.id}`,
        value: si.value, type: si.type, confidence: si.confidence,
        source: 'Standalone',
        sourceType: 'standalone', sourceId: si.id,
        iocStatus: si.iocStatus, attribution: si.attribution,
        standaloneIOC: si,
        updatedAt: si.updatedAt,
      });
    }

    return rows;
  }, [effectiveNotes, effectiveTasks, effectiveEvents, filteredStandaloneIOCs]);

  // ─── Empty state ──────────────────────────────────────────────
  const hasNoIOCs = uniqueIOCs.length === 0 && unifiedRows.length === 0;

  const headerActionProps = {
    onNewIOC: onCreateIOC ? () => setShowHeaderForm(true) : undefined,
    onBulkImport: onCreateIOC ? () => setShowHeaderBulkImport(true) : undefined,
    onSTIXImport: onCreateIOC ? () => setShowHeaderSTIX(true) : undefined,
    onMISPImport: onCreateIOC ? () => setShowHeaderMISP(true) : undefined,
  };

  const headerModals = onCreateIOC ? (
    <>
      <StandaloneIOCForm
        open={showHeaderForm}
        onClose={() => setShowHeaderForm(false)}
        onSubmit={async (data) => { await onCreateIOC(data); }}
        folders={folders}
        defaultFolderId={selectedFolderId}
        allTags={allTags}
        onUpdateIOC={onUpdateIOC}
        investigationMembers={investigationMembers}
      />
      <BulkIOCImportModal
        open={showHeaderBulkImport}
        onClose={() => setShowHeaderBulkImport(false)}
        onCreate={onCreateIOC}
        existingIOCs={allStandaloneIOCs ?? []}
        folders={folders}
        allTags={allTags}
        defaultFolderId={selectedFolderId}
      />
      <STIXImportModal
        open={showHeaderSTIX}
        onClose={() => setShowHeaderSTIX(false)}
        onCreate={onCreateIOC}
        existingIOCs={allStandaloneIOCs ?? []}
        folders={folders}
        defaultFolderId={selectedFolderId}
      />
      <MISPImportModal
        open={showHeaderMISP}
        onClose={() => setShowHeaderMISP(false)}
        onCreate={onCreateIOC}
        existingIOCs={allStandaloneIOCs ?? []}
        folders={folders}
        defaultFolderId={selectedFolderId}
      />
    </>
  ) : null;

  if (hasNoIOCs && activeTab === 'overview') {
    return (
      <div className="flex-1 flex flex-col overflow-hidden">
        <Header
          selectedFolderId={selectedFolderId}
          selectedFolderName={selectedFolderName}
          scopeMode={scopeMode}
          setScopeMode={setScopeMode}
          uniqueIOCCount={0}
          activeTab={activeTab}
          setActiveTab={setActiveTab}
          unifiedRowCount={0}
          {...headerActionProps}
        />
        <div className="flex flex-col items-center justify-center flex-1 text-gray-600">
          <Search size={36} className="mb-3" />
          <p className="text-lg font-medium">No IOCs found</p>
          <p className="text-sm mt-1">Analyze notes, tasks, or timeline events to extract indicators.</p>
          {onCreateIOC && (
            <button
              onClick={() => setShowHeaderForm(true)}
              className="mt-4 flex items-center gap-1.5 px-4 py-2 rounded-lg bg-accent/15 text-accent hover:bg-accent/25 text-sm font-medium transition-colors"
            >
              <Plus size={16} />
              New IOC
            </button>
          )}
        </div>
        {headerModals}
      </div>
    );
  }

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      <Header
        selectedFolderId={selectedFolderId}
        selectedFolderName={selectedFolderName}
        scopeMode={scopeMode}
        setScopeMode={setScopeMode}
        uniqueIOCCount={uniqueIOCs.length}
        activeTab={activeTab}
        setActiveTab={setActiveTab}
        unifiedRowCount={unifiedRows.length}
        {...headerActionProps}
      />

      {activeTab === 'overview' ? (
        <div className="flex-1 overflow-y-auto p-4 space-y-6">
          {/* Summary Cards */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <SummaryCard label="Unique IOCs" value={uniqueIOCs.length} color="#f59e0b" />
            <SummaryCard label="Entities with IOCs" value={entitiesWithIOCs} color="#3b82f6" />
            <SummaryCard label="Most Common Type" value={mostCommonType ? getTypeInfo(mostCommonType[0]).label : '--'} sub={mostCommonType ? `${mostCommonType[1]}` : undefined} color={mostCommonType ? getTypeInfo(mostCommonType[0]).color : '#6b7280'} />
            <SummaryCard label="Top Actor" value={topActor?.name ?? '--'} sub={topActor ? `${topActor.count} IOCs` : undefined} color="#a855f7" />
          </div>

          {/* Two-column layout for type + confidence charts */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {/* IOCs by Type */}
            <Section title="IOCs by Type">
              <div className="space-y-2">
                {byType.entries.map(([type, count]) => {
                  const info = getTypeInfo(type);
                  const pct = ((count / uniqueIOCs.length) * 100).toFixed(1);
                  return (
                    <div key={type} className="flex items-center gap-2">
                      <span className="w-20 text-right text-[11px] text-gray-400 truncate shrink-0">{info.label}</span>
                      <div className="flex-1 h-6 bg-gray-800/60 rounded overflow-hidden">
                        <div className="h-full rounded transition-all" style={{ width: `${(count / byType.max) * 100}%`, backgroundColor: info.color + '55' }} />
                      </div>
                      <span className="w-16 text-right text-[11px] font-mono text-gray-400 shrink-0">{count} <span className="text-gray-600">({pct}%)</span></span>
                    </div>
                  );
                })}
              </div>
            </Section>

            {/* Confidence Distribution */}
            <Section title="Confidence Distribution">
              <div className="space-y-2">
                {(Object.entries(byConfidence) as [ConfidenceLevel, number][]).filter(([, c]) => c > 0).map(([level, count]) => {
                  const info = getConfInfo(level);
                  const pct = ((count / uniqueIOCs.length) * 100).toFixed(1);
                  return (
                    <div key={level} className="flex items-center gap-2">
                      <span className="w-20 text-right text-[11px] text-gray-400 shrink-0">{info.label}</span>
                      <div className="flex-1 h-6 bg-gray-800/60 rounded overflow-hidden">
                        <div className="h-full rounded transition-all" style={{ width: `${(count / uniqueIOCs.length) * 100}%`, backgroundColor: info.color + '55' }} />
                      </div>
                      <span className="w-16 text-right text-[11px] font-mono text-gray-400 shrink-0">{count} <span className="text-gray-600">({pct}%)</span></span>
                    </div>
                  );
                })}
              </div>
            </Section>
          </div>

          {/* Source Distribution */}
          <Section title="Source Distribution">
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <SourceCard value={sourceDist.notes} label="From Notes" color="#3b82f6" />
              <SourceCard value={sourceDist.tasks} label="From Tasks" color="#22c55e" />
              <SourceCard value={sourceDist.events} label="From Events" color="#6366f1" />
              <SourceCard value={sourceDist.standalone} label="Standalone" color="#f59e0b" />
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
                              <span key={t} className="text-[10px] px-1.5 py-0.5 rounded" style={{ backgroundColor: getTypeInfo(t).color + '22', color: getTypeInfo(t).color }}>
                                {getTypeInfo(t).label}
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
              <div className="space-y-1.5">
                {overTime.map((bucket, i) => (
                  <div key={i} className="flex items-center gap-2">
                    <span className="w-20 text-right text-[11px] text-gray-400 truncate shrink-0">{bucket.label}</span>
                    <div className="flex-1 h-5 bg-gray-800/60 rounded overflow-hidden">
                      <div className="h-full bg-accent/50 rounded transition-all" style={{ width: `${bucket.pct}%` }} />
                    </div>
                    <span className="w-6 text-right text-[11px] font-mono text-gray-400 shrink-0">{bucket.count}</span>
                  </div>
                ))}
              </div>
            </Section>
          )}

          {/* Top IOCs by Frequency */}
          {topIOCs.length > 0 && (
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
                      const typeInfo = getTypeInfo(ioc.type);
                      const confInfo = getConfInfo(ioc.confidence);
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
                          <td className="py-1.5 pl-2 text-gray-400">{ioc.attribution || '--'}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </Section>
          )}
        </div>
      ) : (
        <AllIOCsTab
          rows={unifiedRows}
          folders={folders}
          allTags={allTags}
          allStandaloneIOCs={allStandaloneIOCs}
          onCreateIOC={onCreateIOC}
          onUpdateIOC={onUpdateIOC}
          onDeleteIOC={onDeleteIOC}
          onTrashIOC={onTrashIOC}
          onRestoreIOC={onRestoreIOC}
          onToggleArchiveIOC={onToggleArchiveIOC}
          defaultFolderId={selectedFolderId}
          currentFolderId={selectedFolderId}
          currentFolderName={selectedFolderName}
          onOpenSettings={onOpenSettings}
          onNavigateToSource={onNavigateToSource}
          investigationMembers={investigationMembers}
          iocTableColumns={iocTableColumns}
          onUpdateTableColumns={onUpdateTableColumns}
        />
      )}
      {headerModals}
    </div>
  );
}

// ─── Header with tabs ──────────────────────────────────────────────

function Header({
  selectedFolderId, selectedFolderName, scopeMode, setScopeMode,
  uniqueIOCCount, activeTab, setActiveTab, unifiedRowCount,
  onNewIOC, onBulkImport, onSTIXImport, onMISPImport,
}: {
  selectedFolderId?: string;
  selectedFolderName?: string;
  scopeMode: 'investigation' | 'global';
  setScopeMode: (m: 'investigation' | 'global') => void;
  uniqueIOCCount: number;
  activeTab: TabId;
  setActiveTab: (t: TabId) => void;
  unifiedRowCount: number;
  onNewIOC?: () => void;
  onBulkImport?: () => void;
  onSTIXImport?: () => void;
  onMISPImport?: () => void;
}) {
  return (
    <div data-tour="ioc-stats-header" className="shrink-0 border-b border-gray-800">
      <div className="flex items-center gap-2 px-4 pt-3 pb-2">
        <Search size={16} />
        <span className="text-sm font-medium text-gray-200">IOC Analysis</span>
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
        <span className="text-xs text-gray-500">({uniqueIOCCount} unique)</span>
        <div className="ml-auto flex items-center gap-1.5">
          {onSTIXImport && (
            <button onClick={onSTIXImport} className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-gray-800 text-gray-300 hover:bg-gray-700 text-xs font-medium transition-colors">
              STIX
            </button>
          )}
          {onMISPImport && (
            <button onClick={onMISPImport} className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-gray-800 text-gray-300 hover:bg-gray-700 text-xs font-medium transition-colors">
              MISP
            </button>
          )}
          {onBulkImport && (
            <button onClick={onBulkImport} className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-gray-800 text-gray-300 hover:bg-gray-700 text-xs font-medium transition-colors">
              <ListPlus size={14} />
              Bulk Import
            </button>
          )}
          {onNewIOC && (
            <button onClick={onNewIOC} className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-accent/15 text-accent hover:bg-accent/25 text-xs font-medium transition-colors">
              <Plus size={14} />
              New IOC
            </button>
          )}
        </div>
      </div>

      {/* Tab bar */}
      <div className="flex gap-0 px-4">
        <TabButton
          active={activeTab === 'overview'}
          onClick={() => setActiveTab('overview')}
          icon={<BarChart3 size={13} />}
          label="Overview"
        />
        <TabButton
          active={activeTab === 'all-iocs'}
          onClick={() => setActiveTab('all-iocs')}
          icon={<List size={13} />}
          label="All IOCs"
          count={unifiedRowCount}
        />
      </div>
    </div>
  );
}

function TabButton({ active, onClick, icon, label, count }: {
  active: boolean; onClick: () => void; icon: React.ReactNode; label: string; count?: number;
}) {
  return (
    <button
      onClick={onClick}
      className={`flex items-center gap-1.5 px-3 py-2 text-xs font-medium border-b-2 transition-colors ${
        active
          ? 'border-accent text-accent'
          : 'border-transparent text-gray-500 hover:text-gray-300 hover:border-gray-700'
      }`}
    >
      {icon}
      {label}
      {count !== undefined && (
        <span className={`text-[10px] px-1.5 py-0 rounded-full ${active ? 'bg-accent/20 text-accent' : 'bg-gray-800 text-gray-500'}`}>
          {count}
        </span>
      )}
    </button>
  );
}

// ─── All IOCs Tab ──────────────────────────────────────────────────

function AllIOCsTab({
  rows, folders, allTags, allStandaloneIOCs,
  onCreateIOC, onUpdateIOC, onDeleteIOC,
  onTrashIOC, onRestoreIOC, onToggleArchiveIOC,
  defaultFolderId, currentFolderId, currentFolderName,
  onOpenSettings, onNavigateToSource, investigationMembers,
  iocTableColumns, onUpdateTableColumns,
}: {
  rows: UnifiedIOCRow[];
  folders: Folder[];
  allTags?: Tag[];
  allStandaloneIOCs?: StandaloneIOC[];
  onCreateIOC?: (data: Partial<StandaloneIOC>) => Promise<StandaloneIOC>;
  onUpdateIOC?: (id: string, updates: Partial<StandaloneIOC>) => void;
  onDeleteIOC?: (id: string) => void;
  onTrashIOC?: (id: string) => void;
  onRestoreIOC?: (id: string) => void;
  onToggleArchiveIOC?: (id: string) => void;
  defaultFolderId?: string;
  currentFolderId?: string;
  currentFolderName?: string;
  onOpenSettings?: () => void;
  onNavigateToSource?: (sourceType: 'note' | 'task' | 'event', sourceId: string) => void;
  investigationMembers?: InvestigationMember[];
  iocTableColumns?: string[];
  onUpdateTableColumns?: (columns: string[]) => void;
}) {
  const { getInstallationsForIOCType, addRun } = useIntegrations();
  const { addToast } = useToast();
  const { t: tt } = useTranslation('toast');

  const [showForm, setShowForm] = useState(false);
  const [showBulkImport, setShowBulkImport] = useState(false);
  const [showSTIXImport, setShowSTIXImport] = useState(false);
  const [showMISPImport, setShowMISPImport] = useState(false);
  const [editingIOC, setEditingIOC] = useState<StandaloneIOC | undefined>();
  const [deletingId, setDeletingId] = useState<string | null>(null);

  // Sort state
  const [sortField, setSortField] = useState<SortField>('value');
  const [sortDir, setSortDir] = useState<SortDir>('asc');

  // Filter state
  const [statusFilter, setStatusFilter] = useState<string | null>(null);
  const [confidenceFilter, setConfidenceFilter] = useState<ConfidenceLevel | null>(null);
  const [typeFilter, setTypeFilter] = useState<IOCType[]>([]);
  const [searchText, setSearchText] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  useEffect(() => {
    const id = setTimeout(() => setDebouncedSearch(searchText), 150);
    return () => clearTimeout(id);
  }, [searchText]);
  const [sourceFilter, setSourceFilter] = useState<'all' | 'note' | 'task' | 'event' | 'standalone'>('all');

  // Bulk selection state
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [showBulkDelete, setShowBulkDelete] = useState(false);
  const [showBulkStatusMenu, setShowBulkStatusMenu] = useState(false);
  const [showBulkConfidenceMenu, setShowBulkConfidenceMenu] = useState(false);
  const [showBulkTagInput, setShowBulkTagInput] = useState(false);
  const [bulkTagText, setBulkTagText] = useState('');

  // Export
  const [showExportMenu, setShowExportMenu] = useState(false);

  // Column customization state
  const [showColumnPicker, setShowColumnPicker] = useState(false);
  const visibleColumns = useMemo(() => new Set(iocTableColumns ?? DEFAULT_IOC_TABLE_COLUMNS), [iocTableColumns]);

  // Deduplication
  const [showDeduplicator, setShowDeduplicator] = useState(false);

  const handleSort = (field: SortField) => {
    if (sortField === field) {
      setSortDir(d => d === 'asc' ? 'desc' : 'asc');
    } else {
      setSortField(field);
      setSortDir('asc');
    }
  };

  const filteredSortedRows = useMemo(() => {
    let result = rows;

    if (debouncedSearch.trim()) {
      const q = debouncedSearch.trim().toLowerCase();
      result = result.filter(r => r.value.toLowerCase().includes(q) || r.source.toLowerCase().includes(q));
    }
    if (statusFilter) {
      result = result.filter(r => r.iocStatus === statusFilter);
    }
    if (confidenceFilter) {
      result = result.filter(r => r.confidence === confidenceFilter);
    }
    if (typeFilter.length > 0) {
      result = result.filter(r => typeFilter.includes(r.type));
    }
    if (sourceFilter !== 'all') {
      result = result.filter(r => r.sourceType === sourceFilter);
    }

    const sorted = [...result];
    const dir = sortDir === 'asc' ? 1 : -1;
    sorted.sort((a, b) => {
      switch (sortField) {
        case 'value': return dir * a.value.localeCompare(b.value);
        case 'type': return dir * getTypeInfo(a.type).label.localeCompare(getTypeInfo(b.type).label);
        case 'confidence': return dir * ((CONFIDENCE_ORDER[a.confidence] ?? 0) - (CONFIDENCE_ORDER[b.confidence] ?? 0));
        case 'source': return dir * a.source.localeCompare(b.source);
        case 'iocStatus': return dir * (a.iocStatus || '').localeCompare(b.iocStatus || '');
        case 'attribution': return dir * (a.attribution || '').localeCompare(b.attribution || '');
        default: return 0;
      }
    });
    return sorted;
  }, [rows, debouncedSearch, statusFilter, confidenceFilter, typeFilter, sourceFilter, sortField, sortDir]);

  const hasActiveFilters = searchText.trim() !== '' || statusFilter !== null || confidenceFilter !== null || typeFilter.length > 0 || sourceFilter !== 'all';

  const handleSubmit = async (data: Partial<StandaloneIOC>) => {
    if (editingIOC) {
      onUpdateIOC?.(editingIOC.id, data);
    } else {
      await onCreateIOC?.(data);
    }
    setEditingIOC(undefined);
  };

  const toggleTypeFilter = (type: IOCType) => {
    setTypeFilter(prev => prev.includes(type) ? prev.filter(t => t !== type) : [...prev, type]);
  };

  // ─── Bulk operations ────────────────────────────────────────
  const toggleSelect = (id: string) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const toggleSelectAll = () => {
    if (selectedIds.size === filteredSortedRows.length) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(filteredSortedRows.map(r => r.id)));
    }
  };

  const exportIOCs = (format: 'csv' | 'json' | 'txt') => {
    const data = filteredSortedRows;
    let content: string;
    let mimeType: string;
    let ext: string;

    if (format === 'txt') {
      content = data.map(r => r.value).join('\n');
      mimeType = 'text/plain';
      ext = 'txt';
    } else if (format === 'csv') {
      const escape = (v: string) => {
        let s = v;
        if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;
        if (s.includes(',') || s.includes('"') || s.includes('\n')) return '"' + s.replace(/"/g, '""') + '"';
        return s;
      };
      const headers = ['type', 'value', 'confidence', 'source', 'source_type', 'status', 'attribution', 'analyst_notes', 'updated_at'];
      const lines = [headers.join(',')];
      for (const r of data) {
        lines.push([
          escape(r.type),
          escape(r.value),
          escape(r.confidence),
          escape(r.source),
          escape(r.sourceType),
          escape(r.iocStatus || ''),
          escape(r.attribution || ''),
          escape(r.standaloneIOC?.analystNotes || ''),
          escape(new Date(r.updatedAt).toISOString()),
        ].join(','));
      }
      content = lines.join('\n');
      mimeType = 'text/csv';
      ext = 'csv';
    } else {
      content = JSON.stringify({
        exportedAt: new Date().toISOString(),
        count: data.length,
        iocs: data.map(r => ({
          type: r.type,
          value: r.value,
          confidence: r.confidence,
          source: r.source,
          sourceType: r.sourceType,
          status: r.iocStatus || null,
          attribution: r.attribution || null,
          analystNotes: r.standaloneIOC?.analystNotes || null,
          updatedAt: new Date(r.updatedAt).toISOString(),
        })),
      }, null, 2);
      mimeType = 'application/json';
      ext = 'json';
    }

    const blob = new Blob([content], { type: mimeType });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `threatcaddy-iocs-${new Date().toISOString().slice(0, 10)}.${ext}`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    addToast('success', tt('ioc.exported', { count: data.length, format: ext.toUpperCase() }));
  };

  const selectedStandaloneCount = useMemo(() => {
    return filteredSortedRows.filter(r => selectedIds.has(r.id) && r.sourceType === 'standalone').length;
  }, [filteredSortedRows, selectedIds]);

  const selectedExtractedCount = useMemo(() => {
    return filteredSortedRows.filter(r => selectedIds.has(r.id) && r.sourceType !== 'standalone').length;
  }, [filteredSortedRows, selectedIds]);

  const getSelectedStandaloneIds = () => {
    return filteredSortedRows
      .filter(r => selectedIds.has(r.id) && r.sourceType === 'standalone')
      .map(r => r.sourceId);
  };

  const handleBulkDelete = () => {
    const ids = getSelectedStandaloneIds();
    for (const id of ids) {
      if (onTrashIOC) onTrashIOC(id);
      else if (onDeleteIOC) onDeleteIOC(id);
    }
    setSelectedIds(new Set());
    setShowBulkDelete(false);
    addToast('success', tt('ioc.deleted', { count: ids.length }));
  };

  const handleBulkSetStatus = (status: string) => {
    const ids = getSelectedStandaloneIds();
    for (const id of ids) onUpdateIOC?.(id, { iocStatus: status });
    setSelectedIds(new Set());
    setShowBulkStatusMenu(false);
    addToast('success', tt('ioc.statusUpdated', { count: ids.length }));
  };

  const handleBulkSetConfidence = (confidence: ConfidenceLevel) => {
    const ids = getSelectedStandaloneIds();
    for (const id of ids) onUpdateIOC?.(id, { confidence });
    setSelectedIds(new Set());
    setShowBulkConfidenceMenu(false);
    addToast('success', tt('ioc.confidenceUpdated', { count: ids.length }));
  };

  const handleBulkAddTags = () => {
    if (!bulkTagText.trim()) return;
    const newTags = bulkTagText.split(',').map(t => t.trim()).filter(Boolean);
    const standaloneRows = filteredSortedRows.filter(r => selectedIds.has(r.id) && r.sourceType === 'standalone' && r.standaloneIOC);
    for (const row of standaloneRows) {
      const existing = row.standaloneIOC!.tags || [];
      const merged = [...new Set([...existing, ...newTags])];
      onUpdateIOC?.(row.sourceId, { tags: merged });
    }
    setSelectedIds(new Set());
    setShowBulkTagInput(false);
    setBulkTagText('');
    addToast('success', tt('ioc.tagsAdded', { count: standaloneRows.length }));
  };

  // ─── Column toggle helper ──────────────────────────────────
  const toggleColumn = (key: string) => {
    const col = ALL_IOC_TABLE_COLUMNS.find(c => c.key === key);
    if (col?.alwaysVisible) return;
    const currentCols = iocTableColumns ?? DEFAULT_IOC_TABLE_COLUMNS;
    const next = currentCols.includes(key)
      ? currentCols.filter(c => c !== key)
      : [...currentCols, key];
    onUpdateTableColumns?.(next);
  };

  const isColVisible = (key: string) => visibleColumns.has(key);

  const SortHeader = ({ field, label, className }: { field: SortField; label: string; className: string }) => (
    <th className={`${className} cursor-pointer select-none hover:text-gray-300 transition-colors`} onClick={() => handleSort(field)}>
      <span className="inline-flex items-center gap-0.5">
        {label}
        {sortField === field ? (sortDir === 'asc' ? <ChevronUp size={12} /> : <ChevronDown size={12} />) : <span className="w-3" />}
      </span>
    </th>
  );

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      {/* Action bar */}
      <div className="flex items-center justify-between px-4 py-2.5 border-b border-gray-800 shrink-0">
        <span className="text-xs text-gray-500 tabular-nums">
          {hasActiveFilters ? `${filteredSortedRows.length} / ${rows.length}` : rows.length} IOCs
        </span>
        <div className="flex items-center gap-2">
          {/* Column picker */}
          <div className="relative">
            <button
              onClick={() => setShowColumnPicker(!showColumnPicker)}
              className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-gray-800 text-gray-300 hover:bg-gray-700 text-xs font-medium transition-colors"
              title="Configure columns"
            >
              <Columns size={14} />
            </button>
            {showColumnPicker && (
              <div className="absolute right-0 top-full mt-1 z-50 bg-gray-900 border border-gray-700 rounded-lg shadow-xl py-1 w-48">
                {ALL_IOC_TABLE_COLUMNS.map(col => (
                  <button
                    key={col.key}
                    onClick={() => toggleColumn(col.key)}
                    disabled={col.alwaysVisible}
                    className="w-full flex items-center gap-2 px-3 py-1.5 text-xs hover:bg-gray-800 disabled:opacity-50"
                  >
                    <span className={`w-3.5 h-3.5 rounded border ${isColVisible(col.key) ? 'bg-accent border-accent' : 'border-gray-600'} flex items-center justify-center`}>
                      {isColVisible(col.key) && <span className="text-white text-[8px]">&#10003;</span>}
                    </span>
                    <span className="text-gray-300">{col.label}</span>
                    {col.hiddenByDefault && <span className="text-[9px] text-gray-600 ml-auto">hidden</span>}
                  </button>
                ))}
                <div className="border-t border-gray-700 mt-1 pt-1 px-3">
                  <button
                    onClick={() => { onUpdateTableColumns?.(DEFAULT_IOC_TABLE_COLUMNS); setShowColumnPicker(false); }}
                    className="text-[10px] text-gray-500 hover:text-gray-300 py-0.5"
                  >
                    Reset to defaults
                  </button>
                </div>
              </div>
            )}
          </div>

          {/* Find Duplicates */}
          {allStandaloneIOCs && allStandaloneIOCs.length > 1 && onUpdateIOC && onDeleteIOC && (
            <button
              onClick={() => setShowDeduplicator(true)}
              className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-gray-800 text-gray-300 hover:bg-gray-700 text-xs font-medium transition-colors"
              title="Find duplicate IOCs"
            >
              <GitMerge size={14} />
              Dedup
            </button>
          )}

          {filteredSortedRows.length > 0 && (
            <>
              <button
                onClick={async () => {
                  const text = filteredSortedRows.map(r => r.value).join('\n');
                  try {
                    await navigator.clipboard.writeText(text);
                    addToast('success', tt('ioc.copiedToClipboard', { count: filteredSortedRows.length }));
                  } catch {
                    addToast('error', tt('ioc.copyFailed'));
                  }
                }}
                className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-gray-800 text-gray-300 hover:bg-gray-700 text-xs font-medium transition-colors"
                title="Copy visible IOC values to clipboard"
              >
                <Clipboard size={14} />
                Copy
              </button>

              {/* Export dropdown */}
              <div className="relative">
                <button
                  onClick={() => setShowExportMenu(!showExportMenu)}
                  className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-gray-800 text-gray-300 hover:bg-gray-700 text-xs font-medium transition-colors"
                  title="Export IOCs"
                >
                  <Download size={14} />
                  Export
                </button>
                {showExportMenu && (
                  <div className="absolute right-0 top-full mt-1 z-50 bg-gray-900 border border-gray-700 rounded-lg shadow-xl py-1 w-40">
                    <button
                      onClick={() => { exportIOCs('csv'); setShowExportMenu(false); }}
                      className="w-full flex items-center gap-2 px-3 py-1.5 text-xs text-gray-300 hover:bg-gray-800"
                    >
                      CSV (.csv)
                    </button>
                    <button
                      onClick={() => { exportIOCs('json'); setShowExportMenu(false); }}
                      className="w-full flex items-center gap-2 px-3 py-1.5 text-xs text-gray-300 hover:bg-gray-800"
                    >
                      JSON (.json)
                    </button>
                    <button
                      onClick={() => { exportIOCs('txt'); setShowExportMenu(false); }}
                      className="w-full flex items-center gap-2 px-3 py-1.5 text-xs text-gray-300 hover:bg-gray-800"
                    >
                      Plain text (.txt)
                    </button>
                  </div>
                )}
              </div>
            </>
          )}
          {onCreateIOC && (
            <>
              <button
                onClick={() => setShowBulkImport(true)}
                className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-gray-800 text-gray-300 hover:bg-gray-700 text-xs font-medium transition-colors"
                title="Bulk import IOCs"
              >
                <ListPlus size={14} />
                Bulk Import
              </button>
              <button
                onClick={() => setShowSTIXImport(true)}
                className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-gray-800 text-gray-300 hover:bg-gray-700 text-xs font-medium transition-colors"
                title="Import STIX 2.1 bundle"
              >
                <ListPlus size={14} />
                Import STIX
              </button>
              <button
                onClick={() => setShowMISPImport(true)}
                className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-gray-800 text-gray-300 hover:bg-gray-700 text-xs font-medium transition-colors"
                title="Import MISP event"
              >
                <ListPlus size={14} />
                Import MISP
              </button>
              <button
                onClick={() => { setEditingIOC(undefined); setShowForm(true); }}
                className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-accent/15 text-accent hover:bg-accent/25 text-xs font-medium transition-colors"
              >
                <Plus size={14} />
                New IOC
              </button>
            </>
          )}
        </div>
      </div>

      {/* Bulk action bar */}
      {selectedIds.size > 0 && (
        <div className="flex items-center gap-2 px-4 py-2 border-b border-gray-800 bg-accent/5 shrink-0 flex-wrap">
          <span className="text-xs font-medium text-accent">{selectedIds.size} selected</span>
          {selectedExtractedCount > 0 && (
            <span className="text-[10px] text-gray-500">({selectedStandaloneCount} standalone, {selectedExtractedCount} extracted)</span>
          )}
          <div className="w-px h-4 bg-gray-700" />

          {/* Delete */}
          {selectedStandaloneCount > 0 && (onTrashIOC || onDeleteIOC) && (
            <button
              onClick={() => setShowBulkDelete(true)}
              className="flex items-center gap-1 px-2 py-1 rounded bg-red-900/20 text-red-400 hover:bg-red-900/40 text-xs"
            >
              <Trash2 size={12} />
              Delete ({selectedStandaloneCount})
            </button>
          )}

          {/* Set Status */}
          {selectedStandaloneCount > 0 && onUpdateIOC && (
            <div className="relative">
              <button
                onClick={() => setShowBulkStatusMenu(!showBulkStatusMenu)}
                className="flex items-center gap-1 px-2 py-1 rounded bg-gray-800 text-gray-300 hover:bg-gray-700 text-xs"
              >
                Set Status <ChevronDown size={10} />
              </button>
              {showBulkStatusMenu && (
                <div className="absolute top-full left-0 mt-1 z-50 bg-gray-900 border border-gray-700 rounded-lg shadow-xl py-1 w-44">
                  {STATUS_OPTIONS.map(s => (
                    <button
                      key={s}
                      onClick={() => handleBulkSetStatus(s)}
                      className="w-full px-3 py-1.5 text-xs text-gray-300 hover:bg-gray-800 text-left flex items-center gap-2"
                    >
                      <span className="w-2 h-2 rounded-full" style={{ backgroundColor: STATUS_COLORS[s] }} />
                      {STATUS_LABELS[s]}
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Set Confidence */}
          {selectedStandaloneCount > 0 && onUpdateIOC && (
            <div className="relative">
              <button
                onClick={() => setShowBulkConfidenceMenu(!showBulkConfidenceMenu)}
                className="flex items-center gap-1 px-2 py-1 rounded bg-gray-800 text-gray-300 hover:bg-gray-700 text-xs"
              >
                Set Confidence <ChevronDown size={10} />
              </button>
              {showBulkConfidenceMenu && (
                <div className="absolute top-full left-0 mt-1 z-50 bg-gray-900 border border-gray-700 rounded-lg shadow-xl py-1 w-36">
                  {CONFIDENCE_OPTIONS.map(c => {
                    const info = getConfInfo(c);
                    return (
                      <button
                        key={c}
                        onClick={() => handleBulkSetConfidence(c)}
                        className="w-full px-3 py-1.5 text-xs text-gray-300 hover:bg-gray-800 text-left flex items-center gap-2"
                      >
                        <span className="w-2 h-2 rounded-full" style={{ backgroundColor: info.color }} />
                        {info.label}
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          )}

          {/* Add Tags */}
          {selectedStandaloneCount > 0 && onUpdateIOC && (
            <div className="relative">
              <button
                onClick={() => setShowBulkTagInput(!showBulkTagInput)}
                className="flex items-center gap-1 px-2 py-1 rounded bg-gray-800 text-gray-300 hover:bg-gray-700 text-xs"
              >
                <TagIcon size={12} />
                Add Tags
              </button>
              {showBulkTagInput && (
                <div className="absolute top-full left-0 mt-1 z-50 bg-gray-900 border border-gray-700 rounded-lg shadow-xl p-2 w-56">
                  <input
                    type="text"
                    autoFocus
                    maxLength={500}
                    value={bulkTagText}
                    onChange={e => setBulkTagText(e.target.value)}
                    onKeyDown={e => { if (e.key === 'Enter') handleBulkAddTags(); }}
                    placeholder="tag1, tag2, ..."
                    className="w-full bg-gray-800 border border-gray-700 rounded px-2 py-1 text-xs text-gray-200 focus:outline-none focus:border-gray-600"
                  />
                  <button
                    onClick={handleBulkAddTags}
                    disabled={!bulkTagText.trim()}
                    className="mt-1.5 w-full px-2 py-1 rounded bg-accent/15 text-accent text-xs font-medium hover:bg-accent/25 disabled:opacity-50"
                  >
                    Apply Tags
                  </button>
                </div>
              )}
            </div>
          )}

          <button
            onClick={() => setSelectedIds(new Set())}
            className="ml-auto text-xs text-gray-500 hover:text-gray-300 px-2 py-1"
          >
            Clear selection
          </button>
        </div>
      )}

      {/* Filter bar */}
      <div className="flex flex-col gap-2 px-4 pt-2.5 pb-2 border-b border-gray-800 shrink-0">
        <div className="relative">
          <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-500" />
          <input
            type="text"
            value={searchText}
            onChange={e => setSearchText(e.target.value)}
            placeholder="Filter by value or source..."
            className="w-full pl-8 pr-8 py-1.5 rounded-md bg-gray-800 border border-gray-700 text-xs text-gray-200 placeholder-gray-500 focus:outline-none focus:border-gray-600"
          />
          {searchText && (
            <button onClick={() => setSearchText('')} className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-500 hover:text-gray-300">
              <X size={12} />
            </button>
          )}
        </div>

        <div className="flex items-center gap-1 flex-wrap">
          <span className="text-[10px] text-gray-500 uppercase tracking-wide mr-1">Source</span>
          {(['all', 'note', 'task', 'event', 'standalone'] as const).map(s => {
            const active = sourceFilter === s;
            const labels: Record<string, string> = { all: 'All', note: 'Notes', task: 'Tasks', event: 'Events', standalone: 'Standalone' };
            const colors: Record<string, string> = { all: '#6b7280', note: '#3b82f6', task: '#22c55e', event: '#6366f1', standalone: '#f59e0b' };
            const color = colors[s];
            return (
              <button
                key={s}
                onClick={() => setSourceFilter(active && s !== 'all' ? 'all' : s)}
                className="text-[10px] px-2 py-0.5 rounded-full border transition-colors"
                style={{
                  backgroundColor: active ? `${color}30` : `${color}10`,
                  borderColor: active ? `${color}60` : `${color}20`,
                  color: active ? color : `${color}90`,
                }}
              >
                {labels[s]}
              </button>
            );
          })}
        </div>

        <div className="flex items-center gap-1 flex-wrap">
          <span className="text-[10px] text-gray-500 uppercase tracking-wide mr-1">Status</span>
          <button
            onClick={() => setStatusFilter(null)}
            className={`text-[10px] px-2 py-0.5 rounded-full border transition-colors ${
              statusFilter === null
                ? 'bg-gray-600/40 border-gray-500 text-gray-200'
                : 'bg-gray-800/50 border-gray-700 text-gray-500 hover:text-gray-300 hover:border-gray-600'
            }`}
          >
            All
          </button>
          {STATUS_OPTIONS.map(s => {
            const color = STATUS_COLORS[s] || '#6b7280';
            const active = statusFilter === s;
            return (
              <button
                key={s}
                onClick={() => setStatusFilter(active ? null : s)}
                className="text-[10px] px-2 py-0.5 rounded-full border transition-colors"
                style={{
                  backgroundColor: active ? `${color}30` : `${color}10`,
                  borderColor: active ? `${color}60` : `${color}20`,
                  color: active ? color : `${color}90`,
                }}
              >
                {STATUS_LABELS[s] || s}
              </button>
            );
          })}
        </div>

        <div className="flex items-center gap-1 flex-wrap">
          <span className="text-[10px] text-gray-500 uppercase tracking-wide mr-1">Confidence</span>
          <button
            onClick={() => setConfidenceFilter(null)}
            className={`text-[10px] px-2 py-0.5 rounded-full border transition-colors ${
              confidenceFilter === null
                ? 'bg-gray-600/40 border-gray-500 text-gray-200'
                : 'bg-gray-800/50 border-gray-700 text-gray-500 hover:text-gray-300 hover:border-gray-600'
            }`}
          >
            All
          </button>
          {CONFIDENCE_OPTIONS.map(c => {
            const info = getConfInfo(c);
            const active = confidenceFilter === c;
            return (
              <button
                key={c}
                onClick={() => setConfidenceFilter(active ? null : c)}
                className="text-[10px] px-2 py-0.5 rounded-full border transition-colors"
                style={{
                  backgroundColor: active ? `${info.color}30` : `${info.color}10`,
                  borderColor: active ? `${info.color}60` : `${info.color}20`,
                  color: active ? info.color : `${info.color}90`,
                }}
              >
                {info.label}
              </button>
            );
          })}
        </div>

        <div className="flex items-center gap-1 flex-wrap">
          <span className="text-[10px] text-gray-500 uppercase tracking-wide mr-1">Type</span>
          {ALL_IOC_TYPES.map(type => {
            const info = getTypeInfo(type);
            const active = typeFilter.includes(type);
            return (
              <button
                key={type}
                onClick={() => toggleTypeFilter(type)}
                className="text-[10px] px-2 py-0.5 rounded-full border transition-colors"
                style={{
                  backgroundColor: active ? `${info.color}30` : `${info.color}10`,
                  borderColor: active ? `${info.color}60` : `${info.color}20`,
                  color: active ? info.color : `${info.color}90`,
                }}
              >
                {info.label}
              </button>
            );
          })}
          {typeFilter.length > 0 && (
            <button onClick={() => setTypeFilter([])} className="text-[10px] text-gray-500 hover:text-gray-300 px-1.5">
              Clear
            </button>
          )}
        </div>

        {hasActiveFilters && (
          <div className="flex items-center justify-between">
            <span className="text-[10px] text-gray-500">Showing {filteredSortedRows.length} of {rows.length}</span>
            <button
              onClick={() => { setSearchText(''); setStatusFilter(null); setConfidenceFilter(null); setTypeFilter([]); setSourceFilter('all'); }}
              className="text-[10px] text-gray-500 hover:text-gray-300"
            >
              Clear all filters
            </button>
          </div>
        )}
      </div>

      {/* Table */}
      <div className="flex-1 overflow-hidden px-4 pt-2 pb-4">
        {rows.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-12 text-gray-600">
            <Search size={36} className="mb-3" />
            <p className="text-lg font-medium">No IOCs yet</p>
            <p className="text-sm mt-1">Analyze entities or create standalone IOCs to see them here.</p>
          </div>
        ) : filteredSortedRows.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-12 text-gray-600">
            <Search size={36} className="mb-3" />
            <p className="text-lg font-medium">No IOCs match filters</p>
            <p className="text-sm mt-1">Try adjusting your filter criteria</p>
          </div>
        ) : (
          <div className="h-full">
            <TableVirtuoso
              data={filteredSortedRows}
              components={{
                Table: (props) => <table {...props} className="w-full min-w-[700px] text-xs" />,
                TableHead: forwardRef((props, ref) => <thead ref={ref} {...props} />),
                TableRow: (props) => <tr {...props} className="border-b border-gray-800/50 group" />,
                TableBody: forwardRef((props, ref) => <tbody ref={ref} {...props} />),
              }}
              fixedHeaderContent={() => (
                <tr className="border-b border-gray-800 bg-gray-900">
                  <th className="text-left text-gray-500 font-medium py-2 pr-1 w-8">
                    <input
                      type="checkbox"
                      checked={filteredSortedRows.length > 0 && selectedIds.size === filteredSortedRows.length}
                      onChange={toggleSelectAll}
                      className="rounded border-gray-600 bg-gray-800 text-accent focus:ring-0 focus:ring-offset-0 w-3.5 h-3.5 cursor-pointer"
                    />
                  </th>
                  <SortHeader field="value" label="Value" className="text-left text-gray-500 font-medium py-2 pr-2" />
                  {isColVisible('type') && <SortHeader field="type" label="Type" className="text-left text-gray-500 font-medium py-2 px-2" />}
                  {isColVisible('confidence') && <SortHeader field="confidence" label="Confidence" className="text-left text-gray-500 font-medium py-2 px-2" />}
                  {isColVisible('source') && <SortHeader field="source" label="Source" className="text-left text-gray-500 font-medium py-2 px-2" />}
                  {isColVisible('iocStatus') && <SortHeader field="iocStatus" label="Status" className="text-left text-gray-500 font-medium py-2 px-2" />}
                  {isColVisible('attribution') && <SortHeader field="attribution" label="Attribution" className="text-left text-gray-500 font-medium py-2 px-2" />}
                  {isColVisible('clsLevel') && <th className="text-left text-gray-500 font-medium py-2 px-2" title="Classification">CLS</th>}
                  {isColVisible('updatedAt') && <th className="text-left text-gray-500 font-medium py-2 px-2">Updated</th>}
                  {isColVisible('analystNotes') && <th className="text-left text-gray-500 font-medium py-2 px-2">Notes</th>}
                  {isColVisible('tags') && <th className="text-left text-gray-500 font-medium py-2 px-2">Tags</th>}
                  {isColVisible('firstSeen') && <th className="text-left text-gray-500 font-medium py-2 px-2">First Seen</th>}
                  {isColVisible('labels') && <th className="text-left text-gray-500 font-medium py-2 px-2">Labels</th>}
                  <th className="text-right text-gray-500 font-medium py-2 pl-2">Actions</th>
                </tr>
              )}
              itemContent={(_index, row) => {
                const typeInfo = getTypeInfo(row.type);
                const confInfo = getConfInfo(row.confidence);
                const statusColor = row.iocStatus ? STATUS_COLORS[row.iocStatus] || '#6b7280' : undefined;
                const sourceColor: Record<string, string> = { note: '#3b82f6', task: '#22c55e', event: '#6366f1', standalone: '#f59e0b' };
                const sColor = sourceColor[row.sourceType] || '#6b7280';
                const si = row.standaloneIOC;
                const CLS_COLORS: Record<string, string> = {
                  'TLP:CLEAR': '#ffffff', 'TLP:GREEN': '#22c55e', 'TLP:AMBER': '#f59e0b', 'TLP:AMBER+STRICT': '#f59e0b', 'TLP:RED': '#ef4444',
                };
                const clsLevel = si?.clsLevel;
                const clsColor = clsLevel ? CLS_COLORS[clsLevel] || '#6b7280' : undefined;
                return (
                  <>
                    <td className="py-2 pr-1 w-8">
                      <input
                        type="checkbox"
                        checked={selectedIds.has(row.id)}
                        onChange={() => toggleSelect(row.id)}
                        className="rounded border-gray-600 bg-gray-800 text-accent focus:ring-0 focus:ring-offset-0 w-3.5 h-3.5 cursor-pointer"
                      />
                    </td>
                    <td className="py-2 pr-2 text-gray-200 font-mono max-w-[220px] truncate">{row.value}</td>
                    {isColVisible('type') && (
                      <td className="py-2 px-2">
                        <span className="text-[10px] px-1.5 py-0.5 rounded" style={{ backgroundColor: typeInfo.color + '22', color: typeInfo.color }}>
                          {typeInfo.label}
                        </span>
                      </td>
                    )}
                    {isColVisible('confidence') && (
                      <td className="py-2 px-2">
                        <span className="text-[10px] px-1.5 py-0.5 rounded" style={{ backgroundColor: confInfo.color + '22', color: confInfo.color }}>
                          {confInfo.label}
                        </span>
                      </td>
                    )}
                    {isColVisible('source') && (
                      <td className="py-2 px-2">
                        <span className="text-[10px] px-1.5 py-0.5 rounded" style={{ backgroundColor: sColor + '18', color: sColor }}>
                          {row.source}
                        </span>
                      </td>
                    )}
                    {isColVisible('iocStatus') && (
                      <td className="py-2 px-2">
                        {row.iocStatus ? (
                          <span className="text-[10px] px-1.5 py-0.5 rounded" style={{ backgroundColor: statusColor + '22', color: statusColor }}>
                            {STATUS_LABELS[row.iocStatus] || row.iocStatus}
                          </span>
                        ) : (
                          <span className="text-gray-600">--</span>
                        )}
                      </td>
                    )}
                    {isColVisible('attribution') && (
                      <td className="py-2 px-2 text-gray-400 max-w-[120px] truncate">{row.attribution || '--'}</td>
                    )}
                    {isColVisible('clsLevel') && (
                      <td className="py-2 px-2">
                        {clsLevel ? (
                          <span className="text-[10px] px-1.5 py-0.5 rounded font-medium" style={{ backgroundColor: clsColor + '22', color: clsColor }}>
                            {clsLevel}
                          </span>
                        ) : (
                          <span className="text-gray-600">--</span>
                        )}
                      </td>
                    )}
                    {isColVisible('updatedAt') && (
                      <td className="py-2 px-2 text-gray-500">{formatDate(row.updatedAt)}</td>
                    )}
                    {isColVisible('analystNotes') && (
                      <td className="py-2 px-2 text-gray-400 max-w-[180px] truncate" title={si?.analystNotes || ''}>
                        {si?.analystNotes || <span className="text-gray-600">--</span>}
                      </td>
                    )}
                    {isColVisible('tags') && (
                      <td className="py-2 px-2">
                        {si && si.tags.length > 0 ? (
                          <div className="flex gap-0.5 flex-wrap max-w-[120px]">
                            {si.tags.slice(0, 3).map(t => (
                              <span key={t} className="text-[9px] px-1 py-0 rounded bg-gray-700 text-gray-400">{t}</span>
                            ))}
                            {si.tags.length > 3 && <span className="text-[9px] text-gray-600">+{si.tags.length - 3}</span>}
                          </div>
                        ) : (
                          <span className="text-gray-600">--</span>
                        )}
                      </td>
                    )}
                    {isColVisible('firstSeen') && (
                      <td className="py-2 px-2 text-gray-500">
                        {si ? formatDate(si.createdAt) : '--'}
                      </td>
                    )}
                    {isColVisible('labels') && (
                      <td className="py-2 px-2">
                        <EnrichmentLabels enrichment={si?.enrichment} maxVisible={4} compact />
                      </td>
                    )}
                    <td className="py-2 pl-2">
                      <div className="flex items-center justify-end gap-1 opacity-40 group-hover:opacity-100 group-focus-within:opacity-100 transition-opacity">
                        {row.sourceType === 'standalone' && row.standaloneIOC ? (
                          <>
                            <RunIntegrationMenu
                              ioc={{ id: row.standaloneIOC.id, value: row.standaloneIOC.value, type: row.standaloneIOC.type, confidence: row.standaloneIOC.confidence }}
                              investigation={currentFolderId ? { id: currentFolderId, name: currentFolderName || '' } : undefined}
                              matching={getInstallationsForIOCType(row.standaloneIOC.type)}
                              addRun={addRun}
                              onOpenSettings={onOpenSettings}
                            />
                            {onUpdateIOC && (
                              <button
                                onClick={() => { setEditingIOC(row.standaloneIOC); setShowForm(true); }}
                                className="p-1 rounded hover:bg-gray-700 text-gray-500 hover:text-gray-300"
                                title="Edit"
                              >
                                <Pencil size={14} />
                              </button>
                            )}
                            {onToggleArchiveIOC && (
                              <button
                                onClick={() => onToggleArchiveIOC(row.sourceId)}
                                className="p-1 rounded hover:bg-gray-700 text-gray-500 hover:text-gray-300"
                                title={row.standaloneIOC.archived ? 'Unarchive' : 'Archive'}
                              >
                                <Archive size={14} />
                              </button>
                            )}
                            {row.standaloneIOC.trashed ? (
                              <>
                                {onRestoreIOC && (
                                  <button onClick={() => onRestoreIOC(row.sourceId)} className="p-1 rounded hover:bg-gray-700 text-gray-500 hover:text-green-400" title="Restore">
                                    <RotateCcw size={14} />
                                  </button>
                                )}
                                {onDeleteIOC && (
                                  <button onClick={() => setDeletingId(row.sourceId)} className="p-1 rounded hover:bg-gray-700 text-gray-500 hover:text-red-400" title="Delete permanently">
                                    <Trash2 size={14} />
                                  </button>
                                )}
                              </>
                            ) : (
                              onTrashIOC ? (
                                <button onClick={() => onTrashIOC(row.sourceId)} className="p-1 rounded hover:bg-gray-700 text-gray-500 hover:text-red-400" title="Move to trash">
                                  <Trash2 size={14} />
                                </button>
                              ) : onDeleteIOC ? (
                                <button onClick={() => setDeletingId(row.sourceId)} className="p-1 rounded hover:bg-gray-700 text-gray-500 hover:text-red-400" title="Delete">
                                  <Trash2 size={14} />
                                </button>
                              ) : null
                            )}
                          </>
                        ) : (
                          <>
                            <RunIntegrationMenu
                              ioc={{ id: row.id, value: row.value, type: row.type, confidence: row.confidence }}
                              investigation={currentFolderId ? { id: currentFolderId, name: currentFolderName || '' } : undefined}
                              matching={getInstallationsForIOCType(row.type)}
                              addRun={addRun}
                              onOpenSettings={onOpenSettings}
                            />
                            {onNavigateToSource && (
                              <button
                                onClick={() => onNavigateToSource(row.sourceType as 'note' | 'task' | 'event', row.sourceId)}
                                className="p-1 rounded hover:bg-gray-700 text-gray-500 hover:text-accent"
                                title={`Go to ${row.sourceType}`}
                              >
                                <ExternalLink size={14} />
                              </button>
                            )}
                          </>
                        )}
                      </div>
                    </td>
                  </>
                );
              }}
            />
          </div>
        )}
      </div>

      {/* Modals */}
      {onCreateIOC && (
        <>
          <StandaloneIOCForm
            open={showForm}
            onClose={() => { setShowForm(false); setEditingIOC(undefined); }}
            onSubmit={handleSubmit}
            folders={folders}
            defaultFolderId={defaultFolderId}
            editingIOC={editingIOC}
            allTags={allTags}
            onUpdateIOC={onUpdateIOC}
            investigationMembers={investigationMembers}
          />
          <BulkIOCImportModal
            open={showBulkImport}
            onClose={() => setShowBulkImport(false)}
            onCreate={onCreateIOC}
            existingIOCs={allStandaloneIOCs ?? []}
            folders={folders}
            allTags={allTags}
            defaultFolderId={defaultFolderId}
          />
          <STIXImportModal
            open={showSTIXImport}
            onClose={() => setShowSTIXImport(false)}
            onCreate={onCreateIOC}
            existingIOCs={allStandaloneIOCs ?? []}
            folders={folders}
            allTags={allTags}
            defaultFolderId={defaultFolderId}
          />
          <MISPImportModal
            open={showMISPImport}
            onClose={() => setShowMISPImport(false)}
            onCreate={onCreateIOC}
            existingIOCs={allStandaloneIOCs ?? []}
            folders={folders}
            allTags={allTags}
            defaultFolderId={defaultFolderId}
          />
        </>
      )}

      <ConfirmDialog
        open={deletingId !== null}
        onClose={() => setDeletingId(null)}
        onConfirm={() => { if (deletingId && onDeleteIOC) { onDeleteIOC(deletingId); setDeletingId(null); } }}
        title="Delete IOC"
        message="This IOC will be permanently deleted. This cannot be undone."
        confirmLabel="Delete IOC"
        danger
      />

      {/* Bulk delete confirmation */}
      <ConfirmDialog
        open={showBulkDelete}
        onClose={() => setShowBulkDelete(false)}
        onConfirm={handleBulkDelete}
        title="Delete Selected IOCs"
        message={`Delete ${selectedStandaloneCount} standalone IOC${selectedStandaloneCount !== 1 ? 's' : ''}? This cannot be undone.${selectedExtractedCount > 0 ? ` (${selectedExtractedCount} extracted IOCs will be skipped)` : ''}`}
        confirmLabel={`Delete ${selectedStandaloneCount}`}
        danger
      />

      {/* Deduplicator */}
      {allStandaloneIOCs && onUpdateIOC && onDeleteIOC && (
        <IOCDeduplicator
          open={showDeduplicator}
          onClose={() => setShowDeduplicator(false)}
          iocs={allStandaloneIOCs}
          onUpdate={onUpdateIOC}
          onDelete={onDeleteIOC}
        />
      )}
    </div>
  );
}

// ─── Shared UI Components ──────────────────────────────────────────

function SummaryCard({ label, value, sub, color }: { label: string; value: string | number; sub?: string; color: string }) {
  return (
    <div className="bg-gray-800/40 rounded-lg p-3.5 border border-gray-700/40" style={{ borderLeftColor: color + '60', borderLeftWidth: 3 }}>
      <div className="text-[10px] text-gray-500 uppercase tracking-wider">{label}</div>
      <div className="text-2xl font-bold mt-1 truncate" style={{ color }}>{value}</div>
      {sub && <div className="text-[11px] text-gray-500 mt-0.5">{sub}</div>}
    </div>
  );
}

function SourceCard({ value, label, color }: { value: number; label: string; color: string }) {
  return (
    <div className="bg-gray-800/40 rounded-lg p-3 text-center border border-gray-700/30">
      <div className="text-2xl font-bold tabular-nums" style={{ color }}>{value}</div>
      <div className="text-[10px] text-gray-500 uppercase tracking-wider mt-0.5">{label}</div>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-3">{title}</h3>
      {children}
    </div>
  );
}
