import type { IOCType } from '../types';

/**
 * Graph node icons — clean filled SVG sprites.
 * Each icon is a 16×16 SVG using bold filled shapes for clarity at small sizes.
 * The fill color is parameterized to match entity colors.
 */

/** Lighten a hex color (mix toward white) */
function lighten(hex: string, amount: number): string {
  const h = hex.replace('#', '');
  const r = Math.min(255, Math.round(parseInt(h.substring(0, 2), 16) + (255 - parseInt(h.substring(0, 2), 16)) * amount));
  const g = Math.min(255, Math.round(parseInt(h.substring(2, 4), 16) + (255 - parseInt(h.substring(2, 4), 16)) * amount));
  const b = Math.min(255, Math.round(parseInt(h.substring(4, 6), 16) + (255 - parseInt(h.substring(4, 6), 16)) * amount));
  return `#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${b.toString(16).padStart(2, '0')}`;
}

const H = (c: string) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" fill="${c}">`;
const E = '</svg>';

// IPv4: filled globe with vertical/horizontal cross
function svgIpv4(c: string): string {
  const l = lighten(c, 0.5);
  return `${H(c)}<circle cx="8" cy="8" r="7" fill="${l}" opacity="0.4"/><circle cx="8" cy="8" r="7" fill="none" stroke="${c}" stroke-width="1.8"/><ellipse cx="8" cy="8" rx="3.5" ry="7" fill="none" stroke="${c}" stroke-width="1.2"/><line x1="1" y1="8" x2="15" y2="8" stroke="${c}" stroke-width="1.2"/>${E}`;
}

// IPv6: filled hexagon (6-sided = v6)
function svgIpv6(c: string): string {
  const l = lighten(c, 0.5);
  return `${H(c)}<polygon points="8,1 14.5,4.5 14.5,11.5 8,15 1.5,11.5 1.5,4.5" fill="${l}" opacity="0.4" stroke="${c}" stroke-width="1.8" stroke-linejoin="round"/><circle cx="8" cy="8" r="2" fill="${c}"/>${E}`;
}

// Domain: filled globe with latitude lines
function svgDomain(c: string): string {
  const l = lighten(c, 0.5);
  return `${H(c)}<circle cx="8" cy="8" r="7" fill="${l}" opacity="0.4"/><circle cx="8" cy="8" r="7" fill="none" stroke="${c}" stroke-width="1.8"/><line x1="1" y1="8" x2="15" y2="8" stroke="${c}" stroke-width="1.2"/><line x1="8" y1="1" x2="8" y2="15" stroke="${c}" stroke-width="1.2"/><line x1="2.5" y1="4.5" x2="13.5" y2="4.5" stroke="${c}" stroke-width="0.8"/><line x1="2.5" y1="11.5" x2="13.5" y2="11.5" stroke="${c}" stroke-width="0.8"/>${E}`;
}

// URL: chain link — two filled rounded rects linked
function svgUrl(c: string): string {
  const l = lighten(c, 0.5);
  return `${H(c)}<rect x="1" y="4.5" width="7" height="7" rx="2" fill="${l}" opacity="0.4" stroke="${c}" stroke-width="1.5"/><rect x="8" y="4.5" width="7" height="7" rx="2" fill="${l}" opacity="0.4" stroke="${c}" stroke-width="1.5"/><rect x="6" y="6.5" width="4" height="3" rx="0.5" fill="${c}"/>${E}`;
}

// Email: filled envelope
function svgEmail(c: string): string {
  const l = lighten(c, 0.5);
  return `${H(c)}<rect x="1" y="3.5" width="14" height="10" rx="1.5" fill="${l}" opacity="0.4" stroke="${c}" stroke-width="1.5"/><path d="M1.5,4 L8,9.5 L14.5,4" fill="none" stroke="${c}" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>${E}`;
}

// MD5: hash symbol "#" drawn with rects
function svgMd5(c: string): string {
  return `${H(c)}<rect x="5" y="1" width="2" height="14" rx="0.5" fill="${c}"/><rect x="9" y="1" width="2" height="14" rx="0.5" fill="${c}"/><rect x="1" y="5" width="14" height="2" rx="0.5" fill="${c}"/><rect x="1" y="9" width="14" height="2" rx="0.5" fill="${c}"/>${E}`;
}

// SHA-1: lock shape (hash security)
function svgSha1(c: string): string {
  const l = lighten(c, 0.5);
  return `${H(c)}<rect x="3" y="7" width="10" height="8" rx="1.5" fill="${l}" opacity="0.4" stroke="${c}" stroke-width="1.5"/><path d="M5,7 L5,5 Q5,1.5 8,1.5 Q11,1.5 11,5 L11,7" fill="none" stroke="${c}" stroke-width="1.8"/><circle cx="8" cy="11" r="1.5" fill="${c}"/>${E}`;
}

// SHA-256: shield with checkmark
function svgSha256(c: string): string {
  const l = lighten(c, 0.5);
  return `${H(c)}<path d="M8,1 L14,4 L14,9 Q14,13 8,15 Q2,13 2,9 L2,4 Z" fill="${l}" opacity="0.4" stroke="${c}" stroke-width="1.5" stroke-linejoin="round"/><polyline points="5,8.5 7.5,11 11.5,5.5" fill="none" stroke="${c}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>${E}`;
}

// CVE: warning triangle
function svgCve(c: string): string {
  const l = lighten(c, 0.5);
  return `${H(c)}<path d="M8,1.5 L15,14 L1,14 Z" fill="${l}" opacity="0.4" stroke="${c}" stroke-width="1.5" stroke-linejoin="round"/><rect x="7" y="6" width="2" height="4" rx="0.5" fill="${c}"/><rect x="7" y="11.5" width="2" height="1.5" rx="0.5" fill="${c}"/>${E}`;
}

// MITRE ATT&CK: crosshair target
function svgMitreAttack(c: string): string {
  const l = lighten(c, 0.5);
  return `${H(c)}<circle cx="8" cy="8" r="6.5" fill="${l}" opacity="0.3"/><circle cx="8" cy="8" r="6.5" fill="none" stroke="${c}" stroke-width="1.5"/><circle cx="8" cy="8" r="3" fill="none" stroke="${c}" stroke-width="1.5"/><circle cx="8" cy="8" r="1" fill="${c}"/><line x1="8" y1="0" x2="8" y2="4" stroke="${c}" stroke-width="1.5"/><line x1="8" y1="12" x2="8" y2="16" stroke="${c}" stroke-width="1.5"/><line x1="0" y1="8" x2="4" y2="8" stroke="${c}" stroke-width="1.5"/><line x1="12" y1="8" x2="16" y2="8" stroke="${c}" stroke-width="1.5"/>${E}`;
}

// YARA Rule: magnifying glass
function svgYaraRule(c: string): string {
  const l = lighten(c, 0.5);
  return `${H(c)}<circle cx="7" cy="7" r="5.5" fill="${l}" opacity="0.4"/><circle cx="7" cy="7" r="5.5" fill="none" stroke="${c}" stroke-width="2"/><line x1="11" y1="11" x2="15" y2="15" stroke="${c}" stroke-width="2.5" stroke-linecap="round"/>${E}`;
}

// File Path: filled document with corner fold
function svgFilePath(c: string): string {
  const l = lighten(c, 0.5);
  return `${H(c)}<path d="M3,1 L10,1 L13,4 L13,15 L3,15 Z" fill="${l}" opacity="0.4" stroke="${c}" stroke-width="1.5" stroke-linejoin="round"/><path d="M10,1 L10,4 L13,4" fill="${l}" opacity="0.6" stroke="${c}" stroke-width="1.2" stroke-linejoin="round"/><line x1="5.5" y1="8" x2="10.5" y2="8" stroke="${c}" stroke-width="1.2" stroke-linecap="round"/><line x1="5.5" y1="11" x2="10.5" y2="11" stroke="${c}" stroke-width="1.2" stroke-linecap="round"/>${E}`;
}

// Note: filled notepad with lines
function svgNote(c: string): string {
  const l = lighten(c, 0.5);
  return `${H(c)}<rect x="2" y="1" width="12" height="14" rx="1.5" fill="${l}" opacity="0.4" stroke="${c}" stroke-width="1.5"/><line x1="5" y1="5" x2="11" y2="5" stroke="${c}" stroke-width="1.5" stroke-linecap="round"/><line x1="5" y1="8" x2="11" y2="8" stroke="${c}" stroke-width="1.5" stroke-linecap="round"/><line x1="5" y1="11" x2="9" y2="11" stroke="${c}" stroke-width="1.5" stroke-linecap="round"/>${E}`;
}

// Task: checkbox with bold checkmark
function svgTask(c: string): string {
  const l = lighten(c, 0.5);
  return `${H(c)}<rect x="1.5" y="2" width="13" height="12" rx="2" fill="${l}" opacity="0.4" stroke="${c}" stroke-width="1.5"/><polyline points="4.5,8 7,11 11.5,5" fill="none" stroke="${c}" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/>${E}`;
}

// Timeline Event: clock
function svgTimelineEvent(c: string): string {
  const l = lighten(c, 0.5);
  return `${H(c)}<circle cx="8" cy="8" r="7" fill="${l}" opacity="0.4"/><circle cx="8" cy="8" r="7" fill="none" stroke="${c}" stroke-width="1.8"/><line x1="8" y1="3.5" x2="8" y2="8" stroke="${c}" stroke-width="2" stroke-linecap="round"/><line x1="8" y1="8" x2="11.5" y2="10.5" stroke="${c}" stroke-width="2" stroke-linecap="round"/><circle cx="8" cy="8" r="1" fill="${c}"/>${E}`;
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
 * Returns a data URI for an SVG icon matching the given entity type and color.
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
