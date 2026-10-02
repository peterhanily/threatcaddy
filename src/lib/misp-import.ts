import type { IOCType, ConfidenceLevel, StandaloneIOC } from '../types';
import { conservativeClsLevel } from './classification';
import { mergeImportedIOCs } from './interchange-import';

// --- Result types ---

export interface MISPImportResult {
  eventTitle: string;
  iocs: Partial<StandaloneIOC>[];
  tags: string[];
  errors: string[];
  preservedAttributes?: Record<string, unknown>[];
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
  yara: 'yara-rule',
  sigma: 'sigma-rule',
  filename: 'file-path',
};

// Compound types where we extract the hash part after the pipe
const COMPOUND_HASH_TYPES: Record<string, IOCType> = {
  'filename|md5': 'md5',
  'filename|sha1': 'sha1',
  'filename|sha256': 'sha256',
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
    return value.slice(value.lastIndexOf('|') + 1);
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
  const levels: string[] = [];
  for (const tag of tags) {
    const lower = tag.name.toLowerCase();
    if (lower === 'tlp:white') levels.push('TLP:CLEAR');
    else if (lower.startsWith('tlp:')) levels.push(lower.toUpperCase());
    else if (lower.startsWith('threatcaddy:classification=')) {
      try { levels.push(JSON.parse(tag.name.slice('threatcaddy:classification='.length))); } catch { levels.push(`UNRESOLVED MISP TAG: ${tag.name}`); }
    }
  }
  return conservativeClsLevel(levels);
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
  const preservedAttributes: Record<string, unknown>[] = [];

  const eventTitle = typeof event.info === 'string' ? event.info : 'Untitled MISP Event';

  // Parse tags
  const rawTags = Array.isArray(event.Tag) ? event.Tag : [];
  const validTags = rawTags.filter(
    (t): t is { name: string } => t !== null && typeof t === 'object' && typeof (t as Record<string, unknown>).name === 'string',
  );
  const tagNames = validTags.map((t) => t.name);

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

    const iocType = mispType === 'text' && /^T\d{4}(?:\.\d{3})?$/.test(value) ? 'mitre-attack' : mapAttributeType(mispType);
    if (!iocType) {
      errors.push(`Unsupported MISP attribute type: ${mispType}`);
      preservedAttributes.push(a);
      continue;
    }

    // Determine the actual type for IP addresses (could be IPv6)
    const finalType = (mispType.toLowerCase() === 'ip-src' || mispType.toLowerCase() === 'ip-dst')
      ? resolveIOCTypeForIP(mispType, value)
      : iocType;

    const extractedValue = extractAttributeValue(mispType, value);
    const attributeTags = Array.isArray(a.Tag) ? a.Tag.filter((tag): tag is { name: string } => !!tag && typeof tag === 'object' && typeof tag.name === 'string') : [];
    const combinedTags = [...validTags, ...attributeTags];
    const clsLevel = extractTLPFromTags(combinedTags);
    const provenance = { source: 'misp', attribute: JSON.stringify(a), eventTags: JSON.stringify(validTags), eventTitle };
    if (provenance.attribute.length > 500_000 || provenance.eventTags.length > 500_000) { preservedAttributes.push(a); errors.push('Attribute provenance exceeds editable limits; original retained.'); continue; }
    const confidenceOrder = ['low', 'medium', 'high', 'confirmed'];
    const importedConfidence = attributeTags.filter(tag => /^threatcaddy:confidence="(low|medium|high|confirmed)"$/.test(tag.name))
      .map(tag => tag.name.split('"')[1]).sort((a, b) => confidenceOrder.indexOf(a) - confidenceOrder.indexOf(b))[0];

    const ioc: Partial<StandaloneIOC> = {
      type: finalType,
      value: extractedValue,
      confidence: (importedConfidence || 'medium') as ConfidenceLevel,
      tags: [],
      enrichment: { misp: [provenance] },
    };

    if (comment) ioc.analystNotes = comment;
    if (clsLevel) ioc.clsLevel = clsLevel;
    const actor = extractThreatActorFromTags(attributeTags) || threatActor;
    if (actor) ioc.attribution = actor;

    iocs.push(ioc);
  }

  return { eventTitle, iocs: mergeImportedIOCs(iocs), tags: tagNames, errors, preservedAttributes };
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
    const preservedAttributes: Record<string, unknown>[] = [];

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
      preservedAttributes.push(...result.preservedAttributes ?? []);
    }

    return {
      eventTitle: titles.join(', '),
      iocs: mergeImportedIOCs(allIocs),
      tags: [...new Set(allTags)],
      errors: allErrors,
      preservedAttributes,
    };
  }

  return { eventTitle: '', iocs: [], tags: [], errors: ['Unrecognized MISP data format'] };
}
