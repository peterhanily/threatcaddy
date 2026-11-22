import { useEffect, useLayoutEffect, useRef, useCallback } from 'react';
import cytoscape from 'cytoscape';
// @ts-expect-error no type declarations for this package
import coseBilkent from 'cytoscape-cose-bilkent';
import type { GraphData } from '../../lib/graph-data';
import { focusRings } from '../../lib/graph-focus';

// Register layout extension once
cytoscape.use(coseBilkent);

export type LayoutName = 'cose-bilkent' | 'circle' | 'breadthfirst' | 'focus';

interface GraphCanvasProps {
  data: GraphData;
  layout: LayoutName;
  /** The node the Focus layout centres on. */
  focusNodeId?: string;
  onSelectNode: (nodeId: string | null) => void;
  onDoubleClickNode: (nodeId: string) => void;
  onSelectMulti?: (nodeIds: string[]) => void;
  onLinkNodes?: (sourceId: string, targetId: string) => void;
  theme: 'dark' | 'light';
  fitTrigger?: number;
}

export default function GraphCanvas({ data, layout, focusNodeId, onSelectNode, onDoubleClickNode, onSelectMulti, onLinkNodes, theme, fitTrigger }: GraphCanvasProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  // The node the Focus layout centres on, read when the graph is rebuilt, and the last one laid out.
  const focusRef = useRef(focusNodeId);
  const focusLaidOut = useRef<string | undefined>(undefined);
  const cyRef = useRef<cytoscape.Core | null>(null);
  // Stable refs for callbacks so cytoscape event handlers always use latest versions
  const onSelectNodeRef = useRef(onSelectNode);
  const onDoubleClickNodeRef = useRef(onDoubleClickNode);
  const onSelectMultiRef = useRef(onSelectMulti);
  const onLinkNodesRef = useRef(onLinkNodes);
  useLayoutEffect(() => {
    onSelectNodeRef.current = onSelectNode;
    onDoubleClickNodeRef.current = onDoubleClickNode;
    onSelectMultiRef.current = onSelectMulti;
    onLinkNodesRef.current = onLinkNodes;
  }, [onSelectNode, onDoubleClickNode, onSelectMulti, onLinkNodes]);
  // Drag-to-link state
  const linkDragSourceRef = useRef<string | null>(null);
  const linkDragActiveRef = useRef(false);

  const isDark = theme === 'dark';

  const getLayoutOptions = useCallback((name: LayoutName, focus?: cytoscape.NodeSingular) => {
    switch (focus || name !== 'focus' ? name : 'cose-bilkent') {
      case 'focus': {
        // Rings around the selected node (without one, the switch uses the force-directed layout).
        if (!focus) return { name: 'cose-bilkent', animate: false };
        const rings = focusRings(focus);
        return {
          name: 'concentric', animate: false, minNodeSpacing: 30,
          concentric: (node: cytoscape.NodeSingular) => rings.get(node.id()) ?? 0,
          levelWidth: () => 1,
        };
      }
      case 'cose-bilkent':
        return {
          name: 'cose-bilkent',
          animate: false,
          nodeDimensionsIncludeLabels: true,
          idealEdgeLength: 120,
          nodeRepulsion: 6000,
          edgeElasticity: 0.1,
          gravity: 0.25,
          tile: true,
        };
      case 'circle':
        return { name: 'circle', animate: false };
      case 'breadthfirst':
        return { name: 'breadthfirst', animate: false, directed: true, spacingFactor: 1.5 };
      default:
        return { name: 'cose-bilkent', animate: false };
    }
  }, []);

  // Initialize cytoscape
  useEffect(() => {
    if (!containerRef.current) return;

    const cy = cytoscape({
      container: containerRef.current,
      boxSelectionEnabled: true,
      selectionType: 'additive',
      style: [
        {
          selector: 'node',
          style: {
            'background-color': 'data(color)',
            'background-opacity': 0.12,
            'background-image': 'data(icon)',
            'background-fit': 'contain' as const,
            'label': 'data(label)',
            'font-size': '10px',
            'color': isDark ? '#e5e7eb' : '#374151',
            'text-outline-color': isDark ? '#111827' : '#ffffff',
            'text-outline-width': 2,
            'text-valign': 'bottom',
            'text-halign': 'center',
            'text-margin-y': 6,
            'width': 32,
            'height': 32,
            'shape': 'round-rectangle' as cytoscape.Css.NodeShape,
            'border-width': 1.5,
            'border-color': 'data(color)',
            'border-opacity': 0.35,
          },
        },
        {
          selector: 'node[type = "ioc"]',
          style: {
            'width': 28,
            'height': 28,
          },
        },
        {
          selector: 'node[type = "note"], node[type = "task"]',
          style: {
            'width': 36,
            'height': 28,
          },
        },
        {
          selector: 'node[type = "timeline-event"]',
          style: {
            'width': 32,
            'height': 32,
          },
        },
        {
          selector: 'node[type = "identity"]',
          style: {
            'width': 32,
            'height': 32,
            'shape': 'ellipse',
          },
        },
        {
          selector: 'node:selected',
          style: {
            'border-width': 3,
            'border-color': '#f59e0b',
            'border-opacity': 1,
          },
        },
        {
          selector: 'edge',
          style: {
            'width': 1.5,
            'line-color': isDark ? '#4b5563' : '#d1d5db',
            'curve-style': 'bezier',
            'font-size': '8px',
            'color': isDark ? '#9ca3af' : '#6b7280',
            'text-outline-color': isDark ? '#111827' : '#ffffff',
            'text-outline-width': 1.5,
          },
        },
        {
          selector: 'edge[type = "ioc-relationship"]',
          style: {
            'line-color': '#f59e0b',
            'target-arrow-color': '#f59e0b',
            'target-arrow-shape': 'triangle',
            'arrow-scale': 0.8,
            'label': 'data(label)',
            'width': 2,
          },
        },
        {
          selector: 'edge[type = "contains-ioc"]',
          style: {
            'line-style': 'dashed',
            'line-dash-pattern': [4, 4],
            'opacity': 0.6,
          },
        },
        {
          selector: 'edge[type = "timeline-link"]',
          style: {
            'line-color': isDark ? '#6366f1' : '#818cf8',
            'target-arrow-color': isDark ? '#6366f1' : '#818cf8',
            'target-arrow-shape': 'triangle',
            'arrow-scale': 0.6,
          },
        },
        {
          selector: 'edge[type = "entity-link"]',
          style: {
            'line-color': '#22c55e',
            'width': 2,
          },
        },
        {
          selector: 'edge[type = "identity-connection"]',
          style: {
            'line-color': '#0ea5e9',
            'target-arrow-color': '#0ea5e9',
            'target-arrow-shape': 'triangle',
            'arrow-scale': 0.8,
            'label': 'data(label)',
            'width': 2,
          },
        },
        {
          selector: 'edge[type = "identity-link"]',
          style: {
            'line-color': isDark ? '#38bdf8' : '#7dd3fc',
            'line-style': 'dotted',
            'target-arrow-color': isDark ? '#38bdf8' : '#7dd3fc',
            'target-arrow-shape': 'triangle',
            'arrow-scale': 0.6,
            'label': 'data(label)',
          },
        },
        {
          selector: '.link-source',
          style: {
            'border-width': 3,
            'border-color': '#f59e0b',
            'border-opacity': 1,
            'background-opacity': 0.3,
          },
        },
        {
          selector: '.link-target',
          style: {
            'border-width': 2,
            'border-color': '#f59e0b',
            'border-opacity': 0.7,
            'border-style': 'dashed' as cytoscape.Css.LineStyle,
          },
        },
        {
          selector: '.faded',
          style: {
            'opacity': 0.15,
          },
        },
        {
          selector: '.highlighted',
          style: {
            'opacity': 1,
          },
        },
      ],
      layout: getLayoutOptions(layout),
      minZoom: 0.1,
      maxZoom: 5,
    });

    cyRef.current = cy;

    // Events — neighbor highlighting
    cy.on('tap', 'node', (evt) => {
      const node = evt.target;
      const neighborhood = node.neighborhood().add(node);
      cy.elements().addClass('faded').removeClass('highlighted');
      neighborhood.removeClass('faded').addClass('highlighted');
      onSelectNodeRef.current(node.id());
    });
    cy.on('tap', (evt) => {
      if (evt.target === cy) {
        cy.elements().removeClass('faded').removeClass('highlighted');
        cy.elements().unselect();
        onSelectNodeRef.current(null);
      }
    });
    cy.on('dbltap', 'node', (evt) => {
      onDoubleClickNodeRef.current(evt.target.id());
    });

    // Box selection — highlight combined neighborhood of all selected nodes
    cy.on('boxselect', () => {
      const selected = cy.nodes(':selected');
      if (selected.length === 0) return;
      const neighborhood = selected.neighborhood().add(selected);
      cy.elements().addClass('faded').removeClass('highlighted');
      neighborhood.removeClass('faded').addClass('highlighted');
      const ids = selected.map((n) => n.id());
      onSelectMultiRef.current?.(ids);
    });

    // Alt+drag-to-link: grab
    cy.on('grab', 'node', (evt) => {
      if (!evt.originalEvent || !(evt.originalEvent as MouseEvent).altKey) return;
      const node = evt.target;
      linkDragSourceRef.current = node.id();
      linkDragActiveRef.current = true;
      node.addClass('link-source');
    });

    // Alt+drag-to-link: drag — highlight nearest node
    cy.on('drag', 'node', (evt) => {
      if (!linkDragActiveRef.current) return;
      const sourceId = linkDragSourceRef.current;
      const draggedNode = evt.target;
      const pos = draggedNode.position();
      // Remove previous link-target highlights
      cy.nodes('.link-target').removeClass('link-target');
      // Find closest other node within threshold
      let closest: cytoscape.NodeSingular | null = null;
      let minDist = Infinity;
      cy.nodes().forEach((n) => {
        if (n.id() === sourceId || n.id() === draggedNode.id()) return;
        const np = n.position();
        const dx = np.x - pos.x;
        const dy = np.y - pos.y;
        const dist = Math.sqrt(dx * dx + dy * dy);
        if (dist < 60 && dist < minDist) { minDist = dist; closest = n; }
      });
      if (closest) (closest as cytoscape.NodeSingular).addClass('link-target');
    });

    // Alt+drag-to-link: free (drop)
    cy.on('free', 'node', (evt) => {
      if (!linkDragActiveRef.current) return;
      linkDragActiveRef.current = false;
      const sourceId = linkDragSourceRef.current;
      linkDragSourceRef.current = null;
      // Clean up classes
      cy.nodes('.link-source').removeClass('link-source');
      const targetNode = cy.nodes('.link-target');
      targetNode.removeClass('link-target');
      if (!sourceId) return;
      // Find target: the node under the drop position
      const pos = evt.target.position();
      let bestTarget: string | null = null;
      let bestDist = Infinity;
      cy.nodes().forEach((n) => {
        if (n.id() === sourceId || n.id() === evt.target.id()) return;
        const np = n.position();
        const dx = np.x - pos.x;
        const dy = np.y - pos.y;
        const dist = Math.sqrt(dx * dx + dy * dy);
        if (dist < 60 && dist < bestDist) { bestDist = dist; bestTarget = n.id(); }
      });
      if (bestTarget && onLinkNodesRef.current) {
        onLinkNodesRef.current(sourceId, bestTarget);
      }
    });

    return () => {
      cy.destroy();
      cyRef.current = null;
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isDark]);

  // ResizeObserver — call cy.resize() when container becomes visible
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    let prevWidth = el.offsetWidth;
    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (!entry) return;
      const newWidth = entry.contentRect.width;
      // Container transitioned from hidden (0-width) to visible
      if (prevWidth === 0 && newWidth > 0) {
        const cy = cyRef.current;
        if (cy) {
          cy.resize();
          cy.fit(undefined, 40);
        }
      }
      prevWidth = newWidth;
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  // Update data
  useEffect(() => {
    const cy = cyRef.current;
    if (!cy) return;

    cy.batch(() => {
      cy.elements().remove();

      // Add nodes
      for (const node of data.nodes) {
        cy.add({
          group: 'nodes',
          data: {
            id: node.id,
            label: node.label,
            color: node.color,
            type: node.type,
            icon: node.icon,
            iocType: node.iocType ?? '',
            identityType: node.identityType ?? '',
          },
        });
      }

      // Add edges
      for (const edge of data.edges) {
        // Only add edge if both source and target exist
        if (cy.getElementById(edge.source).length > 0 && cy.getElementById(edge.target).length > 0) {
          cy.add({
            group: 'edges',
            data: {
              id: edge.id,
              source: edge.source,
              target: edge.target,
              label: edge.label,
              type: edge.type,
            },
          });
        }
      }
    });

    // Run layout
    const focus = layout === 'focus' && focusRef.current ? cy.getElementById(focusRef.current) : undefined;
    cy.layout(getLayoutOptions(layout, focus?.nonempty() ? focus : undefined) as cytoscape.LayoutOptions).run();
    focusLaidOut.current = layout === 'focus' ? focusRef.current : undefined;
    cy.fit(undefined, 40);
  }, [data, layout, getLayoutOptions]);

  // The Focus layout follows the selected node by moving the existing nodes: no rebuild, so the
  // selection and its highlight stay. Clearing the selection leaves the nodes where they are.
  useEffect(() => {
    focusRef.current = focusNodeId;
    const cy = cyRef.current;
    if (!cy || layout !== 'focus' || !focusNodeId || focusLaidOut.current === focusNodeId) return;
    const focus = cy.getElementById(focusNodeId);
    if (focus.empty()) return;
    cy.layout(getLayoutOptions('focus', focus) as cytoscape.LayoutOptions).run();
    focusLaidOut.current = focusNodeId;
    cy.fit(undefined, 40);
  }, [layout, focusNodeId, getLayoutOptions]);

  // Fit-to-view on trigger change
  useEffect(() => {
    if (fitTrigger === undefined) return;
    const cy = cyRef.current;
    if (cy) cy.fit(undefined, 40);
  }, [fitTrigger]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    const cy = cyRef.current;
    if (!cy) return;
    const selected = cy.nodes(':selected');

    if (e.key === 'Escape') {
      cy.elements().removeClass('faded').removeClass('highlighted');
      cy.elements().unselect();
      onSelectNodeRef.current(null);
    } else if (e.key === 'Tab') {
      e.preventDefault();
      const allNodes = cy.nodes();
      if (allNodes.length === 0) return;
      const currentId = selected.length > 0 ? selected.last().id() : null;
      let currentIdx = -1;
      if (currentId) {
        allNodes.forEach((n, i) => { if (n.id() === currentId) currentIdx = i; });
      }
      const nextIdx = e.shiftKey
        ? (currentIdx <= 0 ? allNodes.length - 1 : currentIdx - 1)
        : (currentIdx + 1) % allNodes.length;
      cy.elements().unselect().removeClass('faded').removeClass('highlighted');
      const nextNode = allNodes[nextIdx];
      nextNode.select();
      const neighborhood = nextNode.neighborhood().add(nextNode);
      cy.elements().addClass('faded');
      neighborhood.removeClass('faded').addClass('highlighted');
      cy.animate({ center: { eles: nextNode }, duration: 200 });
      onSelectNodeRef.current(nextNode.id());
    } else if (e.key === 'Enter' && selected.length > 0) {
      onDoubleClickNodeRef.current(selected.last().id());
    } else if ((e.key === '+' || e.key === '=') && e.metaKey) {
      e.preventDefault();
      cy.zoom({ level: cy.zoom() * 1.2, renderedPosition: { x: cy.width() / 2, y: cy.height() / 2 } });
    } else if (e.key === '-' && e.metaKey) {
      e.preventDefault();
      cy.zoom({ level: cy.zoom() / 1.2, renderedPosition: { x: cy.width() / 2, y: cy.height() / 2 } });
    } else if (e.key === '0' && e.metaKey) {
      e.preventDefault();
      cy.fit(undefined, 40);
    }
  }, []);

  return <div ref={containerRef} className="w-full h-full" role="img" aria-label="Investigation graph visualization" tabIndex={0} onKeyDown={handleKeyDown} />;
}
