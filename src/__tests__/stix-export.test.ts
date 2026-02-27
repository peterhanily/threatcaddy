/* eslint-disable @typescript-eslint/no-non-null-assertion */
import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { formatIOCsSTIX } from '../lib/stix-export';
import type { IOCExportEntry } from '../lib/ioc-export';
import type { IOCEntry } from '../types';

// ── Helpers ─────────────────────────────────────────────────────────

function makeIOC(overrides: Partial<IOCEntry> & { id: string; value: string; type: IOCEntry['type'] }): IOCEntry {
  return {
    confidence: 'high',
    analystNotes: undefined,
    attribution: undefined,
    firstSeen: 1709251200000,
    dismissed: false,
    ...overrides,
  };
}

function makeEntry(overrides: Partial<IOCExportEntry> & { iocs: IOCEntry[] }): IOCExportEntry {
  return {
    clipTitle: 'Test Report',
    ...overrides,
  };
}

function parseBundle(json: string) {
  return JSON.parse(json) as {
    type: string;
    id: string;
    objects: Array<{
      type: string;
      spec_version: string;
      id: string;
      created: string;
      modified: string;
      [key: string]: unknown;
    }>;
  };
}

function findByType(objects: ReturnType<typeof parseBundle>['objects'], type: string) {
  return objects.filter((o) => o.type === type);
}

// ── Freeze time ─────────────────────────────────────────────────────

const FROZEN_NOW = '2024-03-01T00:00:00.000Z';

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date(FROZEN_NOW));
});

afterEach(() => {
  vi.useRealTimers();
});

// ── Bundle structure ────────────────────────────────────────────────

describe('bundle structure', () => {
  it('returns a valid STIX 2.1 bundle', () => {
    const bundle = parseBundle(formatIOCsSTIX([]));
    expect(bundle.type).toBe('bundle');
    expect(bundle.id).toMatch(/^bundle--[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[0-9a-f]{4}-[0-9a-f]{12}$/);
    expect(bundle.objects).toBeInstanceOf(Array);
  });

  it('always includes an identity SDO', () => {
    const bundle = parseBundle(formatIOCsSTIX([]));
    const identities = findByType(bundle.objects, 'identity');
    expect(identities).toHaveLength(1);
    expect(identities[0].name).toBe('ThreatCaddy Analyst');
    expect(identities[0].identity_class).toBe('individual');
  });

  it('uses custom identity name from config', () => {
    const bundle = parseBundle(formatIOCsSTIX([], { identityName: 'ACME SOC' }));
    const identity = findByType(bundle.objects, 'identity')[0];
    expect(identity.name).toBe('ACME SOC');
  });

  it('all objects have spec_version 2.1', () => {
    const entries = [makeEntry({ iocs: [makeIOC({ id: 'ioc1', type: 'ipv4', value: '1.2.3.4' })] })];
    const bundle = parseBundle(formatIOCsSTIX(entries));
    for (const obj of bundle.objects) {
      if (obj.type !== 'marking-definition') {
        expect(obj.spec_version).toBe('2.1');
      }
    }
  });

  it('all objects have created and modified timestamps', () => {
    const entries = [makeEntry({ iocs: [makeIOC({ id: 'ioc1', type: 'domain', value: 'evil.com' })] })];
    const bundle = parseBundle(formatIOCsSTIX(entries));
    for (const obj of bundle.objects) {
      if (obj.type !== 'marking-definition') {
        expect(obj.created).toBe(FROZEN_NOW);
        expect(obj.modified).toBe(FROZEN_NOW);
      }
    }
  });

  it('output is valid JSON', () => {
    const entries = [makeEntry({ iocs: [makeIOC({ id: 'ioc1', type: 'ipv4', value: '1.2.3.4' })] })];
    const json = formatIOCsSTIX(entries);
    expect(() => JSON.parse(json)).not.toThrow();
  });
});

// ── Deterministic IDs ───────────────────────────────────────────────

describe('deterministic IDs', () => {
  it('produces the same bundle ID for the same timestamp', () => {
    const a = parseBundle(formatIOCsSTIX([]));
    const b = parseBundle(formatIOCsSTIX([]));
    expect(a.id).toBe(b.id);
  });

  it('produces the same indicator ID for the same IOC', () => {
    const entries = [makeEntry({ iocs: [makeIOC({ id: 'ioc1', type: 'ipv4', value: '1.2.3.4' })] })];
    const a = parseBundle(formatIOCsSTIX(entries));
    const b = parseBundle(formatIOCsSTIX(entries));
    const indA = findByType(a.objects, 'indicator')[0];
    const indB = findByType(b.objects, 'indicator')[0];
    expect(indA.id).toBe(indB.id);
  });

  it('produces different indicator IDs for different IOC values', () => {
    const e1 = [makeEntry({ iocs: [makeIOC({ id: 'ioc1', type: 'ipv4', value: '1.2.3.4' })] })];
    const e2 = [makeEntry({ iocs: [makeIOC({ id: 'ioc2', type: 'ipv4', value: '5.6.7.8' })] })];
    const ind1 = findByType(parseBundle(formatIOCsSTIX(e1)).objects, 'indicator')[0];
    const ind2 = findByType(parseBundle(formatIOCsSTIX(e2)).objects, 'indicator')[0];
    expect(ind1.id).not.toBe(ind2.id);
  });

  it('identity ID is deterministic based on name', () => {
    const a = parseBundle(formatIOCsSTIX([], { identityName: 'TestAnalyst' }));
    const b = parseBundle(formatIOCsSTIX([], { identityName: 'TestAnalyst' }));
    expect(findByType(a.objects, 'identity')[0].id).toBe(findByType(b.objects, 'identity')[0].id);
  });

  it('produces UUID-formatted IDs (8-4-5xxx-4-12)', () => {
    const entries = [makeEntry({ iocs: [makeIOC({ id: 'ioc1', type: 'ipv4', value: '1.2.3.4' })] })];
    const bundle = parseBundle(formatIOCsSTIX(entries));
    const indicator = findByType(bundle.objects, 'indicator')[0];
    // Extract UUID part after "indicator--"
    const uuid = indicator.id.replace('indicator--', '');
    expect(uuid).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[0-9a-f]{4}-[0-9a-f]{12}$/);
  });
});

// ── Indicator SDOs ──────────────────────────────────────────────────

describe('indicator SDOs', () => {
  it('creates an indicator for an IPv4 IOC', () => {
    const entries = [makeEntry({ iocs: [makeIOC({ id: 'ioc1', type: 'ipv4', value: '10.0.0.1' })] })];
    const bundle = parseBundle(formatIOCsSTIX(entries));
    const indicator = findByType(bundle.objects, 'indicator')[0];
    expect(indicator.id).toMatch(/^indicator--/);
    expect(indicator.pattern).toBe("[ipv4-addr:value = '10.0.0.1']");
    expect(indicator.pattern_type).toBe('stix');
    expect(indicator.indicator_types).toEqual(['malicious-activity']);
  });

  it('creates correct patterns for each IOC type', () => {
    const testCases: Array<{ type: IOCEntry['type']; value: string; expectedPattern: string; expectedType: string }> = [
      { type: 'ipv4', value: '1.2.3.4', expectedPattern: "[ipv4-addr:value = '1.2.3.4']", expectedType: 'stix' },
      { type: 'ipv6', value: '::1', expectedPattern: "[ipv6-addr:value = '::1']", expectedType: 'stix' },
      { type: 'domain', value: 'evil.com', expectedPattern: "[domain-name:value = 'evil.com']", expectedType: 'stix' },
      { type: 'url', value: 'https://evil.com/mal', expectedPattern: "[url:value = 'https://evil.com/mal']", expectedType: 'stix' },
      { type: 'email', value: 'bad@evil.com', expectedPattern: "[email-addr:value = 'bad@evil.com']", expectedType: 'stix' },
      { type: 'file-path', value: 'C:\\mal.exe', expectedPattern: "[file:name = 'C:\\mal.exe']", expectedType: 'stix' },
      { type: 'md5', value: 'd41d8cd98f00b204e9800998ecf8427e', expectedPattern: "[file:hashes.'MD5' = 'd41d8cd98f00b204e9800998ecf8427e']", expectedType: 'stix' },
      { type: 'sha1', value: 'da39a3ee5e6b4b0d3255bfef95601890afd80709', expectedPattern: "[file:hashes.'SHA-1' = 'da39a3ee5e6b4b0d3255bfef95601890afd80709']", expectedType: 'stix' },
      { type: 'sha256', value: 'e3b0c44298fc1c149afbf4c8996fb924', expectedPattern: "[file:hashes.'SHA-256' = 'e3b0c44298fc1c149afbf4c8996fb924']", expectedType: 'stix' },
      { type: 'mitre-attack', value: 'T1566', expectedPattern: "[attack-pattern:external_references[*].external_id = 'T1566']", expectedType: 'stix' },
    ];

    for (const tc of testCases) {
      const entries = [makeEntry({ iocs: [makeIOC({ id: `ioc-${tc.type}`, type: tc.type, value: tc.value })] })];
      const bundle = parseBundle(formatIOCsSTIX(entries));
      const indicator = findByType(bundle.objects, 'indicator')[0];
      expect(indicator.pattern).toBe(tc.expectedPattern);
      expect(indicator.pattern_type).toBe(tc.expectedType);
    }
  });

  it('uses yara pattern_type for yara-rule IOCs', () => {
    const entries = [makeEntry({ iocs: [makeIOC({ id: 'ioc1', type: 'yara-rule', value: 'rule test { condition: true }' })] })];
    const bundle = parseBundle(formatIOCsSTIX(entries));
    const indicator = findByType(bundle.objects, 'indicator')[0];
    expect(indicator.pattern_type).toBe('yara');
    expect(indicator.pattern).toBe('rule test { condition: true }');
  });

  it('uses sigma pattern_type for sigma-rule IOCs', () => {
    const entries = [makeEntry({ iocs: [makeIOC({ id: 'ioc1', type: 'sigma-rule', value: 'title: Test' })] })];
    const bundle = parseBundle(formatIOCsSTIX(entries));
    const indicator = findByType(bundle.objects, 'indicator')[0];
    expect(indicator.pattern_type).toBe('sigma');
  });

  it('escapes single quotes in STIX patterns', () => {
    const entries = [makeEntry({ iocs: [makeIOC({ id: 'ioc1', type: 'domain', value: "it's-evil.com" })] })];
    const bundle = parseBundle(formatIOCsSTIX(entries));
    const indicator = findByType(bundle.objects, 'indicator')[0];
    expect(indicator.pattern).toBe("[domain-name:value = 'it\\'s-evil.com']");
  });

  it('maps confidence levels to STIX scores', () => {
    const levels: Array<{ confidence: IOCEntry['confidence']; expected: number }> = [
      { confidence: 'low', expected: 15 },
      { confidence: 'medium', expected: 50 },
      { confidence: 'high', expected: 85 },
      { confidence: 'confirmed', expected: 100 },
    ];

    for (const { confidence, expected } of levels) {
      const entries = [makeEntry({ iocs: [makeIOC({ id: `ioc-${confidence}`, type: 'ipv4', value: '1.2.3.4', confidence })] })];
      const bundle = parseBundle(formatIOCsSTIX(entries));
      const indicator = findByType(bundle.objects, 'indicator')[0];
      expect(indicator.confidence).toBe(expected);
    }
  });

  it('sets valid_from from IOC firstSeen', () => {
    const entries = [makeEntry({ iocs: [makeIOC({ id: 'ioc1', type: 'ipv4', value: '1.2.3.4', firstSeen: 1709251200000 })] })];
    const bundle = parseBundle(formatIOCsSTIX(entries));
    const indicator = findByType(bundle.objects, 'indicator')[0];
    expect(indicator.valid_from).toBe('2024-03-01T00:00:00.000Z');
  });

  it('sets created_by_ref to identity ID', () => {
    const entries = [makeEntry({ iocs: [makeIOC({ id: 'ioc1', type: 'ipv4', value: '1.2.3.4' })] })];
    const bundle = parseBundle(formatIOCsSTIX(entries));
    const identity = findByType(bundle.objects, 'identity')[0];
    const indicator = findByType(bundle.objects, 'indicator')[0];
    expect(indicator.created_by_ref).toBe(identity.id);
  });

  it('includes analystNotes as description', () => {
    const entries = [makeEntry({ iocs: [makeIOC({ id: 'ioc1', type: 'ipv4', value: '1.2.3.4', analystNotes: 'C2 server' })] })];
    const bundle = parseBundle(formatIOCsSTIX(entries));
    const indicator = findByType(bundle.objects, 'indicator')[0];
    expect(indicator.description).toBe('C2 server');
  });

  it('omits description when no analystNotes', () => {
    const entries = [makeEntry({ iocs: [makeIOC({ id: 'ioc1', type: 'ipv4', value: '1.2.3.4' })] })];
    const bundle = parseBundle(formatIOCsSTIX(entries));
    const indicator = findByType(bundle.objects, 'indicator')[0];
    expect(indicator.description).toBeUndefined();
  });

  it('truncates long IOC values in name to 80 chars', () => {
    const longValue = 'https://evil.com/' + 'a'.repeat(100);
    const entries = [makeEntry({ iocs: [makeIOC({ id: 'ioc1', type: 'url', value: longValue })] })];
    const bundle = parseBundle(formatIOCsSTIX(entries));
    const indicator = findByType(bundle.objects, 'indicator')[0];
    expect((indicator.name as string).length).toBe(80);
    expect((indicator.name as string).endsWith('...')).toBe(true);
  });

  it('uses full value as name when under 80 chars', () => {
    const entries = [makeEntry({ iocs: [makeIOC({ id: 'ioc1', type: 'domain', value: 'evil.com' })] })];
    const bundle = parseBundle(formatIOCsSTIX(entries));
    const indicator = findByType(bundle.objects, 'indicator')[0];
    expect(indicator.name).toBe('evil.com');
  });
});

// ── Vulnerability SDOs (CVEs) ───────────────────────────────────────

describe('vulnerability SDOs', () => {
  it('creates a vulnerability SDO for CVE IOCs', () => {
    const entries = [makeEntry({ iocs: [makeIOC({ id: 'ioc1', type: 'cve', value: 'cve-2024-1234' })] })];
    const bundle = parseBundle(formatIOCsSTIX(entries));
    const vulns = findByType(bundle.objects, 'vulnerability');
    expect(vulns).toHaveLength(1);
    expect(vulns[0].id).toMatch(/^vulnerability--/);
    expect(vulns[0].name).toBe('CVE-2024-1234');
  });

  it('uppercases CVE value in name', () => {
    const entries = [makeEntry({ iocs: [makeIOC({ id: 'ioc1', type: 'cve', value: 'cve-2024-5678' })] })];
    const bundle = parseBundle(formatIOCsSTIX(entries));
    const vuln = findByType(bundle.objects, 'vulnerability')[0];
    expect(vuln.name).toBe('CVE-2024-5678');
  });

  it('includes external_references with CVE ID', () => {
    const entries = [makeEntry({ iocs: [makeIOC({ id: 'ioc1', type: 'cve', value: 'CVE-2024-1234' })] })];
    const bundle = parseBundle(formatIOCsSTIX(entries));
    const vuln = findByType(bundle.objects, 'vulnerability')[0];
    const refs = vuln.external_references as Array<{ source_name: string; external_id: string }>;
    expect(refs).toHaveLength(1);
    expect(refs[0].source_name).toBe('cve');
    expect(refs[0].external_id).toBe('CVE-2024-1234');
  });

  it('does not create an indicator for CVEs', () => {
    const entries = [makeEntry({ iocs: [makeIOC({ id: 'ioc1', type: 'cve', value: 'CVE-2024-1234' })] })];
    const bundle = parseBundle(formatIOCsSTIX(entries));
    const indicators = findByType(bundle.objects, 'indicator');
    expect(indicators).toHaveLength(0);
  });
});

// ── Dismissed IOC filtering ─────────────────────────────────────────

describe('dismissed IOC filtering', () => {
  it('excludes dismissed IOCs', () => {
    const entries = [makeEntry({
      iocs: [
        makeIOC({ id: 'ioc1', type: 'ipv4', value: '1.2.3.4', dismissed: false }),
        makeIOC({ id: 'ioc2', type: 'ipv4', value: '5.6.7.8', dismissed: true }),
      ],
    })];
    const bundle = parseBundle(formatIOCsSTIX(entries));
    const indicators = findByType(bundle.objects, 'indicator');
    expect(indicators).toHaveLength(1);
    expect(indicators[0].pattern).toContain('1.2.3.4');
  });

  it('produces no indicators when all IOCs are dismissed', () => {
    const entries = [makeEntry({
      iocs: [makeIOC({ id: 'ioc1', type: 'ipv4', value: '1.2.3.4', dismissed: true })],
    })];
    const bundle = parseBundle(formatIOCsSTIX(entries));
    const indicators = findByType(bundle.objects, 'indicator');
    expect(indicators).toHaveLength(0);
  });
});

// ── TLP marking definitions ─────────────────────────────────────────

describe('TLP marking definitions', () => {
  it('includes TLP marking-definition when IOC has clsLevel', () => {
    const entries = [makeEntry({
      iocs: [makeIOC({ id: 'ioc1', type: 'ipv4', value: '1.2.3.4', clsLevel: 'TLP:RED' })],
    })];
    const bundle = parseBundle(formatIOCsSTIX(entries));
    const markings = findByType(bundle.objects, 'marking-definition');
    expect(markings.length).toBeGreaterThanOrEqual(1);
    expect(markings.some((m) => (m.name as string)?.includes('RED'))).toBe(true);
  });

  it('sets object_marking_refs on indicator', () => {
    const entries = [makeEntry({
      iocs: [makeIOC({ id: 'ioc1', type: 'ipv4', value: '1.2.3.4', clsLevel: 'TLP:AMBER' })],
    })];
    const bundle = parseBundle(formatIOCsSTIX(entries));
    const indicator = findByType(bundle.objects, 'indicator')[0];
    expect(indicator.object_marking_refs).toBeDefined();
    expect((indicator.object_marking_refs as string[]).length).toBeGreaterThan(0);
  });

  it('resolves TLP from entity level when IOC level is absent', () => {
    const entries = [makeEntry({
      entityClsLevel: 'TLP:GREEN',
      iocs: [makeIOC({ id: 'ioc1', type: 'ipv4', value: '1.2.3.4' })],
    })];
    const bundle = parseBundle(formatIOCsSTIX(entries));
    const markings = findByType(bundle.objects, 'marking-definition');
    expect(markings.some((m) => (m.name as string)?.includes('GREEN'))).toBe(true);
  });

  it('resolves TLP from config default when IOC and entity levels are absent', () => {
    const entries = [makeEntry({
      iocs: [makeIOC({ id: 'ioc1', type: 'ipv4', value: '1.2.3.4' })],
    })];
    const bundle = parseBundle(formatIOCsSTIX(entries, { defaultClsLevel: 'TLP:AMBER+STRICT' }));
    const markings = findByType(bundle.objects, 'marking-definition');
    expect(markings.some((m) => (m.name as string)?.includes('AMBER'))).toBe(true);
  });

  it('sets object_marking_refs on vulnerability SDOs', () => {
    const entries = [makeEntry({
      iocs: [makeIOC({ id: 'ioc1', type: 'cve', value: 'CVE-2024-1234', clsLevel: 'TLP:RED' })],
    })];
    const bundle = parseBundle(formatIOCsSTIX(entries));
    const vuln = findByType(bundle.objects, 'vulnerability')[0];
    expect(vuln.object_marking_refs).toBeDefined();
  });

  it('only includes each marking-definition once', () => {
    const entries = [makeEntry({
      iocs: [
        makeIOC({ id: 'ioc1', type: 'ipv4', value: '1.2.3.4', clsLevel: 'TLP:RED' }),
        makeIOC({ id: 'ioc2', type: 'domain', value: 'evil.com', clsLevel: 'TLP:RED' }),
      ],
    })];
    const bundle = parseBundle(formatIOCsSTIX(entries));
    const markings = findByType(bundle.objects, 'marking-definition');
    const redMarkings = markings.filter((m) => (m.name as string)?.includes('RED'));
    expect(redMarkings).toHaveLength(1);
  });

  it('includes multiple marking-definitions for mixed TLP levels', () => {
    const entries = [makeEntry({
      iocs: [
        makeIOC({ id: 'ioc1', type: 'ipv4', value: '1.2.3.4', clsLevel: 'TLP:RED' }),
        makeIOC({ id: 'ioc2', type: 'domain', value: 'evil.com', clsLevel: 'TLP:GREEN' }),
      ],
    })];
    const bundle = parseBundle(formatIOCsSTIX(entries));
    const markings = findByType(bundle.objects, 'marking-definition');
    expect(markings.length).toBeGreaterThanOrEqual(2);
  });

  it('omits marking refs when no TLP level resolves', () => {
    const entries = [makeEntry({
      iocs: [makeIOC({ id: 'ioc1', type: 'ipv4', value: '1.2.3.4' })],
    })];
    const bundle = parseBundle(formatIOCsSTIX(entries));
    const indicator = findByType(bundle.objects, 'indicator')[0];
    expect(indicator.object_marking_refs).toBeUndefined();
    const markings = findByType(bundle.objects, 'marking-definition');
    expect(markings).toHaveLength(0);
  });

  it('marking-definitions appear before other objects in the bundle', () => {
    const entries = [makeEntry({
      iocs: [makeIOC({ id: 'ioc1', type: 'ipv4', value: '1.2.3.4', clsLevel: 'TLP:RED' })],
    })];
    const bundle = parseBundle(formatIOCsSTIX(entries));
    const firstMarkingIdx = bundle.objects.findIndex((o) => o.type === 'marking-definition');
    const firstIdentityIdx = bundle.objects.findIndex((o) => o.type === 'identity');
    expect(firstMarkingIdx).toBeLessThan(firstIdentityIdx);
  });
});

// ── Relationship SDOs ───────────────────────────────────────────────

describe('relationship SDOs', () => {
  it('creates relationship SDOs from IOC relationships', () => {
    const entries = [makeEntry({
      iocs: [
        makeIOC({
          id: 'ioc1', type: 'domain', value: 'evil.com',
          relationships: [{ targetIOCId: 'ioc2', relationshipType: 'resolves-to' }],
        }),
        makeIOC({ id: 'ioc2', type: 'ipv4', value: '1.2.3.4' }),
      ],
    })];
    const bundle = parseBundle(formatIOCsSTIX(entries));
    const rels = findByType(bundle.objects, 'relationship');
    expect(rels).toHaveLength(1);
    expect(rels[0].relationship_type).toBe('resolves-to');
    expect(rels[0].id).toMatch(/^relationship--/);
  });

  it('sets source_ref and target_ref correctly', () => {
    const entries = [makeEntry({
      iocs: [
        makeIOC({
          id: 'ioc1', type: 'domain', value: 'evil.com',
          relationships: [{ targetIOCId: 'ioc2', relationshipType: 'resolves-to' }],
        }),
        makeIOC({ id: 'ioc2', type: 'ipv4', value: '1.2.3.4' }),
      ],
    })];
    const bundle = parseBundle(formatIOCsSTIX(entries));
    const rel = findByType(bundle.objects, 'relationship')[0];
    const domain = findByType(bundle.objects, 'indicator').find((i) => (i.pattern as string).includes('evil.com'));
    const ipv4 = findByType(bundle.objects, 'indicator').find((i) => (i.pattern as string).includes('1.2.3.4'));
    expect(rel.source_ref).toBe(domain!.id);
    expect(rel.target_ref).toBe(ipv4!.id);
  });

  it('sets created_by_ref on relationships', () => {
    const entries = [makeEntry({
      iocs: [
        makeIOC({
          id: 'ioc1', type: 'domain', value: 'evil.com',
          relationships: [{ targetIOCId: 'ioc2', relationshipType: 'resolves-to' }],
        }),
        makeIOC({ id: 'ioc2', type: 'ipv4', value: '1.2.3.4' }),
      ],
    })];
    const bundle = parseBundle(formatIOCsSTIX(entries));
    const identity = findByType(bundle.objects, 'identity')[0];
    const rel = findByType(bundle.objects, 'relationship')[0];
    expect(rel.created_by_ref).toBe(identity.id);
  });

  it('skips relationships to unknown target IOCs', () => {
    const entries = [makeEntry({
      iocs: [
        makeIOC({
          id: 'ioc1', type: 'domain', value: 'evil.com',
          relationships: [{ targetIOCId: 'nonexistent', relationshipType: 'resolves-to' }],
        }),
      ],
    })];
    const bundle = parseBundle(formatIOCsSTIX(entries));
    const rels = findByType(bundle.objects, 'relationship');
    expect(rels).toHaveLength(0);
  });

  it('skips relationships from dismissed source IOCs', () => {
    const entries = [makeEntry({
      iocs: [
        makeIOC({
          id: 'ioc1', type: 'domain', value: 'evil.com', dismissed: true,
          relationships: [{ targetIOCId: 'ioc2', relationshipType: 'resolves-to' }],
        }),
        makeIOC({ id: 'ioc2', type: 'ipv4', value: '1.2.3.4' }),
      ],
    })];
    const bundle = parseBundle(formatIOCsSTIX(entries));
    const rels = findByType(bundle.objects, 'relationship');
    expect(rels).toHaveLength(0);
  });

  it('handles multiple relationships from one IOC', () => {
    const entries = [makeEntry({
      iocs: [
        makeIOC({
          id: 'ioc1', type: 'domain', value: 'evil.com',
          relationships: [
            { targetIOCId: 'ioc2', relationshipType: 'resolves-to' },
            { targetIOCId: 'ioc3', relationshipType: 'communicates-with' },
          ],
        }),
        makeIOC({ id: 'ioc2', type: 'ipv4', value: '1.2.3.4' }),
        makeIOC({ id: 'ioc3', type: 'ipv4', value: '5.6.7.8' }),
      ],
    })];
    const bundle = parseBundle(formatIOCsSTIX(entries));
    const rels = findByType(bundle.objects, 'relationship');
    expect(rels).toHaveLength(2);
    expect(rels.map((r) => r.relationship_type).sort()).toEqual(['communicates-with', 'resolves-to']);
  });

  it('relationship IDs are deterministic', () => {
    const entries = [makeEntry({
      iocs: [
        makeIOC({
          id: 'ioc1', type: 'domain', value: 'evil.com',
          relationships: [{ targetIOCId: 'ioc2', relationshipType: 'resolves-to' }],
        }),
        makeIOC({ id: 'ioc2', type: 'ipv4', value: '1.2.3.4' }),
      ],
    })];
    const a = findByType(parseBundle(formatIOCsSTIX(entries)).objects, 'relationship')[0];
    const b = findByType(parseBundle(formatIOCsSTIX(entries)).objects, 'relationship')[0];
    expect(a.id).toBe(b.id);
  });
});

// ── Report SDO ──────────────────────────────────────────────────────

describe('report SDO', () => {
  it('creates a report SDO when there are object refs', () => {
    const entries = [makeEntry({
      clipTitle: 'APT29 Campaign',
      iocs: [makeIOC({ id: 'ioc1', type: 'ipv4', value: '1.2.3.4' })],
    })];
    const bundle = parseBundle(formatIOCsSTIX(entries));
    const reports = findByType(bundle.objects, 'report');
    expect(reports).toHaveLength(1);
    expect(reports[0].name).toBe('APT29 Campaign');
    expect(reports[0].report_types).toEqual(['threat-report']);
    expect(reports[0].published).toBe(FROZEN_NOW);
  });

  it('report object_refs include all indicators, vulns, and relationships', () => {
    const entries = [makeEntry({
      iocs: [
        makeIOC({
          id: 'ioc1', type: 'domain', value: 'evil.com',
          relationships: [{ targetIOCId: 'ioc2', relationshipType: 'resolves-to' }],
        }),
        makeIOC({ id: 'ioc2', type: 'ipv4', value: '1.2.3.4' }),
        makeIOC({ id: 'ioc3', type: 'cve', value: 'CVE-2024-1234' }),
      ],
    })];
    const bundle = parseBundle(formatIOCsSTIX(entries));
    const report = findByType(bundle.objects, 'report')[0];
    const refs = report.object_refs as string[];
    // 2 indicators + 1 vulnerability + 1 relationship = 4
    expect(refs).toHaveLength(4);
    expect(refs.some((r) => r.startsWith('indicator--'))).toBe(true);
    expect(refs.some((r) => r.startsWith('vulnerability--'))).toBe(true);
    expect(refs.some((r) => r.startsWith('relationship--'))).toBe(true);
  });

  it('concatenates clip titles from multiple entries', () => {
    const entries = [
      makeEntry({ clipTitle: 'Report A', iocs: [makeIOC({ id: 'ioc1', type: 'ipv4', value: '1.2.3.4' })] }),
      makeEntry({ clipTitle: 'Report B', iocs: [makeIOC({ id: 'ioc2', type: 'domain', value: 'evil.com' })] }),
    ];
    const bundle = parseBundle(formatIOCsSTIX(entries));
    const report = findByType(bundle.objects, 'report')[0];
    expect(report.name).toBe('Report A, Report B');
  });

  it('does not create a report when there are no objects', () => {
    const bundle = parseBundle(formatIOCsSTIX([]));
    const reports = findByType(bundle.objects, 'report');
    expect(reports).toHaveLength(0);
  });

  it('sets created_by_ref on report', () => {
    const entries = [makeEntry({ iocs: [makeIOC({ id: 'ioc1', type: 'ipv4', value: '1.2.3.4' })] })];
    const bundle = parseBundle(formatIOCsSTIX(entries));
    const identity = findByType(bundle.objects, 'identity')[0];
    const report = findByType(bundle.objects, 'report')[0];
    expect(report.created_by_ref).toBe(identity.id);
  });

  it('uses fallback title when clip titles are empty', () => {
    const entries = [makeEntry({ clipTitle: '', iocs: [makeIOC({ id: 'ioc1', type: 'ipv4', value: '1.2.3.4' })] })];
    const bundle = parseBundle(formatIOCsSTIX(entries));
    const report = findByType(bundle.objects, 'report')[0];
    expect(report.name).toBe('IOC Report');
  });
});

// ── Edge cases ──────────────────────────────────────────────────────

describe('edge cases', () => {
  it('handles empty entries array', () => {
    const json = formatIOCsSTIX([]);
    const bundle = parseBundle(json);
    // Just identity, no report
    expect(bundle.objects).toHaveLength(1);
    expect(bundle.objects[0].type).toBe('identity');
  });

  it('handles entries with empty iocs arrays', () => {
    const entries = [makeEntry({ iocs: [] })];
    const bundle = parseBundle(formatIOCsSTIX(entries));
    expect(findByType(bundle.objects, 'indicator')).toHaveLength(0);
    expect(findByType(bundle.objects, 'report')).toHaveLength(0);
  });

  it('handles multiple entries with multiple IOCs each', () => {
    const entries = [
      makeEntry({
        clipTitle: 'Entry 1',
        iocs: [
          makeIOC({ id: 'ioc1', type: 'ipv4', value: '1.2.3.4' }),
          makeIOC({ id: 'ioc2', type: 'domain', value: 'evil.com' }),
        ],
      }),
      makeEntry({
        clipTitle: 'Entry 2',
        iocs: [
          makeIOC({ id: 'ioc3', type: 'sha256', value: 'abc123' }),
          makeIOC({ id: 'ioc4', type: 'cve', value: 'CVE-2024-9999' }),
        ],
      }),
    ];
    const bundle = parseBundle(formatIOCsSTIX(entries));
    expect(findByType(bundle.objects, 'indicator')).toHaveLength(3);
    expect(findByType(bundle.objects, 'vulnerability')).toHaveLength(1);
    expect(findByType(bundle.objects, 'report')).toHaveLength(1);
  });

  it('IOCs without relationships field produce no relationship SDOs', () => {
    const entries = [makeEntry({
      iocs: [
        makeIOC({ id: 'ioc1', type: 'ipv4', value: '1.2.3.4' }),
        makeIOC({ id: 'ioc2', type: 'domain', value: 'evil.com' }),
      ],
    })];
    const bundle = parseBundle(formatIOCsSTIX(entries));
    const rels = findByType(bundle.objects, 'relationship');
    expect(rels).toHaveLength(0);
  });

  it('CVE with relationship to indicator creates relationship SDO', () => {
    const entries = [makeEntry({
      iocs: [
        makeIOC({
          id: 'ioc1', type: 'cve', value: 'CVE-2024-1234',
          relationships: [{ targetIOCId: 'ioc2', relationshipType: 'exploits' }],
        }),
        makeIOC({ id: 'ioc2', type: 'ipv4', value: '1.2.3.4' }),
      ],
    })];
    const bundle = parseBundle(formatIOCsSTIX(entries));
    const rels = findByType(bundle.objects, 'relationship');
    expect(rels).toHaveLength(1);
    expect(rels[0].source_ref).toMatch(/^vulnerability--/);
    expect(rels[0].target_ref).toMatch(/^indicator--/);
  });
});
