import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import type { DB } from '../src/db/index.js';
import { scratchDatabase, type ScratchDatabase } from './database.js';
import { applyCurrentMigrations } from './migrations.js';
import { assertStorageCapacity, lockStorage } from '../src/services/storage-policy.js';
import { files, backups } from '../src/db/schema.js';

describe('combined storage quota serialization in PostgreSQL', () => {
  let database: ScratchDatabase;
  let directory: string;
  beforeEach(async () => {
    database = await scratchDatabase({ maxConnections: 4 });
    await applyCurrentMigrations(database);
    await database.sql`INSERT INTO users (id,email,display_name,password_hash) VALUES ('uploader','owner@example.invalid','Uploader','fixture')`;
    directory = await mkdtemp(join(tmpdir(), 'threatcaddy-quota-'));
    vi.stubEnv('STORAGE_QUOTA_PER_USER_BYTES', '100');
    vi.stubEnv('STORAGE_QUOTA_TOTAL_BYTES', '100');
  });
  afterEach(async () => { vi.unstubAllEnvs(); await database?.close(); if (directory) await rm(directory, { recursive: true, force: true }); });
  it('does not let concurrent file and backup reservations oversubscribe the same quota', async () => {
    const save = (kind: 'file' | 'backup') => (database.db as DB).transaction(async tx => {
      await lockStorage(tx);
      await assertStorageCapacity(tx, 'uploader', 80, directory);
      if (kind === 'file') await tx.insert(files).values({ id: 'file', uploadedBy: 'uploader', filename: 'ordinary.bin', mimeType: 'application/octet-stream', sizeBytes: 80, storagePath: 'file.bin' });
      else await tx.insert(backups).values({ id: 'backup', userId: 'uploader', name: 'Ordinary backup', type: 'full', scope: 'all', sizeBytes: 80, storagePath: 'backups/backup.enc', entityCount: 1 });
    });
    const results = await Promise.allSettled([save('file'), save('backup')]);
    expect(results.filter(result => result.status === 'fulfilled')).toHaveLength(1);
    expect(results.filter(result => result.status === 'rejected')).toHaveLength(1);
    const [usage] = await database.sql`SELECT (SELECT coalesce(sum(size_bytes), 0) FROM files) + (SELECT coalesce(sum(size_bytes), 0) FROM backups) AS total`;
    expect(Number(usage.total)).toBe(80);
  });
});
