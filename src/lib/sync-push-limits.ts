/**
 * The team server validates a whole upload request at once, and older servers
 * refuse every change in it when one change breaks a limit. These checks copy
 * the server's limits (server/src/services/sync-service.ts stripServerFields,
 * server/src/lib/sync-data-budget.ts), so such a change stays queued on this
 * device and the others still upload.
 */
import { sanitizeSyncEntity } from './sync-sanitize';

const SERVER_MANAGED_FIELDS = new Set(['id', 'createdBy', 'updatedBy', 'version', 'createdAt', 'updatedAt', 'deletedAt', 'localOnly']);
const TIMESTAMP_COLUMNS = new Set(['trashedAt', 'completedAt', 'closedAt', 'timestamp', 'timestampEnd']);
const MAX_STRING_LENGTH = 500_000;
const MAX_ARRAY_LENGTH = 5_000;
const MAX_OBJECT_FIELDS = 200;
const MAX_FIELD_DEPTH = 5;
const MAX_DATA_DEPTH = 8;
const MAX_FIELD_NAME = 128;
/** Inline assets are checked by UTF-8 bytes instead of the value limits. */
const ASSET_BYTES: Readonly<Record<string, Readonly<Record<string, number>>>> = { whiteboards: { files: 8 * 1024 * 1024 }, evidenceItems: { imageData: 4_250_000 } };
/** Evidence preview types the server stores (EVIDENCE_RASTER_MIME_TYPES). This client also shows BMP and AVIF. */
const EVIDENCE_PREVIEW_MIME_TYPES = new Set(['image/png', 'image/jpeg', 'image/gif', 'image/webp']);
/** Values the server visits per request before refusing it. */
export const MAX_SYNC_REQUEST_NODES = 100_000;

export type OutgoingRefusal = 'unreadable' | 'limits' | 'previewType';

/** Mirrors the server's per-field validateValue. */
function withinFieldLimits(value: unknown, depth = 0): boolean {
  if (value === null || value === undefined || typeof value === 'boolean' || typeof value === 'number') return true;
  if (typeof value === 'string') return value.length <= MAX_STRING_LENGTH;
  if (typeof value !== 'object' || depth > MAX_FIELD_DEPTH) return false;
  if (Array.isArray(value)) return value.length <= MAX_ARRAY_LENGTH && value.every(item => withinFieldLimits(item, depth + 1));
  const entries = Object.entries(value);
  return entries.length <= MAX_OBJECT_FIELDS && entries.every(([, item]) => withinFieldLimits(item, depth + 1));
}

/** The server parses timestamp columns with new Date(); JSON sends a non-finite number or invalid Date as null. */
function validTimestamp(value: unknown): boolean {
  if (value === null || value === undefined || value instanceof Date || (typeof value === 'number' && !Number.isFinite(value))) return true;
  return (typeof value === 'number' || typeof value === 'string') && Number.isFinite(new Date(value).getTime());
}

/** Values the server's structure budget visits for one change's data, or Infinity when a bound is exceeded. */
export function syncDataNodes(data: unknown): number {
  if (data === undefined) return 0;
  let count = 0;
  const visit = (value: unknown, depth: number): boolean => {
    count++;
    if (depth > MAX_DATA_DEPTH) return false;
    if (value === null || typeof value !== 'object') return true;
    if (Array.isArray(value)) return value.length <= MAX_ARRAY_LENGTH && value.every(item => visit(item, depth + 1));
    let fields = 0;
    for (const key in value) {
      if (!Object.hasOwn(value, key)) continue;
      if (++fields > MAX_OBJECT_FIELDS || (depth === 0 && key.length > MAX_FIELD_NAME)) return false;
      if (!visit((value as Record<string, unknown>)[key], depth + 1)) return false;
    }
    return true;
  };
  return visit(data, 0) ? count : Infinity;
}

/**
 * Why an outgoing put must stay on this device, or null when it can upload.
 * 'unreadable': other clients' sync sanitizer would refuse the row, so it would
 * stop their sync. 'limits': the server would refuse the request.
 * 'previewType': the server refuses the evidence preview's image type.
 */
export function outgoingRefusal(table: string, entityId: string, data: Record<string, unknown> | undefined): OutgoingRefusal | null {
  if (!data) return null;
  for (const [key, value] of Object.entries(data)) {
    if (SERVER_MANAGED_FIELDS.has(key)) continue;
    const assetBytes = ASSET_BYTES[table]?.[key];
    if (assetBytes && typeof value === 'string') {
      if (new TextEncoder().encode(value).byteLength > assetBytes || (key === 'imageData' && value && !/^[A-Za-z0-9+/]+={0,2}$/.test(value))) return 'limits';
      continue; // The sanitizer below checks the whiteboard files JSON shape.
    }
    if (!withinFieldLimits(value) || (TIMESTAMP_COLUMNS.has(key) && !validTimestamp(value))) return 'limits';
  }
  const previewMime = table === 'evidenceItems' ? data.imageDataMimeType : undefined;
  if (previewMime != null && !(typeof previewMime === 'string' && EVIDENCE_PREVIEW_MIME_TYPES.has(previewMime.toLowerCase().trim()))) return 'previewType';
  try {
    if (!sanitizeSyncEntity(table, { ...data, id: entityId })) return 'unreadable';
  } catch {
    return 'unreadable';
  }
  return null;
}
