import type { IOCType } from '../types';

/**
 * Pixel-art SVG icons for graph nodes.
 * All icons use a 16×16 grid with only <rect> elements for a crisp blocky look.
 * Each "pixel" is a 1×1 rect placed on integer coordinates.
 */

function darken(hex: string, amount: number): string {
  const h = hex.replace('#', '');
  const r = Math.max(0, Math.round(parseInt(h.substring(0, 2), 16) * (1 - amount)));
  const g = Math.max(0, Math.round(parseInt(h.substring(2, 4), 16) * (1 - amount)));
  const b = Math.max(0, Math.round(parseInt(h.substring(4, 6), 16) * (1 - amount)));
  return `#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${b.toString(16).padStart(2, '0')}`;
}

/** Helper: render an array of [x,y] pixel positions as 1×1 rects */
function px(coords: [number, number][], fill: string): string {
  return coords.map(([x, y]) => `<rect x="${x}" y="${y}" width="1" height="1" fill="${fill}"/>`).join('');
}

const S = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" shape-rendering="crispEdges">`;
const E = '</svg>';

// --- Globe base (shared by ipv4, ipv6, domain) ---
function globeOutline(c: string): string {
  // Circle outline approximation
  return px([
    [5,1],[6,1],[7,1],[8,1],[9,1],[10,1],
    [3,2],[4,2],[11,2],[12,2],
    [2,3],[13,3],
    [1,4],[14,4],
    [1,5],[14,5],
    [1,6],[14,6],
    [1,7],[14,7],
    [1,8],[14,8],
    [1,9],[14,9],
    [1,10],[14,10],
    [1,11],[14,11],
    [2,12],[13,12],
    [3,13],[4,13],[11,13],[12,13],
    [5,14],[6,14],[7,14],[8,14],[9,14],[10,14],
  ], c);
}

function globeCross(c: string): string {
  // Horizontal + vertical center lines
  return px([
    [2,7],[3,7],[4,7],[5,7],[6,7],[7,7],[8,7],[9,7],[10,7],[11,7],[12,7],[13,7],
    [2,8],[3,8],[4,8],[5,8],[6,8],[7,8],[8,8],[9,8],[10,8],[11,8],[12,8],[13,8],
    [7,2],[8,2],[7,3],[8,3],[7,4],[8,4],[7,5],[8,5],[7,6],[8,6],
    [7,9],[8,9],[7,10],[8,10],[7,11],[8,11],[7,12],[8,12],[7,13],[8,13],
  ], c);
}

// IPv4: globe + "4" in bottom-right
function svgIpv4(c: string): string {
  const d = darken(c, 0.3);
  // Pixel "4" at bottom-right (positions 10-14, 9-14)
  const four = px([
    [10,9],[10,10],[10,11],[10,12],
    [11,12],[12,9],[12,10],[12,11],[12,12],[12,13],[12,14],
    [13,12],[14,12],
  ], c);
  return S + globeOutline(d) + globeCross(d) + four + E;
}

// IPv6: globe + "6" in bottom-right
function svgIpv6(c: string): string {
  const d = darken(c, 0.3);
  const six = px([
    [11,9],[12,9],[13,9],
    [10,10],[10,11],[10,12],[10,13],
    [11,11],[12,11],[13,11],
    [13,12],[13,13],
    [11,14],[12,14],
  ], c);
  return S + globeOutline(d) + globeCross(d) + six + E;
}

// Domain: globe + extra latitude lines
function svgDomain(c: string): string {
  const d = darken(c, 0.3);
  const lats = px([
    [3,4],[4,4],[5,4],[6,4],[9,4],[10,4],[11,4],[12,4],
    [3,11],[4,11],[5,11],[6,11],[9,11],[10,11],[11,11],[12,11],
  ], d);
  return S + globeOutline(c) + globeCross(d) + lats + E;
}

// URL: chain link
function svgUrl(c: string): string {
  const d = darken(c, 0.3);
  return S +
    // Left link
    px([[2,5],[3,5],[4,5],[5,5],[2,6],[5,6],[2,7],[5,7],[2,8],[5,8],[2,9],[5,9],[2,10],[3,10],[4,10],[5,10]], c) +
    // Right link
    px([[10,5],[11,5],[12,5],[13,5],[10,6],[13,6],[10,7],[13,7],[10,8],[13,8],[10,9],[13,9],[10,10],[11,10],[12,10],[13,10]], c) +
    // Bridge
    px([[6,7],[7,7],[8,7],[9,7],[6,8],[7,8],[8,8],[9,8]], d) +
    E;
}

// Email: envelope
function svgEmail(c: string): string {
  const d = darken(c, 0.3);
  return S +
    // Envelope outline
    px([
      [1,4],[2,4],[3,4],[4,4],[5,4],[6,4],[7,4],[8,4],[9,4],[10,4],[11,4],[12,4],[13,4],[14,4],
      [1,5],[14,5],[1,6],[14,6],[1,7],[14,7],[1,8],[14,8],[1,9],[14,9],[1,10],[14,10],
      [1,11],[2,11],[3,11],[4,11],[5,11],[6,11],[7,11],[8,11],[9,11],[10,11],[11,11],[12,11],[13,11],[14,11],
    ], c) +
    // V flap
    px([[2,5],[3,6],[4,7],[5,7],[13,5],[12,6],[11,7],[10,7],[6,8],[7,8],[8,8],[9,8]], d) +
    E;
}

// MD5: hash "#"
function svgMd5(c: string): string {
  const d = darken(c, 0.3);
  return S +
    px([
      // Two vertical bars
      [5,2],[5,3],[5,4],[5,5],[5,6],[5,7],[5,8],[5,9],[5,10],[5,11],[5,12],[5,13],
      [10,2],[10,3],[10,4],[10,5],[10,6],[10,7],[10,8],[10,9],[10,10],[10,11],[10,12],[10,13],
      // Two horizontal bars
      [3,5],[4,5],[6,5],[7,5],[8,5],[9,5],[11,5],[12,5],
      [3,10],[4,10],[6,10],[7,10],[8,10],[9,10],[11,10],[12,10],
    ], c) +
    px([[6,5],[9,5],[6,10],[9,10]], d) + // Intersections slightly darker
    E;
}

// SHA-1: smaller hash + "1"
function svgSha1(c: string): string {
  const d = darken(c, 0.3);
  return S +
    // Small hash on left
    px([
      [3,3],[3,4],[3,5],[3,6],[3,7],[3,8],[3,9],[3,10],
      [7,3],[7,4],[7,5],[7,6],[7,7],[7,8],[7,9],[7,10],
      [1,5],[2,5],[4,5],[5,5],[6,5],[8,5],
      [1,8],[2,8],[4,8],[5,8],[6,8],[8,8],
    ], c) +
    // "1" on right
    px([
      [12,3],[11,4],[12,4],[12,5],[12,6],[12,7],[12,8],[12,9],[12,10],[12,11],
      [11,11],[13,11],
    ], d) +
    E;
}

// SHA-256: hash + checkmark
function svgSha256(c: string): string {
  const d = darken(c, 0.3);
  return S +
    // Small hash on left
    px([
      [2,2],[2,3],[2,4],[2,5],[2,6],[2,7],[2,8],[2,9],
      [6,2],[6,3],[6,4],[6,5],[6,6],[6,7],[6,8],[6,9],
      [1,4],[3,4],[4,4],[5,4],[7,4],
      [1,7],[3,7],[4,7],[5,7],[7,7],
    ], c) +
    // Checkmark on right
    px([
      [9,9],[10,10],[11,11],[12,10],[13,9],[14,8],[13,7],
    ], d) +
    E;
}

// CVE: shield with "!"
function svgCve(c: string): string {
  const d = darken(c, 0.3);
  return S +
    // Shield outline
    px([
      [4,1],[5,1],[6,1],[7,1],[8,1],[9,1],[10,1],[11,1],
      [3,2],[12,2],[2,3],[13,3],[2,4],[13,4],[2,5],[13,5],
      [2,6],[13,6],[3,7],[12,7],[3,8],[12,8],
      [4,9],[11,9],[5,10],[10,10],[6,11],[9,11],[7,12],[8,12],
    ], c) +
    // "!" using rects
    px([
      [7,3],[8,3],[7,4],[8,4],[7,5],[8,5],[7,6],[8,6],
      [7,8],[8,8],
    ], d) +
    E;
}

// MITRE ATT&CK: crosshair/target
function svgMitreAttack(c: string): string {
  const d = darken(c, 0.3);
  return S +
    // Outer ring
    px([
      [5,1],[6,1],[7,1],[8,1],[9,1],[10,1],
      [3,2],[4,2],[11,2],[12,2],
      [2,3],[13,3],[2,4],[13,4],
      [1,5],[1,6],[14,5],[14,6],
      [1,9],[1,10],[14,9],[14,10],
      [2,11],[13,11],[2,12],[13,12],
      [3,13],[4,13],[11,13],[12,13],
      [5,14],[6,14],[7,14],[8,14],[9,14],[10,14],
    ], c) +
    // Crosshair lines
    px([
      [7,0],[8,0],[7,2],[8,2],[7,3],[8,3],
      [7,12],[8,12],[7,13],[8,13],[7,15],[8,15],
      [0,7],[0,8],[2,7],[2,8],[3,7],[3,8],
      [12,7],[12,8],[13,7],[13,8],[15,7],[15,8],
    ], d) +
    // Center dot
    px([[7,7],[8,7],[7,8],[8,8]], c) +
    E;
}

// YARA Rule: magnifying glass
function svgYaraRule(c: string): string {
  const d = darken(c, 0.3);
  return S +
    // Lens ring
    px([
      [4,1],[5,1],[6,1],[7,1],[8,1],
      [3,2],[9,2],[2,3],[10,3],
      [1,4],[11,4],[1,5],[11,5],[1,6],[11,6],[1,7],[11,7],[1,8],[11,8],
      [2,9],[10,9],[3,10],[9,10],
      [4,11],[5,11],[6,11],[7,11],[8,11],
    ], c) +
    // Handle
    px([[10,10],[11,11],[12,12],[13,13],[14,14]], d) +
    px([[11,10],[10,11],[12,11],[11,12],[13,12],[12,13],[14,13],[13,14]], d) +
    E;
}

// File Path: document with corner fold
function svgFilePath(c: string): string {
  const d = darken(c, 0.3);
  return S +
    // Doc outline
    px([
      [3,1],[4,1],[5,1],[6,1],[7,1],[8,1],[9,1],
      [3,2],[3,3],[3,4],[3,5],[3,6],[3,7],[3,8],[3,9],[3,10],[3,11],[3,12],[3,13],
      [12,4],[12,5],[12,6],[12,7],[12,8],[12,9],[12,10],[12,11],[12,12],[12,13],
      [4,14],[5,14],[6,14],[7,14],[8,14],[9,14],[10,14],[11,14],
      [3,14],[12,14],
    ], c) +
    // Corner fold
    px([[10,1],[11,2],[12,3],[10,2],[11,3],[10,3]], d) +
    // Content lines
    px([[5,6],[6,6],[7,6],[8,6],[9,6],[10,6]], d) +
    px([[5,8],[6,8],[7,8],[8,8],[9,8],[10,8]], d) +
    px([[5,10],[6,10],[7,10],[8,10]], d) +
    E;
}

// Note: lined document
function svgNote(c: string): string {
  const d = darken(c, 0.3);
  return S +
    // Page outline
    px([
      [2,1],[3,1],[4,1],[5,1],[6,1],[7,1],[8,1],[9,1],[10,1],[11,1],[12,1],[13,1],
      [2,2],[2,3],[2,4],[2,5],[2,6],[2,7],[2,8],[2,9],[2,10],[2,11],[2,12],[2,13],
      [13,2],[13,3],[13,4],[13,5],[13,6],[13,7],[13,8],[13,9],[13,10],[13,11],[13,12],[13,13],
      [2,14],[3,14],[4,14],[5,14],[6,14],[7,14],[8,14],[9,14],[10,14],[11,14],[12,14],[13,14],
    ], c) +
    // Text lines
    px([[4,4],[5,4],[6,4],[7,4],[8,4],[9,4],[10,4],[11,4]], d) +
    px([[4,7],[5,7],[6,7],[7,7],[8,7],[9,7],[10,7],[11,7]], d) +
    px([[4,10],[5,10],[6,10],[7,10],[8,10]], d) +
    E;
}

// Task: checkbox with checkmark
function svgTask(c: string): string {
  const d = darken(c, 0.3);
  return S +
    // Box outline
    px([
      [2,2],[3,2],[4,2],[5,2],[6,2],[7,2],[8,2],[9,2],[10,2],[11,2],[12,2],[13,2],
      [2,3],[13,3],[2,4],[13,4],[2,5],[13,5],[2,6],[13,6],
      [2,7],[13,7],[2,8],[13,8],[2,9],[13,9],[2,10],[13,10],[2,11],[13,11],
      [2,12],[3,12],[4,12],[5,12],[6,12],[7,12],[8,12],[9,12],[10,12],[11,12],[12,12],[13,12],
    ], c) +
    // Checkmark
    px([
      [5,7],[5,8],[6,8],[6,9],[7,9],[7,10],
      [8,8],[8,9],[9,7],[9,8],[10,6],[10,7],[11,5],[11,6],
    ], d) +
    E;
}

// Timeline Event: clock face
function svgTimelineEvent(c: string): string {
  const d = darken(c, 0.3);
  return S +
    // Circle
    px([
      [5,1],[6,1],[7,1],[8,1],[9,1],[10,1],
      [3,2],[4,2],[11,2],[12,2],
      [2,3],[13,3],[2,4],[13,4],
      [1,5],[1,6],[14,5],[14,6],
      [1,7],[1,8],[14,7],[14,8],
      [1,9],[1,10],[14,9],[14,10],
      [2,11],[13,11],[2,12],[13,12],
      [3,13],[4,13],[11,13],[12,13],
      [5,14],[6,14],[7,14],[8,14],[9,14],[10,14],
    ], c) +
    // Clock hands: vertical (12 o'clock) + angled (3 o'clock)
    px([
      [7,4],[8,4],[7,5],[8,5],[7,6],[8,6],[7,7],[8,7],
      [9,8],[10,8],[11,9],[10,9],
    ], d) +
    // Center dot
    px([[7,8],[8,8]], c) +
    E;
}

// --- Icon resolver ---

const IOC_ICON_MAP: Record<IOCType, (c: string) => string> = {
  ipv4: svgIpv4,
  ipv6: svgIpv6,
  domain: svgDomain,
  url: svgUrl,
  email: svgEmail,
  md5: svgMd5,
  sha1: svgSha1,
  sha256: svgSha256,
  cve: svgCve,
  'mitre-attack': svgMitreAttack,
  'yara-rule': svgYaraRule,
  'file-path': svgFilePath,
};

const cache = new Map<string, string>();

/**
 * Returns a data URI for a pixel-art SVG icon matching the given entity type and color.
 */
export function getNodeIcon(
  type: 'ioc' | 'note' | 'task' | 'timeline-event',
  color: string,
  iocType?: IOCType,
): string {
  const key = `${type}:${iocType ?? ''}:${color}`;
  const cached = cache.get(key);
  if (cached) return cached;

  let svg: string;
  switch (type) {
    case 'ioc': {
      const fn = iocType ? IOC_ICON_MAP[iocType] : svgDomain;
      svg = fn(color);
      break;
    }
    case 'note':
      svg = svgNote(color);
      break;
    case 'task':
      svg = svgTask(color);
      break;
    case 'timeline-event':
      svg = svgTimelineEvent(color);
      break;
  }

  const uri = `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
  cache.set(key, uri);
  return uri;
}

/** Visible for testing only. */
export function _clearIconCache(): void {
  cache.clear();
}
