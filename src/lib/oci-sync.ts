// @deprecated — Use cloud-sync.ts and cloud-providers.ts for new code.
// This file is retained for envelope/key helpers which are provider-agnostic.
import type { Note, SharedItemEnvelope, ExportData } from '../types';

// ---- Validation ----

const MAX_UPLOAD_SIZE = 50 * 1024 * 1024; // 50 MB

export function validatePAR(url: string): { valid: boolean; error?: string } {
  if (!url || typeof url !== 'string') {
    return { valid: false, error: 'PAR URL is required' };
  }
  const trimmed = url.trim();
  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    return { valid: false, error: 'Invalid URL format' };
  }
  if (parsed.protocol !== 'https:') {
    return { valid: false, error: 'PAR URL must use HTTPS' };
  }
  if (!trimmed.includes('/p/') || !trimmed.includes('/o/')) {
    return { valid: false, error: 'PAR URL must contain /p/ and /o/ path segments' };
  }
  // Require actual OCI Object Storage hostname to prevent credential leakage to arbitrary hosts
  if (!/^objectstorage\..*\.oraclecloud\.com$/i.test(parsed.hostname)) {
    return { valid: false, error: 'PAR URL must be an Oracle Cloud Object Storage endpoint (*.objectstorage.*.oraclecloud.com)' };
  }
  return { valid: true };
}

// ---- URL Construction ----

export function buildObjectUrl(parPrefix: string, objectPath: string): string {
  // Decode before sanitizing to prevent %2e%2e bypass
  let decoded: string;
  try {
    decoded = decodeURIComponent(objectPath);
  } catch {
    decoded = objectPath;
  }
  // Sanitize object path: no .., no query params, no leading slashes
  const sanitized = decoded
    .replace(/\.\./g, '')
    .replace(/[?#]/g, '')
    .replace(/^\/+/, '');

  if (!sanitized) {
    throw new Error('Invalid object path');
  }

  // Ensure PAR prefix ends with /
  const prefix = parPrefix.endsWith('/') ? parPrefix : parPrefix + '/';
  return prefix + sanitized;
}

// ---- HTTP Operations ----

export async function ociPut(
  writePAR: string,
  objectPath: string,
  data: string,
  contentType = 'application/json'
): Promise<{ ok: boolean; status: number; error?: string }> {
  const bodyBytes = new TextEncoder().encode(data).length;
  if (bodyBytes > MAX_UPLOAD_SIZE) {
    return { ok: false, status: 0, error: `Upload too large (${Math.round(bodyBytes / 1024 / 1024)} MB, max ${MAX_UPLOAD_SIZE / 1024 / 1024} MB)` };
  }

  const url = buildObjectUrl(writePAR, objectPath);
  try {
    const resp = await fetch(url, {
      method: 'PUT',
      body: data,
      headers: { 'Content-Type': contentType },
    });
    if (!resp.ok) {
      return { ok: false, status: resp.status, error: `HTTP ${resp.status}: ${resp.statusText}` };
    }
    return { ok: true, status: resp.status };
  } catch (err) {
    return { ok: false, status: 0, error: err instanceof Error ? err.message : 'Network error' };
  }
}

// ---- Envelope Helpers ----

export function buildNoteEnvelope(note: Note, label: string, clipsFolderId?: string): SharedItemEnvelope {
  const isClip = clipsFolderId != null && note.folderId === clipsFolderId;
  return {
    version: 1,
    type: isClip ? 'clip' : 'note',
    sharedBy: label || 'anonymous',
    sharedAt: Date.now(),
    payload: note,
  };
}

export function buildIOCReportEnvelope(note: Note, label: string): SharedItemEnvelope {
  return {
    version: 1,
    type: 'ioc-report',
    sharedBy: label || 'anonymous',
    sharedAt: Date.now(),
    payload: note, // note.iocAnalysis is included as part of the Note object
  };
}

export function buildFullBackupEnvelope(exportData: ExportData, label: string): SharedItemEnvelope {
  return {
    version: 1,
    type: 'full-backup',
    sharedBy: label || 'anonymous',
    sharedAt: Date.now(),
    payload: exportData,
  };
}

// ---- Object Key Convention ----

function sanitizeLabel(label: string): string {
  return (label || 'default').replace(/[^a-zA-Z0-9_-]/g, '_').substring(0, 50);
}

export function buildObjectKey(type: SharedItemEnvelope['type'], id: string, label: string): string {
  const timestamp = Date.now();
  const safeLabel = sanitizeLabel(label);
  const safeId = id.replace(/[^a-zA-Z0-9_-]/g, '_');

  switch (type) {
    case 'full-backup':
      return `threatcaddy/backups/${safeLabel}-${timestamp}.json`;
    case 'note':
      return `threatcaddy/shared/notes/${safeId}-${timestamp}.json`;
    case 'clip':
      return `threatcaddy/shared/clips/${safeId}-${timestamp}.json`;
    case 'ioc-report':
      return `threatcaddy/shared/ioc-reports/${safeId}-${timestamp}.json`;
  }
}

// ---- Test PAR Connectivity ----

export async function testPAR(parUrl: string): Promise<{ ok: boolean; error?: string }> {
  const validation = validatePAR(parUrl);
  if (!validation.valid) {
    return { ok: false, error: validation.error };
  }

  const testKey = 'threatcaddy/.connectivity-test';
  const result = await ociPut(parUrl, testKey, JSON.stringify({ test: true, at: Date.now() }));
  return result;
}
