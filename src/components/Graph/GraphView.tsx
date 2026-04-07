import React, { Suspense, useState, useMemo, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { Loader2, Search, Network, Maximize2, ChevronDown, ChevronRight, HelpCircle, X as XIcon, PanelLeftClose, PanelLeftOpen } from 'lucide-react';
import type { Note, Task, TimelineEvent, Settings, IOCType } from '../../types';
import { IOC_TYPE_LABELS } from '../../types';
import { buildGraphData } from '../../lib/graph-data';
import type { GraphNode, GraphEdge } from '../../lib/graph-data';
import { GraphDetailPanel } from './GraphDetailPanel';
import { GraphIOCEditDialog } from './GraphIOCEditDialog';
import { GraphLinkDialog } from './GraphLinkDialog';
import type { LayoutName } from './GraphCanvas';
import { getLegendEntries } from '../../lib/graph-icons';

const GraphCanvas = React.lazy(() => import('./GraphCanvas'));

const ALL_IOC_TYPES = Object.keys(IOC_TYPE_LABELS) as IOCType[];

interface GraphViewProps {
  notes: Note[];
  tasks: Task[];
  timelineEvents: TimelineEvent[];
  settings: Settings;
  layout?: LayoutName;
  onLayoutChange?: (layout: LayoutName) => void;
  onNavigateToNote: (id: string) => void;
  onNavigateToTask: (id: string) => void;
  onNavigateToTimelineEvent: (id: string) => void;
  onUpdateNote?: (id: string, updates: Partial<Note>) => void;
  onUpdateTask?: (id: string, updates: Partial<Task>) => void;
  onUpdateEvent?: (id: string, updates: Partial<TimelineEvent>) => void;
  scopedNotes?: Note[];
  scopedTasks?: Task[];
  scopedTimelineEvents?: TimelineEvent[];
  selectedFolderId?: string;
  selectedFolderName?: string;
  visible?: boolean;
}

type NodeTypeFilter = 'ioc' | 'note' | 'task' | 'timeline-event';
type EdgeTypeFilter = GraphEdge['type'];

const ALL_EDGE_TYPES: { key: EdgeTypeFilter; labelKey: string; color: string }[] = [
  { key: 'contains-ioc', labelKey: 'view.containsIOC', color: '#4b5563' },
  { key: 'ioc-relationship', labelKey: 'view.iocRelations', color: '#f59e0b' },
  { key: 'timeline-link', labelKey: 'view.timelineLinks', color: '#6366f1' },
  { key: 'entity-link', labelKey: 'view.entityLinks', color: '#22c55e' },
];

export function GraphView({ notes, tasks, timelineEvents, settings, layout: externalLayout, onLayoutChange, onNavigateToNote, onNavigateToTask, onNavigateToTimelineEvent, onUpdateNote, onUpdateTask, onUpdateEvent, scopedNotes, scopedTasks, scopedTimelineEvents, selectedFolderId, selectedFolderName, visible = true }: GraphViewProps) {
  const { t } = useTranslation('graph');
  const [internalLayout, setInternalLayout] = useState<LayoutName>('cose-bilkent');
  const layout = externalLayout ?? internalLayout;
  const handleLayoutChange = onLayoutChange ?? setInternalLayout;
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [scopeMode, setScopeMode] = useState<'investigation' | 'global'>('investigation');
  const [selectedNodeIds, setSelectedNodeIds] = useState<string[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [visibleNodeTypes, setVisibleNodeTypes] = useState<Set<NodeTypeFilter>>(new Set(['ioc', 'note', 'task', 'timeline-event']));
  const [visibleIOCTypes, setVisibleIOCTypes] = useState<Set<IOCType>>(new Set(ALL_IOC_TYPES));
  const [visibleEdgeTypes, setVisibleEdgeTypes] = useState<Set<EdgeTypeFilter>>(new Set(['contains-ioc', 'ioc-relationship', 'timeline-link', 'entity-link']));
  const [editingIOCNode, setEditingIOCNode] = useState<GraphNode | null>(null);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [linkDialogState, setLinkDialogState] = useState<{ sourceNodeId: string; targetNodeId: string } | null>(null);
  const [fitTrigger, setFitTrigger] = useState(0);
  const [legendOpen, setLegendOpen] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  // Reset scope mode when investigation changes
  React.useEffect(() => {
    setScopeMode('investigation');
  }, [selectedFolderId]);

  // Determine which data arrays to use based on scope
  const effectiveNotes = selectedFolderId && scopeMode === 'investigation' && scopedNotes ? scopedNotes : notes;
  const effectiveTasks = selectedFolderId && scopeMode === 'investigation' && scopedTasks ? scopedTasks : tasks;
  const effectiveEvents = selectedFolderId && scopeMode === 'investigation' && scopedTimelineEvents ? scopedTimelineEvents : timelineEvents;

  // Stable ref to full graph data for use in cytoscape callbacks
  const fullGraphDataRef = React.useRef<ReturnType<typeof buildGraphData>>({ nodes: [], edges: [] });

  // Build full graph data — skip expensive computation when not visible
  const fullGraphData = useMemo(() => {
    if (!visible) return { nodes: [] as GraphNode[], edges: [] as GraphEdge[] };
    return buildGraphData(effectiveNotes, effectiveTasks, effectiveEvents, settings);
  }, [visible, effectiveNotes, effectiveTasks, effectiveEvents, settings]);

  // Keep ref in sync for use in cytoscape callbacks (outside render)
  React.useEffect(() => {
    fullGraphDataRef.current = fullGraphData;
  }, [fullGraphData]);

  // Filter graph data
  const filteredGraphData = useMemo(() => {
    const query = searchQuery.toLowerCase();
    const filteredNodes = fullGraphData.nodes.filter((node) => {
      // Node type filter
      if (!visibleNodeTypes.has(node.type)) return false;
      // IOC type filter
      if (node.type === 'ioc' && node.iocType && !visibleIOCTypes.has(node.iocType)) return false;
      // Search filter
      if (query && !node.label.toLowerCase().includes(query)) return false;
      return true;
    });
    const nodeIds = new Set(filteredNodes.map((n) => n.id));
    const filteredEdges = fullGraphData.edges.filter(
      (e) => nodeIds.has(e.source) && nodeIds.has(e.target) && visibleEdgeTypes.has(e.type),
    );
    return { nodes: filteredNodes, edges: filteredEdges };
  }, [fullGraphData, visibleNodeTypes, visibleIOCTypes, visibleEdgeTypes, searchQuery]);

  const selectedNode = useMemo(
    () => filteredGraphData.nodes.find((n) => n.id === selectedNodeId)
      || fullGraphData.nodes.find((n) => n.id === selectedNodeId)
      || null,
    [filteredGraphData.nodes, fullGraphData.nodes, selectedNodeId],
  );

  const toggleNodeType = (type: NodeTypeFilter) => {
    setVisibleNodeTypes((prev) => {
      const next = new Set(prev);
      if (next.has(type)) next.delete(type);
      else next.add(type);
      return next;
    });
  };

  const toggleIOCType = (type: IOCType) => {
    setVisibleIOCTypes((prev) => {
      const next = new Set(prev);
      if (next.has(type)) next.delete(type);
      else next.add(type);
      return next;
    });
  };

  const toggleEdgeType = (type: EdgeTypeFilter) => {
    setVisibleEdgeTypes((prev) => {
      const next = new Set(prev);
      if (next.has(type)) next.delete(type);
      else next.add(type);
      return next;
    });
  };

  // Handle node click: IOC nodes open edit dialog directly, others show detail panel
  const handleSelectNode = useCallback((nodeId: string | null) => {
    setSelectedNodeIds([]);
    if (!nodeId) {
      setSelectedNodeId(null);
      return;
    }
    // Look up from ref (always up-to-date) to handle IOC nodes
    const node = fullGraphDataRef.current.nodes.find((n) => n.id === nodeId);
    if (node?.type === 'ioc' && onUpdateNote && onUpdateTask) {
      setEditingIOCNode(node);
      setSelectedNodeId(null);
    } else {
      setSelectedNodeId(nodeId);
    }
  }, [onUpdateNote, onUpdateTask]);

  const handleSelectMulti = useCallback((nodeIds: string[]) => {
    setSelectedNodeId(null);
    setSelectedNodeIds(nodeIds);
  }, []);

  const navigateToEntity = useCallback((node: GraphNode) => {
    if (node.type === 'note') {
      const id = node.sourceEntityIds[0];
      if (id) onNavigateToNote(id);
    } else if (node.type === 'task') {
      const id = node.sourceEntityIds[0];
      if (id) onNavigateToTask(id);
    } else if (node.type === 'timeline-event') {
      const id = node.sourceEntityIds[0];
      if (id) onNavigateToTimelineEvent(id);
    }
  }, [onNavigateToNote, onNavigateToTask, onNavigateToTimelineEvent]);

  const handleDoubleClickNode = useCallback((nodeId: string) => {
    const node = fullGraphData.nodes.find((n) => n.id === nodeId);
    if (!node) return;
    if (node.type === 'ioc' && onUpdateNote && onUpdateTask) {
      setEditingIOCNode(node);
    } else {
      navigateToEntity(node);
    }
  }, [fullGraphData.nodes, navigateToEntity, onUpdateNote, onUpdateTask]);

  const handleLinkNodes = useCallback((sourceId: string, targetId: string) => {
    if (sourceId === targetId) return;
    setLinkDialogState({ sourceNodeId: sourceId, targetNodeId: targetId });
  }, []);

  const handleOpenNewTab = useCallback((node: GraphNode) => {
    const entityId = node.sourceEntityIds[0];
    if (!entityId) return;
    const entityType = node.type === 'note' ? 'note' : node.type === 'task' ? 'task' : node.type === 'timeline-event' ? 'event' : null;
    if (!entityType) return;
    const url = `${location.origin}${location.pathname}#entity=${entityType}:${entityId}`;
    window.open(url, '_blank');
  }, []);

  const nodeTypeCounts = useMemo(() => {
    const counts = { ioc: 0, note: 0, task: 0, 'timeline-event': 0 };
    for (const n of fullGraphData.nodes) counts[n.type]++;
    return counts;
  }, [fullGraphData.nodes]);

  // Multi-selection type breakdown
  const multiSelectInfo = useMemo(() => {
    if (selectedNodeIds.length <= 1) return null;
    const counts: Record<string, number> = {};
    for (const id of selectedNodeIds) {
      const node = fullGraphData.nodes.find((n) => n.id === id);
      if (node) {
        const label = node.type === 'ioc' ? 'IOC' : node.type === 'note' ? 'Note' : node.type === 'task' ? 'Task' : 'Event';
        counts[label] = (counts[label] || 0) + 1;
      }
    }
    return { total: selectedNodeIds.length, counts };
  }, [selectedNodeIds, fullGraphData.nodes]);

  const legendEntries = useMemo(() => getLegendEntries(), []);

  return (
    <div className="flex flex-1 overflow-hidden h-full relative">
      {/* Left sidebar — filters (collapsible) */}
      <div className={`${sidebarCollapsed ? 'hidden' : 'w-52'} border-r border-gray-800 bg-gray-900 flex flex-col overflow-y-auto shrink-0`}>
        <div className="p-3 border-b border-gray-800">
          <div className="flex items-center gap-2 mb-2">
            <Network size={14} className="text-accent" />
            <span className="text-xs font-semibold text-gray-300">{t('view.entityGraph')}</span>
            <button
              onClick={() => setSidebarCollapsed(true)}
              className="ml-auto p-0.5 rounded text-gray-500 hover:text-gray-300 hover:bg-gray-800"
              title={t('view.collapseSidebar')}
              aria-label={t('view.expandSidebar')}
            >
              <PanelLeftClose size={14} />
            </button>
          </div>
          <div className="relative">
            <Search size={12} className="absolute left-2 top-1/2 -translate-y-1/2 text-gray-500" />
            <input
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder={t('view.searchNodes')}
              className="w-full pl-7 pr-2 py-1.5 bg-gray-800 border border-gray-700 rounded text-xs text-gray-200 focus:outline-none focus:border-accent"
            />
          </div>
        </div>

        {/* Scope toggle */}
        {selectedFolderId && (
          <div className="px-3 py-2 border-b border-gray-800">
            <div className="flex rounded-lg overflow-hidden border border-gray-700">
              <button
                onClick={() => setScopeMode('investigation')}
                className={`flex-1 px-2 py-1 text-[10px] font-medium transition-colors ${scopeMode === 'investigation' ? 'bg-accent/20 text-accent' : 'text-gray-500 hover:text-gray-300'}`}
              >
                {selectedFolderName || t('view.investigation')}
              </button>
              <button
                onClick={() => setScopeMode('global')}
                className={`flex-1 px-2 py-1 text-[10px] font-medium transition-colors ${scopeMode === 'global' ? 'bg-accent/20 text-accent' : 'text-gray-500 hover:text-gray-300'}`}
              >
                {t('view.global')}
              </button>
            </div>
          </div>
        )}

        {/* Node type filters */}
        <div className="p-3 space-y-2">
          <span className="text-[10px] text-gray-500 uppercase tracking-wider font-semibold">{t('view.nodeTypes')}</span>
          {([
            { key: 'note' as const, labelKey: 'view.notes', color: '#3b82f6' },
            { key: 'task' as const, labelKey: 'view.tasks', color: '#22c55e' },
            { key: 'ioc' as const, labelKey: 'view.iocs', color: '#f59e0b' },
            { key: 'timeline-event' as const, labelKey: 'view.events', color: '#6366f1' },
          ]).map(({ key, labelKey, color }) => (
            <label key={key} className="flex items-center gap-2 text-xs cursor-pointer">
              <input
                type="checkbox"
                checked={visibleNodeTypes.has(key)}
                onChange={() => toggleNodeType(key)}
                className="rounded border-gray-600 bg-gray-800 text-accent focus:ring-accent"
              />
              <span className="w-2 h-2 rounded-full" style={{ backgroundColor: color }} />
              <span className="text-gray-300">{t(labelKey)}</span>
              <span className="text-gray-600 ml-auto">{nodeTypeCounts[key]}</span>
            </label>
          ))}
        </div>

        {/* IOC type filters */}
        {visibleNodeTypes.has('ioc') && (
          <div className="p-3 pt-0 space-y-1">
            <span className="text-[10px] text-gray-500 uppercase tracking-wider font-semibold">{t('view.iocTypes')}</span>
            {ALL_IOC_TYPES.map((type) => (
              <label key={type} className="flex items-center gap-2 text-xs cursor-pointer">
                <input
                  type="checkbox"
                  checked={visibleIOCTypes.has(type)}
                  onChange={() => toggleIOCType(type)}
                  className="rounded border-gray-600 bg-gray-800 text-accent focus:ring-accent"
                />
                <span className="w-2 h-2 rounded-full" style={{ backgroundColor: IOC_TYPE_LABELS[type].color }} />
                <span className="text-gray-400">{IOC_TYPE_LABELS[type].label}</span>
              </label>
            ))}
          </div>
        )}

        {/* Edge type filters */}
        <div className="p-3 pt-0 space-y-1 border-t border-gray-800 pt-3">
          <span className="text-[10px] text-gray-500 uppercase tracking-wider font-semibold">{t('view.edgeTypes')}</span>
          {ALL_EDGE_TYPES.map(({ key, labelKey, color }) => (
            <label key={key} className="flex items-center gap-2 text-xs cursor-pointer">
              <input
                type="checkbox"
                checked={visibleEdgeTypes.has(key)}
                onChange={() => toggleEdgeType(key)}
                className="rounded border-gray-600 bg-gray-800 text-accent focus:ring-accent"
              />
              <span className="w-2 h-2 rounded-full" style={{ backgroundColor: color }} />
              <span className="text-gray-400">{t(labelKey)}</span>
            </label>
          ))}
        </div>

        {/* Legend */}
        <div className="p-3 border-t border-gray-800">
          <button
            onClick={() => setLegendOpen((o) => !o)}
            className="flex items-center gap-1 text-[10px] text-gray-500 uppercase tracking-wider font-semibold w-full hover:text-gray-300"
          >
            {legendOpen ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
            {t('view.legend')}
          </button>
          {legendOpen && (
            <div className="mt-2 space-y-1.5">
              {legendEntries.map((entry) => (
                <div key={entry.type + (entry.iocType ?? '')} className="flex items-center gap-2">
                  <img src={entry.icon} alt={entry.label} className="w-4 h-4" />
                  <span className="text-[11px] text-gray-400">{entry.label}</span>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Layout */}
        <div className="p-3 border-t border-gray-800 space-y-2">
          <span className="text-[10px] text-gray-500 uppercase tracking-wider font-semibold">{t('view.layout')}</span>
          <div className="flex gap-1">
            <select
              value={layout}
              onChange={(e) => handleLayoutChange(e.target.value as LayoutName)}
              className="flex-1 bg-gray-800 border border-gray-700 rounded px-2 py-1 text-xs text-gray-200 focus:outline-none focus:border-accent"
            >
              <option value="cose-bilkent">{t('view.forceDirected')}</option>
              <option value="circle">{t('view.circle')}</option>
              <option value="breadthfirst">{t('view.breadthFirst')}</option>
            </select>
            <button
              onClick={() => setFitTrigger((n) => n + 1)}
              className="p-1 rounded bg-gray-800 border border-gray-700 text-gray-400 hover:text-gray-200 hover:border-accent"
              title={t('view.fitToView')}
              aria-label={t('view.fitToView')}
            >
              <Maximize2 size={14} />
            </button>
          </div>
        </div>

        {/* Stats */}
        <div className="p-3 border-t border-gray-800 text-[10px] text-gray-600 mt-auto">
          <div>{t('view.stats', { nodes: filteredGraphData.nodes.length, edges: filteredGraphData.edges.length })}</div>
        </div>
      </div>

      {/* Canvas */}
      <div data-tour="graph-canvas" className="flex-1 relative bg-gray-950">
        {sidebarCollapsed && (
          <button
            onClick={() => setSidebarCollapsed(false)}
            className="absolute top-2 left-2 z-10 p-1.5 rounded bg-gray-800 border border-gray-700 text-gray-400 hover:text-gray-200 hover:bg-gray-700 shadow-lg"
            title={t('view.showFilters')}
            aria-label={t('view.expandSidebar')}
          >
            <PanelLeftOpen size={16} />
          </button>
        )}
        {filteredGraphData.nodes.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-gray-600">
            <Network size={48} className="mb-3" />
            <p className="text-lg font-medium">{t('view.noEntities')}</p>
            <p className="text-sm mt-1">{t('view.noEntitiesHint')}</p>
          </div>
        ) : (
          <Suspense fallback={
            <div className="flex items-center justify-center h-full text-gray-500">
              <Loader2 size={24} className="animate-spin mr-2" />
              <span className="text-sm">{t('view.loadingGraph')}</span>
            </div>
          }>
            <GraphCanvas
              data={filteredGraphData}
              layout={layout}
              onSelectNode={handleSelectNode}
              onDoubleClickNode={handleDoubleClickNode}
              onSelectMulti={handleSelectMulti}
              onLinkNodes={handleLinkNodes}
              theme={settings.theme}
              fitTrigger={fitTrigger}
            />
          </Suspense>
        )}

        {/* Floating help overlay */}
        <div className="absolute bottom-3 right-3 z-10">
          {helpOpen ? (
            <div className="bg-gray-900/95 border border-gray-700 rounded-lg shadow-lg p-3 w-52">
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs font-semibold text-gray-300">{t('view.controls')}</span>
                <button onClick={() => setHelpOpen(false)} className="p-0.5 rounded text-gray-500 hover:text-gray-300" aria-label={t('view.closeHelp')}>
                  <XIcon size={12} />
                </button>
              </div>
              <div className="space-y-1.5 text-[11px]">
                <div className="flex gap-2"><kbd className="text-gray-400 font-semibold shrink-0">Click</kbd><span className="text-gray-500">{t('view.clickAction')}</span></div>
                <div className="flex gap-2"><kbd className="text-gray-400 font-semibold shrink-0">Dbl-click</kbd><span className="text-gray-500">{t('view.dblClickAction')}</span></div>
                <div data-tour="graph-link-hint" className="flex gap-2"><kbd className="text-gray-400 font-semibold shrink-0">Alt+drag</kbd><span className="text-gray-500">{t('view.altDragAction')}</span></div>
                <div className="flex gap-2"><kbd className="text-gray-400 font-semibold shrink-0">Shift+drag</kbd><span className="text-gray-500">{t('view.shiftDragAction')}</span></div>
                <div className="flex gap-2"><kbd className="text-gray-400 font-semibold shrink-0">Scroll</kbd><span className="text-gray-500">{t('view.scrollAction')}</span></div>
              </div>
            </div>
          ) : (
            <button
              onClick={() => setHelpOpen(true)}
              className="w-7 h-7 rounded-full bg-gray-800/80 border border-gray-700 flex items-center justify-center text-gray-400 hover:text-gray-200 hover:border-gray-500 transition-colors"
              aria-label={t('view.showGraphControls')}
              title={t('view.graphControls')}
            >
              <HelpCircle size={14} />
            </button>
          )}
        </div>
      </div>

      {/* Detail panel — single selection */}
      {selectedNode && (
        <GraphDetailPanel
          node={selectedNode}
          edges={filteredGraphData.edges}
          allNodes={filteredGraphData.nodes}
          onClose={() => setSelectedNodeId(null)}
          onNavigate={(nodeId) => {
            const node = filteredGraphData.nodes.find((n) => n.id === nodeId);
            if (node) navigateToEntity(node);
          }}
          onOpenNewTab={handleOpenNewTab}
          onEditIOC={onUpdateNote && onUpdateTask ? setEditingIOCNode : undefined}
          notes={notes}
          tasks={tasks}
          timelineEvents={timelineEvents}
        />
      )}

      {/* Multi-selection info panel */}
      {multiSelectInfo && (
        <div className="w-56 border-l border-gray-800 bg-gray-900 p-4 shrink-0 overflow-y-auto">
          <div className="flex items-center justify-between mb-3">
            <span className="text-xs font-semibold text-gray-300">{t('view.selection')}</span>
            <button
              onClick={() => setSelectedNodeIds([])}
              className="text-[10px] text-gray-500 hover:text-gray-300"
            >
              {t('view.clear')}
            </button>
          </div>
          <p className="text-sm text-gray-200 mb-2">{t('view.nodesSelected', { count: multiSelectInfo.total })}</p>
          <div className="space-y-1">
            {Object.entries(multiSelectInfo.counts).map(([label, count]) => (
              <div key={label} className="flex items-center justify-between text-xs">
                <span className="text-gray-400">{label}</span>
                <span className="text-gray-500">{count}</span>
              </div>
            ))}
          </div>
          <p className="text-[10px] text-gray-600 mt-3">{t('view.shiftDragHint')}</p>
        </div>
      )}

      {/* IOC edit dialog */}
      {editingIOCNode && onUpdateNote && onUpdateTask && (
        <GraphIOCEditDialog
          node={editingIOCNode}
          notes={notes}
          tasks={tasks}
          timelineEvents={timelineEvents}
          settings={settings}
          onUpdateNote={onUpdateNote}
          onUpdateTask={onUpdateTask}
          onUpdateEvent={onUpdateEvent}
          onClose={() => setEditingIOCNode(null)}
        />
      )}

      {/* Link dialog */}
      {linkDialogState && (() => {
        const sourceNode = fullGraphData.nodes.find((n) => n.id === linkDialogState.sourceNodeId);
        const targetNode = fullGraphData.nodes.find((n) => n.id === linkDialogState.targetNodeId);
        if (!sourceNode || !targetNode) return null;
        return (
          <GraphLinkDialog
            sourceNode={sourceNode}
            targetNode={targetNode}
            notes={notes}
            tasks={tasks}
            timelineEvents={timelineEvents}
            settings={settings}
            onUpdateNote={onUpdateNote}
            onUpdateTask={onUpdateTask}
            onUpdateEvent={onUpdateEvent}
            onClose={() => setLinkDialogState(null)}
          />
        );
      })()}
    </div>
  );
}
