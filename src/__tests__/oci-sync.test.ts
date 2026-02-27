/* eslint-disable @typescript-eslint/no-non-null-assertion */
import { describe, it, expect } from 'vitest';
import {
  validatePAR,
  buildObjectUrl,
  buildNoteEnvelope,
  buildIOCReportEnvelope,
  buildFullBackupEnvelope,
  buildObjectKey,
} from '../lib/oci-sync';
import type { Note, ExportData } from '../types';

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
    const url = buildObjectUrl(prefix, 'threatcaddy/test.json');
    expect(url).toBe(prefix + 'threatcaddy/test.json');
  });

  it('handles prefix without trailing slash', () => {
    const prefixNoSlash = prefix.slice(0, -1);
    const url = buildObjectUrl(prefixNoSlash, 'threatcaddy/test.json');
    expect(url).toBe(prefix + 'threatcaddy/test.json');
  });

  it('strips leading slashes from object path', () => {
    const url = buildObjectUrl(prefix, '/threatcaddy/test.json');
    expect(url).toBe(prefix + 'threatcaddy/test.json');
  });

  it('sanitizes .. from object path', () => {
    const url = buildObjectUrl(prefix, 'threatcaddy/../secret.json');
    expect(url).not.toContain('..');
  });

  it('strips query params from object path', () => {
    const url = buildObjectUrl(prefix, 'threatcaddy/test.json?param=evil');
    expect(url).not.toContain('?');
  });

  it('strips hash from object path', () => {
    const url = buildObjectUrl(prefix, 'threatcaddy/test.json#frag');
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
    expect(key).toMatch(/^threatcaddy\/backups\/MyTeam-\d+\.json$/);
  });

  it('creates note key with id', () => {
    const key = buildObjectKey('note', 'n1', 'Alice');
    expect(key).toMatch(/^threatcaddy\/shared\/notes\/n1-\d+\.json$/);
  });

  it('creates clip key', () => {
    const key = buildObjectKey('clip', 'c1', 'Bob');
    expect(key).toMatch(/^threatcaddy\/shared\/clips\/c1-\d+\.json$/);
  });

  it('creates ioc-report key', () => {
    const key = buildObjectKey('ioc-report', 'n2', 'Alice');
    expect(key).toMatch(/^threatcaddy\/shared\/ioc-reports\/n2-\d+\.json$/);
  });

  it('sanitizes unsafe label characters', () => {
    const key = buildObjectKey('full-backup', '', 'My Team / Backup!');
    // The label portion should not contain slashes or special chars
    const labelPart = key.replace('threatcaddy/backups/', '').replace(/-\d+\.json$/, '');
    expect(labelPart).not.toContain('/');
    expect(labelPart).not.toContain('!');
    expect(key).toMatch(/^threatcaddy\/backups\//);
  });
});
