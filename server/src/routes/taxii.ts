/**
 * TAXII 2.1 Collection Server
 *
 * Implements a subset of the TAXII 2.1 specification (OASIS standard) to allow
 * external threat intelligence platforms, SIEMs, and SOAR tools to pull STIX 2.1
 * bundles of IOCs from ThreatCaddy investigations.
 *
 * Endpoints:
 *   GET /api/taxii/                   — Discovery (server info)
 *   GET /api/taxii/collections/       — List collections (one per investigation)
 *   GET /api/taxii/collections/:id/   — Collection metadata
 *   GET /api/taxii/collections/:id/objects/ — STIX bundle of IOCs
 *
 * Authentication: Bearer JWT (same as main API)
 * Content-Type: application/taxii+json;version=2.1
 */

import { Hono } from 'hono';
import { eq } from 'drizzle-orm';
import { db } from '../db/index.js';
import { folders, standaloneIOCs, investigationMembers } from '../db/schema.js';
import { requireAuth } from '../middleware/auth.js';
import { checkInvestigationAccess } from '../middleware/access.js';
import type { AuthUser } from '../types.js';

const TAXII_MEDIA_TYPE = 'application/taxii+json;version=2.1';
const STIX_MEDIA_TYPE = 'application/stix+json;version=2.1';

const app = new Hono<{ Variables: { user: AuthUser } }>();

// All TAXII endpoints require auth
app.use('*', requireAuth);

// Set TAXII content type on all responses
app.use('*', async (c, next) => {
  await next();
  // Objects endpoint returns STIX, all others return TAXII
  if (c.req.path.endsWith('/objects/') || c.req.path.endsWith('/objects')) {
    c.header('Content-Type', STIX_MEDIA_TYPE);
  } else {
    c.header('Content-Type', TAXII_MEDIA_TYPE);
  }
});

// ── Deterministic UUID via FNV-1a (matches client-side stix-export.ts) ──

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
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-5${hex.slice(13, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
}

// ── STIX pattern builder ──

/** Escape a value for safe inclusion in a STIX pattern single-quoted string. */
function escapeStixValue(v: string): string {
  return v.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
}

/** IOC type format validators — reject values that don't match expected patterns. */
const IOC_FORMAT_RE: Record<string, RegExp> = {
  ipv4:         /^\d{1,3}(?:\.\d{1,3}){3}(?:\/\d{1,2})?$/,
  ipv6:         /^[0-9a-fA-F:]+(?:\/\d{1,3})?$/,
  domain:       /^[a-zA-Z0-9]([a-zA-Z0-9-]*[a-zA-Z0-9])?(\.[a-zA-Z0-9]([a-zA-Z0-9-]*[a-zA-Z0-9])?)*$/,
  email:        /^[^\s@]+@[^\s@]+\.[^\s@]+$/,
  md5:          /^[0-9a-fA-F]{32}$/,
  sha1:         /^[0-9a-fA-F]{40}$/,
  sha256:       /^[0-9a-fA-F]{64}$/,
  'mitre-attack': /^[A-Z]{1,2}\d{4}(\.\d{3})?$/,
};

const IOC_PATTERN_MAP: Record<string, (v: string) => { pattern: string; pattern_type: string } | null> = {
  ipv4:         (v) => ({ pattern: `[ipv4-addr:value = '${escapeStixValue(v)}']`, pattern_type: 'stix' }),
  ipv6:         (v) => ({ pattern: `[ipv6-addr:value = '${escapeStixValue(v)}']`, pattern_type: 'stix' }),
  domain:       (v) => ({ pattern: `[domain-name:value = '${escapeStixValue(v)}']`, pattern_type: 'stix' }),
  url:          (v) => ({ pattern: `[url:value = '${escapeStixValue(v)}']`, pattern_type: 'stix' }),
  email:        (v) => ({ pattern: `[email-addr:value = '${escapeStixValue(v)}']`, pattern_type: 'stix' }),
  'file-path':  (v) => ({ pattern: `[file:name = '${escapeStixValue(v)}']`, pattern_type: 'stix' }),
  md5:          (v) => ({ pattern: `[file:hashes.'MD5' = '${escapeStixValue(v)}']`, pattern_type: 'stix' }),
  sha1:         (v) => ({ pattern: `[file:hashes.'SHA-1' = '${escapeStixValue(v)}']`, pattern_type: 'stix' }),
  sha256:       (v) => ({ pattern: `[file:hashes.'SHA-256' = '${escapeStixValue(v)}']`, pattern_type: 'stix' }),
  'mitre-attack': (v) => ({ pattern: `[attack-pattern:external_references[*].external_id = '${escapeStixValue(v)}']`, pattern_type: 'stix' }),
  'yara-rule':  (v) => ({ pattern: v, pattern_type: 'yara' }),
  'sigma-rule': (v) => ({ pattern: v, pattern_type: 'sigma' }),
  cve:          () => null,
};

const CONFIDENCE_MAP: Record<string, number> = {
  low: 15, medium: 50, high: 85, confirmed: 100,
};

const TLP_MARKING_DEFS: Record<string, { id: string; name: string }> = {
  'TLP:CLEAR':        { id: 'marking-definition--94868c89-83c2-464b-929b-a1a8aa3c8487', name: 'TLP:CLEAR' },
  'TLP:GREEN':        { id: 'marking-definition--bab4a63c-afd4-4e03-b846-b75e0496be71', name: 'TLP:GREEN' },
  'TLP:AMBER':        { id: 'marking-definition--55d920b0-5e8b-4f79-9ee9-91f868d9b421', name: 'TLP:AMBER' },
  'TLP:AMBER+STRICT': { id: 'marking-definition--939a9414-2ddd-4d32-a0cd-b7571b03f430', name: 'TLP:AMBER+STRICT' },
  'TLP:RED':          { id: 'marking-definition--e828b379-4e03-4974-9ac4-e53a884c97c1', name: 'TLP:RED' },
};

interface STIXObject {
  type: string;
  spec_version: string;
  id: string;
  created: string;
  modified: string;
  [key: string]: unknown;
}

function buildSTIXBundle(iocs: typeof standaloneIOCs.$inferSelect[], investigationName: string) {
  const now = new Date().toISOString();
  const objects: STIXObject[] = [];
  const objectRefs: string[] = [];
  const referencedMarkings = new Set<string>();

  // Identity SDO
  const identityId = `identity--${deterministicUUID('identity', 'ThreatCaddy')}`;
  objects.push({
    type: 'identity',
    spec_version: '2.1',
    id: identityId,
    created: now,
    modified: now,
    name: 'ThreatCaddy',
    identity_class: 'organization',
  });

  const iocIdToStixId = new Map<string, string>();

  for (const ioc of iocs) {
    if (ioc.trashed || ioc.archived) continue;

    // Validate IOC value format — skip malformed values to prevent pattern injection
    const formatRe = IOC_FORMAT_RE[ioc.type];
    if (formatRe && !formatRe.test(ioc.value)) continue;
    const tlpKey = (ioc.clsLevel || '').toUpperCase();
    const markingDef = TLP_MARKING_DEFS[tlpKey];
    const markingRefs = markingDef ? [markingDef.id] : undefined;
    if (markingDef) referencedMarkings.add(tlpKey);

    // CVEs → Vulnerability SDO
    if (ioc.type === 'cve') {
      const vulnId = `vulnerability--${deterministicUUID('vulnerability', ioc.value)}`;
      iocIdToStixId.set(ioc.id, vulnId);
      const vuln: STIXObject = {
        type: 'vulnerability',
        spec_version: '2.1',
        id: vulnId,
        created: ioc.createdAt.toISOString(),
        modified: ioc.updatedAt.toISOString(),
        name: ioc.value.toUpperCase(),
        external_references: [{ source_name: 'cve', external_id: ioc.value.toUpperCase() }],
      };
      if (markingRefs) vuln.object_marking_refs = markingRefs;
      objects.push(vuln);
      objectRefs.push(vulnId);
      continue;
    }

    // Other IOCs → Indicator SDO
    const patternFn = IOC_PATTERN_MAP[ioc.type];
    const patternInfo = patternFn ? patternFn(ioc.value) : null;
    if (!patternInfo) continue;

    const indicatorId = `indicator--${deterministicUUID('indicator', `${ioc.type}:${ioc.value}`)}`;
    iocIdToStixId.set(ioc.id, indicatorId);

    const indicator: STIXObject = {
      type: 'indicator',
      spec_version: '2.1',
      id: indicatorId,
      created: ioc.createdAt.toISOString(),
      modified: ioc.updatedAt.toISOString(),
      name: ioc.value.length > 80 ? `${ioc.value.slice(0, 77)}...` : ioc.value,
      indicator_types: ['malicious-activity'],
      pattern: patternInfo.pattern,
      pattern_type: patternInfo.pattern_type,
      valid_from: ioc.createdAt.toISOString(),
      confidence: CONFIDENCE_MAP[ioc.confidence] ?? 50,
      created_by_ref: identityId,
    };

    if (markingRefs) indicator.object_marking_refs = markingRefs;
    if (ioc.analystNotes) indicator.description = ioc.analystNotes;
    if (ioc.attribution) indicator.labels = [ioc.attribution];

    objects.push(indicator);
    objectRefs.push(indicatorId);
  }

  // Relationship SDOs from IOC relationships
  for (const ioc of iocs) {
    const rels = (ioc.relationships ?? []) as Array<{ targetIOCId: string; relationshipType: string }>;
    const sourceStixId = iocIdToStixId.get(ioc.id);
    if (!sourceStixId || !rels.length) continue;

    for (const rel of rels) {
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

  // Report SDO
  if (objectRefs.length > 0) {
    const reportId = `report--${deterministicUUID('report', investigationName)}`;
    objects.push({
      type: 'report',
      spec_version: '2.1',
      id: reportId,
      created: now,
      modified: now,
      name: investigationName,
      report_types: ['threat-report'],
      published: now,
      object_refs: objectRefs,
      created_by_ref: identityId,
    });
  }

  // Prepend referenced TLP marking definitions
  const markingObjects: STIXObject[] = [];
  for (const key of referencedMarkings) {
    const def = TLP_MARKING_DEFS[key];
    if (def) {
      markingObjects.push({
        type: 'marking-definition',
        spec_version: '2.1',
        id: def.id,
        created: '2017-01-20T00:00:00.000Z',
        modified: '2017-01-20T00:00:00.000Z',
        name: def.name,
        definition_type: 'statement',
        definition: { statement: `Copyright 2017, OASIS. ${def.name}` },
      });
    }
  }

  return {
    type: 'bundle' as const,
    id: `bundle--${deterministicUUID('bundle', `${investigationName}:${now}`)}`,
    objects: [...markingObjects, ...objects],
  };
}

// ── GET /api/taxii/ — Discovery ──

app.get('/', (c) => {
  return c.json({
    title: 'ThreatCaddy TAXII Server',
    description: 'TAXII 2.1 endpoint for ThreatCaddy threat intelligence',
    default: '/api/taxii/',
    api_roots: ['/api/taxii/'],
  });
});

// ── GET /api/taxii/collections/ — List collections ──

app.get('/collections/', async (c) => {
  const user = c.get('user');

  // Only show investigations the user is a member of
  const memberships = await db
    .select({ folderId: investigationMembers.folderId })
    .from(investigationMembers)
    .where(eq(investigationMembers.userId, user.id));

  const folderIds = memberships.map(m => m.folderId);
  if (folderIds.length === 0) {
    return c.json({ collections: [] });
  }

  const allFolders = await db.select().from(folders);
  const accessible = allFolders.filter(f => folderIds.includes(f.id));

  return c.json({
    collections: accessible.map(f => ({
      id: f.id,
      title: f.name,
      description: f.description || '',
      can_read: true,
      can_write: false,
      media_types: [STIX_MEDIA_TYPE],
    })),
  });
});

// ── GET /api/taxii/collections/:id/ — Collection metadata ──

app.get('/collections/:id/', async (c) => {
  const user = c.get('user');
  const folderId = c.req.param('id');

  const hasAccess = await checkInvestigationAccess(user.id, folderId);
  if (!hasAccess) {
    return c.json({ title: 'Error', description: 'No access to this collection' }, 403);
  }

  const folder = await db.select().from(folders).where(eq(folders.id, folderId)).limit(1);
  if (folder.length === 0) {
    return c.json({ title: 'Error', description: 'Collection not found' }, 404);
  }

  const f = folder[0];
  return c.json({
    id: f.id,
    title: f.name,
    description: f.description || '',
    can_read: true,
    can_write: false,
    media_types: [STIX_MEDIA_TYPE],
  });
});

// ── GET /api/taxii/collections/:id/objects/ — STIX bundle ──

app.get('/collections/:id/objects/', async (c) => {
  const user = c.get('user');
  const folderId = c.req.param('id');

  const hasAccess = await checkInvestigationAccess(user.id, folderId);
  if (!hasAccess) {
    return c.json({ title: 'Error', description: 'No access to this collection' }, 403);
  }

  const folder = await db.select().from(folders).where(eq(folders.id, folderId)).limit(1);
  if (folder.length === 0) {
    return c.json({ title: 'Error', description: 'Collection not found' }, 404);
  }

  // Fetch all IOCs for this investigation
  const iocs = await db
    .select()
    .from(standaloneIOCs)
    .where(eq(standaloneIOCs.folderId, folderId));

  const bundle = buildSTIXBundle(iocs, folder[0].name);
  return c.json(bundle);
});

export default app;
