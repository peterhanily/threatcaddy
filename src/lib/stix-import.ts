import type { IOCType, ConfidenceLevel, StandaloneIOC } from '../types';
import { conservativeClsLevel } from './classification';
import { mergeImportedIOCs } from './interchange-import';
import { LEGACY_TLP_LEVELS, STIX_TLP_MARKING_DEFS, TLP2_EXTENSION_ID } from './stix-common-objects';

type Obj = Record<string, unknown>;
export interface STIXImportResult {
  iocs: Partial<StandaloneIOC>[];
  relationships: Array<{ sourceValue: string; targetValue: string; type: string }>;
  errors: string[];
  /** Objects not converted to editable IOCs remain available intact for export/review. */
  preservedObjects: Obj[];
}
const record = (value: unknown): value is Obj => !!value && typeof value === 'object' && !Array.isArray(value);
const pathTypes: Record<string, IOCType> = {
  'ipv4-addr:value': 'ipv4', 'ipv6-addr:value': 'ipv6', 'domain-name:value': 'domain',
  'url:value': 'url', 'email-addr:value': 'email', "file:hashes.'MD5'": 'md5',
  "file:hashes.'SHA-1'": 'sha1', "file:hashes.'SHA-256'": 'sha256', 'file:name': 'file-path',
};
function parsePattern(pattern: string, patternType: unknown): { type: IOCType; value: string } | undefined {
  if (patternType === 'yara') return { type: 'yara-rule', value: pattern };
  if (patternType === 'sigma') return { type: 'sigma-rule', value: pattern };
  if (patternType && patternType !== 'stix') return;
  // Exactly one supported equality expression. Do not flatten compound/qualified patterns.
  const match = pattern.match(/^\[([^=]+?)\s*=\s*'((?:[^'\\]|\\['\\])*)'\]$/);
  const type = match && pathTypes[match[1].trim()];
  if (match && type) return { type, value: match[2].replace(/\\(['\\])/g, '$1') };
}
function confidence(value: unknown): ConfidenceLevel {
  if (typeof value !== 'number' || !Number.isFinite(value)) return 'medium';
  return value <= 25 ? 'low' : value <= 50 ? 'medium' : value < 100 ? 'high' : 'confirmed';
}
const known = new Map(Object.entries(STIX_TLP_MARKING_DEFS).map(([level, def]) => [def.id, level]));
function markingLevel(ref: string, definitions: Map<string, Obj>): string | undefined {
  if (known.has(ref)) return known.get(ref);
  if (LEGACY_TLP_LEVELS[ref]) return LEGACY_TLP_LEVELS[ref];
  const def = definitions.get(ref);
  const extensions = def && record(def.extensions) ? def.extensions : undefined;
  const extension = extensions && record(extensions[TLP2_EXTENSION_ID]) ? extensions[TLP2_EXTENSION_ID] : undefined;
  const value = extension?.tlp_2_0;
  if (typeof value === 'string' && STIX_TLP_MARKING_DEFS[`TLP:${value.toUpperCase()}`]) return `TLP:${value.toUpperCase()}`;
  if (def && record(def.definition) && typeof def.definition.tlp === 'string') return `TLP1:${def.definition.tlp.toUpperCase()}`;
  // Statement/custom markings remain explicit restrictions; never turn their names into TLP2.
  if (def && record(def.definition) && typeof def.definition.statement === 'string') return `STATEMENT: ${def.definition.statement}`;
}

export function parseSTIXBundle(jsonString: string): STIXImportResult {
  const result: STIXImportResult = { iocs: [], relationships: [], errors: [], preservedObjects: [] };
  let bundle: unknown;
  try { bundle = JSON.parse(jsonString); } catch { result.errors.push('Invalid JSON'); return result; }
  if (!record(bundle) || bundle.type !== 'bundle') { result.errors.push('Not a valid STIX 2.1 bundle (missing type: "bundle")'); return result; }
  if (!Array.isArray(bundle.objects)) { result.errors.push('Bundle has no objects array'); return result; }
  const objects = bundle.objects.filter(record);
  const definitions = new Map(objects.filter(o => o.type === 'marking-definition' && typeof o.id === 'string').map(o => [o.id as string, o]));
  const values = new Map<string, string>();
  for (const obj of objects) {
    let parsed: { type: IOCType; value: string } | undefined;
    if (obj.type === 'indicator') parsed = parsePattern(typeof obj.pattern === 'string' ? obj.pattern : '', obj.pattern_type);
    if (obj.type === 'vulnerability' || obj.type === 'attack-pattern') {
      const source = obj.type === 'vulnerability' ? 'cve' : 'mitre-attack';
      const external = Array.isArray(obj.external_references) ? obj.external_references.filter(record).find(r => r.source_name === source && typeof r.external_id === 'string') : undefined;
      const value = external?.external_id ?? obj.name;
      if (typeof value === 'string' && (source === 'cve' ? /^CVE-\d{4}-\d{4,}$/i : /^T\d{4}(?:\.\d{3})?$/i).test(value)) parsed = { type: source, value: value.toUpperCase() };
    }
    if (!parsed) {
      result.preservedObjects.push(obj);
      if (['indicator', 'vulnerability', 'attack-pattern'].includes(String(obj.type))) result.errors.push(`Unsupported ${obj.type} preserved intact: ${String(obj.id ?? obj.pattern ?? '').slice(0, 100)}`);
      continue;
    }
    const refs = Array.isArray(obj.object_marking_refs) ? obj.object_marking_refs.filter((v): v is string => typeof v === 'string') : [];
    const levels = refs.map(ref => markingLevel(ref, definitions));
    const unresolved = refs.filter((_, index) => !levels[index]);
    if (unresolved.length) result.errors.push(`Unresolved handling markings retained: ${unresolved.join(', ')}`);
    const restricted = unresolved.length || (Array.isArray(obj.granular_markings) && obj.granular_markings.length);
    const clsLevel = restricted ? `UNRESOLVED STIX MARKINGS: ${refs.join(', ') || 'granular markings'}` : conservativeClsLevel(levels);
    const provenance = { object: JSON.stringify(obj), markings: JSON.stringify(refs.map(ref => definitions.get(ref)).filter(Boolean)), source: 'stix' };
    if (provenance.object.length > 500_000 || provenance.markings.length > 500_000) {
      result.errors.push(`Object ${String(obj.id)} exceeds editable provenance limits; preserved intact.`); result.preservedObjects.push(obj); continue;
    }
    const date = Date.parse(String(obj.valid_from ?? obj.created ?? ''));
    const ioc: Partial<StandaloneIOC> = { ...parsed, confidence: confidence(obj.confidence), tags: [], clsLevel,
      enrichment: { stix: [provenance] } };
    if (Number.isFinite(date)) ioc.firstSeen = date;
    if (typeof obj.name === 'string') ioc.attribution = obj.name;
    if (typeof obj.description === 'string') ioc.analystNotes = obj.description;
    result.iocs.push(ioc);
    if (typeof obj.id === 'string') values.set(obj.id, parsed.value);
  }
  for (const obj of objects.filter(o => o.type === 'relationship')) {
    const sourceValue = values.get(String(obj.source_ref));
    const targetValue = values.get(String(obj.target_ref));
    if (sourceValue && targetValue && typeof obj.relationship_type === 'string') result.relationships.push({ sourceValue, targetValue, type: obj.relationship_type });
    else result.errors.push(`Relationship endpoints not imported; original object retained: ${String(obj.id)}`);
  }
  result.iocs = mergeImportedIOCs(result.iocs);
  return result;
}
