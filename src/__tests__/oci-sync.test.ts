import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  validatePAR,
  buildObjectUrl,
  buildNoteEnvelope,
  buildIOCReportEnvelope,
  buildFullBackupEnvelope,
  buildObjectKey,
  fetchManifest,
} from '../lib/oci-sync';
import type { Note, ExportData, SharedManifest } from '../types';

// ---- validatePAR ----

describe('validatePAR', () => {
  it('accepts a valid OCI PAR URL', () => {
    const url = 'https://objectstorage.us-ashburn-1.oraclecloud.com/p/abc123/n/ns/b/bucket/o/';
    expect(validatePAR(url)).toEqual({ valid: true });
  });

  it('rejects empty string', () => {
    expect(validatePAR('')).toEqual({ valid: false, error: 'PAR URL is required' });
  });

  it('rejects http:// URLs', () => {
    const url = 'http://objectstorage.us-ashburn-1.oraclecloud.com/p/abc123/n/ns/b/bucket/o/';
    const result = validatePAR(url);
    expect(result.valid).toBe(false);
    expect(result.error).toContain('HTTPS');
  });

  it('rejects URLs without /p/ segment', () => {
    const url = 'https://objectstorage.example.com/n/ns/b/bucket/o/';
    const result = validatePAR(url);
    expect(result.valid).toBe(false);
    expect(result.error).toContain('/p/');
  });

  it('rejects URLs without /o/ segment', () => {
    const url = 'https://objectstorage.example.com/p/token/n/ns/b/bucket/';
    const result = validatePAR(url);
    expect(result.valid).toBe(false);
    expect(result.error).toContain('/o/');
  });

  it('rejects non-URL strings', () => {
    const result = validatePAR('not a url');
    expect(result.valid).toBe(false);
    expect(result.error).toContain('Invalid URL');
  });

  it('rejects non-OCI hostnames with valid path segments', () => {
    const url = 'https://evil.com/p/token/n/ns/b/bucket/o/';
    const result = validatePAR(url);
    expect(result.valid).toBe(false);
    expect(result.error).toContain('Oracle Cloud');
  });
});

// ---- buildObjectUrl ----

describe('buildObjectUrl', () => {
  const prefix = 'https://objectstorage.us-ashburn-1.oraclecloud.com/p/token/n/ns/b/bucket/o/';

  it('appends path to prefix', () => {
    const url = buildObjectUrl(prefix, 'browsernotes/test.json');
    expect(url).toBe(prefix + 'browsernotes/test.json');
  });

  it('handles prefix without trailing slash', () => {
    const prefixNoSlash = prefix.slice(0, -1);
    const url = buildObjectUrl(prefixNoSlash, 'browsernotes/test.json');
    expect(url).toBe(prefix + 'browsernotes/test.json');
  });

  it('strips leading slashes from object path', () => {
    const url = buildObjectUrl(prefix, '/browsernotes/test.json');
    expect(url).toBe(prefix + 'browsernotes/test.json');
  });

  it('sanitizes .. from object path', () => {
    const url = buildObjectUrl(prefix, 'browsernotes/../secret.json');
    expect(url).not.toContain('..');
  });

  it('strips query params from object path', () => {
    const url = buildObjectUrl(prefix, 'browsernotes/test.json?param=evil');
    expect(url).not.toContain('?');
  });

  it('strips hash from object path', () => {
    const url = buildObjectUrl(prefix, 'browsernotes/test.json#frag');
    expect(url).not.toContain('#');
  });

  it('throws on empty object path after sanitization', () => {
    expect(() => buildObjectUrl(prefix, '../../../')).toThrow('Invalid object path');
  });
});

// ---- Envelope Helpers ----

const mockNote: Note = {
  id: 'n1',
  title: 'Test Note',
  content: '# Hello',
  tags: ['test'],
  pinned: false,
  archived: false,
  trashed: false,
  createdAt: 1000,
  updatedAt: 2000,
};

const mockNoteWithIOC: Note = {
  ...mockNote,
  folderId: 'clips-folder',
  iocAnalysis: {
    extractedAt: 1000,
    iocs: [
      {
        id: 'ioc1',
        type: 'ipv4',
        value: '192.168.1.1',
        confidence: 'high',
        firstSeen: 1000,
        dismissed: false,
      },
    ],
    analysisSummary: 'Found 1 IOC',
  },
};

describe('buildNoteEnvelope', () => {
  it('creates correct envelope for a regular note', () => {
    const envelope = buildNoteEnvelope(mockNote, 'Alice');
    expect(envelope.version).toBe(1);
    expect(envelope.type).toBe('note');
    expect(envelope.sharedBy).toBe('Alice');
    expect(envelope.sharedAt).toBeGreaterThan(0);
    expect(envelope.payload).toEqual(mockNote);
  });

  it('detects clip type when note is in clips folder', () => {
    const clipNote = { ...mockNote, folderId: 'clips-folder' };
    const envelope = buildNoteEnvelope(clipNote, 'Bob', 'clips-folder');
    expect(envelope.type).toBe('clip');
  });

  it('uses "anonymous" when label is empty', () => {
    const envelope = buildNoteEnvelope(mockNote, '');
    expect(envelope.sharedBy).toBe('anonymous');
  });
});

describe('buildIOCReportEnvelope', () => {
  it('creates correct envelope with iocAnalysis', () => {
    const envelope = buildIOCReportEnvelope(mockNoteWithIOC, 'Alice');
    expect(envelope.version).toBe(1);
    expect(envelope.type).toBe('ioc-report');
    expect(envelope.sharedBy).toBe('Alice');
    const payload = envelope.payload as Note;
    expect(payload.iocAnalysis).toBeDefined();
    expect(payload.iocAnalysis!.iocs).toHaveLength(1);
  });
});

describe('buildFullBackupEnvelope', () => {
  it('wraps ExportData correctly', () => {
    const exportData: ExportData = {
      version: 1,
      exportedAt: Date.now(),
      notes: [mockNote],
      tasks: [],
      folders: [],
      tags: [],
    };
    const envelope = buildFullBackupEnvelope(exportData, 'Charlie');
    expect(envelope.version).toBe(1);
    expect(envelope.type).toBe('full-backup');
    expect(envelope.sharedBy).toBe('Charlie');
    const payload = envelope.payload as ExportData;
    expect(payload.version).toBe(1);
    expect(payload.notes).toHaveLength(1);
  });
});

// ---- buildObjectKey ----

describe('buildObjectKey', () => {
  it('creates backup key with label', () => {
    const key = buildObjectKey('full-backup', '', 'MyTeam');
    expect(key).toMatch(/^browsernotes\/backups\/MyTeam-\d+\.json$/);
  });

  it('creates note key with id', () => {
    const key = buildObjectKey('note', 'n1', 'Alice');
    expect(key).toMatch(/^browsernotes\/shared\/notes\/n1-\d+\.json$/);
  });

  it('creates clip key', () => {
    const key = buildObjectKey('clip', 'c1', 'Bob');
    expect(key).toMatch(/^browsernotes\/shared\/clips\/c1-\d+\.json$/);
  });

  it('creates ioc-report key', () => {
    const key = buildObjectKey('ioc-report', 'n2', 'Alice');
    expect(key).toMatch(/^browsernotes\/shared\/ioc-reports\/n2-\d+\.json$/);
  });

  it('sanitizes unsafe label characters', () => {
    const key = buildObjectKey('full-backup', '', 'My Team / Backup!');
    // The label portion should not contain slashes or special chars
    const labelPart = key.replace('browsernotes/backups/', '').replace(/-\d+\.json$/, '');
    expect(labelPart).not.toContain('/');
    expect(labelPart).not.toContain('!');
    expect(key).toMatch(/^browsernotes\/backups\//);
  });
});

// ---- Manifest Parsing ----

describe('fetchManifest', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('returns empty manifest when fetch fails', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValueOnce(new Error('network error'));
    const manifest = await fetchManifest('https://objectstorage.example.com/p/t/n/ns/b/b/o/');
    expect(manifest.version).toBe(1);
    expect(manifest.items).toEqual([]);
  });

  it('returns empty manifest for 404', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response('Not found', { status: 404 })
    );
    const manifest = await fetchManifest('https://objectstorage.example.com/p/t/n/ns/b/b/o/');
    expect(manifest.version).toBe(1);
    expect(manifest.items).toEqual([]);
  });

  it('parses valid manifest JSON', async () => {
    const validManifest: SharedManifest = {
      version: 1,
      updatedAt: 1000,
      items: [
        {
          objectKey: 'browsernotes/shared/notes/n1-1000.json',
          type: 'note',
          title: 'Test Note',
          sharedBy: 'Alice',
          sharedAt: 1000,
        },
      ],
    };
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(JSON.stringify(validManifest), { status: 200 })
    );
    const manifest = await fetchManifest('https://objectstorage.example.com/p/t/n/ns/b/b/o/');
    expect(manifest.version).toBe(1);
    expect(manifest.items).toHaveLength(1);
    expect(manifest.items[0].title).toBe('Test Note');
  });

  it('returns empty manifest for malformed JSON', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response('not json {{{', { status: 200 })
    );
    const manifest = await fetchManifest('https://objectstorage.example.com/p/t/n/ns/b/b/o/');
    expect(manifest.version).toBe(1);
    expect(manifest.items).toEqual([]);
  });

  it('returns empty manifest for wrong version', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(JSON.stringify({ version: 2, items: [{ x: 1 }] }), { status: 200 })
    );
    const manifest = await fetchManifest('https://objectstorage.example.com/p/t/n/ns/b/b/o/');
    expect(manifest.items).toEqual([]);
  });
});
