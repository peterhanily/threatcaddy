import React, { Suspense, useState, useMemo, useCallback } from 'react';
import { Loader2, Search, Network, Maximize2 } from 'lucide-react';
import type { Note, Task, TimelineEvent, Settings, IOCType } from '../../types';
import { IOC_TYPE_LABELS } from '../../types';
import { buildGraphData } from '../../lib/graph-data';
import type { GraphNode, GraphEdge } from '../../lib/graph-data';
import { GraphDetailPanel } from './GraphDetailPanel';
import { GraphIOCEditDialog } from './GraphIOCEditDialog';
import type { LayoutName } from './GraphCanvas';

const GraphCanvas = React.lazy(() => import('./GraphCanvas'));

const ALL_IOC_TYPES = Object.keys(IOC_TYPE_LABELS) as IOCType[];

interface GraphViewProps {
  notes: Note[];
  tasks: Task[];
  timelineEvents: TimelineEvent[];
  settings: Settings;
  onNavigateToNote: (id: string) => void;
  onNavigateToTask: (id: string) => void;
  onNavigateToTimelineEvent: (id: string) => void;
  onUpdateNote?: (id: string, updates: Partial<Note>) => void;
  onUpdateTask?: (id: string, updates: Partial<Task>) => void;
  onUpdateEvent?: (id: string, updates: Partial<TimelineEvent>) => void;
}

type NodeTypeFilter = 'ioc' | 'note' | 'task' | 'timeline-event';
type EdgeTypeFilter = GraphEdge['type'];

const ALL_EDGE_TYPES: { key: EdgeTypeFilter; label: string; color: string }[] = [
  { key: 'contains-ioc', label: 'Contains IOC', color: '#4b5563' },
  { key: 'ioc-relationship', label: 'IOC Relations', color: '#f59e0b' },
  { key: 'timeline-link', label: 'Timeline Links', color: '#6366f1' },
  { key: 'entity-link', label: 'Entity Links', color: '#22c55e' },
];

export function GraphView({ notes, tasks, timelineEvents, settings, onNavigateToNote, onNavigateToTask, onNavigateToTimelineEvent, onUpdateNote, onUpdateTask, onUpdateEvent }: GraphViewProps) {
  const [layout, setLayout] = useState<LayoutName>('cose-bilkent');
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [visibleNodeTypes, setVisibleNodeTypes] = useState<Set<NodeTypeFilter>>(new Set(['ioc', 'note', 'task', 'timeline-event']));
  const [visibleIOCTypes, setVisibleIOCTypes] = useState<Set<IOCType>>(new Set(ALL_IOC_TYPES));
  const [visibleEdgeTypes, setVisibleEdgeTypes] = useState<Set<EdgeTypeFilter>>(new Set(['contains-ioc', 'ioc-relationship', 'timeline-link', 'entity-link']));
  const [editingIOCNode, setEditingIOCNode] = useState<GraphNode | null>(null);
  const [fitTrigger, setFitTrigger] = useState(0);
  // Stable ref to full graph data for use in cytoscape callbacks
  const fullGraphDataRef = React.useRef<ReturnType<typeof buildGraphData>>({ nodes: [], edges: [] });

  // Build full graph data
  const fullGraphData = useMemo(() => {
    const data = buildGraphData(notes, tasks, timelineEvents, settings);
    fullGraphDataRef.current = data;
    return data;
  }, [notes, tasks, timelineEvents, settings]);

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

  return (
    <div className="flex flex-1 overflow-hidden h-full">
      {/* Left sidebar — filters */}
      <div className="w-52 border-r border-gray-800 bg-gray-900 flex flex-col overflow-y-auto shrink-0">
        <div className="p-3 border-b border-gray-800">
          <div className="flex items-center gap-2 mb-2">
            <Network size={14} className="text-accent" />
            <span className="text-xs font-semibold text-gray-300">Entity Graph</span>
          </div>
          <div className="relative">
            <Search size={12} className="absolute left-2 top-1/2 -translate-y-1/2 text-gray-500" />
            <input
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search nodes..."
              className="w-full pl-7 pr-2 py-1.5 bg-gray-800 border border-gray-700 rounded text-xs text-gray-200 focus:outline-none focus:border-accent"
            />
          </div>
        </div>

        {/* Node type filters */}
        <div className="p-3 space-y-2">
          <span className="text-[10px] text-gray-500 uppercase tracking-wider font-semibold">Node Types</span>
          {([
            { key: 'note' as const, label: 'Notes', color: '#3b82f6' },
            { key: 'task' as const, label: 'Tasks', color: '#22c55e' },
            { key: 'ioc' as const, label: 'IOCs', color: '#f59e0b' },
            { key: 'timeline-event' as const, label: 'Events', color: '#6366f1' },
          ]).map(({ key, label, color }) => (
            <label key={key} className="flex items-center gap-2 text-xs cursor-pointer">
              <input
                type="checkbox"
                checked={visibleNodeTypes.has(key)}
                onChange={() => toggleNodeType(key)}
                className="rounded border-gray-600 bg-gray-800 text-accent focus:ring-accent"
              />
              <span className="w-2 h-2 rounded-full" style={{ backgroundColor: color }} />
              <span className="text-gray-300">{label}</span>
              <span className="text-gray-600 ml-auto">{nodeTypeCounts[key]}</span>
            </label>
          ))}
        </div>

        {/* IOC type filters */}
        {visibleNodeTypes.has('ioc') && (
          <div className="p-3 pt-0 space-y-1">
            <span className="text-[10px] text-gray-500 uppercase tracking-wider font-semibold">IOC Types</span>
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
          <span className="text-[10px] text-gray-500 uppercase tracking-wider font-semibold">Edge Types</span>
          {ALL_EDGE_TYPES.map(({ key, label, color }) => (
            <label key={key} className="flex items-center gap-2 text-xs cursor-pointer">
              <input
                type="checkbox"
                checked={visibleEdgeTypes.has(key)}
                onChange={() => toggleEdgeType(key)}
                className="rounded border-gray-600 bg-gray-800 text-accent focus:ring-accent"
              />
              <span className="w-2 h-2 rounded-full" style={{ backgroundColor: color }} />
              <span className="text-gray-400">{label}</span>
            </label>
          ))}
        </div>

        {/* Layout */}
        <div className="p-3 border-t border-gray-800 space-y-2">
          <span className="text-[10px] text-gray-500 uppercase tracking-wider font-semibold">Layout</span>
          <div className="flex gap-1">
            <select
              value={layout}
              onChange={(e) => setLayout(e.target.value as LayoutName)}
              className="flex-1 bg-gray-800 border border-gray-700 rounded px-2 py-1 text-xs text-gray-200 focus:outline-none focus:border-accent"
            >
              <option value="cose-bilkent">Force-Directed</option>
              <option value="circle">Circle</option>
              <option value="breadthfirst">Breadth-First</option>
            </select>
            <button
              onClick={() => setFitTrigger((n) => n + 1)}
              className="p-1 rounded bg-gray-800 border border-gray-700 text-gray-400 hover:text-gray-200 hover:border-accent"
              title="Fit to view"
              aria-label="Fit to view"
            >
              <Maximize2 size={14} />
            </button>
          </div>
        </div>

        {/* Stats */}
        <div className="p-3 border-t border-gray-800 text-[10px] text-gray-600 mt-auto">
          {filteredGraphData.nodes.length} nodes, {filteredGraphData.edges.length} edges
        </div>
      </div>

      {/* Canvas */}
      <div className="flex-1 relative bg-gray-950">
        {filteredGraphData.nodes.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-gray-600">
            <Network size={48} className="mb-3" />
            <p className="text-lg font-medium">No entities to display</p>
            <p className="text-sm mt-1">Add notes with IOCs or timeline events to see the graph</p>
          </div>
        ) : (
          <Suspense fallback={
            <div className="flex items-center justify-center h-full text-gray-500">
              <Loader2 size={24} className="animate-spin mr-2" />
              <span className="text-sm">Loading graph...</span>
            </div>
          }>
            <GraphCanvas
              data={filteredGraphData}
              layout={layout}
              onSelectNode={handleSelectNode}
              onDoubleClickNode={handleDoubleClickNode}
              theme={settings.theme}
              fitTrigger={fitTrigger}
            />
          </Suspense>
        )}
      </div>

      {/* Detail panel */}
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
        />
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
    </div>
  );
}
