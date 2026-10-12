/** Versioned, bounded content contract shared with the browser extension. */
export const CLIP_PROTOCOL = 2 as const;
export const CLIP_LIMITS = Object.freeze({
  batchCount: 20,
  batchBytes: 8 * 1024 * 1024,
  clipBytes: 5 * 1024 * 1024,
  contentBytes: 4 * 1024 * 1024,
  titleBytes: 4 * 1024,
  sourceUrlBytes: 16 * 1024,
  folderLength: 256,
  classificationLength: 128,
  identifierLength: 128,
});

export type ClipEntityType = 'note' | 'task' | 'timeline-event';
export interface ClipContent {
  id: string;
  revision: number;
  title: string;
  content: string;
  sourceUrl: string;
  sourceTitle: string;
  entityType: ClipEntityType;
  folderName: string;
  clsLevel: string;
  createdAt: number;
}
export interface ClipRevision extends ClipContent { fingerprint: string }

/** Metadata only: do not add captured content, URLs, titles, or credentials. */
export interface ClipReceipt {
  key: string;
  sourceId: string;
  clipId: string;
  revision: number;
  fingerprint: string;
  entityType: ClipEntityType;
  entityId: string;
  folderId: string;
  committedAt: number;
}
export interface ClipImportResult {
  id: string;
  revision: number;
  fingerprint: string;
  status: 'imported' | 'duplicate' | 'failed';
  entityType?: ClipEntityType;
  entityId?: string;
  folderId?: string;
  error?: string;
}

const encoder = new TextEncoder();
const CONTENT_KEYS = ['id', 'revision', 'title', 'content', 'sourceUrl', 'sourceTitle', 'entityType', 'folderName', 'clsLevel', 'createdAt'];
function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Clip must be an object.');
  return value as Record<string, unknown>;
}
export function validateClipIdentifier(value: unknown, label: string): asserts value is string {
  if (typeof value !== 'string' || !value.trim() || value.length > CLIP_LIMITS.identifierLength) {
    throw new Error(`${label} must be a nonempty identifier of at most ${CLIP_LIMITS.identifierLength} characters.`);
  }
}
function text(value: unknown, label: string, maxBytes: number): asserts value is string {
  if (typeof value !== 'string' || value.length > maxBytes || encoder.encode(value).byteLength > maxBytes) {
    throw new Error(`${label} exceeds its text limit or is not text.`);
  }
}

/** Never coerce, trim, truncate or rely on the sender's object property order. */
export function serializeClipContent(clip: ClipContent): string {
  return JSON.stringify({ id: clip.id, revision: clip.revision, title: clip.title,
    content: clip.content, sourceUrl: clip.sourceUrl, sourceTitle: clip.sourceTitle,
    entityType: clip.entityType, folderName: clip.folderName, clsLevel: clip.clsLevel,
    createdAt: clip.createdAt });
}

export function validateClipContent(value: unknown, limits = CLIP_LIMITS): ClipContent {
  const row = record(value);
  if (Object.keys(row).some(key => !CONTENT_KEYS.includes(key) && key !== 'fingerprint')) throw new Error('Clip contains unsupported fields.');
  validateClipIdentifier(row.id, 'Clip ID');
  if (!Number.isSafeInteger(row.revision) || Number(row.revision) < 1) throw new Error('Clip revision must be a positive safe integer.');
  if (!Number.isSafeInteger(row.createdAt) || Number(row.createdAt) < 0 || Number(row.createdAt) > 8_640_000_000_000_000) throw new Error('Clip creation time is invalid.');
  text(row.title, 'Clip title', limits.titleBytes);
  text(row.content, 'Clip content', limits.contentBytes);
  text(row.sourceTitle, 'Clip source title', limits.titleBytes);
  text(row.sourceUrl, 'Clip source URL', limits.sourceUrlBytes);
  if (typeof row.folderName !== 'string' || row.folderName.length > limits.folderLength) throw new Error('Clip folder name exceeds its limit or is not text.');
  if (typeof row.clsLevel !== 'string' || row.clsLevel.length > limits.classificationLength) throw new Error('Clip classification exceeds its limit or is not text.');
  if (typeof row.entityType !== 'string' || !['note', 'task', 'timeline-event'].includes(row.entityType)) throw new Error('Clip entity type is unsupported.');
  const clip = row as unknown as ClipContent;
  if (encoder.encode(serializeClipContent(clip)).byteLength > limits.clipBytes) throw new Error('Clip exceeds the full-clip size limit.');
  // Copy scalar fields: callers cannot change content after validation/hash awaits.
  return JSON.parse(serializeClipContent(clip)) as ClipContent;
}

export async function fingerprintClip(clip: ClipContent): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', encoder.encode(serializeClipContent(clip)));
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
}

export async function createClipRevision(value: ClipContent): Promise<ClipRevision> {
  const clip = validateClipContent(value);
  return { ...clip, fingerprint: await fingerprintClip(clip) };
}

export async function validateClip(value: unknown): Promise<ClipRevision> {
  const clip = validateClipContent(value);
  const supplied = record(value).fingerprint;
  if (typeof supplied !== 'string' || !/^[a-f0-9]{64}$/.test(supplied)) throw new Error('Clip fingerprint is missing or invalid.');
  if (await fingerprintClip(clip) !== supplied) throw new Error('Clip content does not match its fingerprint. Retry the current saved revision.');
  return { ...clip, fingerprint: supplied };
}

/** Legacy messages cannot acknowledge extension delivery; this only gives retries a stable identity. */
export async function adaptLegacyClip(value: unknown): Promise<ClipRevision> {
  const row = record(value);
  const clip: ClipContent = {
    id: typeof row.id === 'string' && row.id.trim() ? row.id : 'legacy', revision: 1,
    title: typeof row.title === 'string' ? row.title : '',
    content: typeof row.content === 'string' ? row.content : '',
    sourceUrl: typeof row.sourceUrl === 'string' ? row.sourceUrl : '',
    sourceTitle: typeof row.sourceTitle === 'string' ? row.sourceTitle : '',
    entityType: row.entityType === undefined ? 'note' : row.entityType as ClipEntityType,
    folderName: typeof row.folderName === 'string' ? row.folderName : '',
    clsLevel: typeof row.clsLevel === 'string' ? row.clsLevel : '',
    createdAt: row.createdAt === undefined ? 0 : row.createdAt as number,
  };
  validateClipContent(clip);
  if (!(typeof row.id === 'string' && row.id.trim())) clip.id = `legacy-${await fingerprintClip(clip)}`;
  return createClipRevision(clip);
}

export function clipReceiptKey(sourceId: string, clip: Pick<ClipContent, 'id' | 'revision'>): string {
  return JSON.stringify([sourceId, clip.id, clip.revision]);
}

/** Safe correlation for a failed row; never reflect unbounded or nested input. */
export function failedClipResult(value: unknown, error: string): ClipImportResult {
  const row = value && typeof value === 'object' ? value as Record<string, unknown> : {};
  return { id: typeof row.id === 'string' && row.id.length <= CLIP_LIMITS.identifierLength ? row.id : '',
    revision: Number.isSafeInteger(row.revision) ? Number(row.revision) : 0,
    fingerprint: typeof row.fingerprint === 'string' && /^[a-f0-9]{64}$/.test(row.fingerprint) ? row.fingerprint : '',
    status: 'failed', error };
}
