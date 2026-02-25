import { describe, it, expect } from 'vitest';
import { formatIOCsSTIX } from '../lib/stix-export';
import type { IOCExportEntry } from '../lib/ioc-export';
import type { IOCEntry } from '../types';

function makeIOC(overrides: Partial<IOCEntry> & Pick<IOCEntry, 'type' | 'value'>): IOCEntry {
  return {
    id: overrides.id || `ioc-${overrides.type}-${overrides.value}`,
    type: overrides.type,
    value: overrides.value,
    confidence: overrides.confidence || 'medium',
    firstSeen: overrides.firstSeen || 1000,
    dismissed: overrides.dismissed || false,
    analystNotes: overrides.analystNotes,
    attribution: overrides.attribution,
    relationships: overrides.relationships,
  };
}

function makeEntry(iocs: IOCEntry[], title = 'Test Report'): IOCExportEntry {
  return { clipTitle: title, sourceUrl: 'https://example.com', iocs };
}

function parseBundle(entries: IOCExportEntry[], config = {}) {
  return JSON.parse(formatIOCsSTIX(entries, config));
}

describe('formatIOCsSTIX', () => {
  it('produces valid STIX 2.1 bundle structure', () => {
    const bundle = parseBundle([makeEntry([makeIOC({ type: 'ipv4', value: '10.0.0.1' })])]);
    expect(bundle.type).toBe('bundle');
    expect(bundle.id).toMatch(/^bundle--/);
    expect(Array.isArray(bundle.objects)).toBe(true);
  });

  it('creates Identity SDO with default name', () => {
    const bundle = parseBundle([makeEntry([makeIOC({ type: 'ipv4', value: '10.0.0.1' })])]);
    const identity = bundle.objects.find((o: Record<string, unknown>) => o.type === 'identity');
    expect(identity).toBeDefined();
    expect(identity.name).toBe('BrowserNotes Analyst');
    expect(identity.identity_class).toBe('individual');
  });

  it('creates Identity SDO with custom name', () => {
    const bundle = parseBundle(
      [makeEntry([makeIOC({ type: 'ipv4', value: '10.0.0.1' })])],
      { identityName: 'Custom Analyst' },
    );
    const identity = bundle.objects.find((o: Record<string, unknown>) => o.type === 'identity');
    expect(identity.name).toBe('Custom Analyst');
  });

  it('creates Indicator SDO for IPv4', () => {
    const bundle = parseBundle([makeEntry([makeIOC({ type: 'ipv4', value: '10.0.0.1' })])]);
    const indicator = bundle.objects.find((o: Record<string, unknown>) => o.type === 'indicator');
    expect(indicator).toBeDefined();
    expect(indicator.pattern).toBe("[ipv4-addr:value = '10.0.0.1']");
    expect(indicator.pattern_type).toBe('stix');
  });

  it('creates Indicator SDO for IPv6', () => {
    const bundle = parseBundle([makeEntry([makeIOC({ type: 'ipv6', value: '::1' })])]);
    const indicator = bundle.objects.find((o: Record<string, unknown>) => o.type === 'indicator');
    expect(indicator.pattern).toBe("[ipv6-addr:value = '::1']");
  });

  it('creates Indicator SDO for domain', () => {
    const bundle = parseBundle([makeEntry([makeIOC({ type: 'domain', value: 'evil.com' })])]);
    const indicator = bundle.objects.find((o: Record<string, unknown>) => o.type === 'indicator');
    expect(indicator.pattern).toBe("[domain-name:value = 'evil.com']");
  });

  it('creates Indicator SDO for URL', () => {
    const bundle = parseBundle([makeEntry([makeIOC({ type: 'url', value: 'https://evil.com/payload' })])]);
    const indicator = bundle.objects.find((o: Record<string, unknown>) => o.type === 'indicator');
    expect(indicator.pattern).toBe("[url:value = 'https://evil.com/payload']");
  });

  it('creates Indicator SDO for email', () => {
    const bundle = parseBundle([makeEntry([makeIOC({ type: 'email', value: 'bad@evil.com' })])]);
    const indicator = bundle.objects.find((o: Record<string, unknown>) => o.type === 'indicator');
    expect(indicator.pattern).toBe("[email-addr:value = 'bad@evil.com']");
  });

  it('creates Indicator SDO for file-path', () => {
    const bundle = parseBundle([makeEntry([makeIOC({ type: 'file-path', value: '/tmp/malware.bin' })])]);
    const indicator = bundle.objects.find((o: Record<string, unknown>) => o.type === 'indicator');
    expect(indicator.pattern).toBe("[file:name = '/tmp/malware.bin']");
  });

  it('creates Indicator for MD5 hash', () => {
    const bundle = parseBundle([makeEntry([makeIOC({ type: 'md5', value: 'd41d8cd98f00b204e9800998ecf8427e' })])]);
    const indicator = bundle.objects.find((o: Record<string, unknown>) => o.type === 'indicator');
    expect(indicator.pattern).toBe("[file:hashes.'MD5' = 'd41d8cd98f00b204e9800998ecf8427e']");
  });

  it('creates Indicator for SHA-1 hash', () => {
    const bundle = parseBundle([makeEntry([makeIOC({ type: 'sha1', value: 'da39a3ee5e6b4b0d3255bfef95601890afd80709' })])]);
    const indicator = bundle.objects.find((o: Record<string, unknown>) => o.type === 'indicator');
    expect(indicator.pattern).toBe("[file:hashes.'SHA-1' = 'da39a3ee5e6b4b0d3255bfef95601890afd80709']");
  });

  it('creates Indicator for SHA-256 hash', () => {
    const bundle = parseBundle([makeEntry([makeIOC({ type: 'sha256', value: 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855' })])]);
    const indicator = bundle.objects.find((o: Record<string, unknown>) => o.type === 'indicator');
    expect(indicator.pattern).toBe("[file:hashes.'SHA-256' = 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855']");
  });

  it('creates Vulnerability SDO for CVE', () => {
    const bundle = parseBundle([makeEntry([makeIOC({ type: 'cve', value: 'CVE-2024-12345' })])]);
    const vuln = bundle.objects.find((o: Record<string, unknown>) => o.type === 'vulnerability');
    expect(vuln).toBeDefined();
    expect(vuln.name).toBe('CVE-2024-12345');
    expect(vuln.external_references[0].external_id).toBe('CVE-2024-12345');
    // CVE should NOT create an indicator
    const indicator = bundle.objects.find((o: Record<string, unknown>) => o.type === 'indicator');
    expect(indicator).toBeUndefined();
  });

  it('creates YARA Indicator with pattern_type yara', () => {
    const yaraBody = 'rule TestRule { condition: true }';
    const bundle = parseBundle([makeEntry([makeIOC({ type: 'yara-rule', value: yaraBody })])]);
    const indicator = bundle.objects.find((o: Record<string, unknown>) => o.type === 'indicator');
    expect(indicator.pattern_type).toBe('yara');
    expect(indicator.pattern).toBe(yaraBody);
  });

  it('creates SIGMA Indicator with pattern_type sigma', () => {
    const sigmaBody = 'title: Test\ndetection:\n  condition: selection';
    const bundle = parseBundle([makeEntry([makeIOC({ type: 'sigma-rule', value: sigmaBody })])]);
    const indicator = bundle.objects.find((o: Record<string, unknown>) => o.type === 'indicator');
    expect(indicator.pattern_type).toBe('sigma');
    expect(indicator.pattern).toBe(sigmaBody);
  });

  it('creates MITRE ATT&CK Indicator', () => {
    const bundle = parseBundle([makeEntry([makeIOC({ type: 'mitre-attack', value: 'T1059.001' })])]);
    const indicator = bundle.objects.find((o: Record<string, unknown>) => o.type === 'indicator');
    expect(indicator.pattern).toBe("[attack-pattern:external_references[*].external_id = 'T1059.001']");
  });

  it('filters dismissed IOCs', () => {
    const bundle = parseBundle([makeEntry([
      makeIOC({ type: 'ipv4', value: '10.0.0.1', dismissed: true }),
      makeIOC({ type: 'ipv4', value: '10.0.0.2' }),
    ])]);
    const indicators = bundle.objects.filter((o: Record<string, unknown>) => o.type === 'indicator');
    expect(indicators).toHaveLength(1);
    expect(indicators[0].pattern).toContain('10.0.0.2');
  });

  it('creates Report SDO with object_refs', () => {
    const bundle = parseBundle([makeEntry([
      makeIOC({ type: 'ipv4', value: '10.0.0.1' }),
      makeIOC({ type: 'domain', value: 'evil.com' }),
    ])]);
    const report = bundle.objects.find((o: Record<string, unknown>) => o.type === 'report');
    expect(report).toBeDefined();
    expect(report.name).toBe('Test Report');
    expect(report.object_refs).toHaveLength(2);
    expect(report.report_types).toContain('threat-report');
  });

  it('generates deterministic IDs', () => {
    const entries = [makeEntry([makeIOC({ type: 'ipv4', value: '10.0.0.1' })])];
    const b1 = parseBundle(entries);
    const b2 = parseBundle(entries);
    // Indicator IDs should be deterministic (same input → same ID)
    const i1 = b1.objects.find((o: Record<string, unknown>) => o.type === 'indicator');
    const i2 = b2.objects.find((o: Record<string, unknown>) => o.type === 'indicator');
    expect(i1.id).toBe(i2.id);
  });

  it('creates Relationship SDOs from relationships', () => {
    const iocA = makeIOC({ id: 'a', type: 'domain', value: 'evil.com', relationships: [{ targetIOCId: 'b', relationshipType: 'resolves-to' }] });
    const iocB = makeIOC({ id: 'b', type: 'ipv4', value: '10.0.0.1' });
    const bundle = parseBundle([makeEntry([iocA, iocB])]);
    const rels = bundle.objects.filter((o: Record<string, unknown>) => o.type === 'relationship');
    expect(rels).toHaveLength(1);
    expect(rels[0].relationship_type).toBe('resolves-to');
  });

  it('maps confidence levels correctly', () => {
    const levels = ['low', 'medium', 'high', 'confirmed'] as const;
    const expected = [15, 50, 85, 100];
    for (let i = 0; i < levels.length; i++) {
      const bundle = parseBundle([makeEntry([makeIOC({ type: 'ipv4', value: `10.0.0.${i + 1}`, confidence: levels[i] })])]);
      const indicator = bundle.objects.find((o: Record<string, unknown>) => o.type === 'indicator');
      expect(indicator.confidence).toBe(expected[i]);
    }
  });

  it('handles empty entries gracefully', () => {
    const bundle = parseBundle([]);
    expect(bundle.type).toBe('bundle');
    // Just the identity, no report (no object_refs)
    expect(bundle.objects).toHaveLength(1);
    expect(bundle.objects[0].type).toBe('identity');
  });
});
