import type { BackupDestination, Note, SharedItemEnvelope, ExportData } from '../types';
import { CLOUD_PROVIDERS } from './cloud-providers';

const MAX_UPLOAD_SIZE = 50 * 1024 * 1024; // 50 MB

// ---- Envelope Helpers (provider-agnostic) ----

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

export interface DestinationPutResult {
  destinationId: string;
  label: string;
  ok: boolean;
  status: number;
  error?: string;
}

// ---- Single-destination PUT ----

export async function cloudPut(
  destination: BackupDestination,
  objectPath: string,
  data: string,
  contentType = 'application/json',
): Promise<DestinationPutResult> {
  const provider = CLOUD_PROVIDERS[destination.provider];
  if (!provider) {
    return { destinationId: destination.id, label: destination.label, ok: false, status: 0, error: `Unknown provider: ${destination.provider}` };
  }

  const validation = provider.validateUrl(destination.url);
  if (!validation.valid) {
    return { destinationId: destination.id, label: destination.label, ok: false, status: 0, error: validation.error };
  }

  const bodyBytes = new TextEncoder().encode(data).length;
  if (bodyBytes > MAX_UPLOAD_SIZE) {
    return {
      destinationId: destination.id,
      label: destination.label,
      ok: false,
      status: 0,
      error: `Upload too large (${Math.round(bodyBytes / 1024 / 1024)} MB, max ${MAX_UPLOAD_SIZE / 1024 / 1024} MB)`,
    };
  }

  const url = provider.buildObjectUrl(destination.url, objectPath);
  const headers: Record<string, string> = {
    'Content-Type': contentType,
    ...provider.extraHeaders(),
  };

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 60_000);
    const resp = await fetch(url, { method: 'PUT', body: data, headers, signal: controller.signal });
    clearTimeout(timer);
    if (!resp.ok) {
      return { destinationId: destination.id, label: destination.label, ok: false, status: resp.status, error: `HTTP ${resp.status}: ${resp.statusText}` };
    }
    return { destinationId: destination.id, label: destination.label, ok: true, status: resp.status };
  } catch (err) {
    return {
      destinationId: destination.id,
      label: destination.label,
      ok: false,
      status: 0,
      error: err instanceof Error ? err.message : 'Network error',
    };
  }
}

// ---- Multi-destination PUT ----

export async function multiCloudPut(
  destinations: BackupDestination[],
  objectPath: string,
  data: string,
  contentType = 'application/json',
  onProgress?: (message: string) => void,
): Promise<DestinationPutResult[]> {
  const enabled = destinations.filter((d) => d.enabled);
  if (enabled.length === 0) return [];

  onProgress?.(`Uploading to ${enabled.length} destination(s)...`);

  const settled = await Promise.allSettled(
    enabled.map(async (dest, idx) => {
      const result = await cloudPut(dest, objectPath, data, contentType);
      onProgress?.(`Uploaded to ${dest.label} (${idx + 1}/${enabled.length})`);
      return result;
    }),
  );

  return settled.map((s) =>
    s.status === 'fulfilled'
      ? s.value
      : { destinationId: 'unknown', label: 'unknown', ok: false, status: 0, error: s.reason?.message || 'Unknown error' },
  );
}

// ---- Test connectivity ----

export async function testDestination(
  destination: BackupDestination,
): Promise<{ ok: boolean; error?: string }> {
  const provider = CLOUD_PROVIDERS[destination.provider];
  if (!provider) return { ok: false, error: `Unknown provider: ${destination.provider}` };

  const validation = provider.validateUrl(destination.url);
  if (!validation.valid) return { ok: false, error: validation.error };

  const testKey = 'threatcaddy/.connectivity-test';
  const result = await cloudPut(destination, testKey, JSON.stringify({ test: true, at: Date.now() }));
  return { ok: result.ok, error: result.error };
}
