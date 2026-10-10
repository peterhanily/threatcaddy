import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { db } from '../db';
import { useCloudSync } from '../hooks/useCloudSync';
import { importJSON } from '../lib/export';
import { decodePortableBackup } from '../lib/portable-backup';
import { BACKUP_TABLES } from '../lib/backup-tables';
import type { BackupDestination, Note } from '../types';

const upload = vi.hoisted(() => vi.fn());
vi.mock('../lib/cloud-sync', async (importOriginal) => ({
  ...await importOriginal<typeof import('../lib/cloud-sync')>(), multiCloudPut: upload,
}));
const destination: BackupDestination = { id: 'fixture-cloud', label: 'Fixture cloud', enabled: true, provider: 'oci',
  url: 'https://objectstorage.example.oraclecloud.com/p/example/n/example/b/example/o/' };
const note: Note = { id: 'cloud-roundtrip-note', title: 'Cloud roundtrip', content: 'Ordinary backup content', tags: [],
  pinned: false, archived: false, trashed: false, createdAt: 1000, updatedAt: 1001 };

beforeEach(async () => {
  upload.mockReset();
  upload.mockResolvedValue([{ destinationId: destination.id, label: destination.label, ok: true, status: 200 }]);
  localStorage.clear();
  await Promise.all(BACKUP_TABLES.map(name => db.table(name).clear()));
  await db.notes.add(note);
  await db.installedIntegrations.add({ id: 'cloud-roundtrip-integration', templateId: 'uninstalled-fixture-template', name: 'Inert fixture',
    enabled: false, config: { credential: 'fictional-cloud-roundtrip-value', retries: 0, flag: false }, scopeType: 'all', scopeFolderIds: [],
    runCount: 0, errorCount: 0, createdAt: 1000, updatedAt: 1001 });
});
afterEach(async () => {
  cleanup();
  await Promise.all(BACKUP_TABLES.map(name => db.table(name).clear()));
  localStorage.clear();
});

describe('actual cloud portable backups', () => {
  it.each([false, true])('round-trips uploaded bytes through the file importer (encrypted=%s)', async encrypted => {
    const password = encrypted ? 'ordinary-cloud-roundtrip-password' : undefined;
    const { result } = renderHook(() => useCloudSync([destination]));
    await act(async () => {
      expect((await result.current.pushFullBackup(password)).status).toBe('success');
    });
    const json: string = upload.mock.calls[0][2];
    const decoded = await decodePortableBackup(json, password);
    expect(decoded.encrypted).toBe(encrypted);
    expect(Object.keys(decoded.payload.data).sort()).toEqual([...BACKUP_TABLES].sort());
    expect(decoded.payload.data.notes).toEqual([note]);
    expect(json).not.toContain('fictional-cloud-roundtrip-value');
    expect(decoded.payload.data.installedIntegrations?.[0]).toMatchObject({ config: encrypted
      ? { credential: 'fictional-cloud-roundtrip-value', retries: 0, flag: false } : {} });
    await db.notes.delete(note.id);
    await importJSON(json, password);
    expect(await db.notes.get(note.id)).toMatchObject(note);
    expect((await db.installedIntegrations.get('cloud-roundtrip-integration'))?.enabled).toBe(false);
  });
});
