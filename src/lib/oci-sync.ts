import type { Note, SharedItemEnvelope, SharedManifest, SharedManifestEntry, ExportData } from '../types';

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

export async function ociGet(
  readPAR: string,
  objectPath: string
): Promise<{ ok: boolean; data?: string; error?: string }> {
  const url = buildObjectUrl(readPAR, objectPath);
  try {
    const resp = await fetch(url);
    if (!resp.ok) {
      return { ok: false, error: `HTTP ${resp.status}: ${resp.statusText}` };
    }
    const data = await resp.text();
    return { ok: true, data };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'Network error' };
  }
}

export async function ociList(
  readPAR: string,
  prefix?: string
): Promise<{ ok: boolean; keys?: string[]; error?: string }> {
  // OCI PAR list: GET on the prefix returns XML with <Key> elements
  const url = prefix ? buildObjectUrl(readPAR, prefix) : readPAR;
  try {
    const resp = await fetch(url);
    if (!resp.ok) {
      return { ok: false, error: `HTTP ${resp.status}: ${resp.statusText}` };
    }
    const xml = await resp.text();
    const keys: string[] = [];
    const regex = /<Key>([^<]+)<\/Key>/g;
    let match;
    while ((match = regex.exec(xml)) !== null) {
      keys.push(match[1]);
    }
    return { ok: true, keys };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'Network error' };
  }
}

export async function ociHead(
  readPAR: string,
  objectPath: string
): Promise<{ ok: boolean; status: number; contentLength?: number; error?: string }> {
  const url = buildObjectUrl(readPAR, objectPath);
  try {
    const resp = await fetch(url, { method: 'HEAD' });
    const contentLength = resp.headers.get('content-length');
    return {
      ok: resp.ok,
      status: resp.status,
      contentLength: contentLength ? parseInt(contentLength, 10) : undefined,
    };
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
      return `browsernotes/backups/${safeLabel}-${timestamp}.json`;
    case 'note':
      return `browsernotes/shared/notes/${safeId}-${timestamp}.json`;
    case 'clip':
      return `browsernotes/shared/clips/${safeId}-${timestamp}.json`;
    case 'ioc-report':
      return `browsernotes/shared/ioc-reports/${safeId}-${timestamp}.json`;
  }
}

// ---- Manifest Management ----

export async function fetchManifest(readPAR: string): Promise<SharedManifest> {
  const result = await ociGet(readPAR, 'browsernotes/manifest.json');
  if (!result.ok || !result.data) {
    return { version: 1, updatedAt: Date.now(), items: [] };
  }
  try {
    const parsed = JSON.parse(result.data);
    if (parsed && parsed.version === 1 && Array.isArray(parsed.items)) {
      return parsed as SharedManifest;
    }
    return { version: 1, updatedAt: Date.now(), items: [] };
  } catch {
    return { version: 1, updatedAt: Date.now(), items: [] };
  }
}

export async function updateManifest(
  writePAR: string,
  readPAR: string,
  newEntry: SharedManifestEntry
): Promise<{ ok: boolean; error?: string }> {
  const manifest = await fetchManifest(readPAR);
  manifest.items.push(newEntry);
  manifest.updatedAt = Date.now();

  const data = JSON.stringify(manifest, null, 2);
  return ociPut(writePAR, 'browsernotes/manifest.json', data);
}

// ---- Test PAR Connectivity ----

export async function testPAR(parUrl: string, mode: 'read' | 'write'): Promise<{ ok: boolean; error?: string }> {
  const validation = validatePAR(parUrl);
  if (!validation.valid) {
    return { ok: false, error: validation.error };
  }

  if (mode === 'read') {
    // Try to HEAD a known path
    const result = await ociHead(parUrl, 'browsernotes/manifest.json');
    // 404 is OK for read (manifest may not exist yet), only network errors are failures
    if (result.status === 0 && result.error) {
      return { ok: false, error: result.error };
    }
    return { ok: true };
  } else {
    // For write, try a small test PUT
    const testKey = 'browsernotes/.connectivity-test';
    const result = await ociPut(parUrl, testKey, JSON.stringify({ test: true, at: Date.now() }));
    return result;
  }
}
