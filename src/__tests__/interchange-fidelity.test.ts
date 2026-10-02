import { describe, expect, it, vi } from 'vitest';
import { validate as uuidValid, version as uuidVersion } from 'uuid';
import { formatIOCsSTIX } from '../lib/stix-export';
import { parseSTIXBundle } from '../lib/stix-import';
import { formatIOCsMISP } from '../lib/misp-export';
import { parseMISPEvent } from '../lib/misp-import';
import { sanitizeStandaloneIOC, sanitizeWhiteboard, MAX_WHITEBOARD_FILES_BYTES } from '../lib/export';
import type { IOCEntry, IOCType } from '../types';

const ioc = (overrides: Partial<IOCEntry> = {}): IOCEntry => ({
  id: 'test', type: 'domain', value: 'example.test', confidence: 'high',
  firstSeen: 1700000000000, dismissed: false, ...overrides,
});
const entries = (iocs: IOCEntry[], entityClsLevel?: string) => [{ clipTitle: 'Interoperability fixture', iocs, entityClsLevel }];
const exported = (iocs: IOCEntry[]) => JSON.parse(formatIOCsSTIX(entries(iocs)));

describe('independent interchange regression contracts', () => {
  it('retains source versions on repeated exports and advances only with a source revision', () => {
    vi.useFakeTimers();
    try {
      const source = [{ ...entries([ioc()])[0], updatedAt: 1700000001000 }];
      const first = JSON.parse(formatIOCsSTIX(source));
      vi.setSystemTime(new Date('2028-01-01T00:00:00Z'));
      expect(JSON.parse(formatIOCsSTIX(source))).toEqual(first);
      const next = JSON.parse(formatIOCsSTIX([{ ...source[0], updatedAt: 1700000002000, iocs: [ioc({ analystNotes: 'Reviewed' })] }]));
      const indicator = first.objects.find((object: { type: string }) => object.type === 'indicator');
      const changed = next.objects.find((object: { type: string }) => object.type === 'indicator');
      expect(changed.id).toBe(indicator.id);
      expect(changed.created).toBe(indicator.created);
      expect(Date.parse(changed.modified)).toBeGreaterThan(Date.parse(indicator.modified));
      expect(changed.description).toBe('Reviewed');
      expect(next.id).not.toBe(first.id);
    } finally { vi.useRealTimers(); }
  });
  it('recognizes official reference-only GREEN and AMBER+STRICT objects', () => {
    for (const [id, level] of [
      ['marking-definition--bab4a63c-aed9-4cf5-a766-dfca5abac2bb', 'TLP:GREEN'],
      ['marking-definition--939a9414-2ddd-4d32-a0cd-375ea402b003', 'TLP:AMBER+STRICT'],
    ]) {
      const parsed = parseSTIXBundle(JSON.stringify({ type: 'bundle', objects: [{
        type: 'indicator', pattern_type: 'stix', pattern: "[domain-name:value = 'example.test']", object_marking_refs: [id],
      }] }));
      expect(parsed.iocs[0].clsLevel).toBe(level);
      expect(parsed.errors).toEqual([]);
    }
  });
  it('preserves legacy version semantics, unknown and granular restrictions', () => {
    const original = { type: 'indicator', pattern: "[domain-name:value = 'example.test']",
      object_marking_refs: ['marking-definition--f88d31f6-486f-44da-b317-01333bde0b82', 'marking-definition--unknown'],
      granular_markings: [{ marking_ref: 'marking-definition--extra', selectors: ['pattern'] }] };
    const parsed = parseSTIXBundle(JSON.stringify({ type: 'bundle', objects: [original] }));
    expect(parsed.iocs[0].clsLevel).toContain('UNRESOLVED');
    expect(parsed.errors[0]).toContain('unknown');
    expect(JSON.parse(String(parsed.iocs[0].enrichment?.stix[0].object))).toEqual(original);
    const sanitized = sanitizeStandaloneIOC({ ...parsed.iocs[0], id: 'retained' });
    if (!sanitized) throw new Error('Expected valid fixture');
    expect(sanitized.enrichment?.stix[0].object).toBe(JSON.stringify(original));
    const output = exported([ioc({ ...sanitized, firstSeen: 1 })]);
    expect(output.objects.find((o: { type: string }) => o.type === 'indicator').object_marking_refs).toEqual(expect.arrayContaining(original.object_marking_refs));
  });
  it('uses RFC UUIDv5 semantic identities and merges duplicate restrictions', () => {
    const bundle = exported([ioc({ id: 'a', clsLevel: 'TLP:CLEAR' }), ioc({ id: 'b', clsLevel: 'TLP:RED' })]);
    const indicators = bundle.objects.filter((o: { type: string }) => o.type === 'indicator');
    expect(indicators).toHaveLength(1);
    expect(indicators[0].object_marking_refs).toHaveLength(2);
    const id = indicators[0].id.split('--')[1];
    expect(uuidValid(id)).toBe(true);
    expect(uuidVersion(id)).toBe(5);
    expect(exported([ioc()]).objects.find((o: { type: string }) => o.type === 'indicator').id).toBe(indicators[0].id);
  });
  it.each(['low', 'medium', 'high', 'confirmed'] as const)('roundtrips %s confidence without upgrading it', confidence => {
    expect(parseSTIXBundle(formatIOCsSTIX(entries([ioc({ confidence })]))).iocs[0].confidence).toBe(confidence);
    expect(parseMISPEvent(formatIOCsMISP(entries([ioc({ confidence })]))).iocs[0].confidence).toBe(confidence);
  });
  it.each([
    ['file-path', "C:\\Users\\Analyst's files\\sample.txt"],
    ['yara-rule', 'rule sample { condition: true }'],
    ['sigma-rule', 'title: Sample\ndetection:\n  condition: selection'],
    ['mitre-attack', 'T1566.001'], ['cve', 'CVE-2025-12345'],
  ] as [IOCType, string][])('roundtrips advertised %s format', (type, value) => {
    const parsed = parseSTIXBundle(formatIOCsSTIX(entries([ioc({ type, value })])));
    expect(parsed.errors).toEqual([]);
    expect(parsed.iocs[0]).toMatchObject({ type, value, confidence: 'high' });
    const misp = parseMISPEvent(formatIOCsMISP(entries([ioc({ type, value })])));
    expect(misp.iocs[0]).toMatchObject({ type, value });
  });
  it('retains unsupported compound patterns and SHA512 without semantic conversion', () => {
    const unsupported = { type: 'indicator', pattern_type: 'stix', pattern: "[domain-name:value = 'one.test'] OR [domain-name:value = 'two.test']" };
    const stix = parseSTIXBundle(JSON.stringify({ type: 'bundle', objects: [unsupported] }));
    expect(stix.iocs).toEqual([]);
    expect(stix.preservedObjects).toEqual([unsupported]);
    const attribute = { type: 'filename|sha512', value: 'sample|' + 'a'.repeat(128) };
    const misp = parseMISPEvent(JSON.stringify({ Event: { Attribute: [attribute] } }));
    expect(misp.iocs).toEqual([]);
    expect(misp.preservedAttributes).toEqual([attribute]);
  });
  it('retains per-attribute handling, inheritance and the strongest duplicate label', () => {
    const output = formatIOCsMISP([
      ...entries([ioc({ id: 'a', clsLevel: 'TLP:CLEAR' }), ioc({ id: 'b', clsLevel: 'TLP:RED' })]),
      ...entries([ioc({ id: 'c', value: 'second.test' })], 'TLP:AMBER+STRICT'),
    ], { defaultClsLevel: 'TLP:GREEN' });
    const event = JSON.parse(output).Event;
    expect(event.Tag.some((tag: { name: string }) => tag.name.startsWith('tlp:'))).toBe(false);
    const parsed = parseMISPEvent(output);
    expect(parsed.iocs.find(row => row.value === 'example.test')?.clsLevel).toBe('TLP:RED');
    expect(parsed.iocs.find(row => row.value === 'second.test')?.clsLevel).toBe('TLP:AMBER+STRICT');
    const incoming = parseMISPEvent(JSON.stringify({ Event: { Tag: [{ name: 'tlp:green' }], Attribute: [
      { type: 'domain', value: 'example.test', Tag: [{ name: 'tlp:red' }] },
      { type: 'domain', value: 'example.test', Tag: [{ name: 'tlp:clear' }] },
    ] } }));
    expect(incoming.iocs).toHaveLength(1);
    expect(incoming.iocs[0].clsLevel).toBe('TLP:RED');
    expect(incoming.iocs[0].enrichment?.misp).toHaveLength(2);
  });
});

describe('whiteboard asset import boundaries', () => {
  it('retains exact embedded file JSON and scene JSON', () => {
    const files = '{"image1":{"dataURL":"data:image/png;base64,aGVsbG8=","mimeType":"image/png","id":"image1","created":1}}';
    const result = sanitizeWhiteboard({ id: 'wb', name: 'Asset board', elements: '[{"type":"image","fileId":"image1"}]', files });
    expect(result?.files).toBe(files);
    expect(result?.elements).toBe('[{"type":"image","fileId":"image1"}]');
  });
  it('rejects malformed and oversized JSON instead of truncating a restore', () => {
    expect(() => sanitizeWhiteboard({ id: 'wb', elements: 'not json' })).toThrow();
    expect(() => sanitizeWhiteboard({ id: 'wb', elements: '[]', files: JSON.stringify({ data: 'x'.repeat(MAX_WHITEBOARD_FILES_BYTES) }) })).toThrow();
  });
});
