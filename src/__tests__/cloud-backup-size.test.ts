import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useCloudSync } from '../hooks/useCloudSync';
import type { BackupDestination } from '../types';

const mocks = vi.hoisted(() => ({
  exportJSON: vi.fn(),
  exportEncryptedJSON: vi.fn(),
  upload: vi.fn(),
  assertSize: vi.fn(),
  byteLimit: 0,
}));

vi.mock('../lib/export', () => ({
  exportJSON: mocks.exportJSON,
  exportEncryptedJSON: mocks.exportEncryptedJSON,
}));
vi.mock('../lib/backup-records', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../lib/backup-records')>();
  mocks.assertSize.mockImplementation((value: string) => actual.assertBackupSize(value, mocks.byteLimit));
  return { ...actual, assertBackupSize: mocks.assertSize };
});
vi.mock('../lib/cloud-sync', async (importOriginal) => ({
  ...await importOriginal<typeof import('../lib/cloud-sync')>(),
  multiCloudPut: mocks.upload,
}));

const destination: BackupDestination = {
  id: 'ordinary-backup', label: 'Fictional cloud', enabled: true, provider: 'oci',
  url: 'https://objectstorage.example.oraclecloud.com/p/example/n/example/b/example/o/',
};
const plain = JSON.stringify({ version: 1, notes: [], tasks: [], label: 'café' });
// Export/encryption are mocked here: real WebCrypto/import round trips are
// covered by cloud-portable-roundtrip.test.ts. These fixtures test preflight.
const encrypted = JSON.stringify({ version: 1, salt: 'fixture', iv: 'fixture', ciphertext: 'fixture' });
const bytes = (value: string) => new TextEncoder().encode(value).byteLength;

beforeEach(() => {
  vi.clearAllMocks();
  mocks.byteLimit = 1024;
  mocks.exportJSON.mockResolvedValue(plain);
  mocks.exportEncryptedJSON.mockResolvedValue(encrypted);
  mocks.upload.mockResolvedValue([{ destinationId: destination.id, label: destination.label, ok: true, status: 200 }]);
});
afterEach(cleanup);

describe('cloud full-backup final-file size preflight', () => {
  it('rejects a cloud wrapper over the limit even when the inner export fits', async () => {
    mocks.byteLimit = bytes(plain);
    const { result } = renderHook(() => useCloudSync([destination]));

    await act(async () => {
      expect(await result.current.pushFullBackup()).toEqual({
        status: 'failure', results: [], encrypted: false, error: expect.stringContaining('Backup file too large'),
      });
    });

    const checked: string = mocks.assertSize.mock.calls[0][0];
    expect(JSON.parse(checked)).toMatchObject({ type: 'full-backup', payload: JSON.parse(plain) });
    expect(bytes(checked)).toBeGreaterThan(mocks.byteLimit);
    expect(mocks.upload).not.toHaveBeenCalled();
    expect(result.current).toMatchObject({ syncing: false, progress: '', lastSyncAt: null, lastResults: [] });
  });

  it('checks the final encrypted envelope before any destination is attempted', async () => {
    mocks.byteLimit = bytes(encrypted) - 1;
    const { result } = renderHook(() => useCloudSync([destination]));

    await act(async () => {
      expect(await result.current.pushFullBackup('fictional-password')).toMatchObject({
        status: 'failure', encrypted: true, results: [], error: expect.stringContaining('Backup file too large'),
      });
    });

    expect(mocks.exportEncryptedJSON).toHaveBeenCalledWith('fictional-password');
    expect(mocks.assertSize).toHaveBeenCalledExactlyOnceWith(encrypted);
    expect(mocks.upload).not.toHaveBeenCalled();
    expect(result.current.lastSyncAt).toBeNull();
  });

  it.each([false, true])('uploads exactly the checked bytes when they fit (encrypted=%s)', async isEncrypted => {
    if (isEncrypted) mocks.byteLimit = bytes(encrypted);
    const { result } = renderHook(() => useCloudSync([destination]));

    await act(async () => {
      expect(await result.current.pushFullBackup(isEncrypted ? 'fictional-password' : undefined)).toMatchObject({
        status: 'success', encrypted: isEncrypted, error: null,
      });
    });

    expect(mocks.assertSize).toHaveBeenCalledOnce();
    const checked: string = mocks.assertSize.mock.calls[0][0];
    expect(bytes(checked)).toBeLessThanOrEqual(mocks.byteLimit);
    expect(mocks.upload).toHaveBeenCalledWith([destination], expect.any(String), checked, 'application/json', expect.any(Function));
    expect(mocks.assertSize.mock.invocationCallOrder[0]).toBeLessThan(mocks.upload.mock.invocationCallOrder[0]);
    expect(result.current.lastSyncAt).not.toBeNull();
  });
});

describe('real portable-file size guard with a lower budget', () => {
  it('measures UTF-8 bytes and allows the exact boundary', async () => {
    const { assertBackupSize } = await vi.importActual<typeof import('../lib/backup-records')>('../lib/backup-records');
    expect(() => assertBackupSize('café', 5)).not.toThrow();
    expect(() => assertBackupSize('café', 4)).toThrow('Backup file too large');
  });

  it.each([0, -1, Number.NaN, 1.5, 50 * 1024 * 1024 + 1])('refuses an invalid or raised budget (%s)', async limit => {
    const { assertBackupSize } = await vi.importActual<typeof import('../lib/backup-records')>('../lib/backup-records');
    expect(() => assertBackupSize('{}', limit)).toThrow('Invalid backup file size limit');
  });
});
