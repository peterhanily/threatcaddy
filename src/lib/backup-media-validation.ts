/** Validate embedded media without rewriting bytes or fetching remote resources. */
import type { BackupTable } from './backup-tables';

const RASTER_MIME_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/gif', 'image/bmp', 'image/avif']);
// Excalidraw renders these embedded images via HTMLImageElement/canvas, not
// by inserting their markup into the app DOM. Preserve its supported SVG and
// icon/JFIF files; this validation is not a general-purpose SVG sanitizer.
const WHITEBOARD_MIME_TYPES = new Set([...RASTER_MIME_TYPES, 'image/svg+xml', 'image/x-icon', 'image/jfif']);
const MAX_EVIDENCE_IMAGE_CHARS = 4_250_000;
const MAX_WHITEBOARD_FILES_BYTES = 8 * 1024 * 1024;
const MAX_BACKUP_BYTES = 50 * 1024 * 1024;
function invalid(field: string): never { throw new Error(`Invalid backup media ${field}; nothing was imported.`); }
function object(value: unknown): value is Record<string, unknown> { return !!value && typeof value === 'object' && !Array.isArray(value); }
function rasterMime(value: unknown, field: string): string {
  if (typeof value !== 'string' || !RASTER_MIME_TYPES.has(value.toLowerCase().trim())) invalid(field);
  return (value as string).toLowerCase().trim();
}
function base64(value: unknown, field: string, max: number): void {
  if (typeof value !== 'string' || !value || value.length > max || value.length % 4 === 1
    || !/^[A-Za-z0-9+/]+={0,2}$/.test(value)) invalid(field);
  // Accept historical unpadded base64, but not padding in an incomplete group.
  if ((value as string).includes('=') && (value as string).length % 4 !== 0) invalid(field);
}

export function validateBackupURL(url: string): void {
  try {
    const parsed = new URL(url);
    if (parsed.protocol === 'http:' || parsed.protocol === 'https:') return;
  } catch { /* Fall through to the same non-sensitive validation error. */ }
  throw new Error('Backup quick links require valid HTTP(S) URLs; nothing was imported.');
}

export function validateBackupMedia(name: BackupTable, row: Record<string, unknown>): void {
  if (name === 'evidenceItems' && (row.imageData !== undefined || row.imageDataMimeType !== undefined)) {
    rasterMime(row.imageDataMimeType, 'evidence image MIME type');
    // Metadata-only evidence can retain its image MIME without stored pixels.
    if (row.imageData !== undefined) base64(row.imageData, 'evidence image data', MAX_EVIDENCE_IMAGE_CHARS);
  }
  if (name === 'chatThreads' && Array.isArray(row.messages)) {
    for (const message of row.messages) {
      if (!object(message) || !Array.isArray(message.attachments)) continue;
      for (const attachment of message.attachments) {
        if (!object(attachment) || attachment.type !== 'image') invalid('chat attachment');
        // The chat picker accepts image/* and renders attachments in <img>.
        // Preserve formats such as SVG/HEIC instead of making an existing
        // conversation impossible to back up; reject non-image MIME values.
        if (typeof attachment.mimeType !== 'string' || !/^image\/[a-z0-9.+-]+$/i.test(attachment.mimeType)) invalid('chat image MIME type');
        base64(attachment.data, 'chat image data', MAX_BACKUP_BYTES);
      }
    }
  }
  if (name === 'whiteboards' && row.files !== undefined) {
    if (typeof row.files !== 'string' || new TextEncoder().encode(row.files).byteLength > MAX_WHITEBOARD_FILES_BYTES) invalid('whiteboard files');
    let files: unknown;
    try { files = JSON.parse(row.files as string); } catch { invalid('whiteboard files'); }
    if (!object(files)) invalid('whiteboard files');
    for (const [id, value] of Object.entries(files as Record<string, unknown>)) {
      if (!object(value) || value.id !== id || !id.trim()) invalid('whiteboard file identity');
      if (Object.keys(value).some(key => !['id', 'mimeType', 'dataURL', 'created', 'lastRetrieved', 'version'].includes(key))) invalid('whiteboard file fields');
      for (const field of ['created', 'lastRetrieved', 'version']) {
        if (value[field] !== undefined && (typeof value[field] !== 'number' || !Number.isFinite(value[field]))) invalid(`whiteboard ${field}`);
      }
      if (typeof value.mimeType !== 'string' || !WHITEBOARD_MIME_TYPES.has(value.mimeType.toLowerCase().trim())) invalid('whiteboard image MIME type');
      const mime = (value.mimeType as string).toLowerCase().trim();
      if (typeof value.dataURL !== 'string') invalid('whiteboard image data');
      const comma = (value.dataURL as string).indexOf(',');
      if ((value.dataURL as string).slice(0, comma).toLowerCase() !== `data:${mime};base64`) invalid('whiteboard image data');
      base64((value.dataURL as string).slice(comma + 1), 'whiteboard image data', MAX_WHITEBOARD_FILES_BYTES);
    }
  }
}
