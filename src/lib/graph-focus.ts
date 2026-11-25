import type { NodeSingular } from 'cytoscape';

/**
 * Rings for the graph's Focus layout: the chosen node (3), its neighbours (2), their neighbours
 * (1), everything else (0). An organisation's other members are not pulled into the third ring,
 * so focusing on one employee does not draw the whole company around them.
 */
export function focusRings(focus: NodeSingular): Map<string, number> {
  const rings = new Map<string, number>([[focus.id(), 3]]);
  const neighbours = focus.neighborhood('node');
  neighbours.forEach(node => { rings.set(node.id(), 2); });
  neighbours.forEach(node => {
    if (node.data('type') === 'identity' && node.data('identityType') === 'organization') return;
    node.neighborhood('node').forEach(next => { if (!rings.has(next.id())) rings.set(next.id(), 1); });
  });
  return rings;
}
