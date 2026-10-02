import type { IOCType, ConfidenceLevel } from '../types';
import { v5 as uuidv5 } from 'uuid';
import { TLP2_EXTENSION } from './stix-common-objects';
import type { IOCExportEntry, ThreatIntelExportConfig, IOCExportFilter } from './ioc-export';
import { applyExportFilter } from './ioc-export';
import { STIX_TLP_MARKING_DEFS, resolveIOCClsLevel } from './classification';

// Stable semantic identity, using RFC-compatible UUIDv5 in the URL namespace.
function deterministicUUID(namespace: string, value: string): string {
  return uuidv5(`${namespace}:${value}`, uuidv5.URL);
}
const CONFIDENCE_MAP: Record<ConfidenceLevel, number> = {
  low: 15,
  medium: 50,
  high: 85,
  confirmed: 100,
};

// --- STIX pattern builders ---

function stixPattern(type: IOCType, value: string): { pattern: string; pattern_type: string } | null {
  // Escape single quotes for STIX patterns
  const escaped = value.replace(/\\/g, '\\\\').replace(/'/g, "\\'");

  switch (type) {
    case 'ipv4':
      return { pattern: `[ipv4-addr:value = '${escaped}']`, pattern_type: 'stix' };
    case 'ipv6':
      return { pattern: `[ipv6-addr:value = '${escaped}']`, pattern_type: 'stix' };
    case 'domain':
      return { pattern: `[domain-name:value = '${escaped}']`, pattern_type: 'stix' };
    case 'url':
      return { pattern: `[url:value = '${escaped}']`, pattern_type: 'stix' };
    case 'email':
      return { pattern: `[email-addr:value = '${escaped}']`, pattern_type: 'stix' };
    case 'file-path':
      return { pattern: `[file:name = '${escaped}']`, pattern_type: 'stix' };
    case 'md5':
      return { pattern: `[file:hashes.'MD5' = '${escaped}']`, pattern_type: 'stix' };
    case 'sha1':
      return { pattern: `[file:hashes.'SHA-1' = '${escaped}']`, pattern_type: 'stix' };
    case 'sha256':
      return { pattern: `[file:hashes.'SHA-256' = '${escaped}']`, pattern_type: 'stix' };
    case 'mitre-attack':
      return null; // ATT&CK techniques are Attack Pattern SDOs, not observable patterns.
    case 'yara-rule':
      return { pattern: value, pattern_type: 'yara' };
    case 'sigma-rule':
      return { pattern: value, pattern_type: 'sigma' };
    case 'cve':
      return null; // CVEs become Vulnerability SDOs, not Indicators
    default:
      return null;
  }
}

// --- STIX SDO types ---

interface STIXObject {
  type: string;
  spec_version: string;
  id: string;
  created: string;
  modified?: string;
  [key: string]: unknown;
}

interface STIXBundle {
  type: 'bundle';
  id: string;
  objects: STIXObject[];
}

export interface STIXExportConfig extends ThreatIntelExportConfig {
  identityName?: string;
}

// Definition epoch for the generated attribution identity, not an analyst's account creation.
const GENERATED_IDENTITY_EPOCH = '2026-10-02T00:00:00.000Z';
function sourceTimes(ioc: IOCExportEntry['iocs'][number], entry: IOCExportEntry) {
  const created = ioc.createdAt ?? ioc.firstSeen;
  const modified = Math.max(created, ioc.updatedAt ?? entry.updatedAt ?? created);
  if (![created, modified, ioc.firstSeen].every(value => Number.isFinite(value) && value >= 0 && value <= 8.64e15)) {
    throw new Error('Cannot export an IOC with invalid source timestamps. Correct its source dates first.');
  }
  return { created: new Date(created).toISOString(), modified: new Date(modified).toISOString() };
}

// --- Main export ---

export function formatIOCsSTIX(
  entries: IOCExportEntry[],
  config: STIXExportConfig = {},
  filter?: IOCExportFilter,
): string {
  const objects: STIXObject[] = [];
  const objectRefs: string[] = [];
  const referencedMarkingDefIds = new Set<string>();
  const extraMarkings = new Map<string, STIXObject>();

  // Filter out dismissed IOCs (and apply export filter if provided)
  const activeEntries = applyExportFilter(entries, filter).map((e) => ({
    ...e,
    iocs: e.iocs.filter((ioc) => !ioc.dismissed),
  }));

  // 1. Identity SDO
  const identityName = config.identityName || 'ThreatCaddy Analyst';
  const identityId = `identity--${deterministicUUID('identity', identityName)}`;
  objects.push({
    type: 'identity',
    spec_version: '2.1',
    id: identityId,
    created: GENERATED_IDENTITY_EPOCH,
    modified: GENERATED_IDENTITY_EPOCH,
    name: identityName,
    identity_class: 'individual',
  });

  // Track IOC id → STIX id mapping for relationships
  const iocIdToStixId = new Map<string, string>();

  // 2. Indicator + Vulnerability SDOs
  for (const entry of activeEntries) {
    for (const ioc of entry.iocs) {
      const timestamps = sourceTimes(ioc, entry);
      // Resolve TLP level for this IOC via cascade
      const resolvedLevel = resolveIOCClsLevel(ioc.clsLevel, entry.entityClsLevel, config.defaultClsLevel);
      const tlpKey = resolvedLevel.toUpperCase();
      const markingDef = STIX_TLP_MARKING_DEFS[tlpKey];
      const markingRefs: string[] = markingDef ? [markingDef.id] : [];
      if (markingDef) referencedMarkingDefIds.add(tlpKey);
      if (resolvedLevel && !markingDef) {
        const id = `marking-definition--${deterministicUUID('statement', resolvedLevel)}`;
        markingRefs.push(id);
        extraMarkings.set(id, { type: 'marking-definition', spec_version: '2.1', id,
          created: '2022-10-01T00:00:00.000Z', definition_type: 'statement', definition: { statement: resolvedLevel } });
      }
      for (const provenance of ioc.enrichment?.stix ?? []) {
        try {
          const source = JSON.parse(String(provenance.object)) as Record<string, unknown>;
          if (Array.isArray(source.object_marking_refs)) markingRefs.push(...source.object_marking_refs.filter((v): v is string => typeof v === 'string'));
          // Conservatively promote granular restrictions to the whole newly serialized object.
          if (Array.isArray(source.granular_markings)) for (const marking of source.granular_markings) {
            if (marking && typeof marking.marking_ref === 'string') markingRefs.push(marking.marking_ref);
          }
          const defs: unknown = JSON.parse(String(provenance.markings));
          if (Array.isArray(defs)) for (const def of defs) if (def?.type === 'marking-definition' && typeof def.id === 'string') extraMarkings.set(def.id, def);
        } catch { throw new Error('Cannot export damaged STIX marking provenance. Restore the original source before exporting.'); }
      }

      // CVEs → Vulnerability SDO
      if (ioc.type === 'cve' || ioc.type === 'mitre-attack') {
        const objectType = ioc.type === 'cve' ? 'vulnerability' : 'attack-pattern';
        const vulnId = `${objectType}--${deterministicUUID(objectType, ioc.value.toUpperCase())}`;
        iocIdToStixId.set(ioc.id, vulnId);
        const vuln: STIXObject = {
          type: objectType,
          spec_version: '2.1',
          id: vulnId,
          ...timestamps,
          name: ioc.value.toUpperCase(),
          external_references: [
            {
              source_name: ioc.type,
              external_id: ioc.value.toUpperCase(),
            },
          ],
        };
        vuln.confidence = CONFIDENCE_MAP[ioc.confidence] ?? 50;
        if (ioc.analystNotes) vuln.description = ioc.analystNotes;
        if (markingRefs.length) vuln.object_marking_refs = [...new Set(markingRefs)];
        objects.push(vuln);
        objectRefs.push(vulnId);
        continue;
      }

      // All other IOCs → Indicator SDO
      const patternInfo = stixPattern(ioc.type, ioc.value);
      if (!patternInfo) continue;

      const indicatorId = `indicator--${deterministicUUID('indicator', `${ioc.type}:${ioc.value}`)}`;
      iocIdToStixId.set(ioc.id, indicatorId);

      const indicator: STIXObject = {
        type: 'indicator',
        spec_version: '2.1',
        id: indicatorId,
        ...timestamps,
        name: ioc.value.length > 80 ? `${ioc.value.slice(0, 77)}...` : ioc.value,
        indicator_types: ['malicious-activity'],
        pattern: patternInfo.pattern,
        pattern_type: patternInfo.pattern_type,
        valid_from: new Date(ioc.firstSeen).toISOString(),
        confidence: CONFIDENCE_MAP[ioc.confidence] ?? 50,
        created_by_ref: identityId,
      };

      if (markingRefs.length) indicator.object_marking_refs = [...new Set(markingRefs)];

      if (ioc.analystNotes) {
        indicator.description = ioc.analystNotes;
      }

      objects.push(indicator);
      objectRefs.push(indicatorId);
    }
  }

  // 3. Relationship SDOs from IOCEntry.relationships[]
  for (const entry of activeEntries) {
    for (const ioc of entry.iocs) {
      if (!ioc.relationships) continue;
      const sourceStixId = iocIdToStixId.get(ioc.id);
      if (!sourceStixId) continue;

      for (const rel of ioc.relationships) {
        const targetStixId = iocIdToStixId.get(rel.targetIOCId);
        if (!targetStixId) continue;

        const sourceObjects = objects.filter(object => object.id === sourceStixId || object.id === targetStixId);
        const created = sourceObjects.map(object => object.created).sort().at(-1) ?? sourceTimes(ioc, entry).created;
        const modified = sourceObjects.map(object => object.modified ?? object.created).sort().at(-1) ?? created;

        const relId = `relationship--${deterministicUUID('relationship', `${sourceStixId}:${rel.relationshipType}:${targetStixId}`)}`;
        objects.push({
          type: 'relationship',
          spec_version: '2.1',
          id: relId,
          created,
          modified,
          relationship_type: rel.relationshipType,
          source_ref: sourceStixId,
          target_ref: targetStixId,
          created_by_ref: identityId,
        });
        objectRefs.push(relId);
      }
    }
  }

  // 4. Report SDO
  if (objectRefs.length > 0) {
    const reportTitle = activeEntries.map((e) => e.clipTitle).join(', ') || 'IOC Report';
    // Different selection sets are distinct reports; repeated exports do not invent new versions.
    const reportId = `report--${deterministicUUID('report', JSON.stringify([reportTitle, [...new Set(objectRefs)].sort()]))}`;
    const sourceObjects = objects.filter(object => object.type !== 'identity');
    const created = sourceObjects.map(object => object.created).sort()[0];
    const modified = sourceObjects.map(object => object.modified ?? object.created).sort().at(-1) ?? created;
    objects.push({
      type: 'report',
      spec_version: '2.1',
      id: reportId,
      created,
      modified,
      name: reportTitle,
      report_types: ['threat-report'],
      published: modified,
      object_refs: objectRefs,
      created_by_ref: identityId,
    });
  }

  // 5. Prepend referenced TLP marking-definition SDOs
  const markingDefObjects: STIXObject[] = [];
  for (const key of referencedMarkingDefIds) {
    const def = STIX_TLP_MARKING_DEFS[key];
    if (def) {
      markingDefObjects.push(def as unknown as STIXObject);
    }
  }

  // Merge duplicate semantic objects only after unioning all restrictions.
  const uniqueObjects = new Map<string, STIXObject>();
  for (const object of [...markingDefObjects, ...extraMarkings.values(), ...objects]) {
    const existing = uniqueObjects.get(object.id);
    if (existing) {
      const refs = [...new Set([...(existing.object_marking_refs as string[] ?? []), ...(object.object_marking_refs as string[] ?? [])])];
      if (refs.length) existing.object_marking_refs = refs;
      if (typeof object.confidence === 'number' && typeof existing.confidence === 'number') existing.confidence = Math.min(object.confidence, existing.confidence);
      existing.created = [existing.created, object.created].sort()[0];
      if (existing.modified && object.modified) existing.modified = [existing.modified, object.modified].sort()[1];
    } else uniqueObjects.set(object.id, object);
  }
  const allRefs = [...new Set([...uniqueObjects.values()].flatMap(o => o.object_marking_refs as string[] ?? []))];
  // Reports and relationships disclose the same marked indicator graph.
  for (const object of uniqueObjects.values()) {
    if ((object.type === 'report' || object.type === 'relationship') && allRefs.length) object.object_marking_refs = allRefs;
    if (Array.isArray(object.object_refs)) object.object_refs = [...new Set(object.object_refs)];
  }
  if (referencedMarkingDefIds.size) uniqueObjects.set(TLP2_EXTENSION.id, TLP2_EXTENSION);

  // 6. Bundle
  const bundle: STIXBundle = {
    type: 'bundle',
    id: `bundle--${deterministicUUID('bundle', JSON.stringify([...uniqueObjects.values()]))}`,
    objects: [...uniqueObjects.values()],
  };

  return JSON.stringify(bundle, null, 2);
}
