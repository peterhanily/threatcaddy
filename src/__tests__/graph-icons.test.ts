import { describe, it, expect, beforeEach } from 'vitest';
import { getNodeIcon, _clearIconCache } from '../lib/graph-icons';
import type { IOCType } from '../types';

const ALL_IOC_TYPES: IOCType[] = [
  'ipv4', 'ipv6', 'domain', 'url', 'email',
  'md5', 'sha1', 'sha256',
  'cve', 'mitre-attack', 'yara-rule', 'sigma-rule', 'file-path',
];

describe('getNodeIcon', () => {
  beforeEach(() => {
    _clearIconCache();
  });

  it('returns a valid data URI for every IOC type', () => {
    for (const iocType of ALL_IOC_TYPES) {
      const uri = getNodeIcon('ioc', '#3b82f6', iocType);
      expect(uri).toMatch(/^data:image\/svg\+xml;utf8,/);
      expect(uri.length).toBeGreaterThan(30);
    }
  });

  it('returns a valid data URI for note type', () => {
    const uri = getNodeIcon('note', '#3b82f6');
    expect(uri).toMatch(/^data:image\/svg\+xml;utf8,/);
  });

  it('returns a valid data URI for task type', () => {
    const uri = getNodeIcon('task', '#22c55e');
    expect(uri).toMatch(/^data:image\/svg\+xml;utf8,/);
  });

  it('returns a valid data URI for timeline-event type', () => {
    const uri = getNodeIcon('timeline-event', '#6b7280');
    expect(uri).toMatch(/^data:image\/svg\+xml;utf8,/);
  });

  it('caches results for the same type+color', () => {
    const a = getNodeIcon('note', '#3b82f6');
    const b = getNodeIcon('note', '#3b82f6');
    expect(a).toBe(b); // exact same string reference (from cache)
  });

  it('returns different URIs for different IOC types', () => {
    const uris = ALL_IOC_TYPES.map((t) => getNodeIcon('ioc', '#3b82f6', t));
    const unique = new Set(uris);
    expect(unique.size).toBe(ALL_IOC_TYPES.length);
  });

  it('returns different URIs for different colors', () => {
    const a = getNodeIcon('note', '#3b82f6');
    const b = getNodeIcon('note', '#22c55e');
    expect(a).not.toBe(b);
  });

  it('produces different SVGs for note vs task vs timeline-event', () => {
    const noteUri = getNodeIcon('note', '#ffffff');
    const taskUri = getNodeIcon('task', '#ffffff');
    const eventUri = getNodeIcon('timeline-event', '#ffffff');
    const uris = new Set([noteUri, taskUri, eventUri]);
    expect(uris.size).toBe(3);
  });
});
