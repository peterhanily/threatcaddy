import type { Note, Task, TimelineEvent, Settings, IOCEntry, IOCType, TimelineEventType } from '../types';
import { IOC_TYPE_LABELS, TIMELINE_EVENT_TYPE_LABELS, DEFAULT_RELATIONSHIP_TYPES } from '../types';
import type { IOCRelationshipDef } from '../types';
import { getNodeIcon } from './graph-icons';

/**
 * Parse IOC type + normalized value from a deduplicated graph node ID.
 * Node IDs follow the pattern: `ioc:{type}:{normalizedValue}`
 */
export function parseIOCNodeId(nodeId: string): { iocType: IOCType; normalizedValue: string } | null {
  const match = nodeId.match(/^ioc:([^:]+):(.+)$/);
  if (!match) return null;
  return { iocType: match[1] as IOCType, normalizedValue: match[2] };
}

export interface GraphNode {
  id: string;
  label: string;
  type: 'ioc' | 'note' | 'task' | 'timeline-event';
  color: string;
  shape: 'round-rectangle';
  icon: string;
  /** Original entity IDs that contributed to this node (for IOCs deduplicated across entities) */
  sourceEntityIds: string[];
  iocType?: IOCType;
  eventType?: TimelineEventType;
}

export interface GraphEdge {
  id: string;
  source: string;
  target: string;
  label: string;
  type: 'contains-ioc' | 'ioc-relationship' | 'timeline-link' | 'entity-link';
}

export interface GraphData {
  nodes: GraphNode[];
  edges: GraphEdge[];
}

/**
 * Build a unified graph from all entities.
 * IOCs are deduplicated by (type, lowercase value) across notes and tasks.
 */
export function buildGraphData(
  notes: Note[],
  tasks: Task[],
  timelineEvents: TimelineEvent[],
  settings?: Settings,
): GraphData {
  const nodes: GraphNode[] = [];
  const edges: GraphEdge[] = [];
  const nodeIdSet = new Set<string>();
  const edgeIdSet = new Set<string>();

  // IOC deduplication map: key = `${type}:${value.toLowerCase()}`
  const iocNodeMap = new Map<string, GraphNode>();
  // Map from individual IOCEntry id → deduplicated graph node id
  const iocIdToNodeId = new Map<string, string>();

  const allRelDefs: Record<string, IOCRelationshipDef> = { ...DEFAULT_RELATIONSHIP_TYPES };
  if (settings?.tiRelationshipTypes) {
    for (const [k, v] of Object.entries(settings.tiRelationshipTypes)) allRelDefs[k] = v;
  }

  function getOrCreateIOCNode(ioc: IOCEntry): GraphNode {
    const key = `${ioc.type}:${ioc.value.toLowerCase()}`;
    let node = iocNodeMap.get(key);
    if (!node) {
      const typeInfo = IOC_TYPE_LABELS[ioc.type as IOCType] || { label: ioc.type, color: '#6b7280' };
      node = {
        id: `ioc:${key}`,
        label: ioc.value.length > 40 ? ioc.value.substring(0, 37) + '...' : ioc.value,
        type: 'ioc',
        color: typeInfo.color,
        shape: 'round-rectangle',
        icon: getNodeIcon('ioc', typeInfo.color, ioc.type),
        sourceEntityIds: [],
        iocType: ioc.type,
      };
      iocNodeMap.set(key, node);
      nodes.push(node);
      nodeIdSet.add(node.id);
    }
    iocIdToNodeId.set(ioc.id, node.id);
    return node;
  }

  // Process notes
  const activeNotes = notes.filter((n) => !n.trashed);
  for (const note of activeNotes) {
    const noteNodeId = `note:${note.id}`;
    nodeIdSet.add(noteNodeId);
    nodes.push({
      id: noteNodeId,
      label: note.title || 'Untitled',
      type: 'note',
      color: '#3b82f6',
      shape: 'round-rectangle',
      icon: getNodeIcon('note', '#3b82f6'),
      sourceEntityIds: [note.id],
    });

    if (note.iocAnalysis?.iocs) {
      for (const ioc of note.iocAnalysis.iocs) {
        if (ioc.dismissed) continue;
        const iocNode = getOrCreateIOCNode(ioc);
        if (!iocNode.sourceEntityIds.includes(note.id)) {
          iocNode.sourceEntityIds.push(note.id);
        }
        // Note ↔ IOC edge
        const edgeId = `${noteNodeId}--${iocNode.id}`;
        if (!edgeIdSet.has(edgeId)) {
          edgeIdSet.add(edgeId);
          edges.push({
            id: edgeId,
            source: noteNodeId,
            target: iocNode.id,
            label: 'contains',
            type: 'contains-ioc',
          });
        }
      }
    }
  }

  // Process tasks
  const activeTasks = tasks.filter((t) => !t.trashed);
  for (const task of activeTasks) {
    const taskNodeId = `task:${task.id}`;
    nodeIdSet.add(taskNodeId);
    nodes.push({
      id: taskNodeId,
      label: task.title || 'Untitled',
      type: 'task',
      color: '#22c55e',
      shape: 'round-rectangle',
      icon: getNodeIcon('task', '#22c55e'),
      sourceEntityIds: [task.id],
    });

    if (task.iocAnalysis?.iocs) {
      for (const ioc of task.iocAnalysis.iocs) {
        if (ioc.dismissed) continue;
        const iocNode = getOrCreateIOCNode(ioc);
        if (!iocNode.sourceEntityIds.includes(task.id)) {
          iocNode.sourceEntityIds.push(task.id);
        }
        const edgeId = `${taskNodeId}--${iocNode.id}`;
        if (!edgeIdSet.has(edgeId)) {
          edgeIdSet.add(edgeId);
          edges.push({
            id: edgeId,
            source: taskNodeId,
            target: iocNode.id,
            label: 'contains',
            type: 'contains-ioc',
          });
        }
      }
    }
  }

  // Process timeline events
  const activeEvents = timelineEvents.filter((e) => !e.trashed);
  for (const event of activeEvents) {
    const eventNodeId = `event:${event.id}`;
    const eventTypeInfo = TIMELINE_EVENT_TYPE_LABELS[event.eventType];
    const eventColor = eventTypeInfo?.color || '#6b7280';
    nodeIdSet.add(eventNodeId);
    nodes.push({
      id: eventNodeId,
      label: event.title || 'Untitled',
      type: 'timeline-event',
      color: eventColor,
      shape: 'round-rectangle',
      icon: getNodeIcon('timeline-event', eventColor),
      sourceEntityIds: [event.id],
      eventType: event.eventType,
    });

    // Timeline event → IOC edges (from iocAnalysis)
    if (event.iocAnalysis?.iocs) {
      for (const ioc of event.iocAnalysis.iocs) {
        if (ioc.dismissed) continue;
        const iocNode = getOrCreateIOCNode(ioc);
        if (!iocNode.sourceEntityIds.includes(event.id)) {
          iocNode.sourceEntityIds.push(event.id);
        }
        const edgeId = `${eventNodeId}--${iocNode.id}`;
        if (!edgeIdSet.has(edgeId)) {
          edgeIdSet.add(edgeId);
          edges.push({
            id: edgeId,
            source: eventNodeId,
            target: iocNode.id,
            label: 'contains',
            type: 'contains-ioc',
          });
        }
      }
    }

    // Timeline → Note links
    for (const noteId of event.linkedNoteIds) {
      const noteNodeId = `note:${noteId}`;
      if (nodeIdSet.has(noteNodeId)) {
        edges.push({
          id: `${eventNodeId}--${noteNodeId}`,
          source: eventNodeId,
          target: noteNodeId,
          label: 'linked',
          type: 'timeline-link',
        });
      }
    }

    // Timeline → Task links
    for (const taskId of event.linkedTaskIds) {
      const taskNodeId = `task:${taskId}`;
      if (nodeIdSet.has(taskNodeId)) {
        edges.push({
          id: `${eventNodeId}--${taskNodeId}`,
          source: eventNodeId,
          target: taskNodeId,
          label: 'linked',
          type: 'timeline-link',
        });
      }
    }

    // Timeline → IOC links
    for (const iocId of event.linkedIOCIds) {
      const iocNodeId = iocIdToNodeId.get(iocId);
      if (iocNodeId) {
        const edgeId = `${eventNodeId}--${iocNodeId}`;
        if (!edgeIdSet.has(edgeId)) {
          edgeIdSet.add(edgeId);
          edges.push({
            id: edgeId,
            source: eventNodeId,
            target: iocNodeId,
            label: 'linked',
            type: 'timeline-link',
          });
        }
      }
    }
  }

  // IOC → IOC relationship edges (from all IOCEntry instances)
  const allIOCEntries: IOCEntry[] = [];
  for (const note of activeNotes) {
    if (note.iocAnalysis?.iocs) allIOCEntries.push(...note.iocAnalysis.iocs);
  }
  for (const task of activeTasks) {
    if (task.iocAnalysis?.iocs) allIOCEntries.push(...task.iocAnalysis.iocs);
  }
  for (const event of timelineEvents) {
    if (event.iocAnalysis?.iocs) allIOCEntries.push(...event.iocAnalysis.iocs);
  }

  const seenRelEdges = new Set<string>();
  for (const ioc of allIOCEntries) {
    if (ioc.dismissed) continue;
    const sourceNodeId = iocIdToNodeId.get(ioc.id);
    if (!sourceNodeId) continue;

    const rels = ioc.relationships || [];
    // Legacy fallback: convert deprecated relatedId/relationshipType to relationships[]
    // format when no modern relationships exist. Safe to remove once all persisted data
    // has been migrated (IOCItem.tsx migrates on first render).
    if (ioc.relatedId && ioc.relationshipType && rels.length === 0) {
      rels.push({ targetIOCId: ioc.relatedId, relationshipType: ioc.relationshipType });
    }

    for (const rel of rels) {
      const targetNodeId = iocIdToNodeId.get(rel.targetIOCId);
      if (!targetNodeId || targetNodeId === sourceNodeId) continue;
      const edgeKey = `${sourceNodeId}->${targetNodeId}:${rel.relationshipType}`;
      if (seenRelEdges.has(edgeKey)) continue;
      seenRelEdges.add(edgeKey);

      const def = allRelDefs[rel.relationshipType];
      edges.push({
        id: `rel:${edgeKey}`,
        source: sourceNodeId,
        target: targetNodeId,
        label: def?.label || rel.relationshipType,
        type: 'ioc-relationship',
      });
    }
  }

  // Entity-link edges (from Note/Task linkedNoteIds, linkedTaskIds, linkedTimelineEventIds)
  const seenEntityLinks = new Set<string>();
  function addEntityLink(sourceNodeId: string, targetNodeId: string) {
    // Deduplicate bidirectional: sort to create canonical key
    const key = [sourceNodeId, targetNodeId].sort().join('--');
    if (seenEntityLinks.has(key)) return;
    if (!nodeIdSet.has(sourceNodeId) || !nodeIdSet.has(targetNodeId)) return;
    seenEntityLinks.add(key);
    edges.push({
      id: `link:${key}`,
      source: sourceNodeId,
      target: targetNodeId,
      label: 'linked',
      type: 'entity-link',
    });
  }

  for (const note of activeNotes) {
    const noteNodeId = `note:${note.id}`;
    for (const id of note.linkedNoteIds || []) addEntityLink(noteNodeId, `note:${id}`);
    for (const id of note.linkedTaskIds || []) addEntityLink(noteNodeId, `task:${id}`);
    for (const id of note.linkedTimelineEventIds || []) addEntityLink(noteNodeId, `event:${id}`);
  }
  for (const task of activeTasks) {
    const taskNodeId = `task:${task.id}`;
    for (const id of task.linkedNoteIds || []) addEntityLink(taskNodeId, `note:${id}`);
    for (const id of task.linkedTaskIds || []) addEntityLink(taskNodeId, `task:${id}`);
    for (const id of task.linkedTimelineEventIds || []) addEntityLink(taskNodeId, `event:${id}`);
  }

  return { nodes, edges };
}

/**
 * Compute a lightweight hash string from entity IDs and updatedAt timestamps.
 * Used for memoization — only rebuild the graph when this hash changes.
 */
export function computeGraphHash(
  notes: Note[],
  tasks: Task[],
  timelineEvents: TimelineEvent[],
  settings?: Settings,
): string {
  // Build a compact fingerprint: id:updatedAt pairs joined by ','
  const parts: string[] = [];
  for (const n of notes) parts.push(`n:${n.id}:${n.updatedAt}`);
  for (const t of tasks) parts.push(`t:${t.id}:${t.updatedAt}`);
  for (const e of timelineEvents) parts.push(`e:${e.id}:${e.updatedAt}`);
  // Include custom relationship types in hash so graph updates when they change
  if (settings?.tiRelationshipTypes) {
    parts.push(`rel:${Object.keys(settings.tiRelationshipTypes).sort().join(',')}`);
  }
  return parts.join('|');
}

// Cached state for memoized graph building
let _cachedHash = '';
let _cachedGraph: GraphData = { nodes: [], edges: [] };

/**
 * Memoized graph builder — only rebuilds when entity data actually changes.
 * Can be called outside useMemo (e.g., in callbacks or effects).
 */
export function buildGraphDataMemoized(
  notes: Note[],
  tasks: Task[],
  timelineEvents: TimelineEvent[],
  settings?: Settings,
): GraphData {
  const hash = computeGraphHash(notes, tasks, timelineEvents, settings);
  if (hash === _cachedHash && _cachedGraph.nodes.length > 0) {
    return _cachedGraph;
  }
  _cachedHash = hash;
  _cachedGraph = buildGraphData(notes, tasks, timelineEvents, settings);
  return _cachedGraph;
}
