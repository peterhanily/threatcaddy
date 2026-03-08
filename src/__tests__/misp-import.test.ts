import { describe, it, expect } from 'vitest';
import { parseMISPEvent } from '../lib/misp-import';

// ── Helpers ─────────────────────────────────────────────────────────

function makeEvent(overrides: Record<string, unknown> = {}) {
  return {
    Event: {
      info: 'Test MISP Event',
      date: '2024-01-15',
      Attribute: [],
      Tag: [],
      ...overrides,
    },
  };
}

function makeAttribute(overrides: Record<string, unknown> = {}) {
  return {
    type: 'ip-src',
    value: '1.2.3.4',
    category: 'Network activity',
    ...overrides,
  };
}

// ── Single event parsing ────────────────────────────────────────────

describe('single event parsing', () => {
  it('parses a basic MISP event', () => {
    const result = parseMISPEvent(JSON.stringify(makeEvent({
      info: 'APT29 Campaign',
      Attribute: [makeAttribute()],
    })));
    expect(result.eventTitle).toBe('APT29 Campaign');
    expect(result.iocs).toHaveLength(1);
    expect(result.errors).toHaveLength(0);
  });

  it('handles event without Event wrapper', () => {
    const result = parseMISPEvent(JSON.stringify({
      info: 'Bare Event',
      Attribute: [makeAttribute()],
      Tag: [],
    }));
    expect(result.eventTitle).toBe('Bare Event');
    expect(result.iocs).toHaveLength(1);
  });

  it('returns default title when info is missing', () => {
    const result = parseMISPEvent(JSON.stringify({ Event: { Attribute: [] } }));
    expect(result.eventTitle).toBe('Untitled MISP Event');
  });
});

// ── Attribute type mapping ──────────────────────────────────────────

describe('attribute type mapping', () => {
  it('maps ip-src to ipv4', () => {
    const result = parseMISPEvent(JSON.stringify(makeEvent({
      Attribute: [makeAttribute({ type: 'ip-src', value: '10.0.0.1' })],
    })));
    expect(result.iocs[0].type).toBe('ipv4');
    expect(result.iocs[0].value).toBe('10.0.0.1');
  });

  it('maps ip-dst to ipv4', () => {
    const result = parseMISPEvent(JSON.stringify(makeEvent({
      Attribute: [makeAttribute({ type: 'ip-dst', value: '192.168.1.1' })],
    })));
    expect(result.iocs[0].type).toBe('ipv4');
  });

  it('maps ip-src with IPv6 value to ipv6', () => {
    const result = parseMISPEvent(JSON.stringify(makeEvent({
      Attribute: [makeAttribute({ type: 'ip-src', value: '2001:db8::1' })],
    })));
    expect(result.iocs[0].type).toBe('ipv6');
    expect(result.iocs[0].value).toBe('2001:db8::1');
  });

  it('maps domain to domain', () => {
    const result = parseMISPEvent(JSON.stringify(makeEvent({
      Attribute: [makeAttribute({ type: 'domain', value: 'evil.com' })],
    })));
    expect(result.iocs[0].type).toBe('domain');
  });

  it('maps hostname to domain', () => {
    const result = parseMISPEvent(JSON.stringify(makeEvent({
      Attribute: [makeAttribute({ type: 'hostname', value: 'c2.evil.com' })],
    })));
    expect(result.iocs[0].type).toBe('domain');
  });

  it('maps url to url', () => {
    const result = parseMISPEvent(JSON.stringify(makeEvent({
      Attribute: [makeAttribute({ type: 'url', value: 'https://evil.com/payload' })],
    })));
    expect(result.iocs[0].type).toBe('url');
  });

  it('maps email-src to email', () => {
    const result = parseMISPEvent(JSON.stringify(makeEvent({
      Attribute: [makeAttribute({ type: 'email-src', value: 'phish@evil.com' })],
    })));
    expect(result.iocs[0].type).toBe('email');
  });

  it('maps email-dst to email', () => {
    const result = parseMISPEvent(JSON.stringify(makeEvent({
      Attribute: [makeAttribute({ type: 'email-dst', value: 'victim@example.com' })],
    })));
    expect(result.iocs[0].type).toBe('email');
  });

  it('maps md5 to md5', () => {
    const result = parseMISPEvent(JSON.stringify(makeEvent({
      Attribute: [makeAttribute({ type: 'md5', value: 'd41d8cd98f00b204e9800998ecf8427e' })],
    })));
    expect(result.iocs[0].type).toBe('md5');
  });

  it('maps sha1 to sha1', () => {
    const result = parseMISPEvent(JSON.stringify(makeEvent({
      Attribute: [makeAttribute({ type: 'sha1', value: 'da39a3ee5e6b4b0d3255bfef95601890afd80709' })],
    })));
    expect(result.iocs[0].type).toBe('sha1');
  });

  it('maps sha256 to sha256', () => {
    const result = parseMISPEvent(JSON.stringify(makeEvent({
      Attribute: [makeAttribute({ type: 'sha256', value: 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855' })],
    })));
    expect(result.iocs[0].type).toBe('sha256');
  });

  it('maps vulnerability to cve', () => {
    const result = parseMISPEvent(JSON.stringify(makeEvent({
      Attribute: [makeAttribute({ type: 'vulnerability', value: 'CVE-2024-1234' })],
    })));
    expect(result.iocs[0].type).toBe('cve');
  });

  it('reports error for unsupported types', () => {
    const result = parseMISPEvent(JSON.stringify(makeEvent({
      Attribute: [makeAttribute({ type: 'x509-fingerprint-sha1', value: 'abc' })],
    })));
    expect(result.iocs).toHaveLength(0);
    expect(result.errors).toContain('Unsupported MISP attribute type: x509-fingerprint-sha1');
  });
});

// ── Compound types ──────────────────────────────────────────────────

describe('compound types', () => {
  it('extracts hash from filename|md5', () => {
    const result = parseMISPEvent(JSON.stringify(makeEvent({
      Attribute: [makeAttribute({ type: 'filename|md5', value: 'malware.exe|d41d8cd98f00b204e9800998ecf8427e' })],
    })));
    expect(result.iocs[0].type).toBe('md5');
    expect(result.iocs[0].value).toBe('d41d8cd98f00b204e9800998ecf8427e');
  });

  it('extracts hash from filename|sha256', () => {
    const result = parseMISPEvent(JSON.stringify(makeEvent({
      Attribute: [makeAttribute({ type: 'filename|sha256', value: 'payload.dll|e3b0c44298fc1c149afbf4c8996fb924' })],
    })));
    expect(result.iocs[0].type).toBe('sha256');
    expect(result.iocs[0].value).toBe('e3b0c44298fc1c149afbf4c8996fb924');
  });

  it('extracts hash from filename|sha1', () => {
    const result = parseMISPEvent(JSON.stringify(makeEvent({
      Attribute: [makeAttribute({ type: 'filename|sha1', value: 'dropper.bin|da39a3ee5e6b4b0d3255bfef95601890afd80709' })],
    })));
    expect(result.iocs[0].type).toBe('sha1');
    expect(result.iocs[0].value).toBe('da39a3ee5e6b4b0d3255bfef95601890afd80709');
  });
});

// ── TLP extraction from tags ────────────────────────────────────────

describe('TLP extraction from tags', () => {
  it('extracts TLP:CLEAR from tlp:white', () => {
    const result = parseMISPEvent(JSON.stringify(makeEvent({
      Attribute: [makeAttribute()],
      Tag: [{ name: 'tlp:white' }],
    })));
    expect(result.iocs[0].clsLevel).toBe('TLP:CLEAR');
  });

  it('extracts TLP:GREEN from tlp:green', () => {
    const result = parseMISPEvent(JSON.stringify(makeEvent({
      Attribute: [makeAttribute()],
      Tag: [{ name: 'tlp:green' }],
    })));
    expect(result.iocs[0].clsLevel).toBe('TLP:GREEN');
  });

  it('extracts TLP:AMBER from tlp:amber', () => {
    const result = parseMISPEvent(JSON.stringify(makeEvent({
      Attribute: [makeAttribute()],
      Tag: [{ name: 'tlp:amber' }],
    })));
    expect(result.iocs[0].clsLevel).toBe('TLP:AMBER');
  });

  it('extracts TLP:RED from tlp:red', () => {
    const result = parseMISPEvent(JSON.stringify(makeEvent({
      Attribute: [makeAttribute()],
      Tag: [{ name: 'tlp:red' }],
    })));
    expect(result.iocs[0].clsLevel).toBe('TLP:RED');
  });

  it('does not set clsLevel when no TLP tag', () => {
    const result = parseMISPEvent(JSON.stringify(makeEvent({
      Attribute: [makeAttribute()],
      Tag: [{ name: 'some-other-tag' }],
    })));
    expect(result.iocs[0].clsLevel).toBeUndefined();
  });
});

// ── Threat actor extraction ─────────────────────────────────────────

describe('threat actor extraction', () => {
  it('extracts threat actor from galaxy tag', () => {
    const result = parseMISPEvent(JSON.stringify(makeEvent({
      Attribute: [makeAttribute()],
      Tag: [{ name: 'misp-galaxy:threat-actor="APT29"' }],
    })));
    expect(result.iocs[0].attribution).toBe('APT29');
  });

  it('does not set attribution without galaxy tag', () => {
    const result = parseMISPEvent(JSON.stringify(makeEvent({
      Attribute: [makeAttribute()],
      Tag: [{ name: 'tlp:green' }],
    })));
    expect(result.iocs[0].attribution).toBeUndefined();
  });
});

// ── Attribute metadata ──────────────────────────────────────────────

describe('attribute metadata', () => {
  it('sets comment as analystNotes', () => {
    const result = parseMISPEvent(JSON.stringify(makeEvent({
      Attribute: [makeAttribute({ comment: 'C2 callback server' })],
    })));
    expect(result.iocs[0].analystNotes).toBe('C2 callback server');
  });

  it('does not set analystNotes when comment is empty', () => {
    const result = parseMISPEvent(JSON.stringify(makeEvent({
      Attribute: [makeAttribute({ comment: '' })],
    })));
    expect(result.iocs[0].analystNotes).toBeUndefined();
  });
});

// ── Error handling ──────────────────────────────────────────────────

describe('error handling', () => {
  it('handles invalid JSON', () => {
    const result = parseMISPEvent('not json');
    expect(result.iocs).toHaveLength(0);
    expect(result.errors).toContain('Invalid JSON');
  });

  it('handles empty event (no attributes)', () => {
    const result = parseMISPEvent(JSON.stringify(makeEvent({ Attribute: [] })));
    expect(result.iocs).toHaveLength(0);
    expect(result.errors).toHaveLength(0);
  });

  it('handles unrecognized format', () => {
    const result = parseMISPEvent(JSON.stringify({ random: 'data' }));
    expect(result.errors[0]).toContain('Unrecognized MISP data format');
  });

  it('handles array of events', () => {
    const events = [
      makeEvent({ info: 'Event 1', Attribute: [makeAttribute({ value: '1.1.1.1' })] }),
      makeEvent({ info: 'Event 2', Attribute: [makeAttribute({ value: '2.2.2.2' })] }),
    ];
    const result = parseMISPEvent(JSON.stringify(events));
    expect(result.iocs).toHaveLength(2);
    expect(result.eventTitle).toContain('Event 1');
    expect(result.eventTitle).toContain('Event 2');
  });

  it('returns all tags from event', () => {
    const result = parseMISPEvent(JSON.stringify(makeEvent({
      Attribute: [makeAttribute()],
      Tag: [
        { name: 'tlp:green' },
        { name: 'misp-galaxy:threat-actor="APT28"' },
        { name: 'custom-tag' },
      ],
    })));
    expect(result.tags).toContain('tlp:green');
    expect(result.tags).toContain('custom-tag');
    expect(result.tags).toHaveLength(3);
  });
});
