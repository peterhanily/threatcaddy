import { useState, useMemo } from 'react';
import { Modal } from '../Common/Modal';
import { parseIOCNodeId } from '../../lib/graph-data';
import type { GraphNode } from '../../lib/graph-data';
import type { Note, Task, TimelineEvent, Settings, IOCRelationshipDef } from '../../types';
import { IOC_TYPE_LABELS, DEFAULT_RELATIONSHIP_TYPES } from '../../types';
import { ArrowRight } from 'lucide-react';

interface GraphLinkDialogProps {
  sourceNode: GraphNode;
  targetNode: GraphNode;
  notes: Note[];
  tasks: Task[];
  timelineEvents: TimelineEvent[];
  settings: Settings;
  onUpdateNote?: (id: string, updates: Partial<Note>) => void;
  onUpdateTask?: (id: string, updates: Partial<Task>) => void;
  onUpdateEvent?: (id: string, updates: Partial<TimelineEvent>) => void;
  onClose: () => void;
}

type LinkCategory = 'ioc-ioc' | 'entity-entity' | 'invalid';

function getNodeBadge(node: GraphNode): { label: string; color: string } {
  if (node.type === 'ioc' && node.iocType) {
    const info = IOC_TYPE_LABELS[node.iocType];
    return { label: info.label, color: info.color };
  }
  if (node.type === 'note') return { label: 'Note', color: '#3b82f6' };
  if (node.type === 'task') return { label: 'Task', color: '#22c55e' };
  return { label: 'Event', color: '#6366f1' };
}

function parseEntityNodeId(nodeId: string): { entityType: 'note' | 'task' | 'event'; entityId: string } | null {
  const m = nodeId.match(/^(note|task|event):(.+)$/);
  if (!m) return null;
  return { entityType: m[1] as 'note' | 'task' | 'event', entityId: m[2] };
}

export function GraphLinkDialog({ sourceNode, targetNode, notes, tasks, timelineEvents, settings, onUpdateNote, onUpdateTask, onUpdateEvent, onClose }: GraphLinkDialogProps) {
  const [selectedRelType, setSelectedRelType] = useState<string>('');

  const category: LinkCategory = useMemo(() => {
    if (sourceNode.type === 'ioc' && targetNode.type === 'ioc') return 'ioc-ioc';
    if (sourceNode.type !== 'ioc' && targetNode.type !== 'ioc') return 'entity-entity';
    return 'invalid';
  }, [sourceNode.type, targetNode.type]);

  // For IOC↔IOC: filter valid relationship types
  const validRelTypes = useMemo(() => {
    if (category !== 'ioc-ioc') return [];
    const sourceParsed = parseIOCNodeId(sourceNode.id);
    const targetParsed = parseIOCNodeId(targetNode.id);
    if (!sourceParsed || !targetParsed) return [];

    const allDefs: Record<string, IOCRelationshipDef> = { ...DEFAULT_RELATIONSHIP_TYPES };
    if (settings.tiRelationshipTypes) {
      for (const [k, v] of Object.entries(settings.tiRelationshipTypes)) allDefs[k] = v;
    }

    return Object.entries(allDefs).filter(([, def]) => {
      const sourceOk = def.sourceTypes.length === 0 || def.sourceTypes.includes(sourceParsed.iocType);
      const targetOk = def.targetTypes.length === 0 || def.targetTypes.includes(targetParsed.iocType);
      return sourceOk && targetOk;
    });
  }, [category, sourceNode.id, targetNode.id, settings.tiRelationshipTypes]);

  const sourceBadge = getNodeBadge(sourceNode);
  const targetBadge = getNodeBadge(targetNode);

  const handleCreateIOCLink = () => {
    if (!selectedRelType) return;
    const sourceParsed = parseIOCNodeId(sourceNode.id);
    const targetParsed = parseIOCNodeId(targetNode.id);
    if (!sourceParsed || !targetParsed) return;

    // Find a source IOCEntry and a target IOCEntry across all entities
    let targetIOCId: string | null = null;

    // Search for target IOC entry to get its ID
    const allEntities: Array<{ type: 'note' | 'task' | 'event'; entity: Note | Task | TimelineEvent }> = [
      ...notes.map((n) => ({ type: 'note' as const, entity: n })),
      ...tasks.map((t) => ({ type: 'task' as const, entity: t })),
      ...timelineEvents.map((e) => ({ type: 'event' as const, entity: e })),
    ];

    for (const { entity } of allEntities) {
      const iocs = (entity as { iocAnalysis?: import('../../types').IOCAnalysis }).iocAnalysis?.iocs;
      if (!iocs) continue;
      for (const ioc of iocs) {
        if (ioc.dismissed) continue;
        if (ioc.type === targetParsed.iocType && ioc.value.toLowerCase() === targetParsed.normalizedValue) {
          targetIOCId = ioc.id;
          break;
        }
      }
      if (targetIOCId) break;
    }

    if (!targetIOCId) return;
    const resolvedTargetId = targetIOCId;

    // Update all entities that contain the source IOC
    for (const { type, entity } of allEntities) {
      const analysis = (entity as { iocAnalysis?: import('../../types').IOCAnalysis }).iocAnalysis;
      if (!analysis?.iocs) continue;
      let changed = false;
      const updatedIOCs = analysis.iocs.map((ioc) => {
        if (ioc.dismissed) return ioc;
        if (ioc.type !== sourceParsed.iocType || ioc.value.toLowerCase() !== sourceParsed.normalizedValue) return ioc;
        const existing = ioc.relationships || [];
        if (existing.some((r) => r.targetIOCId === resolvedTargetId && r.relationshipType === selectedRelType)) return ioc;
        changed = true;
        return { ...ioc, relationships: [...existing, { targetIOCId: resolvedTargetId, relationshipType: selectedRelType }] };
      });
      if (!changed) continue;
      const updatedAnalysis = { ...analysis, iocs: updatedIOCs };
      if (type === 'note' && onUpdateNote) onUpdateNote(entity.id, { iocAnalysis: updatedAnalysis });
      if (type === 'task' && onUpdateTask) onUpdateTask(entity.id, { iocAnalysis: updatedAnalysis });
      if (type === 'event' && onUpdateEvent) onUpdateEvent(entity.id, { iocAnalysis: updatedAnalysis });
    }

    onClose();
  };

  const handleCreateEntityLink = () => {
    const source = parseEntityNodeId(sourceNode.id);
    const target = parseEntityNodeId(targetNode.id);
    if (!source || !target) return;

    // Helper: update linked IDs on an entity
    const addLink = (entityType: 'note' | 'task' | 'event', entityId: string, linkedType: 'note' | 'task' | 'event', linkedId: string) => {
      if (entityType === 'note' && onUpdateNote) {
        const note = notes.find((n) => n.id === entityId);
        if (!note) return;
        if (linkedType === 'note') {
          const arr = note.linkedNoteIds || [];
          if (!arr.includes(linkedId)) onUpdateNote(entityId, { linkedNoteIds: [...arr, linkedId] });
        } else if (linkedType === 'task') {
          const arr = note.linkedTaskIds || [];
          if (!arr.includes(linkedId)) onUpdateNote(entityId, { linkedTaskIds: [...arr, linkedId] });
        } else {
          const arr = note.linkedTimelineEventIds || [];
          if (!arr.includes(linkedId)) onUpdateNote(entityId, { linkedTimelineEventIds: [...arr, linkedId] });
        }
      } else if (entityType === 'task' && onUpdateTask) {
        const task = tasks.find((t) => t.id === entityId);
        if (!task) return;
        if (linkedType === 'note') {
          const arr = task.linkedNoteIds || [];
          if (!arr.includes(linkedId)) onUpdateTask(entityId, { linkedNoteIds: [...arr, linkedId] });
        } else if (linkedType === 'task') {
          const arr = task.linkedTaskIds || [];
          if (!arr.includes(linkedId)) onUpdateTask(entityId, { linkedTaskIds: [...arr, linkedId] });
        } else {
          const arr = task.linkedTimelineEventIds || [];
          if (!arr.includes(linkedId)) onUpdateTask(entityId, { linkedTimelineEventIds: [...arr, linkedId] });
        }
      } else if (entityType === 'event' && onUpdateEvent) {
        const event = timelineEvents.find((e) => e.id === entityId);
        if (!event) return;
        if (linkedType === 'note') {
          const arr = event.linkedNoteIds;
          if (!arr.includes(linkedId)) onUpdateEvent(entityId, { linkedNoteIds: [...arr, linkedId] });
        } else if (linkedType === 'task') {
          const arr = event.linkedTaskIds;
          if (!arr.includes(linkedId)) onUpdateEvent(entityId, { linkedTaskIds: [...arr, linkedId] });
        }
        // event↔event not supported in data model
      }
    };

    // Link both directions
    addLink(source.entityType, source.entityId, target.entityType, target.entityId);
    addLink(target.entityType, target.entityId, source.entityType, source.entityId);
    onClose();
  };

  if (category === 'invalid') {
    return (
      <Modal open onClose={onClose} title="Cannot Link">
        <p className="text-sm text-gray-400">IOC nodes can only be linked to other IOC nodes, and entity nodes (notes, tasks, events) can only be linked to other entities.</p>
        <div className="flex justify-end mt-4">
          <button onClick={onClose} className="px-3 py-1.5 text-xs rounded-lg text-gray-400 hover:text-gray-200 hover:bg-gray-700 transition-colors">
            Close
          </button>
        </div>
      </Modal>
    );
  }

  return (
    <Modal open onClose={onClose} title={category === 'ioc-ioc' ? 'Create IOC Relationship' : 'Link Entities'}>
      <div className="space-y-4">
        {/* Source → Target display */}
        <div className="flex items-center gap-3 p-3 rounded-lg bg-gray-800/50">
          <div className="flex items-center gap-1.5 min-w-0">
            <span className="text-[10px] font-bold uppercase px-1.5 py-0.5 rounded shrink-0" style={{ backgroundColor: sourceBadge.color + '22', color: sourceBadge.color }}>
              {sourceBadge.label}
            </span>
            <span className="text-xs text-gray-200 truncate">{sourceNode.label}</span>
          </div>
          <ArrowRight size={16} className="text-gray-500 shrink-0" />
          <div className="flex items-center gap-1.5 min-w-0">
            <span className="text-[10px] font-bold uppercase px-1.5 py-0.5 rounded shrink-0" style={{ backgroundColor: targetBadge.color + '22', color: targetBadge.color }}>
              {targetBadge.label}
            </span>
            <span className="text-xs text-gray-200 truncate">{targetNode.label}</span>
          </div>
        </div>

        {category === 'ioc-ioc' && (
          <>
            <div>
              <label className="text-[10px] text-gray-500 uppercase tracking-wider">Relationship Type</label>
              {validRelTypes.length === 0 ? (
                <p className="text-xs text-gray-500 mt-1">No valid relationship types for this IOC pair.</p>
              ) : (
                <div className="mt-1 space-y-1 max-h-48 overflow-y-auto">
                  {validRelTypes.map(([key, def]) => (
                    <label key={key} className={`flex items-center gap-2 px-2 py-1.5 rounded cursor-pointer text-xs transition-colors ${selectedRelType === key ? 'bg-amber-500/15 text-amber-400' : 'text-gray-300 hover:bg-gray-800'}`}>
                      <input
                        type="radio"
                        name="relType"
                        value={key}
                        checked={selectedRelType === key}
                        onChange={() => setSelectedRelType(key)}
                        className="text-amber-500 focus:ring-amber-500"
                      />
                      {def.label}
                    </label>
                  ))}
                </div>
              )}
            </div>

            <div className="flex justify-end gap-2 pt-2 border-t border-gray-700">
              <button onClick={onClose} className="px-3 py-1.5 text-xs rounded-lg text-gray-400 hover:text-gray-200 hover:bg-gray-700 transition-colors">
                Cancel
              </button>
              <button
                onClick={handleCreateIOCLink}
                disabled={!selectedRelType || validRelTypes.length === 0}
                className="px-3 py-1.5 text-xs rounded-lg font-medium bg-amber-500/20 text-amber-400 hover:bg-amber-500/30 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                Create Relationship
              </button>
            </div>
          </>
        )}

        {category === 'entity-entity' && (
          <div className="flex justify-end gap-2 pt-2 border-t border-gray-700">
            <button onClick={onClose} className="px-3 py-1.5 text-xs rounded-lg text-gray-400 hover:text-gray-200 hover:bg-gray-700 transition-colors">
              Cancel
            </button>
            <button
              onClick={handleCreateEntityLink}
              className="px-3 py-1.5 text-xs rounded-lg font-medium bg-green-500/20 text-green-400 hover:bg-green-500/30 transition-colors"
            >
              Link Entities
            </button>
          </div>
        )}
      </div>
    </Modal>
  );
}
