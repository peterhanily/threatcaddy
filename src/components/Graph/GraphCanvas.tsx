import { useEffect, useRef, useCallback } from 'react';
import cytoscape from 'cytoscape';
// @ts-expect-error no type declarations for this package
import coseBilkent from 'cytoscape-cose-bilkent';
import type { GraphData } from '../../lib/graph-data';

// Register layout extension once
cytoscape.use(coseBilkent);

export type LayoutName = 'cose-bilkent' | 'circle' | 'breadthfirst';

interface GraphCanvasProps {
  data: GraphData;
  layout: LayoutName;
  onSelectNode: (nodeId: string | null) => void;
  onDoubleClickNode: (nodeId: string) => void;
  onSelectMulti?: (nodeIds: string[]) => void;
  theme: 'dark' | 'light';
  fitTrigger?: number;
}

export default function GraphCanvas({ data, layout, onSelectNode, onDoubleClickNode, onSelectMulti, theme, fitTrigger }: GraphCanvasProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const cyRef = useRef<cytoscape.Core | null>(null);
  // Stable refs for callbacks so cytoscape event handlers always use latest versions
  const onSelectNodeRef = useRef(onSelectNode);
  onSelectNodeRef.current = onSelectNode;
  const onDoubleClickNodeRef = useRef(onDoubleClickNode);
  onDoubleClickNodeRef.current = onDoubleClickNode;
  const onSelectMultiRef = useRef(onSelectMulti);
  onSelectMultiRef.current = onSelectMulti;

  const isDark = theme === 'dark';

  const getLayoutOptions = useCallback((name: LayoutName) => {
    switch (name) {
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
    cy.layout(getLayoutOptions(layout)).run();
    cy.fit(undefined, 40);
  }, [data, layout, getLayoutOptions]);

  // Fit-to-view on trigger change
  useEffect(() => {
    if (fitTrigger === undefined) return;
    const cy = cyRef.current;
    if (cy) cy.fit(undefined, 40);
  }, [fitTrigger]);

  return <div ref={containerRef} className="w-full h-full" />;
}
