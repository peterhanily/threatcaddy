import type { IOCType, ConfidenceLevel, StandaloneIOC } from '../types';
import { STIX_TLP_MARKING_DEFS } from './classification';

// --- Result types ---

export interface STIXImportResult {
  iocs: Partial<StandaloneIOC>[];
  relationships: Array<{ sourceValue: string; targetValue: string; type: string }>;
  errors: string[];
}

// --- Pattern parsing ---

interface PatternMatch {
  type: IOCType;
  value: string;
}

// Pattern value capture: match non-quote/non-backslash chars or escaped chars (e.g., \')
const VAL = "((?:[^'\\\\]|\\\\.)*)";

const PATTERN_MATCHERS: Array<{ regex: RegExp; type: IOCType }> = [
  { regex: new RegExp(`\\[ipv4-addr:value\\s*=\\s*'${VAL}'\\]`), type: 'ipv4' },
  { regex: new RegExp(`\\[ipv6-addr:value\\s*=\\s*'${VAL}'\\]`), type: 'ipv6' },
  { regex: new RegExp(`\\[domain-name:value\\s*=\\s*'${VAL}'\\]`), type: 'domain' },
  { regex: new RegExp(`\\[url:value\\s*=\\s*'${VAL}'\\]`), type: 'url' },
  { regex: new RegExp(`\\[email-addr:value\\s*=\\s*'${VAL}'\\]`), type: 'email' },
  { regex: new RegExp(`\\[file:hashes\\.'MD5'\\s*=\\s*'${VAL}'\\]`), type: 'md5' },
  { regex: new RegExp(`\\[file:hashes\\.'SHA-1'\\s*=\\s*'${VAL}'\\]`), type: 'sha1' },
  { regex: new RegExp(`\\[file:hashes\\.'SHA-256'\\s*=\\s*'${VAL}'\\]`), type: 'sha256' },
  { regex: new RegExp(`\\[file:name\\s*=\\s*'${VAL}'\\]`), type: 'file-path' },
];

function parseSTIXPattern(pattern: string): PatternMatch | null {
  for (const { regex, type } of PATTERN_MATCHERS) {
    const match = pattern.match(regex);
    if (match) {
      // Unescape single quotes
      const value = match[1].replace(/\\'/g, "'");
      return { type, value };
    }
  }
  return null;
}

// --- Confidence mapping ---

function mapConfidence(stixConfidence: number): ConfidenceLevel {
  if (stixConfidence <= 25) return 'low';
  if (stixConfidence <= 50) return 'medium';
  if (stixConfidence <= 75) return 'high';
  return 'confirmed';
}

// --- TLP mapping ---

// Build reverse lookup: marking-definition id -> TLP level
const TLP_ID_MAP = new Map<string, string>();
for (const [level, def] of Object.entries(STIX_TLP_MARKING_DEFS)) {
  TLP_ID_MAP.set(def.id, level);
}

function resolveTLPFromMarkings(
  markingRefs: string[] | undefined,
  markingDefs: Map<string, { name?: string; definition?: { tlp?: string } }>,
): string | undefined {
  if (!markingRefs || markingRefs.length === 0) return undefined;

  for (const ref of markingRefs) {
    // Check against known STIX TLP marking definition IDs
    const knownLevel = TLP_ID_MAP.get(ref);
    if (knownLevel) return knownLevel;

    // Check inline marking definitions from the bundle
    const def = markingDefs.get(ref);
    if (def?.name) {
      const upper = def.name.toUpperCase();
      if (upper.startsWith('TLP:')) return upper;
    }
    if (def?.definition?.tlp) {
      const tlp = def.definition.tlp.toLowerCase();
      const map: Record<string, string> = {
        clear: 'TLP:CLEAR',
        white: 'TLP:CLEAR',
        green: 'TLP:GREEN',
        amber: 'TLP:AMBER',
        'amber+strict': 'TLP:AMBER+STRICT',
        red: 'TLP:RED',
      };
      if (map[tlp]) return map[tlp];
    }
  }

  return undefined;
}

// --- Main import function ---

export function parseSTIXBundle(jsonString: string): STIXImportResult {
  const errors: string[] = [];
  const iocs: Partial<StandaloneIOC>[] = [];
  const relationships: STIXImportResult['relationships'] = [];

  // Parse JSON
  let bundle: Record<string, unknown>;
  try {
    bundle = JSON.parse(jsonString);
  } catch {
    return { iocs: [], relationships: [], errors: ['Invalid JSON'] };
  }

  // Validate bundle structure
  if (!bundle || typeof bundle !== 'object' || bundle.type !== 'bundle') {
    return { iocs: [], relationships: [], errors: ['Not a valid STIX 2.1 bundle (missing type: "bundle")'] };
  }

  const objects = bundle.objects;
  if (!Array.isArray(objects)) {
    return { iocs: [], relationships: [], errors: ['Bundle has no objects array'] };
  }

  // Index all objects by ID for relationship and marking resolution
  const objectById = new Map<string, Record<string, unknown>>();
  const markingDefs = new Map<string, { name?: string; definition?: { tlp?: string } }>();

  for (const obj of objects) {
    if (!obj || typeof obj !== 'object') continue;
    const o = obj as Record<string, unknown>;
    if (typeof o.id === 'string') {
      objectById.set(o.id, o);
      if (o.type === 'marking-definition') {
        markingDefs.set(o.id, {
          name: typeof o.name === 'string' ? o.name : undefined,
          definition: o.definition && typeof o.definition === 'object'
            ? { tlp: typeof (o.definition as Record<string, unknown>).tlp === 'string' ? (o.definition as Record<string, unknown>).tlp as string : undefined }
            : undefined,
        });
      }
    }
  }

  // Track STIX ID -> IOC value for relationship resolution
  const stixIdToValue = new Map<string, string>();

  // Process Indicator SDOs
  for (const obj of objects) {
    if (!obj || typeof obj !== 'object') continue;
    const o = obj as Record<string, unknown>;

    if (o.type === 'indicator') {
      const pattern = typeof o.pattern === 'string' ? o.pattern : '';
      const parsed = parseSTIXPattern(pattern);

      if (!parsed) {
        errors.push(`Could not parse pattern: ${pattern.slice(0, 100)}`);
        continue;
      }

      const confidence = typeof o.confidence === 'number'
        ? mapConfidence(o.confidence)
        : 'medium';

      const name = typeof o.name === 'string' ? o.name : undefined;
      const description = typeof o.description === 'string' ? o.description : undefined;

      const clsLevel = resolveTLPFromMarkings(
        Array.isArray(o.object_marking_refs) ? o.object_marking_refs as string[] : undefined,
        markingDefs,
      );

      const ioc: Partial<StandaloneIOC> = {
        type: parsed.type,
        value: parsed.value,
        confidence,
        tags: [],
      };

      if (name) ioc.attribution = name;
      if (description) ioc.analystNotes = description;
      if (clsLevel) ioc.clsLevel = clsLevel;

      iocs.push(ioc);

      if (typeof o.id === 'string') {
        stixIdToValue.set(o.id, parsed.value);
      }
    }

    // Process Vulnerability SDOs (CVEs)
    if (o.type === 'vulnerability') {
      const vulnName = typeof o.name === 'string' ? o.name : '';
      let cveValue = vulnName;

      // Also check external_references for CVE ID
      if (Array.isArray(o.external_references)) {
        for (const ref of o.external_references) {
          const r = ref as Record<string, unknown>;
          if (r.source_name === 'cve' && typeof r.external_id === 'string') {
            cveValue = r.external_id;
            break;
          }
        }
      }

      if (!cveValue) {
        errors.push('Vulnerability SDO missing name and CVE external reference');
        continue;
      }

      const clsLevel = resolveTLPFromMarkings(
        Array.isArray(o.object_marking_refs) ? o.object_marking_refs as string[] : undefined,
        markingDefs,
      );

      const ioc: Partial<StandaloneIOC> = {
        type: 'cve',
        value: cveValue.toUpperCase(),
        confidence: 'medium',
        tags: [],
      };

      if (clsLevel) ioc.clsLevel = clsLevel;

      iocs.push(ioc);

      if (typeof o.id === 'string') {
        stixIdToValue.set(o.id, cveValue.toUpperCase());
      }
    }
  }

  // Process Relationship SDOs
  for (const obj of objects) {
    if (!obj || typeof obj !== 'object') continue;
    const o = obj as Record<string, unknown>;

    if (o.type === 'relationship') {
      const sourceRef = typeof o.source_ref === 'string' ? o.source_ref : '';
      const targetRef = typeof o.target_ref === 'string' ? o.target_ref : '';
      const relType = typeof o.relationship_type === 'string' ? o.relationship_type : '';

      const sourceValue = stixIdToValue.get(sourceRef);
      const targetValue = stixIdToValue.get(targetRef);

      if (sourceValue && targetValue && relType) {
        relationships.push({ sourceValue, targetValue, type: relType });
      } else {
        if (!sourceValue) errors.push(`Relationship source not found: ${sourceRef}`);
        if (!targetValue) errors.push(`Relationship target not found: ${targetRef}`);
      }
    }
  }

  return { iocs, relationships, errors };
}
