import { Hono } from 'hono';
import { eq } from 'drizzle-orm';
import { nanoid } from 'nanoid';
import { requireAuth, requireRole } from '../middleware/auth.js';
import { checkInvestigationAccess } from '../middleware/access.js';
import { db } from '../db/index.js';
import { files } from '../db/schema.js';
import type { AuthUser } from '../types.js';
import { mkdir, writeFile, readFile, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { logger } from '../lib/logger.js';

const STORAGE_PATH = process.env.FILE_STORAGE_PATH || '/data/files';
const MAX_FILE_SIZE = 50 * 1024 * 1024; // 50MB

// MIME types safe to serve inline (no XSS risk)
const SAFE_INLINE_MIME = /^(image\/(?!svg)[\w+-]+|video\/[\w+-]+|audio\/[\w+-]+|application\/pdf)$/;

function sanitizeFilename(name: string): string {
  // eslint-disable-next-line no-control-regex -- intentional: strip control chars for Content-Disposition safety
  return name.replace(/["\\\r\n\x00-\x1f]/g, '_');
}

const app = new Hono<{ Variables: { user: AuthUser } }>();

app.use('*', requireAuth);

// POST /api/files/upload — multipart file upload
app.post('/upload', requireRole('admin', 'analyst'), async (c) => {
  const user = c.get('user');
  const body = await c.req.parseBody();
  const file = body['file'];

  if (!file || typeof file === 'string') {
    return c.json({ error: 'No file provided' }, 400);
  }

  const blob = file as File;
  if (blob.size > MAX_FILE_SIZE) {
    return c.json({ error: 'File too large (max 50MB)' }, 413);
  }

  const id = nanoid();
  const ext = blob.name.split('.').pop() || 'bin';
  const storageName = `${id}.${ext}`;
  const storagePath = join(STORAGE_PATH, storageName);

  // Ensure storage directory exists
  await mkdir(STORAGE_PATH, { recursive: true });

  const buffer = Buffer.from(await blob.arrayBuffer());
  await writeFile(storagePath, buffer);

  // Generate thumbnail for images
  let thumbnailPath: string | null = null;
  if (blob.type.startsWith('image/') && blob.type !== 'image/svg+xml') {
    try {
      const sharp = (await import('sharp')).default;
      const thumbName = `${id}_thumb.webp`;
      thumbnailPath = join(STORAGE_PATH, thumbName);
      await sharp(buffer).resize(400, 400, { fit: 'inside' }).webp({ quality: 80 }).toFile(thumbnailPath);
      thumbnailPath = thumbName;
    } catch (err) {
      logger.error('Thumbnail generation failed', { error: String(err) });
      thumbnailPath = null;
    }
  }

  const folderId = (body['folderId'] as string) || null;

  await db.insert(files).values({
    id,
    uploadedBy: user.id,
    filename: blob.name,
    mimeType: blob.type,
    sizeBytes: blob.size,
    storagePath: storageName,
    thumbnailPath,
    folderId,
  });

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
    return c.json({ error: 'File not found' }, 404);
  }

  const file = result[0];

  // Check folder access if file belongs to a folder
  if (file.folderId && user.role !== 'admin') {
    const hasAccess = await checkInvestigationAccess(user.id, file.folderId, 'viewer');
    if (!hasAccess) {
      return c.json({ error: 'No access to this file' }, 403);
    }
  }

  const filePath = join(STORAGE_PATH, file.storagePath);

  try {
    const data = await readFile(filePath);
    const fileStat = await stat(filePath);
    const safeName = sanitizeFilename(file.filename);
    const disposition = SAFE_INLINE_MIME.test(file.mimeType) ? 'inline' : 'attachment';

    return new Response(data, {
      headers: {
        'Content-Type': file.mimeType,
        'Content-Length': fileStat.size.toString(),
        'Content-Disposition': `${disposition}; filename="${safeName}"`,
        'Cache-Control': 'public, max-age=31536000, immutable',
        'X-Content-Type-Options': 'nosniff',
      },
    });
  } catch {
    return c.json({ error: 'File not found on disk' }, 404);
  }
});

// GET /api/files/:id/thumbnail — serve thumbnail
app.get('/:id/thumbnail', async (c) => {
  const user = c.get('user');
  const fileId = c.req.param('id');

  const result = await db.select().from(files).where(eq(files.id, fileId)).limit(1);
  if (result.length === 0 || !result[0].thumbnailPath) {
    return c.json({ error: 'Thumbnail not found' }, 404);
  }

  const file = result[0];

  // Check folder access if file belongs to a folder
  if (file.folderId && user.role !== 'admin') {
    const hasAccess = await checkInvestigationAccess(user.id, file.folderId, 'viewer');
    if (!hasAccess) {
      return c.json({ error: 'No access to this file' }, 403);
    }
  }

  const thumbPath = join(STORAGE_PATH, file.thumbnailPath!);

  try {
    const data = await readFile(thumbPath);
    return new Response(data, {
      headers: {
        'Content-Type': 'image/webp',
        'Cache-Control': 'public, max-age=31536000, immutable',
        'X-Content-Type-Options': 'nosniff',
      },
    });
  } catch {
    return c.json({ error: 'Thumbnail not found on disk' }, 404);
  }
});

export default app;
