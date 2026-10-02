import { sql } from 'drizzle-orm';
import { mkdir, readdir, lstat, realpath, rename, statfs, unlink } from 'node:fs/promises';
import { join, resolve, sep } from 'node:path';
import { randomUUID } from 'node:crypto';
import type { DB } from '../db/index.js';
import { files, backups } from '../db/schema.js';
import { logger } from '../lib/logger.js';

type StorageDatabase = Pick<DB, 'execute' | 'select'>;
export class StorageQuotaError extends Error {}
export function storageLimits(env = process.env) {
  function setting(name: string, fallback: number) {
    const raw = env[name];
    const value = raw === undefined ? fallback : Number(raw);
    if (!Number.isSafeInteger(value) || value <= 0) throw new Error(`${name} must be a positive safe integer byte count`);
    return value;
  }
  return { perUser: setting('STORAGE_QUOTA_PER_USER_BYTES', 2 * 1024 ** 3), total: setting('STORAGE_QUOTA_TOTAL_BYTES', 20 * 1024 ** 3) };
}
export async function lockStorage(tx: StorageDatabase): Promise<void> {
  await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended('threatcaddy:blob-storage:v1', 0))`);
}
/** Call only after the reference-removing transaction commits. Failed cleanup
 * leaves a recoverable orphan for startup reconciliation, never a broken DB reference. */
export async function removeCommittedBlobs(root: string, records: { storagePath: string; thumbnailPath?: string | null }[]): Promise<number> {
  let pending = 0;
  for (const path of new Set(records.flatMap(row => [row.storagePath, row.thumbnailPath]).filter((path): path is string => Boolean(path)))) {
    try {
      const base = await realpath(root);
      const candidate = resolve(base, path);
      if (!candidate.startsWith(base + sep)) throw new Error('Blob path is outside managed storage');
      const resolved = await realpath(candidate);
      if (resolved !== candidate || !(await lstat(candidate)).isFile()) throw new Error('Blob path is not an ordinary managed file');
      await unlink(candidate);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') continue;
      pending++;
      logger.warn('Committed blob cleanup deferred', { path, error: String(error) });
    }
  }
  return pending;
}
export async function assertStorageCapacity(tx: StorageDatabase, userId: string, bytes: number, root: string): Promise<void> {
  if (!Number.isSafeInteger(bytes) || bytes < 0) throw new StorageQuotaError('Invalid upload size');
  const limits = storageLimits();
  const [usage] = await tx.execute<{ total: string; owned: string }>(sql`
    SELECT coalesce(sum(size_bytes), 0)::text AS total,
      coalesce(sum(size_bytes) FILTER (WHERE owner_id = ${userId}), 0)::text AS owned
    FROM (SELECT size_bytes + CASE WHEN thumbnail_path IS NULL THEN 0 ELSE 1048576 END AS size_bytes, uploaded_by AS owner_id FROM files
      UNION ALL SELECT size_bytes, user_id AS owner_id FROM backups) AS stored`);
  if (!usage || !/^\d+$/.test(usage.total) || !/^\d+$/.test(usage.owned)) throw new Error('Unable to determine storage usage');
  if (BigInt(usage.total) + BigInt(bytes) > BigInt(limits.total) || BigInt(usage.owned) + BigInt(bytes) > BigInt(limits.perUser)) {
    throw new StorageQuotaError('Storage quota exceeded. Remove retained uploads/backups or ask an administrator to adjust the quota.');
  }
  const disk = await statfs(root, { bigint: true });
  if (disk.bavail * disk.bsize < BigInt(bytes) + 64n * 1024n * 1024n) throw new StorageQuotaError('Storage volume has insufficient free space');
}

/** Move only recognizable old managed blobs without a DB reference. Unknown
 * files, secrets, fresh uploads, symlinks, and existing quarantine are untouched. */
export async function reconcileStorage(tx: StorageDatabase, root: string): Promise<number> {
  await mkdir(root, { recursive: true });
  await lockStorage(tx);
  const records = await tx.select({ storagePath: files.storagePath, thumbnailPath: files.thumbnailPath }).from(files);
  const backupRecords = await tx.select({ storagePath: backups.storagePath }).from(backups);
  const retained = new Set([...records.flatMap(row => [row.storagePath, row.thumbnailPath]), ...backupRecords.map(row => row.storagePath)].filter(Boolean));
  const base = await realpath(root);
  const cutoff = Date.now() - 60 * 60 * 1000;
  let moved = 0;
  for (const child of ['', 'backups']) {
    const directory = join(base, child);
    const resolved = await realpath(directory).catch(() => null);
    if (!resolved || resolved !== resolve(base, child)) continue;
    const entries = await readdir(directory, { withFileTypes: true });
    for (const entry of entries) {
      const relative = child ? `${child}/${entry.name}` : entry.name;
      if (!entry.isFile() || retained.has(relative) || !/^[A-Za-z0-9_-]{21}(?:_thumb)?\.[A-Za-z0-9]+$/.test(entry.name)) continue;
      const path = join(directory, entry.name);
      const details = await lstat(path);
      if (!details.isFile() || details.mtimeMs >= cutoff) continue;
      const quarantine = join(base, '.orphan-quarantine');
      await mkdir(quarantine, { recursive: true, mode: 0o700 });
      if (await realpath(quarantine) !== quarantine) throw new Error('Storage quarantine must not be a symlink');
      await rename(path, join(quarantine, `${randomUUID()}--${child ? 'backups--' : ''}${entry.name}`));
      moved++;
    }
  }
  if (moved) logger.warn('Unreferenced managed blobs moved to recoverable quarantine', { count: moved, directory: join(base, '.orphan-quarantine') });
  return moved;
}
