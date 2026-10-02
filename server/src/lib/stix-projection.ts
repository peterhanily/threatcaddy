import { createHash } from 'node:crypto';
import { isIP } from 'node:net';
import type { standaloneIOCs } from '../db/schema.js';

type IOC = typeof standaloneIOCs.$inferSelect;
export interface STIXObject { type: string; id: string; spec_version: '2.1'; created: string; modified?: string; [key: string]: unknown }
/** RFC 9562 UUIDv5 using the URL namespace, matching the client uuid.v5 contract. */
export function stixId(type: string, value: string): string {
  const namespace = Buffer.from('6ba7b8119dad11d180b400c04fd430c8', 'hex');
  const bytes = createHash('sha1').update(namespace).update(`${type}:${value}`, 'utf8').digest().subarray(0, 16);
  bytes[6] = (bytes[6] & 0x0f) | 0x50;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = bytes.toString('hex');
  return `${type}--${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
// OASIS common TLP 2.0 markings. Their official definitions are globally known;
// never invent replacement statement objects under these canonical IDs.
const TLP: Record<string, string> = {
  'TLP:CLEAR': '94868c89-83c2-464b-929b-a1a8aa3c8487', 'TLP:GREEN': 'bab4a63c-aed9-4cf5-a766-dfca5abac2bb',
  'TLP:AMBER': '55d920b0-5e8b-4f79-9ee9-91f868d9b421', 'TLP:AMBER+STRICT': '939a9414-2ddd-4d32-a0cd-375ea402b003',
  'TLP:RED': 'e828b379-4e03-4974-9ac4-e53a884c97c1',
};
function markings(ioc: IOC): { refs: string[]; definitions: STIXObject[] } {
  const refs = new Set<string>();
  const definitions = new Map<string, STIXObject>();
  const value = ioc.clsLevel?.trim();
  if (value) {
    const canonical = TLP[value.toUpperCase()];
    if (canonical) refs.add(`marking-definition--${canonical}`);
    else {
      const id = stixId('statement', value).replace(/^statement--/, 'marking-definition--');
      refs.add(id);
      definitions.set(id, { type: 'marking-definition', spec_version: '2.1', id,
        created: '2022-10-01T00:00:00.000Z', definition_type: 'statement', definition: { statement: value } });
    }
  }
  const provenance = (ioc.enrichment as { stix?: unknown } | null)?.stix;
  if (provenance !== undefined) {
    try {
      if (!Array.isArray(provenance)) throw new Error();
      for (const entry of provenance) {
        const source = JSON.parse(String(entry.object)) as Record<string, unknown>;
        if (Array.isArray(source.object_marking_refs)) for (const ref of source.object_marking_refs) if (typeof ref === 'string') refs.add(ref);
        // Selectors no longer map to the reserialized object; preserve all
        // restrictions conservatively at object level instead of dropping them.
        if (Array.isArray(source.granular_markings)) for (const marking of source.granular_markings) {
          if (typeof marking?.marking_ref === 'string') refs.add(marking.marking_ref);
        }
        const originalDefinitions: unknown = JSON.parse(String(entry.markings));
        if (!Array.isArray(originalDefinitions)) throw new Error();
        for (const definition of originalDefinitions) {
          if (definition?.type === 'marking-definition' && typeof definition.id === 'string'
            && !Object.values(TLP).some(id => definition.id === `marking-definition--${id}`)) definitions.set(definition.id, definition);
        }
      }
    } catch { throw Object.assign(new Error('Cannot export damaged STIX marking provenance; restore the original source first'), { status: 422 }); }
  }
  return { refs: [...refs], definitions: [...definitions.values()] };
}
const escapeValue = (value: string) => value.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
function pattern(type: string, value: string): { pattern: string; pattern_type: string } | undefined {
  const paths: Record<string, string> = { ipv4: 'ipv4-addr:value', ipv6: 'ipv6-addr:value', domain: 'domain-name:value',
    url: 'url:value', email: 'email-addr:value', 'file-path': 'file:name', md5: "file:hashes.'MD5'", sha1: "file:hashes.'SHA-1'", sha256: "file:hashes.'SHA-256'" };
  if (type === 'ipv4' || type === 'ipv6') {
    const [address, prefix, ...extra] = value.split('/');
    const family = type === 'ipv4' ? 4 : 6;
    if (isIP(address) !== family || extra.length || prefix !== undefined && (!/^\d+$/.test(prefix) || Number(prefix) > (family === 4 ? 32 : 128))) return;
  }
  const hashes: Record<string, number> = { md5: 32, sha1: 40, sha256: 64 };
  if (hashes[type] && (!/^[a-f\d]+$/i.test(value) || value.length !== hashes[type])) return;
  if (type === 'yara-rule' || type === 'sigma-rule') return { pattern: value, pattern_type: type === 'yara-rule' ? 'yara' : 'sigma' };
  return paths[type] ? { pattern: `[${paths[type]} = '${escapeValue(value)}']`, pattern_type: 'stix' } : undefined;
}
export function stixIOC(ioc: IOC): STIXObject[] {
  if (ioc.deletedAt || ioc.trashed || ioc.archived) return [];
  const marking = markings(ioc);
  const common = { spec_version: '2.1' as const, created: ioc.createdAt.toISOString(), modified: ioc.updatedAt.toISOString(),
    ...(marking.refs.length ? { object_marking_refs: marking.refs } : {}), ...(ioc.analystNotes ? { description: ioc.analystNotes } : {}) };
  let object: STIXObject;
  if (ioc.type === 'cve') {
    const value = ioc.value.toUpperCase();
    if (!/^CVE-\d{4}-\d{4,}$/.test(value)) return [];
    object = { ...common, type: 'vulnerability', id: stixId('vulnerability', value), name: value,
      external_references: [{ source_name: 'cve', external_id: value }] };
  } else if (ioc.type === 'mitre-attack') {
    if (!/^T\d{4}(?:\.\d{3})?$/.test(ioc.value)) return [];
    object = { ...common, type: 'attack-pattern', id: stixId('attack-pattern', ioc.value), name: ioc.value,
      external_references: [{ source_name: 'mitre-attack', external_id: ioc.value }] };
  } else {
    const expression = pattern(ioc.type, ioc.value);
    if (!expression) return [];
    object = { ...common, ...expression, type: 'indicator', id: stixId('indicator', `${ioc.type}:${ioc.value}`),
      name: ioc.value.length > 80 ? `${ioc.value.slice(0, 77)}...` : ioc.value,
      indicator_types: ['malicious-activity'], valid_from: ioc.createdAt.toISOString(),
      confidence: ({ low: 15, medium: 50, high: 85, confirmed: 100 } as Record<string, number>)[ioc.confidence] ?? 50,
      ...(ioc.attribution ? { labels: [ioc.attribution] } : {}) };
  }
  return [...marking.definitions, object];
}
export function stixRelationship(source: IOC, target: IOC, relationship: string): STIXObject[] {
  if (!/^[a-z][a-z0-9-]{0,99}$/.test(relationship)) return [];
  const from = stixIOC(source).at(-1), to = stixIOC(target).at(-1);
  if (!from || !to) return [];
  const targetMarking = markings(target);
  const refs = [...new Set([...markings(source).refs, ...targetMarking.refs])];
  return [...targetMarking.definitions, { type: 'relationship', spec_version: '2.1',
    id: stixId('relationship', `${from.id}:${relationship}:${to.id}`), created: source.createdAt.toISOString(), modified: source.updatedAt.toISOString(),
    relationship_type: relationship, source_ref: from.id, target_ref: to.id,
    ...(refs.length ? { object_marking_refs: refs } : {}) }];
}
