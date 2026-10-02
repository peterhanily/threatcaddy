import { Hono } from 'hono';
import { eq, and, desc } from 'drizzle-orm';
import { nanoid } from 'nanoid';
import { requireAuth } from '../middleware/auth.js';
import { db } from '../db/index.js';
import { backups } from '../db/schema.js';
import type { AuthUser } from '../types.js';
import { ErrorCodes } from '../types/error-codes.js';
import { mkdir, writeFile, stat, realpath, unlink } from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import { Readable } from 'node:stream';
import { join, resolve } from 'node:path';
import { logger } from '../lib/logger.js';
import { MAX_BACKUP_BYTES } from '../middleware/api-body-limit.js';
import { assertStorageCapacity, lockStorage, StorageQuotaError } from '../services/storage-policy.js';

const STORAGE_PATH = process.env.FILE_STORAGE_PATH || '/data/files';
const BACKUPS_DIR = 'backups';
const MAX_BACKUPS_PER_USER = 50;

const app = new Hono<{ Variables: { user: AuthUser } }>();

app.use('*', requireAuth);

// POST /api/backups — upload encrypted backup (multipart: metadata JSON + blob file)
app.post('/', async (c) => {
  const user = c.get('user');
  const body = await c.req.parseBody();
  let createdPath: string | undefined;
  try {
    return await db.transaction(async tx => {
      // Serialize this user's count/parent checks with uploads and deletes.
      await lockStorage(tx);

      // Check backup count limit
      const existing = await tx.select({ id: backups.id })
        .from(backups)
        .where(eq(backups.userId, user.id));
      if (existing.length >= MAX_BACKUPS_PER_USER) {
        return c.json({ error: `Maximum ${MAX_BACKUPS_PER_USER} backups reached. Delete old backups first.`, code: ErrorCodes.MAX_BACKUPS_REACHED }, 400);
      }

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
      if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) {
        return c.json({ error: 'Metadata must be an object', code: ErrorCodes.INVALID_METADATA }, 400);
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
      if (!Number.isSafeInteger(entityCount) || entityCount < 0 || (scope !== 'all' && !scopeId)) {
        return c.json({ error: 'Invalid backup scope or entity count', code: ErrorCodes.INVALID_METADATA }, 400);
      }
      if (type === 'differential') {
        if (!parentBackupId) return c.json({ error: 'Differential backups require a parent backup', code: ErrorCodes.INVALID_METADATA }, 400);
        const [parent] = await tx.select().from(backups)
          .where(and(eq(backups.id, parentBackupId), eq(backups.userId, user.id))).limit(1);
        if (!parent || parent.scope !== scope || parent.scopeId !== scopeId) {
          return c.json({ error: 'Parent backup must be owned by you and have the same scope', code: ErrorCodes.INVALID_METADATA }, 400);
        }
      } else if (parentBackupId) {
        return c.json({ error: 'Full backups cannot have a parent', code: ErrorCodes.INVALID_METADATA }, 400);
      }

      const blobFile = blob as File;
      if (blobFile.size > MAX_BACKUP_BYTES) return c.json({ error: 'Backup too large (max 100MB)', code: ErrorCodes.FILE_TOO_LARGE }, 413);
      const id = nanoid();
      const storageName = `${id}.enc`;
      const backupsDir = join(STORAGE_PATH, BACKUPS_DIR);
      const storagePath = join(backupsDir, storageName);

      await mkdir(backupsDir, { recursive: true });
      await assertStorageCapacity(tx, user.id, blobFile.size, STORAGE_PATH);

      const buffer = Buffer.from(await blobFile.arrayBuffer());
      await writeFile(storagePath, buffer, { flag: 'wx' });
      createdPath = storagePath;

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

      await tx.insert(backups).values(record);

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
  } catch (error) {
    if (createdPath) await unlink(createdPath).catch(cleanupError => logger.error('Failed to clean up uncommitted backup', { error: String(cleanupError) }));
    if (error instanceof StorageQuotaError) return c.json({ error: error.message, code: 'STORAGE_QUOTA_EXCEEDED' }, 507);
    throw error;
  }
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
  try {
    const resolvedPath = await realpath(filePath);
    const basePath = await realpath(join(STORAGE_PATH, BACKUPS_DIR));
    if (!resolvedPath.startsWith(basePath + '/')) return c.json({ error: 'Invalid backup path', code: ErrorCodes.INVALID_BACKUP_PATH }, 403);
    const details = await stat(resolvedPath);
    return new Response(Readable.toWeb(createReadStream(resolvedPath)) as ReadableStream, {
      headers: {
        'Content-Type': 'application/octet-stream',
        'Content-Length': details.size.toString(),
        'Content-Disposition': `attachment; filename="${backup.id}.enc"`,
        'X-Content-Type-Options': 'nosniff',
        'Cache-Control': 'private, no-store',
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
  const result = await db.transaction(async tx => {
    await lockStorage(tx);

    const result = await tx.select()
      .from(backups)
      .where(and(eq(backups.id, backupId), eq(backups.userId, user.id)))
      .limit(1);

    if (result.length === 0) {
      return c.json({ error: 'Backup not found', code: ErrorCodes.BACKUP_NOT_FOUND }, 404);
    }

    const backup = result[0];
    const dependents = await tx.select({ id: backups.id }).from(backups)
      .where(and(eq(backups.parentBackupId, backupId), eq(backups.userId, user.id))).limit(1);
    if (dependents.length) return c.json({ error: 'Delete dependent backups before their parent', code: ErrorCodes.BACKUP_HAS_DEPENDENTS }, 409);
    const filePath = join(STORAGE_PATH, backup.storagePath);

    // Path traversal protection
    const resolvedDeletePath = resolve(filePath);
    const deleteBasePath = resolve(STORAGE_PATH, BACKUPS_DIR);
    if (!resolvedDeletePath.startsWith(deleteBasePath + '/')) {
      return c.json({ error: 'Invalid backup path', code: ErrorCodes.INVALID_BACKUP_PATH }, 403);
    }

    // Retain the recoverable blob if deleting its database record fails.
    await tx.delete(backups).where(and(eq(backups.id, backupId), eq(backups.userId, user.id)));
    return filePath;
  });
  if (typeof result !== 'string') return result;

  // Delete from disk
  try {
    await unlink(result);
  } catch {
    logger.warn('Backup file not found on disk during delete', { backupId, path: result });
  }

  logger.info('Backup deleted', { backupId, userId: user.id });

  return c.json({ ok: true });
});

export default app;
