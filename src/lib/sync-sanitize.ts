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
  // Revisions belong to _syncMeta, where the engine records them separately.
  // Transport metadata is not part of the portable entity/backup schema.
  return sanitizer(normalizeTimestamps(data));
}

/**
 * Client fields the team server has no column for (server/src/db/schema.ts).
 * The server's change log never carries them, so a pulled or conflict-accepted
 * row must keep the local value instead of erasing it. If the server later gains
 * a column for one of them, it must be nullable with no default, and clients must
 * upload their local values before null stops meaning "no value".
 */
export const SERVER_UNREPRESENTED_FIELDS: Readonly<Record<string, readonly string[]>> = {
  notes: ['parentNoteId', 'isFolder', 'reviewRequired'],
  tasks: ['checklist', 'rejectionCount', 'rejectionHistory', 'escalated'],
  folders: ['playbookExecution', 'noteTemplateIds', 'agentEnabled', 'agentPolicy', 'agentStatus', 'agentThreadId', 'agentLastRunAt'],
  standaloneIOCs: ['firstSeen', 'lastSeen', 'linkedEvidenceIds'],
  chatThreads: ['mode', 'source', 'contextSummary', 'parentThreadId', 'isFolder'],
};

/** Per-device agent runtime state: never taken from a server change. */
const DEVICE_LOCAL_FIELDS: Readonly<Record<string, readonly string[]>> = {
  folders: ['agentEnabled', 'agentPolicy', 'agentStatus', 'agentThreadId', 'agentLastRunAt'],
};

/** Parent pointers only make sense inside one investigation. */
const PARENT_FIELDS: Readonly<Record<string, string>> = { notes: 'parentNoteId', chatThreads: 'parentThreadId' };

/**
 * Chat message details that stay on this device (and in its backups). Uploading them
 * would make every push of a thread resend its whole tool and image history until it
 * exceeds the push size limit, so pushes omit them and pulls restore them by message id.
 */
const DEVICE_LOCAL_MESSAGE_FIELDS = ['toolCalls', 'attachments', 'agentCycleSummary'];

const isRecord = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);

/** The data a push uploads for a row: chat message details stay on this device. */
export function outgoingSyncData(tableName: string, data: Record<string, unknown> | undefined): Record<string, unknown> | undefined {
  if (tableName !== 'chatThreads' || !data || !Array.isArray(data.messages)) return data;
  return {
    ...data,
    messages: data.messages.map(message => {
      if (!isRecord(message)) return message;
      const copy = { ...message };
      for (const field of DEVICE_LOCAL_MESSAGE_FIELDS) delete copy[field];
      return copy;
    }),
  };
}

/**
 * Whether a pulled or conflict-accepted row keeps this device's value for a field.
 * Clients never push explicit nulls, so an absent or null server value means the
 * server has no value for it; only a concrete server value replaces local data.
 */
export function keepsLocalValue(tableName: string, incoming: Record<string, unknown> | undefined, field: string): boolean {
  if (DEVICE_LOCAL_FIELDS[tableName]?.includes(field)) return true;
  return !!SERVER_UNREPRESENTED_FIELDS[tableName]?.includes(field) && incoming?.[field] == null;
}

/** Overlay this device's values for the fields the server cannot supply. */
export function preserveUnsyncedFields(
  tableName: string,
  incoming: Record<string, unknown>,
  record: Record<string, unknown>,
  local: Record<string, unknown> | undefined,
): Record<string, unknown> {
  const fields = new Set([...(SERVER_UNREPRESENTED_FIELDS[tableName] ?? []), ...(DEVICE_LOCAL_FIELDS[tableName] ?? [])]);
  const moved = incoming.folderId != null && local?.folderId !== incoming.folderId;
  for (const field of fields) {
    if (!keepsLocalValue(tableName, incoming, field)) continue;
    if (field === PARENT_FIELDS[tableName] && moved) continue;
    if (local?.[field] !== undefined) record[field] = local[field];
    else if (DEVICE_LOCAL_FIELDS[tableName]?.includes(field)) record[field] = undefined;
  }
  if (tableName === 'chatThreads' && Array.isArray(record.messages) && Array.isArray(local?.messages)) {
    const mine = new Map(local.messages.filter(isRecord).map(message => [message.id, message]));
    record.messages = record.messages.map(message => {
      const kept = isRecord(message) ? mine.get(message.id) : undefined;
      if (!kept || !isRecord(message)) return message;
      const merged = { ...message };
      for (const field of DEVICE_LOCAL_MESSAGE_FIELDS) if (merged[field] === undefined && kept[field] !== undefined) merged[field] = kept[field];
      return merged;
    });
  }
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
