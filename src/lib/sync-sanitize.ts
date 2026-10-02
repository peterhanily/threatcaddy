/**
 * Sanitize data received from the sync server before writing to IndexedDB.
 * Applies the same allowlisted field extractors used by the import path,
 * ensuring a malicious server or team member cannot inject unexpected fields.
 */
import {
  sanitizeNote,
  sanitizeTask,
  sanitizeFolder,
  sanitizeTag,
  sanitizeTimelineEvent,
  sanitizeTimeline,
  sanitizeWhiteboard,
  sanitizeStandaloneIOC,
  sanitizeChatThread,
  sanitizeEvidenceItem,
} from './export';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Sanitizer = (raw: unknown) => any;

const TABLE_SANITIZERS: Record<string, Sanitizer> = {
  notes: sanitizeNote,
  tasks: sanitizeTask,
  folders: sanitizeFolder,
  tags: sanitizeTag,
  timelineEvents: sanitizeTimelineEvent,
  timelines: sanitizeTimeline,
  whiteboards: sanitizeWhiteboard,
  standaloneIOCs: sanitizeStandaloneIOC,
  chatThreads: sanitizeChatThread,
  evidenceItems: sanitizeEvidenceItem,
};

/** Timestamp fields the server may send as ISO strings instead of ms. */
const TIMESTAMP_FIELDS = ['createdAt', 'updatedAt', 'trashedAt', 'completedAt', 'closedAt', 'timestamp', 'timestampEnd'];

/**
 * Convert ISO timestamp strings to milliseconds so the sanitizers' num()
 * helper (which only accepts typeof number) doesn't discard them.
 */
function normalizeTimestamps(data: Record<string, unknown>): Record<string, unknown> {
  const out = { ...data };
  for (const key of TIMESTAMP_FIELDS) {
    if (typeof out[key] === 'string') {
      const ms = new Date(out[key] as string).getTime();
      if (isFinite(ms)) out[key] = ms;
    }
  }
  // Handle nested messages in chatThreads
  if (Array.isArray(out.messages)) {
    out.messages = (out.messages as Record<string, unknown>[]).map((m) => {
      if (typeof m === 'object' && m && typeof m.createdAt === 'string') {
        const ms = new Date(m.createdAt as string).getTime();
        return isFinite(ms) ? { ...m, createdAt: ms } : m;
      }
      return m;
    });
  }
  return out;
}

/**
 * Sanitize a single entity received from the sync server.
 * Returns the sanitized data, or null if the data is invalid.
 * Unknown tables are never accepted from the network.
 */
export function sanitizeSyncEntity(
  tableName: string,
  data: Record<string, unknown>,
): Record<string, unknown> | null {
  const sanitizer = TABLE_SANITIZERS[tableName];
  if (!sanitizer) return null;
  const record = sanitizer(normalizeTimestamps(data));
  if (record && Number.isSafeInteger(data.version) && (data.version as number) > 0) record.version = data.version;
  return record;
}

/**
 * Sanitize an array of entities, filtering out any that fail validation.
 */
export function sanitizeSyncBatch(
  tableName: string,
  rows: Record<string, unknown>[],
): Record<string, unknown>[] {
  return rows.map((r) => sanitizeSyncEntity(tableName, r)).filter((r): r is Record<string, unknown> => r !== null);
}
