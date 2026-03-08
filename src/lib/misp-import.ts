import type { IOCType, ConfidenceLevel, StandaloneIOC } from '../types';

// --- Result types ---

export interface MISPImportResult {
  eventTitle: string;
  iocs: Partial<StandaloneIOC>[];
  tags: string[];
  errors: string[];
}

// --- Attribute type mapping ---

const MISP_TYPE_MAP: Record<string, IOCType> = {
  'ip-src': 'ipv4',
  'ip-dst': 'ipv4',
  domain: 'domain',
  hostname: 'domain',
  url: 'url',
  uri: 'url',
  'email-src': 'email',
  'email-dst': 'email',
  md5: 'md5',
  sha1: 'sha1',
  sha256: 'sha256',
  vulnerability: 'cve',
};

// Compound types where we extract the hash part after the pipe
const COMPOUND_HASH_TYPES: Record<string, IOCType> = {
  'filename|md5': 'md5',
  'filename|sha1': 'sha1',
  'filename|sha256': 'sha256',
  'filename|sha512': 'sha256', // map to sha256 as closest available
};

function mapAttributeType(mispType: string): IOCType | null {
  const lower = mispType.toLowerCase();

  // Check direct mapping
  if (MISP_TYPE_MAP[lower]) return MISP_TYPE_MAP[lower];

  // Check compound types
  if (COMPOUND_HASH_TYPES[lower]) return COMPOUND_HASH_TYPES[lower];

  return null;
}

function extractAttributeValue(mispType: string, value: string): string {
  const lower = mispType.toLowerCase();

  // For compound types, extract the hash part after the pipe
  if (COMPOUND_HASH_TYPES[lower] && value.includes('|')) {
    return value.split('|')[1];
  }

  // For ip-src/ip-dst, check if it looks like IPv6
  if ((lower === 'ip-src' || lower === 'ip-dst') && value.includes(':')) {
    return value; // IPv6 address
  }

  return value;
}

function resolveIOCTypeForIP(mispType: string, value: string): IOCType {
  const lower = mispType.toLowerCase();
  if ((lower === 'ip-src' || lower === 'ip-dst') && value.includes(':')) {
    return 'ipv6';
  }
  return MISP_TYPE_MAP[lower] || 'ipv4';
}

// --- TLP extraction ---

function extractTLPFromTags(tags: Array<{ name: string }>): string | undefined {
  for (const tag of tags) {
    const lower = tag.name.toLowerCase();
    if (lower === 'tlp:white') return 'TLP:CLEAR';
    if (lower === 'tlp:clear') return 'TLP:CLEAR';
    if (lower === 'tlp:green') return 'TLP:GREEN';
    if (lower === 'tlp:amber') return 'TLP:AMBER';
    if (lower === 'tlp:amber+strict') return 'TLP:AMBER+STRICT';
    if (lower === 'tlp:red') return 'TLP:RED';
  }
  return undefined;
}

// --- Threat actor extraction ---

function extractThreatActorFromTags(tags: Array<{ name: string }>): string | undefined {
  for (const tag of tags) {
    // Galaxy tag format: misp-galaxy:threat-actor="APT29"
    const match = tag.name.match(/^misp-galaxy:threat-actor="([^"]+)"$/);
    if (match) return match[1];
  }
  return undefined;
}

// --- Single event parsing ---

function parseEvent(event: Record<string, unknown>): MISPImportResult {
  const errors: string[] = [];
  const iocs: Partial<StandaloneIOC>[] = [];

  const eventTitle = typeof event.info === 'string' ? event.info : 'Untitled MISP Event';

  // Parse tags
  const rawTags = Array.isArray(event.Tag) ? event.Tag : [];
  const validTags = rawTags.filter(
    (t): t is { name: string } => t !== null && typeof t === 'object' && typeof (t as Record<string, unknown>).name === 'string',
  );
  const tagNames = validTags.map((t) => t.name);

  const clsLevel = extractTLPFromTags(validTags);
  const threatActor = extractThreatActorFromTags(validTags);

  // Parse attributes
  const attributes = Array.isArray(event.Attribute) ? event.Attribute : [];

  for (const attr of attributes) {
    if (!attr || typeof attr !== 'object') {
      errors.push('Skipping invalid attribute');
      continue;
    }

    const a = attr as Record<string, unknown>;
    const mispType = typeof a.type === 'string' ? a.type : '';
    const value = typeof a.value === 'string' ? a.value : '';
    const comment = typeof a.comment === 'string' ? a.comment : undefined;

    if (!mispType || !value) {
      errors.push('Attribute missing type or value');
      continue;
    }

    const iocType = mapAttributeType(mispType);
    if (!iocType) {
      errors.push(`Unsupported MISP attribute type: ${mispType}`);
      continue;
    }

    // Determine the actual type for IP addresses (could be IPv6)
    const finalType = (mispType.toLowerCase() === 'ip-src' || mispType.toLowerCase() === 'ip-dst')
      ? resolveIOCTypeForIP(mispType, value)
      : iocType;

    const extractedValue = extractAttributeValue(mispType, value);

    const ioc: Partial<StandaloneIOC> = {
      type: finalType,
      value: extractedValue,
      confidence: 'medium' as ConfidenceLevel,
      tags: [],
    };

    if (comment) ioc.analystNotes = comment;
    if (clsLevel) ioc.clsLevel = clsLevel;
    if (threatActor) ioc.attribution = threatActor;

    iocs.push(ioc);
  }

  return { eventTitle, iocs, tags: tagNames, errors };
}

// --- Main import function ---

export function parseMISPEvent(jsonString: string): MISPImportResult {
  let data: unknown;
  try {
    data = JSON.parse(jsonString);
  } catch {
    return { eventTitle: '', iocs: [], tags: [], errors: ['Invalid JSON'] };
  }

  if (!data || typeof data !== 'object') {
    return { eventTitle: '', iocs: [], tags: [], errors: ['Invalid MISP data format'] };
  }

  const d = data as Record<string, unknown>;

  // Single event format: { "Event": { ... } }
  if (d.Event && typeof d.Event === 'object') {
    return parseEvent(d.Event as Record<string, unknown>);
  }

  // Bare event format (no Event wrapper): { "info": "...", "Attribute": [...] }
  if (typeof d.info === 'string' || Array.isArray(d.Attribute)) {
    return parseEvent(d);
  }

  // Array of events format: [ { "Event": { ... } }, ... ]
  if (Array.isArray(data)) {
    const allIocs: Partial<StandaloneIOC>[] = [];
    const allTags: string[] = [];
    const allErrors: string[] = [];
    const titles: string[] = [];

    for (const item of data) {
      if (!item || typeof item !== 'object') continue;
      const i = item as Record<string, unknown>;
      const event = i.Event && typeof i.Event === 'object'
        ? i.Event as Record<string, unknown>
        : i;
      const result = parseEvent(event);
      allIocs.push(...result.iocs);
      allTags.push(...result.tags);
      allErrors.push(...result.errors);
      titles.push(result.eventTitle);
    }

    return {
      eventTitle: titles.join(', '),
      iocs: allIocs,
      tags: [...new Set(allTags)],
      errors: allErrors,
    };
  }

  return { eventTitle: '', iocs: [], tags: [], errors: ['Unrecognized MISP data format'] };
}
