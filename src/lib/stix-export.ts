import type { IOCType, ConfidenceLevel } from '../types';
import type { IOCExportEntry, ThreatIntelExportConfig } from './ioc-export';
import { STIX_TLP_MARKING_DEFS, resolveIOCClsLevel } from './classification';

// --- Deterministic UUID via FNV-1a hash ---

function fnv1a(input: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

function deterministicUUID(namespace: string, value: string): string {
  const h1 = fnv1a(`${namespace}:${value}:0`);
  const h2 = fnv1a(`${namespace}:${value}:1`);
  const h3 = fnv1a(`${namespace}:${value}:2`);
  const h4 = fnv1a(`${namespace}:${value}:3`);
  const hex = [
    h1.toString(16).padStart(8, '0'),
    h2.toString(16).padStart(8, '0'),
    h3.toString(16).padStart(8, '0'),
    h4.toString(16).padStart(8, '0'),
  ].join('');
  // Format as UUID v5-ish: 8-4-4-4-12
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-5${hex.slice(13, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
}

// --- Confidence mapping ---

const CONFIDENCE_MAP: Record<ConfidenceLevel, number> = {
  low: 15,
  medium: 50,
  high: 85,
  confirmed: 100,
};

// --- STIX pattern builders ---

function stixPattern(type: IOCType, value: string): { pattern: string; pattern_type: string } | null {
  // Escape single quotes for STIX patterns
  const escaped = value.replace(/'/g, "\\'");

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
      return { pattern: `[attack-pattern:external_references[*].external_id = '${escaped}']`, pattern_type: 'stix' };
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
  modified: string;
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

// --- Main export ---

export function formatIOCsSTIX(
  entries: IOCExportEntry[],
  config: STIXExportConfig = {},
): string {
  const now = new Date().toISOString();
  const objects: STIXObject[] = [];
  const objectRefs: string[] = [];
  const referencedMarkingDefIds = new Set<string>();

  // Filter out dismissed IOCs
  const activeEntries = entries.map((e) => ({
    ...e,
    iocs: e.iocs.filter((ioc) => !ioc.dismissed),
  }));

  // 1. Identity SDO
  const identityName = config.identityName || 'BrowserNotes Analyst';
  const identityId = `identity--${deterministicUUID('identity', identityName)}`;
  objects.push({
    type: 'identity',
    spec_version: '2.1',
    id: identityId,
    created: now,
    modified: now,
    name: identityName,
    identity_class: 'individual',
  });

  // Track IOC id → STIX id mapping for relationships
  const iocIdToStixId = new Map<string, string>();

  // 2. Indicator + Vulnerability SDOs
  for (const entry of activeEntries) {
    for (const ioc of entry.iocs) {
      // Resolve TLP level for this IOC via cascade
      const resolvedLevel = resolveIOCClsLevel(ioc.clsLevel, entry.entityClsLevel, config.defaultClsLevel);
      const tlpKey = resolvedLevel.toUpperCase();
      const markingDef = STIX_TLP_MARKING_DEFS[tlpKey];
      const markingRefs = markingDef ? [markingDef.id] : undefined;
      if (markingDef) referencedMarkingDefIds.add(tlpKey);

      // CVEs → Vulnerability SDO
      if (ioc.type === 'cve') {
        const vulnId = `vulnerability--${deterministicUUID('vulnerability', ioc.value)}`;
        iocIdToStixId.set(ioc.id, vulnId);
        const vuln: STIXObject = {
          type: 'vulnerability',
          spec_version: '2.1',
          id: vulnId,
          created: now,
          modified: now,
          name: ioc.value.toUpperCase(),
          external_references: [
            {
              source_name: 'cve',
              external_id: ioc.value.toUpperCase(),
            },
          ],
        };
        if (markingRefs) vuln.object_marking_refs = markingRefs;
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
        created: now,
        modified: now,
        name: ioc.value.length > 80 ? `${ioc.value.slice(0, 77)}...` : ioc.value,
        indicator_types: ['malicious-activity'],
        pattern: patternInfo.pattern,
        pattern_type: patternInfo.pattern_type,
        valid_from: new Date(ioc.firstSeen).toISOString(),
        confidence: CONFIDENCE_MAP[ioc.confidence] ?? 50,
        created_by_ref: identityId,
      };

      if (markingRefs) indicator.object_marking_refs = markingRefs;

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

        const relId = `relationship--${deterministicUUID('relationship', `${sourceStixId}:${rel.relationshipType}:${targetStixId}`)}`;
        objects.push({
          type: 'relationship',
          spec_version: '2.1',
          id: relId,
          created: now,
          modified: now,
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
    const reportId = `report--${deterministicUUID('report', reportTitle)}`;
    objects.push({
      type: 'report',
      spec_version: '2.1',
      id: reportId,
      created: now,
      modified: now,
      name: reportTitle,
      report_types: ['threat-report'],
      published: now,
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

  // 6. Bundle
  const bundle: STIXBundle = {
    type: 'bundle',
    id: `bundle--${deterministicUUID('bundle', now)}`,
    objects: [...markingDefObjects, ...objects],
  };

  return JSON.stringify(bundle, null, 2);
}
