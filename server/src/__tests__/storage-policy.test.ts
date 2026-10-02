import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, writeFile, utimes, readdir, rm, mkdir, symlink } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import type { DB } from '../db/index.js';
import { assertStorageCapacity, reconcileStorage, removeCommittedBlobs, storageLimits } from '../services/storage-policy.js';

const directories: string[] = [];
async function fixture() { const path = await mkdtemp(join(tmpdir(), 'threatcaddy-storage-')); directories.push(path); return path; }
afterEach(async () => { vi.unstubAllEnvs(); await Promise.all(directories.splice(0).map(path => rm(path, { recursive: true, force: true }))); });
function database(total = '0', owned = '0', rows: unknown[][] = []) {
  return { execute: vi.fn().mockResolvedValue([{ total, owned }]), select: vi.fn(() => ({ from: () => Promise.resolve(rows.shift() ?? []) })) } as unknown as DB;
}
describe('combined storage quotas and recoverable orphan reconciliation', () => {
  it('removes only committed ordinary blobs, tolerating already missing bytes', async () => {
    const root = await fixture();
    await writeFile(join(root, 'retired.pdf'), 'ordinary fixture');
    await writeFile(join(root, 'still-referenced.pdf'), 'ordinary fixture');
    expect(await removeCommittedBlobs(root, [{ storagePath: 'retired.pdf', thumbnailPath: 'already-absent.webp' }])).toBe(0);
    expect(await readdir(root)).toEqual(['still-referenced.pdf']);
  });
  it('accepts capacity within both byte quotas', async () => {
    vi.stubEnv('STORAGE_QUOTA_TOTAL_BYTES', '1000'); vi.stubEnv('STORAGE_QUOTA_PER_USER_BYTES', '500');
    await expect(assertStorageCapacity(database('700', '200'), 'user', 100, await fixture())).resolves.toBeUndefined();
  });
  it.each([['901', '200'], ['700', '450']])('rejects capacity beyond either limit (%s/%s)', async (total, owned) => {
    vi.stubEnv('STORAGE_QUOTA_TOTAL_BYTES', '1000'); vi.stubEnv('STORAGE_QUOTA_PER_USER_BYTES', '500');
    await expect(assertStorageCapacity(database(total, owned), 'user', 100, await fixture())).rejects.toThrow('quota exceeded');
  });
  it('requires positive explicit quota settings', () => {
    expect(() => storageLimits({ STORAGE_QUOTA_PER_USER_BYTES: '0' })).toThrow('positive');
    expect(() => storageLimits({ STORAGE_QUOTA_TOTAL_BYTES: 'unlimited' })).toThrow('positive');
  });
  it('quarantines only old unreferenced managed files, retaining fresh, referenced, secret and symlink entries', async () => {
    const root = await fixture();
    const orphan = 'a'.repeat(21) + '.bin', retained = 'b'.repeat(21) + '.bin', fresh = 'c'.repeat(21) + '.bin';
    for (const name of [orphan, retained, fresh, '.admin-secret', 'operator-document.txt']) await writeFile(join(root, name), 'ordinary fixture');
    for (const name of [orphan, retained, '.admin-secret', 'operator-document.txt']) await utimes(join(root, name), new Date(0), new Date(0));
    await mkdir(join(root, 'backups'));
    await symlink(join(root, retained), join(root, 'd'.repeat(21) + '.bin'));
    expect(await reconcileStorage(database('0', '0', [[{ storagePath: retained, thumbnailPath: null }], []]), root)).toBe(1);
    expect(await readdir(root)).toEqual(expect.arrayContaining([retained, fresh, '.admin-secret', 'operator-document.txt', 'd'.repeat(21) + '.bin']));
    const quarantine = await readdir(join(root, '.orphan-quarantine'));
    expect(quarantine).toHaveLength(1);
    expect(quarantine[0]).toContain(orphan);
  });
});
