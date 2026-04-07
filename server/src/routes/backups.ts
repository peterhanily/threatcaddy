import { Hono } from 'hono';
import { eq, and, desc } from 'drizzle-orm';
import { nanoid } from 'nanoid';
import { requireAuth } from '../middleware/auth.js';
import { db } from '../db/index.js';
import { backups } from '../db/schema.js';
import type { AuthUser } from '../types.js';
import { ErrorCodes } from '../types/error-codes.js';
import { mkdir, writeFile, readFile, unlink } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { logger } from '../lib/logger.js';

const STORAGE_PATH = process.env.FILE_STORAGE_PATH || '/data/files';
const BACKUPS_DIR = 'backups';
const MAX_BACKUPS_PER_USER = 50;

const app = new Hono<{ Variables: { user: AuthUser } }>();

app.use('*', requireAuth);

// POST /api/backups — upload encrypted backup (multipart: metadata JSON + blob file)
app.post('/', async (c) => {
  const user = c.get('user');

  // Check backup count limit
  const existing = await db.select({ id: backups.id })
    .from(backups)
    .where(eq(backups.userId, user.id));
  if (existing.length >= MAX_BACKUPS_PER_USER) {
    return c.json({ error: `Maximum ${MAX_BACKUPS_PER_USER} backups reached. Delete old backups first.`, code: ErrorCodes.MAX_BACKUPS_REACHED }, 400);
  }

  const body = await c.req.parseBody();
  const metadataRaw = body['metadata'];
  const blob = body['blob'];

  if (!metadataRaw || typeof metadataRaw !== 'string') {
    return c.json({ error: 'Missing metadata field', code: ErrorCodes.MISSING_METADATA }, 400);
  }
  if (!blob || typeof blob === 'string') {
    return c.json({ error: 'Missing blob file', code: ErrorCodes.MISSING_BLOB }, 400);
  }

  let metadata: {
    name?: string;
    type?: string;
    scope?: string;
    scopeId?: string;
    entityCount?: number;
    parentBackupId?: string;
  };
  try {
    metadata = JSON.parse(metadataRaw);
  } catch {
    return c.json({ error: 'Invalid metadata JSON', code: ErrorCodes.INVALID_METADATA }, 400);
  }

  const name = typeof metadata.name === 'string' ? metadata.name.slice(0, 200) : '';
  if (!name) {
    return c.json({ error: 'Backup name is required', code: ErrorCodes.BACKUP_NAME_REQUIRED }, 400);
  }

  const type = metadata.type === 'differential' ? 'differential' : 'full';
  const scope = ['all', 'investigation', 'entity'].includes(metadata.scope ?? '')
    ? (metadata.scope as 'all' | 'investigation' | 'entity')
    : 'all';
  const scopeId = typeof metadata.scopeId === 'string' ? metadata.scopeId.slice(0, 200) : null;
  const entityCount = typeof metadata.entityCount === 'number' ? metadata.entityCount : 0;
  const parentBackupId = typeof metadata.parentBackupId === 'string' ? metadata.parentBackupId : null;

  const blobFile = blob as File;
  const id = nanoid();
  const storageName = `${id}.enc`;
  const backupsDir = join(STORAGE_PATH, BACKUPS_DIR);
  const storagePath = join(backupsDir, storageName);

  await mkdir(backupsDir, { recursive: true });

  const buffer = Buffer.from(await blobFile.arrayBuffer());
  await writeFile(storagePath, buffer);

  const record = {
    id,
    userId: user.id,
    name,
    type: type as 'full' | 'differential',
    scope: scope as 'all' | 'investigation' | 'entity',
    scopeId,
    entityCount,
    sizeBytes: buffer.length,
    storagePath: `${BACKUPS_DIR}/${storageName}`,
    parentBackupId,
  };

  await db.insert(backups).values(record);

  logger.info('Backup created', { backupId: id, userId: user.id, type, scope, size: buffer.length });

  return c.json({
    id,
    name,
    type,
    scope,
    scopeId,
    entityCount,
    sizeBytes: buffer.length,
    parentBackupId,
    createdAt: new Date().toISOString(),
  }, 201);
});

// GET /api/backups — list user's own backups
app.get('/', async (c) => {
  const user = c.get('user');

  const rows = await db.select({
    id: backups.id,
    name: backups.name,
    type: backups.type,
    scope: backups.scope,
    scopeId: backups.scopeId,
    entityCount: backups.entityCount,
    sizeBytes: backups.sizeBytes,
    parentBackupId: backups.parentBackupId,
    createdAt: backups.createdAt,
  })
    .from(backups)
    .where(eq(backups.userId, user.id))
    .orderBy(desc(backups.createdAt));

  return c.json({ backups: rows });
});

// GET /api/backups/:id — download encrypted backup blob
app.get('/:id', async (c) => {
  const user = c.get('user');
  const backupId = c.req.param('id');

  const result = await db.select()
    .from(backups)
    .where(and(eq(backups.id, backupId), eq(backups.userId, user.id)))
    .limit(1);

  if (result.length === 0) {
    return c.json({ error: 'Backup not found', code: ErrorCodes.BACKUP_NOT_FOUND }, 404);
  }

  const backup = result[0];
  const filePath = join(STORAGE_PATH, backup.storagePath);

  // Path traversal protection
  const resolvedPath = resolve(filePath);
  const basePath = resolve(STORAGE_PATH);
  if (!resolvedPath.startsWith(basePath + '/') && resolvedPath !== basePath) {
    return c.json({ error: 'Invalid backup path', code: ErrorCodes.INVALID_BACKUP_PATH }, 403);
  }

  try {
    const data = await readFile(filePath);
    return new Response(data, {
      headers: {
        'Content-Type': 'application/octet-stream',
        'Content-Length': data.length.toString(),
        'Content-Disposition': `attachment; filename="${backup.id}.enc"`,
        'X-Content-Type-Options': 'nosniff',
      },
    });
  } catch {
    return c.json({ error: 'Backup file not found on disk', code: ErrorCodes.BACKUP_FILE_NOT_FOUND }, 404);
  }
});

// DELETE /api/backups/:id — delete backup + disk file
app.delete('/:id', async (c) => {
  const user = c.get('user');
  const backupId = c.req.param('id');

  const result = await db.select()
    .from(backups)
    .where(and(eq(backups.id, backupId), eq(backups.userId, user.id)))
    .limit(1);

  if (result.length === 0) {
    return c.json({ error: 'Backup not found', code: ErrorCodes.BACKUP_NOT_FOUND }, 404);
  }

  const backup = result[0];
  const filePath = join(STORAGE_PATH, backup.storagePath);

  // Path traversal protection
  const resolvedDeletePath = resolve(filePath);
  const deleteBasePath = resolve(STORAGE_PATH);
  if (!resolvedDeletePath.startsWith(deleteBasePath + '/') && resolvedDeletePath !== deleteBasePath) {
    return c.json({ error: 'Invalid backup path', code: ErrorCodes.INVALID_BACKUP_PATH }, 403);
  }

  // Delete from disk
  try {
    await unlink(filePath);
  } catch {
    logger.warn('Backup file not found on disk during delete', { backupId, path: filePath });
  }

  // Delete from DB
  await db.delete(backups).where(eq(backups.id, backupId));

  logger.info('Backup deleted', { backupId, userId: user.id });

  return c.json({ ok: true });
});

export default app;
