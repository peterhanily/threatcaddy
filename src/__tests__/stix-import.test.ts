import { describe, it, expect } from 'vitest';
import { parseSTIXBundle } from '../lib/stix-import';

// ── Helpers ─────────────────────────────────────────────────────────

function makeBundle(objects: Record<string, unknown>[] = []) {
  return JSON.stringify({
    type: 'bundle',
    id: 'bundle--test',
    objects,
  });
}

function makeIndicator(overrides: Record<string, unknown> = {}) {
  return {
    type: 'indicator',
    spec_version: '2.1',
    id: 'indicator--test-1',
    created: '2024-01-01T00:00:00.000Z',
    modified: '2024-01-01T00:00:00.000Z',
    name: 'Test Indicator',
    pattern: "[ipv4-addr:value = '1.2.3.4']",
    pattern_type: 'stix',
    valid_from: '2024-01-01T00:00:00.000Z',
    confidence: 85,
    ...overrides,
  };
}

function makeVulnerability(overrides: Record<string, unknown> = {}) {
  return {
    type: 'vulnerability',
    spec_version: '2.1',
    id: 'vulnerability--test-1',
    created: '2024-01-01T00:00:00.000Z',
    modified: '2024-01-01T00:00:00.000Z',
    name: 'CVE-2024-1234',
    external_references: [{ source_name: 'cve', external_id: 'CVE-2024-1234' }],
    ...overrides,
  };
}

// ── Bundle validation ───────────────────────────────────────────────

describe('bundle validation', () => {
  it('rejects invalid JSON', () => {
    const result = parseSTIXBundle('not json');
    expect(result.iocs).toHaveLength(0);
    expect(result.errors).toContain('Invalid JSON');
  });

  it('rejects non-bundle objects', () => {
    const result = parseSTIXBundle(JSON.stringify({ type: 'not-a-bundle' }));
    expect(result.iocs).toHaveLength(0);
    expect(result.errors[0]).toContain('Not a valid STIX 2.1 bundle');
  });

  it('rejects bundles without objects array', () => {
    const result = parseSTIXBundle(JSON.stringify({ type: 'bundle' }));
    expect(result.errors[0]).toContain('no objects array');
  });

  it('handles empty bundle', () => {
    const result = parseSTIXBundle(makeBundle([]));
    expect(result.iocs).toHaveLength(0);
    expect(result.relationships).toHaveLength(0);
    expect(result.errors).toHaveLength(0);
  });

  it('handles bundle with only non-indicator/non-vulnerability objects', () => {
    const result = parseSTIXBundle(makeBundle([
      { type: 'identity', id: 'identity--test', name: 'Test' },
    ]));
    expect(result.iocs).toHaveLength(0);
  });
});

// ── Indicator pattern parsing ───────────────────────────────────────

describe('indicator pattern parsing', () => {
  it('parses IPv4 pattern', () => {
    const result = parseSTIXBundle(makeBundle([
      makeIndicator({ pattern: "[ipv4-addr:value = '10.0.0.1']" }),
    ]));
    expect(result.iocs).toHaveLength(1);
    expect(result.iocs[0].type).toBe('ipv4');
    expect(result.iocs[0].value).toBe('10.0.0.1');
  });

  it('parses IPv6 pattern', () => {
    const result = parseSTIXBundle(makeBundle([
      makeIndicator({ pattern: "[ipv6-addr:value = '::1']" }),
    ]));
    expect(result.iocs).toHaveLength(1);
    expect(result.iocs[0].type).toBe('ipv6');
    expect(result.iocs[0].value).toBe('::1');
  });

  it('parses domain pattern', () => {
    const result = parseSTIXBundle(makeBundle([
      makeIndicator({ pattern: "[domain-name:value = 'evil.com']" }),
    ]));
    expect(result.iocs).toHaveLength(1);
    expect(result.iocs[0].type).toBe('domain');
    expect(result.iocs[0].value).toBe('evil.com');
  });

  it('parses URL pattern', () => {
    const result = parseSTIXBundle(makeBundle([
      makeIndicator({ pattern: "[url:value = 'https://evil.com/payload']" }),
    ]));
    expect(result.iocs).toHaveLength(1);
    expect(result.iocs[0].type).toBe('url');
    expect(result.iocs[0].value).toBe('https://evil.com/payload');
  });

  it('parses email pattern', () => {
    const result = parseSTIXBundle(makeBundle([
      makeIndicator({ pattern: "[email-addr:value = 'bad@evil.com']" }),
    ]));
    expect(result.iocs).toHaveLength(1);
    expect(result.iocs[0].type).toBe('email');
    expect(result.iocs[0].value).toBe('bad@evil.com');
  });

  it('parses MD5 hash pattern', () => {
    const result = parseSTIXBundle(makeBundle([
      makeIndicator({ pattern: "[file:hashes.'MD5' = 'd41d8cd98f00b204e9800998ecf8427e']" }),
    ]));
    expect(result.iocs).toHaveLength(1);
    expect(result.iocs[0].type).toBe('md5');
    expect(result.iocs[0].value).toBe('d41d8cd98f00b204e9800998ecf8427e');
  });

  it('parses SHA-1 hash pattern', () => {
    const result = parseSTIXBundle(makeBundle([
      makeIndicator({ pattern: "[file:hashes.'SHA-1' = 'da39a3ee5e6b4b0d3255bfef95601890afd80709']" }),
    ]));
    expect(result.iocs).toHaveLength(1);
    expect(result.iocs[0].type).toBe('sha1');
    expect(result.iocs[0].value).toBe('da39a3ee5e6b4b0d3255bfef95601890afd80709');
  });

  it('parses SHA-256 hash pattern', () => {
    const result = parseSTIXBundle(makeBundle([
      makeIndicator({ pattern: "[file:hashes.'SHA-256' = 'e3b0c44298fc1c149afbf4c8996fb924']" }),
    ]));
    expect(result.iocs).toHaveLength(1);
    expect(result.iocs[0].type).toBe('sha256');
    expect(result.iocs[0].value).toBe('e3b0c44298fc1c149afbf4c8996fb924');
  });

  it('parses file-path pattern', () => {
    const result = parseSTIXBundle(makeBundle([
      makeIndicator({ pattern: "[file:name = 'C:\\\\malware.exe']" }),
    ]));
    expect(result.iocs).toHaveLength(1);
    expect(result.iocs[0].type).toBe('file-path');
    expect(result.iocs[0].value).toBe('C:\\\\malware.exe');
  });

  it('handles escaped single quotes in patterns', () => {
    const result = parseSTIXBundle(makeBundle([
      makeIndicator({ pattern: "[domain-name:value = 'it\\'s-evil.com']" }),
    ]));
    expect(result.iocs).toHaveLength(1);
    expect(result.iocs[0].value).toBe("it's-evil.com");
  });

  it('collects error for unparseable patterns', () => {
    const result = parseSTIXBundle(makeBundle([
      makeIndicator({ pattern: 'rule yara_test { condition: true }', pattern_type: 'yara' }),
    ]));
    expect(result.iocs).toHaveLength(0);
    expect(result.errors.length).toBeGreaterThan(0);
    expect(result.errors[0]).toContain('Could not parse pattern');
  });
});

// ── Confidence mapping ──────────────────────────────────────────────

describe('confidence mapping', () => {
  it('maps 0-25 to low', () => {
    const result = parseSTIXBundle(makeBundle([makeIndicator({ confidence: 10 })]));
    expect(result.iocs[0].confidence).toBe('low');
  });

  it('maps 25 to low', () => {
    const result = parseSTIXBundle(makeBundle([makeIndicator({ confidence: 25 })]));
    expect(result.iocs[0].confidence).toBe('low');
  });

  it('maps 26-50 to medium', () => {
    const result = parseSTIXBundle(makeBundle([makeIndicator({ confidence: 50 })]));
    expect(result.iocs[0].confidence).toBe('medium');
  });

  it('maps 51-75 to high', () => {
    const result = parseSTIXBundle(makeBundle([makeIndicator({ confidence: 75 })]));
    expect(result.iocs[0].confidence).toBe('high');
  });

  it('maps 76-100 to confirmed', () => {
    const result = parseSTIXBundle(makeBundle([makeIndicator({ confidence: 100 })]));
    expect(result.iocs[0].confidence).toBe('confirmed');
  });

  it('defaults to medium when confidence is missing', () => {
    const indicator = makeIndicator({});
    delete (indicator as Record<string, unknown>).confidence;
    const result = parseSTIXBundle(makeBundle([indicator]));
    expect(result.iocs[0].confidence).toBe('medium');
  });
});

// ── TLP marking extraction ──────────────────────────────────────────

describe('TLP marking extraction', () => {
  it('extracts TLP:RED from known marking definition ID', () => {
    const result = parseSTIXBundle(makeBundle([
      makeIndicator({
        object_marking_refs: ['marking-definition--e828b379-4e03-4974-9ac4-e53a884c97c1'],
      }),
    ]));
    expect(result.iocs[0].clsLevel).toBe('TLP:RED');
  });

  it('extracts TLP:GREEN from known marking definition ID', () => {
    const result = parseSTIXBundle(makeBundle([
      makeIndicator({
        object_marking_refs: ['marking-definition--bab4a63c-afd4-4e03-b846-b75e0496be71'],
      }),
    ]));
    expect(result.iocs[0].clsLevel).toBe('TLP:GREEN');
  });

  it('extracts TLP from inline marking definition name', () => {
    const result = parseSTIXBundle(makeBundle([
      {
        type: 'marking-definition',
        id: 'marking-definition--custom-1',
        name: 'TLP:AMBER',
        definition_type: 'tlp',
        definition: { tlp: 'amber' },
      },
      makeIndicator({
        object_marking_refs: ['marking-definition--custom-1'],
      }),
    ]));
    expect(result.iocs[0].clsLevel).toBe('TLP:AMBER');
  });

  it('sets no clsLevel when no marking refs', () => {
    const result = parseSTIXBundle(makeBundle([makeIndicator({})]));
    expect(result.iocs[0].clsLevel).toBeUndefined();
  });
});

// ── Vulnerability SDOs ──────────────────────────────────────────────

describe('vulnerability SDO parsing', () => {
  it('creates CVE IOC from vulnerability SDO', () => {
    const result = parseSTIXBundle(makeBundle([makeVulnerability()]));
    expect(result.iocs).toHaveLength(1);
    expect(result.iocs[0].type).toBe('cve');
    expect(result.iocs[0].value).toBe('CVE-2024-1234');
  });

  it('uses external_references CVE ID when available', () => {
    const result = parseSTIXBundle(makeBundle([
      makeVulnerability({
        name: 'Some Vulnerability',
        external_references: [{ source_name: 'cve', external_id: 'CVE-2024-5678' }],
      }),
    ]));
    expect(result.iocs[0].value).toBe('CVE-2024-5678');
  });

  it('uppercases CVE value', () => {
    const result = parseSTIXBundle(makeBundle([
      makeVulnerability({
        name: 'cve-2024-9999',
        external_references: [],
      }),
    ]));
    expect(result.iocs[0].value).toBe('CVE-2024-9999');
  });

  it('applies TLP marking to vulnerability', () => {
    const result = parseSTIXBundle(makeBundle([
      makeVulnerability({
        object_marking_refs: ['marking-definition--e828b379-4e03-4974-9ac4-e53a884c97c1'],
      }),
    ]));
    expect(result.iocs[0].clsLevel).toBe('TLP:RED');
  });
});

// ── Relationship extraction ─────────────────────────────────────────

describe('relationship extraction', () => {
  it('extracts relationships between indicators', () => {
    const result = parseSTIXBundle(makeBundle([
      makeIndicator({ id: 'indicator--a', pattern: "[domain-name:value = 'evil.com']" }),
      makeIndicator({ id: 'indicator--b', pattern: "[ipv4-addr:value = '1.2.3.4']" }),
      {
        type: 'relationship',
        id: 'relationship--1',
        source_ref: 'indicator--a',
        target_ref: 'indicator--b',
        relationship_type: 'resolves-to',
      },
    ]));
    expect(result.relationships).toHaveLength(1);
    expect(result.relationships[0]).toEqual({
      sourceValue: 'evil.com',
      targetValue: '1.2.3.4',
      type: 'resolves-to',
    });
  });

  it('extracts relationships between indicator and vulnerability', () => {
    const result = parseSTIXBundle(makeBundle([
      makeIndicator({ id: 'indicator--a', pattern: "[url:value = 'https://exploit.com']" }),
      makeVulnerability({ id: 'vulnerability--b' }),
      {
        type: 'relationship',
        id: 'relationship--1',
        source_ref: 'indicator--a',
        target_ref: 'vulnerability--b',
        relationship_type: 'exploits',
      },
    ]));
    expect(result.relationships).toHaveLength(1);
    expect(result.relationships[0].type).toBe('exploits');
    expect(result.relationships[0].targetValue).toBe('CVE-2024-1234');
  });

  it('reports error for relationships with unknown references', () => {
    const result = parseSTIXBundle(makeBundle([
      {
        type: 'relationship',
        id: 'relationship--1',
        source_ref: 'indicator--nonexistent',
        target_ref: 'indicator--also-nonexistent',
        relationship_type: 'related-to',
      },
    ]));
    expect(result.relationships).toHaveLength(0);
    expect(result.errors.length).toBeGreaterThan(0);
  });

  it('handles multiple relationships', () => {
    const result = parseSTIXBundle(makeBundle([
      makeIndicator({ id: 'indicator--a', pattern: "[domain-name:value = 'evil.com']" }),
      makeIndicator({ id: 'indicator--b', pattern: "[ipv4-addr:value = '1.2.3.4']" }),
      makeIndicator({ id: 'indicator--c', pattern: "[ipv4-addr:value = '5.6.7.8']" }),
      {
        type: 'relationship', id: 'rel--1',
        source_ref: 'indicator--a', target_ref: 'indicator--b', relationship_type: 'resolves-to',
      },
      {
        type: 'relationship', id: 'rel--2',
        source_ref: 'indicator--a', target_ref: 'indicator--c', relationship_type: 'communicates-with',
      },
    ]));
    expect(result.relationships).toHaveLength(2);
  });
});

// ── Indicator metadata ──────────────────────────────────────────────

describe('indicator metadata', () => {
  it('extracts name as attribution', () => {
    const result = parseSTIXBundle(makeBundle([
      makeIndicator({ name: 'APT29 C2 Server' }),
    ]));
    expect(result.iocs[0].attribution).toBe('APT29 C2 Server');
  });

  it('extracts description as analystNotes', () => {
    const result = parseSTIXBundle(makeBundle([
      makeIndicator({ description: 'Known C2 infrastructure' }),
    ]));
    expect(result.iocs[0].analystNotes).toBe('Known C2 infrastructure');
  });

  it('initializes tags as empty array', () => {
    const result = parseSTIXBundle(makeBundle([makeIndicator()]));
    expect(result.iocs[0].tags).toEqual([]);
  });
});

// ── Complex bundle ──────────────────────────────────────────────────

describe('complex bundle', () => {
  it('handles a realistic bundle with mixed object types', () => {
    const result = parseSTIXBundle(makeBundle([
      { type: 'identity', id: 'identity--1', name: 'Test Analyst' },
      {
        type: 'marking-definition',
        id: 'marking-definition--e828b379-4e03-4974-9ac4-e53a884c97c1',
        name: 'TLP:RED',
        definition_type: 'tlp',
        definition: { tlp: 'red' },
      },
      makeIndicator({
        id: 'indicator--1',
        pattern: "[ipv4-addr:value = '10.0.0.1']",
        confidence: 90,
        name: 'C2 Server',
        description: 'Primary C2',
        object_marking_refs: ['marking-definition--e828b379-4e03-4974-9ac4-e53a884c97c1'],
      }),
      makeIndicator({
        id: 'indicator--2',
        pattern: "[domain-name:value = 'evil.example.com']",
        confidence: 60,
      }),
      makeVulnerability({
        id: 'vulnerability--1',
        name: 'CVE-2024-0001',
        external_references: [{ source_name: 'cve', external_id: 'CVE-2024-0001' }],
      }),
      {
        type: 'relationship', id: 'rel--1',
        source_ref: 'indicator--2', target_ref: 'indicator--1', relationship_type: 'resolves-to',
      },
      { type: 'report', id: 'report--1', name: 'Test Report', object_refs: [] },
    ]));

    expect(result.iocs).toHaveLength(3);

    const ipIOC = result.iocs.find((i) => i.type === 'ipv4');
    expect(ipIOC?.value).toBe('10.0.0.1');
    expect(ipIOC?.confidence).toBe('confirmed');
    expect(ipIOC?.attribution).toBe('C2 Server');
    expect(ipIOC?.analystNotes).toBe('Primary C2');
    expect(ipIOC?.clsLevel).toBe('TLP:RED');

    const domainIOC = result.iocs.find((i) => i.type === 'domain');
    expect(domainIOC?.value).toBe('evil.example.com');
    expect(domainIOC?.confidence).toBe('high');

    const cveIOC = result.iocs.find((i) => i.type === 'cve');
    expect(cveIOC?.value).toBe('CVE-2024-0001');

    expect(result.relationships).toHaveLength(1);
    expect(result.errors).toHaveLength(0);
  });
});
