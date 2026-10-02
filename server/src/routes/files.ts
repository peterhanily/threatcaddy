import { Hono } from 'hono';
import { eq, and } from 'drizzle-orm';
import { nanoid } from 'nanoid';
import { requireAuth, requireRole } from '../middleware/auth.js';
import { checkInvestigationAccess } from '../middleware/access.js';
import { db } from '../db/index.js';
import { files } from '../db/schema.js';
import type { AuthUser } from '../types.js';
import { ErrorCodes } from '../types/error-codes.js';
import { mkdir, writeFile, stat, realpath, unlink } from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import { join, resolve } from 'node:path';
import { Readable } from 'node:stream';
import { logger } from '../lib/logger.js';
import { MAX_FILE_BYTES } from '../middleware/api-body-limit.js';
import { assertStorageCapacity, lockStorage, StorageQuotaError } from '../services/storage-policy.js';

const STORAGE_PATH = process.env.FILE_STORAGE_PATH || '/data/files';

// MIME types safe to serve inline (no XSS risk)
const SAFE_INLINE_MIME = /^(image\/(?!svg)[\w+-]+|video\/[\w+-]+|audio\/[\w+-]+|application\/pdf)$/;

// Allowed file extensions
const ALLOWED_EXTENSIONS = new Set([
  'jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp', 'ico', 'avif',
  'mp4', 'webm', 'ogg', 'mov', 'avi',
  'mp3', 'wav', 'flac', 'aac', 'm4a',
  'pdf', 'txt', 'csv', 'json', 'xml',
  'zip', 'gz', 'tar',
  'doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx',
  'bin',
]);

function sanitizeFilename(name: string): string {
  // eslint-disable-next-line no-control-regex -- intentional: strip control chars for Content-Disposition safety
  return name.replace(/["\\\r\n\x00-\x1f;/]/g, '_');
}

function detectMimeFromMagicBytes(buffer: Buffer): string | null {
  if (buffer.length < 12) return null;
  const b = buffer;
  // JPEG: FF D8 FF
  if (b[0] === 0xFF && b[1] === 0xD8 && b[2] === 0xFF) return 'image/jpeg';
  // PNG: 89 50 4E 47
  if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4E && b[3] === 0x47) return 'image/png';
  // GIF: GIF8
  if (b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x38) return 'image/gif';
  // WebP: RIFF....WEBP
  if (b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 &&
      b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50) return 'image/webp';
  // PDF: %PDF
  if (b[0] === 0x25 && b[1] === 0x50 && b[2] === 0x44 && b[3] === 0x46) return 'application/pdf';
  // SVG: XML-like with <svg (check up to 2048 bytes to catch SVGs with long XML prologues)
  if (b[0] === 0x3C || b[0] === 0xEF /* UTF-8 BOM */) {
    const head = buffer.subarray(0, Math.min(2048, buffer.length)).toString('utf8').toLowerCase();
    if (head.includes('<svg') || head.includes('<!doctype svg')) return 'image/svg+xml';
  }
  return null;
}

const app = new Hono<{ Variables: { user: AuthUser } }>();

app.use('*', requireAuth);

// POST /api/files/upload — multipart file upload
app.post('/upload', requireRole('admin', 'analyst'), async (c) => {
  const user = c.get('user');
  const body = await c.req.parseBody();
  const file = body['file'];

  if (!file || typeof file === 'string') {
    return c.json({ error: 'No file provided', code: ErrorCodes.NO_FILE_PROVIDED }, 400);
  }

  const blob = file as File;
  if (blob.size > MAX_FILE_BYTES) {
    return c.json({ error: 'File too large (max 50MB)', code: ErrorCodes.FILE_TOO_LARGE }, 413);
  }

  const id = nanoid();
  const ext = (blob.name.split('.').pop() || 'bin').toLowerCase();
  if (!ALLOWED_EXTENSIONS.has(ext)) {
    return c.json({ error: 'File type not allowed', code: ErrorCodes.FILE_TYPE_NOT_ALLOWED }, 400);
  }
  const storageName = `${id}.${ext}`;
  const storagePath = join(STORAGE_PATH, storageName);

  // Ensure storage directory exists
  await mkdir(STORAGE_PATH, { recursive: true });

  const buffer = Buffer.from(await blob.arrayBuffer());

  // Validate magic bytes for image types (primary inline XSS vector)
  const claimedMime = blob.type;
  if (claimedMime.startsWith('image/')) {
    const detected = detectMimeFromMagicBytes(buffer);
    if (detected === 'image/svg+xml') {
      return c.json({ error: 'SVG uploads are not allowed', code: ErrorCodes.SVG_NOT_ALLOWED }, 400);
    }
    if (detected && !detected.startsWith('image/')) {
      return c.json({ error: 'File content does not match claimed image type', code: ErrorCodes.FILE_CONTENT_MISMATCH }, 400);
    }
  }
  // Block SVG regardless of claimed type
  const detectedAny = detectMimeFromMagicBytes(buffer);
  if (detectedAny === 'image/svg+xml') {
    return c.json({ error: 'SVG uploads are not allowed', code: ErrorCodes.SVG_NOT_ALLOWED }, 400);
  }

  // Block MIME types that could contain active/executable content
  const DANGEROUS_MIMES = new Set([
    'text/html', 'application/javascript', 'text/javascript',
    'application/x-httpd-php', 'image/svg+xml', 'application/xhtml+xml',
  ]);
  if (DANGEROUS_MIMES.has(claimedMime)) {
    return c.json({ error: 'File MIME type not allowed (active content)', code: ErrorCodes.FILE_MIME_NOT_ALLOWED }, 400);
  }
  if (detectedAny && DANGEROUS_MIMES.has(detectedAny)) {
    return c.json({ error: 'Detected file content type not allowed (active content)', code: ErrorCodes.FILE_MIME_NOT_ALLOWED }, 400);
  }

  // Validate that detected MIME type is consistent with file extension
  if (detectedAny) {
    const extMimeMap: Record<string, string[]> = {
      jpg: ['image/jpeg'], jpeg: ['image/jpeg'],
      png: ['image/png'], gif: ['image/gif'],
      webp: ['image/webp'], pdf: ['application/pdf'],
    };
    const allowedMimes = extMimeMap[ext];
    if (allowedMimes && !allowedMimes.includes(detectedAny)) {
      return c.json({ error: `File extension .${ext} does not match detected content type (${detectedAny})`, code: ErrorCodes.FILE_CONTENT_MISMATCH }, 400);
    }
  }

  const folderId = (body['folderId'] as string) || null;

  // Verify the uploader has editor access to the target folder BEFORE writing to disk
  if (folderId) {
    const hasAccess = await checkInvestigationAccess(user.id, folderId, 'editor');
    if (!hasAccess) {
      return c.json({ error: 'No access to this investigation', code: ErrorCodes.NO_ACCESS }, 403);
    }
  }

  let thumbnailPath: string | null = null;
  const createdPaths: string[] = [];
  try {
    const denied = await db.transaction(async tx => {
      await lockStorage(tx);
      // A queued upload must not recreate a reference after investigation purge.
      if (folderId && !await checkInvestigationAccess(user.id, folderId, 'editor', tx)) {
        return c.json({ error: 'No access to this investigation', code: ErrorCodes.NO_ACCESS }, 403);
      }
      await assertStorageCapacity(tx, user.id, blob.size + (blob.type.startsWith('image/') ? 1024 * 1024 : 0), STORAGE_PATH);
      await writeFile(storagePath, buffer, { flag: 'wx' });
      createdPaths.push(storagePath);

      // Generate thumbnail for images
      if (blob.type.startsWith('image/') && blob.type !== 'image/svg+xml') {
        try {
          const sharp = (await import('sharp')).default;
          const thumbName = `${id}_thumb.webp`;
          thumbnailPath = join(STORAGE_PATH, thumbName);
          await sharp(buffer).resize(400, 400, { fit: 'inside' }).webp({ quality: 80 }).toFile(thumbnailPath);
          createdPaths.push(thumbnailPath);
          thumbnailPath = thumbName;
        } catch (err) {
          logger.error('Thumbnail generation failed', { error: String(err) });
          await unlink(join(STORAGE_PATH, `${id}_thumb.webp`)).catch(() => {});
          thumbnailPath = null;
        }
      }

      await tx.insert(files).values({
        id,
        uploadedBy: user.id,
        filename: blob.name,
        mimeType: blob.type,
        sizeBytes: blob.size,
        storagePath: storageName,
        thumbnailPath,
        folderId,
      });
    });
    if (denied) return denied;
  } catch (error) {
    // These are newly generated paths owned by this upload, never existing files.
    await Promise.all(createdPaths
      .map(path => unlink(path).catch(cleanupError => logger.error('Failed to clean up uncommitted upload', { path, error: String(cleanupError) }))));
    if (error instanceof StorageQuotaError) return c.json({ error: error.message, code: 'STORAGE_QUOTA_EXCEEDED' }, 507);
    throw error;
  }

  return c.json({
    id,
    url: `/api/files/${id}`,
    thumbnailUrl: thumbnailPath ? `/api/files/${id}/thumbnail` : null,
    mimeType: blob.type,
    size: blob.size,
    filename: blob.name,
  }, 201);
});

// GET /api/files/:id — serve file
app.get('/:id', async (c) => {
  const user = c.get('user');
  const fileId = c.req.param('id');

  const result = await db.select().from(files).where(eq(files.id, fileId)).limit(1);
  if (result.length === 0) {
    return c.json({ error: 'File not found', code: ErrorCodes.FILE_NOT_FOUND }, 404);
  }

  const file = result[0];

  // Check access: folder-scoped files require investigation membership,
  // unscoped files are restricted to the uploader
  if (file.folderId) {
    const hasAccess = await checkInvestigationAccess(user.id, file.folderId, 'viewer');
    if (!hasAccess) {
      return c.json({ error: 'No access to this file', code: ErrorCodes.NO_ACCESS }, 403);
    }
  } else if (file.uploadedBy !== user.id) {
    return c.json({ error: 'No access to this file', code: ErrorCodes.NO_ACCESS }, 403);
  }

  const filePath = join(STORAGE_PATH, file.storagePath);

  // Path traversal protection: resolve() normalizes ".." but doesn't follow symlinks.
  // Use realpath() to resolve symlinks and verify the true location is inside STORAGE_PATH.
  const basePath = resolve(STORAGE_PATH);
  let resolvedFilePath: string;
  try {
    resolvedFilePath = await realpath(filePath);
  } catch {
    return c.json({ error: 'File not found on disk', code: ErrorCodes.FILE_NOT_FOUND }, 404);
  }
  const resolvedBasePath = await realpath(basePath).catch(() => basePath);
  if (!resolvedFilePath.startsWith(resolvedBasePath + '/')) {
    logger.warn('Path traversal blocked', { fileId, storagePath: file.storagePath, resolved: resolvedFilePath });
    return c.json({ error: 'Invalid file path', code: ErrorCodes.INVALID_FILE_PATH }, 403);
  }

  try {
    const fileStat = await stat(resolvedFilePath);
    const safeName = sanitizeFilename(file.filename);
    const disposition = SAFE_INLINE_MIME.test(file.mimeType) ? 'inline' : 'attachment';

    logger.info('File download', { fileId, userId: user.id, filename: file.filename, folderId: file.folderId });

    const stream = createReadStream(resolvedFilePath);
    const webStream = Readable.toWeb(stream) as ReadableStream;

    return new Response(webStream, {
      headers: {
        'Content-Type': file.mimeType,
        'Content-Length': fileStat.size.toString(),
        'Content-Disposition': `${disposition}; filename="${safeName}"`,
        'Cache-Control': 'private, no-store',
        'X-Content-Type-Options': 'nosniff',
      },
    });
  } catch {
    return c.json({ error: 'File not found on disk', code: ErrorCodes.FILE_NOT_FOUND }, 404);
  }
});

// GET /api/files/:id/thumbnail — serve thumbnail
app.get('/:id/thumbnail', async (c) => {
  const user = c.get('user');
  const fileId = c.req.param('id');

  const result = await db.select().from(files).where(eq(files.id, fileId)).limit(1);
  if (result.length === 0 || !result[0].thumbnailPath) {
    return c.json({ error: 'Thumbnail not found', code: ErrorCodes.THUMBNAIL_NOT_FOUND }, 404);
  }

  const file = result[0];

  if (file.folderId) {
    const hasAccess = await checkInvestigationAccess(user.id, file.folderId, 'viewer');
    if (!hasAccess) {
      return c.json({ error: 'No access to this file', code: ErrorCodes.NO_ACCESS }, 403);
    }
  } else if (file.uploadedBy !== user.id) {
    return c.json({ error: 'No access to this file', code: ErrorCodes.NO_ACCESS }, 403);
  }

  const thumbPath = join(STORAGE_PATH, file.thumbnailPath!);

  // Path traversal protection (use realpath to follow symlinks)
  const thumbBasePath = resolve(STORAGE_PATH);
  let resolvedThumbPath: string;
  try {
    resolvedThumbPath = await realpath(thumbPath);
  } catch {
    return c.json({ error: 'Thumbnail not found', code: ErrorCodes.THUMBNAIL_NOT_FOUND }, 404);
  }
  const resolvedThumbBase = await realpath(thumbBasePath).catch(() => thumbBasePath);
  if (!resolvedThumbPath.startsWith(resolvedThumbBase + '/')) {
    return c.json({ error: 'Invalid file path', code: ErrorCodes.INVALID_FILE_PATH }, 403);
  }

  try {
    await stat(resolvedThumbPath);
    const stream = createReadStream(resolvedThumbPath);
    const webStream = Readable.toWeb(stream) as ReadableStream;

    return new Response(webStream, {
      headers: {
        'Content-Type': 'image/webp',
        'Cache-Control': 'private, no-store',
        'X-Content-Type-Options': 'nosniff',
      },
    });
  } catch {
    return c.json({ error: 'Thumbnail not found on disk', code: ErrorCodes.THUMBNAIL_NOT_FOUND }, 404);
  }
});

// Explicit owner-authorized removal releases quota; deleting a note alone does
// not imply permission to destroy shared evidence attachments.
app.delete('/:id', requireRole('admin', 'analyst'), async c => {
  const user = c.get('user');
  const id = c.req.param('id');
  const result = await db.transaction(async tx => {
    await lockStorage(tx);
    const [file] = await tx.select().from(files).where(eq(files.id, id)).limit(1);
    if (!file) return c.json({ error: 'File not found', code: ErrorCodes.FILE_NOT_FOUND }, 404);
    if (file.uploadedBy !== user.id || file.folderId && !await checkInvestigationAccess(user.id, file.folderId, 'editor', tx)) {
      return c.json({ error: 'Only the uploader with current investigation access may delete this file', code: ErrorCodes.NO_ACCESS }, 403);
    }
    const base = await realpath(STORAGE_PATH);
    const paths: string[] = [];
    for (const relative of [file.storagePath, file.thumbnailPath].filter((path): path is string => !!path)) {
      const candidate = resolve(base, relative);
      if (!candidate.startsWith(base + '/')) return c.json({ error: 'Invalid file path', code: ErrorCodes.INVALID_FILE_PATH }, 403);
      try {
        const actual = await realpath(candidate);
        if (!actual.startsWith(base + '/')) return c.json({ error: 'Invalid file path', code: ErrorCodes.INVALID_FILE_PATH }, 403);
        paths.push(actual);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      }
    }
    await tx.delete(files).where(and(eq(files.id, id), eq(files.uploadedBy, user.id)));
    return paths;
  });
  if (!Array.isArray(result)) return result;
  let cleanupPending = false;
  for (const path of result) {
    await unlink(path).catch(error => { cleanupPending = true; logger.warn('Removed file record has a recoverable orphan blob', { id, error: String(error) }); });
  }
  return c.json({ ok: true, cleanupPending });
});

export default app;
