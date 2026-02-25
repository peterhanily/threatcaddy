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
  theme: 'dark' | 'light';
}

export default function GraphCanvas({ data, layout, onSelectNode, onDoubleClickNode, theme }: GraphCanvasProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const cyRef = useRef<cytoscape.Core | null>(null);

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
      style: [
        {
          selector: 'node',
          style: {
            'background-color': 'data(color)',
            'background-opacity': 0.12,
            'background-image': 'data(icon)',
            'background-width': 'data(iconSize)' as unknown as number,
            'background-height': 'data(iconSize)' as unknown as number,
            'background-fit': 'none' as const,
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
      ],
      layout: getLayoutOptions(layout),
      minZoom: 0.1,
      maxZoom: 5,
    });

    cyRef.current = cy;

    // Keep icons at a constant screen size regardless of zoom level.
    // Updating node data triggers a reactive style recalculation via data(iconSize).
    const ICON_SCREEN_PX = 22;
    cy.on('zoom', () => {
      const modelSize = ICON_SCREEN_PX / cy.zoom();
      cy.nodes().data('iconSize', modelSize);
    });

    // Events
    cy.on('tap', 'node', (evt) => {
      onSelectNode(evt.target.id());
    });
    cy.on('tap', (evt) => {
      if (evt.target === cy) onSelectNode(null);
    });
    cy.on('dbltap', 'node', (evt) => {
      onDoubleClickNode(evt.target.id());
    });

    return () => {
      cy.destroy();
      cyRef.current = null;
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isDark]);

  // Update data
  useEffect(() => {
    const cy = cyRef.current;
    if (!cy) return;

    cy.batch(() => {
      cy.elements().remove();

      // Add nodes — include iconSize so stylesheet data(iconSize) is available
      const iconSize = 22 / cy.zoom();
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
            iconSize,
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

    // After fit changes zoom, update iconSize data so icons stay at constant screen size
    const postFitSize = 22 / cy.zoom();
    cy.nodes().data('iconSize', postFitSize);
  }, [data, layout, getLayoutOptions]);

  return (
    <div ref={containerRef} className="w-full h-full" />
  );
}
