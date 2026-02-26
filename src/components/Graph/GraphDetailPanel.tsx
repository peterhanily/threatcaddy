import { X, ArrowRight, ExternalLink, Pencil } from 'lucide-react';
import type { GraphNode, GraphEdge } from '../../lib/graph-data';
import { IOC_TYPE_LABELS, TIMELINE_EVENT_TYPE_LABELS } from '../../types';
import type { Note, Task, TimelineEvent } from '../../types';

interface GraphDetailPanelProps {
  node: GraphNode;
  edges: GraphEdge[];
  allNodes: GraphNode[];
  onClose: () => void;
  onNavigate: (nodeId: string) => void;
  onOpenNewTab?: (node: GraphNode) => void;
  onEditIOC?: (node: GraphNode) => void;
  notes?: Note[];
  tasks?: Task[];
  timelineEvents?: TimelineEvent[];
}

const PRIORITY_COLORS: Record<string, string> = {
  high: 'bg-red-500/20 text-red-400',
  medium: 'bg-yellow-500/20 text-yellow-400',
  low: 'bg-blue-500/20 text-blue-400',
  none: 'bg-gray-500/20 text-gray-400',
};

const CONFIDENCE_COLORS: Record<string, string> = {
  confirmed: 'bg-green-500/20 text-green-400',
  high: 'bg-emerald-500/20 text-emerald-400',
  medium: 'bg-yellow-500/20 text-yellow-400',
  low: 'bg-orange-500/20 text-orange-400',
};

function stripMarkdown(text: string): string {
  return text
    .replace(/#{1,6}\s/g, '')
    .replace(/\*\*(.+?)\*\*/g, '$1')
    .replace(/\*(.+?)\*/g, '$1')
    .replace(/`(.+?)`/g, '$1')
    .replace(/\[(.+?)\]\(.+?\)/g, '$1')
    .replace(/^\s*[-*+]\s/gm, '')
    .replace(/\n+/g, ' ')
    .trim();
}

function snippet(text: string, maxLen = 120): string {
  const clean = stripMarkdown(text);
  if (clean.length <= maxLen) return clean;
  return clean.slice(0, maxLen) + '...';
}

export function GraphDetailPanel({ node, edges, allNodes, onClose, onNavigate, onOpenNewTab, onEditIOC, notes, tasks, timelineEvents }: GraphDetailPanelProps) {
  const connectedEdges = edges.filter((e) => e.source === node.id || e.target === node.id);

  const getNodeLabel = (id: string) => {
    const n = allNodes.find((n) => n.id === id);
    return n?.label || id;
  };

  // Look up source entities
  const sourceId = node.sourceEntityIds[0];
  const sourceEvent = node.type === 'timeline-event' && sourceId && timelineEvents
    ? timelineEvents.find((e) => e.id === sourceId) : undefined;
  const sourceNote = node.type === 'note' && sourceId && notes
    ? notes.find((n) => n.id === sourceId) : undefined;
  const sourceTask = node.type === 'task' && sourceId && tasks
    ? tasks.find((t) => t.id === sourceId) : undefined;

  return (
    <div className="w-72 border-l-2 bg-gray-900 flex flex-col h-full overflow-hidden shrink-0" style={{ borderLeftColor: node.color }}>
      <div className="flex items-center gap-2 px-3 py-2 border-b border-gray-800">
        <div className="w-3 h-3 rounded-full shrink-0" style={{ backgroundColor: node.color }} />
        <span className="text-sm font-medium text-gray-200 flex-1 truncate">{node.label}</span>
        <button onClick={onClose} className="p-1 rounded text-gray-500 hover:text-gray-300" aria-label="Close detail panel">
          <X size={14} />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto p-3 space-y-3">
        {/* Node type */}
        <div className="space-y-1">
          <div className="text-[10px] text-gray-500 uppercase tracking-wider">Type</div>
          {node.type === 'timeline-event' && node.eventType ? (
            <span
              className="inline-block text-[11px] px-1.5 py-0.5 rounded font-medium"
              style={{
                backgroundColor: (TIMELINE_EVENT_TYPE_LABELS[node.eventType]?.color || '#6b7280') + '33',
                color: TIMELINE_EVENT_TYPE_LABELS[node.eventType]?.color || '#6b7280',
              }}
            >
              {TIMELINE_EVENT_TYPE_LABELS[node.eventType]?.label || node.eventType}
            </span>
          ) : (
            <div className="text-xs text-gray-300 capitalize">
              {node.type === 'ioc' && node.iocType
                ? IOC_TYPE_LABELS[node.iocType].label
                : node.type.replace('-', ' ')}
            </div>
          )}
        </div>

        {/* Timeline event enriched info */}
        {sourceEvent && (
          <>
            <div className="space-y-1">
              <div className="text-[10px] text-gray-500 uppercase tracking-wider">Timestamp</div>
              <div className="text-xs text-gray-300">{new Date(sourceEvent.timestamp).toLocaleString()}</div>
            </div>
            {sourceEvent.description && (
              <div className="space-y-1">
                <div className="text-[10px] text-gray-500 uppercase tracking-wider">Description</div>
                <div className="text-xs text-gray-400 leading-relaxed">{snippet(sourceEvent.description)}</div>
              </div>
            )}
            {sourceEvent.actor && (
              <div className="space-y-1">
                <div className="text-[10px] text-gray-500 uppercase tracking-wider">Actor</div>
                <div className="text-xs text-gray-300 font-mono">{sourceEvent.actor}</div>
              </div>
            )}
            {sourceEvent.mitreAttackIds.length > 0 && (
              <div className="space-y-1">
                <div className="text-[10px] text-gray-500 uppercase tracking-wider">MITRE ATT&CK</div>
                <div className="flex flex-wrap gap-1">
                  {sourceEvent.mitreAttackIds.map((id) => (
                    <span key={id} className="text-[10px] px-1.5 py-0.5 rounded bg-purple-500/20 text-purple-400 font-mono">{id}</span>
                  ))}
                </div>
              </div>
            )}
            <div className="space-y-1">
              <div className="text-[10px] text-gray-500 uppercase tracking-wider">Confidence</div>
              <span className={`inline-block text-[11px] px-1.5 py-0.5 rounded font-medium capitalize ${CONFIDENCE_COLORS[sourceEvent.confidence] || 'bg-gray-500/20 text-gray-400'}`}>
                {sourceEvent.confidence}
              </span>
            </div>
          </>
        )}

        {/* Note enriched info */}
        {sourceNote && (
          <>
            <div className="space-y-1">
              <div className="text-[10px] text-gray-500 uppercase tracking-wider">Created</div>
              <div className="text-xs text-gray-300">{new Date(sourceNote.createdAt).toLocaleDateString()}</div>
            </div>
            {sourceNote.content && (
              <div className="space-y-1">
                <div className="text-[10px] text-gray-500 uppercase tracking-wider">Content</div>
                <div className="text-xs text-gray-400 leading-relaxed">{snippet(sourceNote.content)}</div>
              </div>
            )}
            {sourceNote.tags.length > 0 && (
              <div className="space-y-1">
                <div className="text-[10px] text-gray-500 uppercase tracking-wider">Tags</div>
                <div className="flex flex-wrap gap-1">
                  {sourceNote.tags.map((tag) => (
                    <span key={tag} className="text-[10px] px-1.5 py-0.5 rounded bg-blue-500/20 text-blue-400">{tag}</span>
                  ))}
                </div>
              </div>
            )}
          </>
        )}

        {/* Task enriched info */}
        {sourceTask && (
          <>
            <div className="space-y-1">
              <div className="text-[10px] text-gray-500 uppercase tracking-wider">Priority</div>
              <span className={`inline-block text-[11px] px-1.5 py-0.5 rounded font-medium capitalize ${PRIORITY_COLORS[sourceTask.priority] || 'bg-gray-500/20 text-gray-400'}`}>
                {sourceTask.priority}
              </span>
            </div>
            <div className="space-y-1">
              <div className="text-[10px] text-gray-500 uppercase tracking-wider">Status</div>
              <div className="text-xs text-gray-300 capitalize">{sourceTask.status}</div>
            </div>
            {sourceTask.dueDate && (
              <div className="space-y-1">
                <div className="text-[10px] text-gray-500 uppercase tracking-wider">Due Date</div>
                <div className="text-xs text-gray-300">{sourceTask.dueDate}</div>
              </div>
            )}
          </>
        )}

        {/* IOC info */}
        {node.type === 'ioc' && (
          <div className="space-y-1">
            <div className="text-[10px] text-gray-500 uppercase tracking-wider">Value</div>
            <div className="text-xs text-gray-300 font-mono break-all">{node.label}</div>
          </div>
        )}

        {node.sourceEntityIds.length > 0 && node.type === 'ioc' && (
          <div className="space-y-1">
            <div className="text-[10px] text-gray-500 uppercase tracking-wider">Found in {node.sourceEntityIds.length} entit{node.sourceEntityIds.length === 1 ? 'y' : 'ies'}</div>
          </div>
        )}

        {/* Connected edges */}
        <div className="space-y-1">
          <div className="text-[10px] text-gray-500 uppercase tracking-wider">
            Connections ({connectedEdges.length})
          </div>
          {connectedEdges.length === 0 ? (
            <p className="text-xs text-gray-600">No connections</p>
          ) : (
            <div className="space-y-1">
              {connectedEdges.map((edge) => {
                const isSource = edge.source === node.id;
                const otherId = isSource ? edge.target : edge.source;
                const otherNode = allNodes.find((n) => n.id === otherId);
                return (
                  <div key={edge.id} className="flex items-center gap-1 text-xs p-1 rounded bg-gray-800/50">
                    {isSource ? (
                      <>
                        <span className="text-gray-500">{edge.label}</span>
                        <ArrowRight size={10} className="text-gray-600 shrink-0" />
                        <span className="text-gray-300 truncate flex-1">{getNodeLabel(otherId)}</span>
                      </>
                    ) : (
                      <>
                        <span className="text-gray-300 truncate flex-1">{getNodeLabel(otherId)}</span>
                        <ArrowRight size={10} className="text-gray-600 shrink-0" />
                        <span className="text-gray-500">{edge.label}</span>
                      </>
                    )}
                    {otherNode && (
                      <div className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: otherNode.color }} />
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {/* Footer buttons */}
      {(node.type === 'note' || node.type === 'task' || node.type === 'timeline-event' || (node.type === 'ioc' && onEditIOC)) && (
        <div className="border-t border-gray-800 p-2 space-y-1">
          {(node.type === 'note' || node.type === 'task' || node.type === 'timeline-event') && (
            <>
              <button
                onClick={() => onNavigate(node.id)}
                className="flex items-center gap-2 w-full px-3 py-1.5 rounded-lg text-xs font-medium bg-accent/15 text-accent hover:bg-accent/25 transition-colors"
              >
                <ArrowRight size={12} />
                Open {node.type === 'note' ? 'Note' : node.type === 'task' ? 'Task' : 'Event'}
              </button>
              {onOpenNewTab && (
                <button
                  onClick={() => onOpenNewTab(node)}
                  className="flex items-center gap-2 w-full px-3 py-1.5 rounded-lg text-xs font-medium bg-gray-700/50 text-gray-300 hover:bg-gray-700 transition-colors"
                >
                  <ExternalLink size={12} />
                  Open in New Tab
                </button>
              )}
            </>
          )}
          {node.type === 'ioc' && onEditIOC && (
            <button
              onClick={() => onEditIOC(node)}
              className="flex items-center gap-2 w-full px-3 py-1.5 rounded-lg text-xs font-medium bg-amber-500/15 text-amber-400 hover:bg-amber-500/25 transition-colors"
            >
              <Pencil size={12} />
              Edit IOC Attributes
            </button>
          )}
        </div>
      )}
    </div>
  );
}
