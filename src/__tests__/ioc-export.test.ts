import { describe, it, expect } from 'vitest';
import { formatIOCsJSON, formatIOCsCSV, formatIOCsFlatJSON, formatIOCsFlatCSV, slugify } from '../lib/ioc-export';
import type { IOCExportEntry, ThreatIntelExportConfig } from '../lib/ioc-export';
import type { IOCEntry } from '../types';

function makeIOC(overrides: Partial<IOCEntry> = {}): IOCEntry {
  return {
    id: 'ioc-1',
    type: 'ipv4',
    value: '192.168.1.1',
    confidence: 'high',
    firstSeen: new Date('2024-06-01T00:00:00Z').getTime(),
    dismissed: false,
    ...overrides,
  };
}

function makeEntry(overrides: Partial<IOCExportEntry> & { iocs?: IOCEntry[] } = {}): IOCExportEntry {
  return {
    clipTitle: 'Test Clip',
    sourceUrl: 'https://example.com',
    iocs: [makeIOC()],
    ...overrides,
  };
}

describe('formatIOCsJSON', () => {
  it('produces correct structure with metadata', () => {
    const result = JSON.parse(formatIOCsJSON([makeEntry()]));
    expect(result).toHaveProperty('exportedAt');
    expect(result.totalIOCs).toBe(1);
    expect(result.clips).toHaveLength(1);
    expect(result.clips[0].clipTitle).toBe('Test Clip');
    expect(result.clips[0].sourceUrl).toBe('https://example.com');
  });

  it('aggregates multiple clips', () => {
    const entries = [
      makeEntry({ clipTitle: 'Clip A', iocs: [makeIOC(), makeIOC({ id: 'ioc-2', value: '10.0.0.1' })] }),
      makeEntry({ clipTitle: 'Clip B', iocs: [makeIOC({ id: 'ioc-3', type: 'domain', value: 'evil.com' })] }),
    ];
    const result = JSON.parse(formatIOCsJSON(entries));
    expect(result.totalIOCs).toBe(3);
    expect(result.clips).toHaveLength(2);
  });

  it('skips dismissed IOCs', () => {
    const entries = [
      makeEntry({
        iocs: [
          makeIOC({ dismissed: false }),
          makeIOC({ id: 'ioc-2', value: '10.0.0.2', dismissed: true }),
        ],
      }),
    ];
    const result = JSON.parse(formatIOCsJSON(entries));
    expect(result.totalIOCs).toBe(1);
    expect(result.clips[0].iocs).toHaveLength(1);
  });

  it('omits the internal id field', () => {
    const result = JSON.parse(formatIOCsJSON([makeEntry()]));
    expect(result.clips[0].iocs[0]).not.toHaveProperty('id');
  });

  it('handles empty IOC arrays', () => {
    const result = JSON.parse(formatIOCsJSON([makeEntry({ iocs: [] })]));
    expect(result.totalIOCs).toBe(0);
    expect(result.clips[0].iocs).toEqual([]);
  });

  it('handles empty entries array', () => {
    const result = JSON.parse(formatIOCsJSON([]));
    expect(result.totalIOCs).toBe(0);
    expect(result.clips).toEqual([]);
  });
});

describe('formatIOCsCSV', () => {
  it('has correct header row', () => {
    const csv = formatIOCsCSV([makeEntry()]);
    const header = csv.split('\n')[0];
    expect(header).toBe('type,value,confidence,analystNotes,attribution,firstSeen,dismissed,clsLevel,clipTitle,sourceUrl');
  });

  it('produces one data row per active IOC', () => {
    const csv = formatIOCsCSV([
      makeEntry({ iocs: [makeIOC(), makeIOC({ id: 'ioc-2', value: '10.0.0.1' })] }),
    ]);
    const lines = csv.split('\n');
    expect(lines).toHaveLength(3); // header + 2 data rows
  });

  it('escapes commas in field values', () => {
    const csv = formatIOCsCSV([
      makeEntry({ iocs: [makeIOC({ analystNotes: 'note with, comma' })] }),
    ]);
    expect(csv).toContain('"note with, comma"');
  });

  it('escapes quotes in field values', () => {
    const csv = formatIOCsCSV([
      makeEntry({ iocs: [makeIOC({ analystNotes: 'has "quotes"' })] }),
    ]);
    expect(csv).toContain('"has ""quotes"""');
  });

  it('escapes newlines in field values', () => {
    const csv = formatIOCsCSV([
      makeEntry({ iocs: [makeIOC({ analystNotes: 'line1\nline2' })] }),
    ]);
    expect(csv).toContain('"line1\nline2"');
  });

  it('skips dismissed IOCs', () => {
    const csv = formatIOCsCSV([
      makeEntry({
        iocs: [
          makeIOC({ dismissed: false }),
          makeIOC({ id: 'ioc-2', value: '10.0.0.2', dismissed: true }),
        ],
      }),
    ]);
    const lines = csv.split('\n');
    expect(lines).toHaveLength(2); // header + 1 data row
  });

  it('handles multi-clip output', () => {
    const csv = formatIOCsCSV([
      makeEntry({ clipTitle: 'Clip A' }),
      makeEntry({ clipTitle: 'Clip B', iocs: [makeIOC({ id: 'ioc-2', type: 'domain', value: 'evil.com' })] }),
    ]);
    const lines = csv.split('\n');
    expect(lines).toHaveLength(3); // header + 2 rows
    expect(lines[1]).toContain('Clip A');
    expect(lines[2]).toContain('Clip B');
  });

  it('handles empty IOC arrays', () => {
    const csv = formatIOCsCSV([makeEntry({ iocs: [] })]);
    const lines = csv.split('\n');
    expect(lines).toHaveLength(1); // header only
  });
});

describe('formatIOCsFlatJSON', () => {
  it('produces correct { iocs: [...] } structure', () => {
    const result = JSON.parse(formatIOCsFlatJSON([makeEntry()]));
    expect(result).toHaveProperty('iocs');
    expect(Array.isArray(result.iocs)).toBe(true);
    expect(result.iocs).toHaveLength(1);
  });

  it('assigns sequential IDs across entries', () => {
    const entries = [
      makeEntry({ clipTitle: 'Clip A', iocs: [makeIOC(), makeIOC({ id: 'ioc-2', value: '10.0.0.1' })] }),
      makeEntry({ clipTitle: 'Clip B', iocs: [makeIOC({ id: 'ioc-3', type: 'domain', value: 'evil.com' })] }),
    ];
    const result = JSON.parse(formatIOCsFlatJSON(entries));
    expect(result.iocs.map((i: { id: number }) => i.id)).toEqual([1, 2, 3]);
  });

  it('maps confidence string to numeric value', () => {
    const entries = [
      makeEntry({ iocs: [
        makeIOC({ confidence: 'low' }),
        makeIOC({ id: 'ioc-2', confidence: 'medium' }),
        makeIOC({ id: 'ioc-3', confidence: 'high' }),
        makeIOC({ id: 'ioc-4', confidence: 'confirmed' }),
      ] }),
    ];
    const result = JSON.parse(formatIOCsFlatJSON(entries));
    expect(result.iocs.map((i: { confidence: number }) => i.confidence)).toEqual([1, 2, 3, 5]);
  });

  it('applies default values from config', () => {
    const config: ThreatIntelExportConfig = {
      defaultClsLevel: 'TLP:AMBER',
      defaultReportSource: 'Internal',
    };
    const entries = [makeEntry({ sourceUrl: undefined, iocs: [makeIOC()] })];
    const result = JSON.parse(formatIOCsFlatJSON(entries, config));
    expect(result.iocs[0].cls_level).toBe('TLP:AMBER');
    expect(result.iocs[0].report_source).toBe('Internal');
  });

  it('per-IOC overrides take precedence over defaults', () => {
    const config: ThreatIntelExportConfig = { defaultClsLevel: 'TLP:GREEN' };
    const entries = [makeEntry({ iocs: [makeIOC({ clsLevel: 'TLP:RED' })] })];
    const result = JSON.parse(formatIOCsFlatJSON(entries, config));
    expect(result.iocs[0].cls_level).toBe('TLP:RED');
  });

  it('formats tags as colon-delimited string', () => {
    const entries = [makeEntry({ tags: ['malware', 'apt', 'phishing'] })];
    const result = JSON.parse(formatIOCsFlatJSON(entries));
    expect(result.iocs[0].tags).toBe('malware:apt:phishing');
  });

  it('filters dismissed IOCs', () => {
    const entries = [
      makeEntry({
        iocs: [
          makeIOC({ dismissed: false }),
          makeIOC({ id: 'ioc-2', value: '10.0.0.2', dismissed: true }),
        ],
      }),
    ];
    const result = JSON.parse(formatIOCsFlatJSON(entries));
    expect(result.iocs).toHaveLength(1);
  });

  it('maps all IOC fields correctly', () => {
    const entries = [makeEntry({
      iocs: [makeIOC({
        attribution: 'APT29',
        analystNotes: 'Suspicious',
        iocSubtype: 'C2',
        iocStatus: 'active',
        relatedId: 'REL-001',
        relationshipType: 'communicates-with',
      })],
    })];
    const result = JSON.parse(formatIOCsFlatJSON(entries));
    const ioc = result.iocs[0];
    expect(ioc.actor_name).toBe('APT29');
    expect(ioc.ioc_value).toBe('192.168.1.1');
    expect(ioc.report_title).toBe('Test Clip');
    expect(ioc.report_source).toBe('https://example.com');
    expect(ioc.ioc_type).toBe('ipv4');
    expect(ioc.ioc_subtype).toBe('C2');
    expect(ioc.notes).toBe('Suspicious');
    expect(ioc.related_id).toBe('REL-001');
    expect(ioc.relationship_type).toBe('communicates-with');
    expect(ioc.ioc_status).toBe('active');
    expect(ioc.first_seen).toBe('2024-06-01T00:00:00.000Z');
    expect(ioc.confidence).toBe(3);
  });

  it('handles empty entries array', () => {
    const result = JSON.parse(formatIOCsFlatJSON([]));
    expect(result.iocs).toEqual([]);
  });
});

describe('formatIOCsFlatCSV', () => {
  it('has correct header row', () => {
    const csv = formatIOCsFlatCSV([makeEntry()]);
    const header = csv.split('\n')[0];
    expect(header).toBe(
      'id,actor_name,ioc_value,report_date,report_title,report_source,cls_level,confidence,first_seen,ioc_type,ioc_subtype,notes,related_id,relationship_type,ioc_status,tags'
    );
  });

  it('produces matching data rows', () => {
    const csv = formatIOCsFlatCSV([
      makeEntry({ iocs: [makeIOC(), makeIOC({ id: 'ioc-2', value: '10.0.0.1' })] }),
    ]);
    const lines = csv.split('\n');
    expect(lines).toHaveLength(3); // header + 2 rows
    // First data row starts with id=1
    expect(lines[1]).toMatch(/^1,/);
    expect(lines[2]).toMatch(/^2,/);
  });

  it('escapes CSV fields with commas', () => {
    const csv = formatIOCsFlatCSV([
      makeEntry({ iocs: [makeIOC({ analystNotes: 'note, with comma' })] }),
    ]);
    expect(csv).toContain('"note, with comma"');
  });

  it('filters dismissed IOCs', () => {
    const csv = formatIOCsFlatCSV([
      makeEntry({
        iocs: [
          makeIOC({ dismissed: false }),
          makeIOC({ id: 'ioc-2', dismissed: true }),
        ],
      }),
    ]);
    const lines = csv.split('\n');
    expect(lines).toHaveLength(2); // header + 1 row
  });

  it('handles empty entries', () => {
    const csv = formatIOCsFlatCSV([]);
    const lines = csv.split('\n');
    expect(lines).toHaveLength(1); // header only
  });
});

describe('slugify', () => {
  it('converts to lowercase kebab-case', () => {
    expect(slugify('My Threat Report')).toBe('my-threat-report');
  });

  it('strips special characters', () => {
    expect(slugify('Report: APT29 (2024)')).toBe('report-apt29-2024');
  });

  it('truncates long strings', () => {
    const long = 'a'.repeat(100);
    expect(slugify(long).length).toBeLessThanOrEqual(50);
  });
});
