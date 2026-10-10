import { act, cleanup, fireEvent, render, renderHook, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { BackupDestination, ExportData } from '../types';
import type { DestinationPutResult } from '../lib/cloud-sync';
import { useCloudSync } from '../hooks/useCloudSync';
import { CloudBackup } from '../components/Settings/CloudBackup';

const mocked = vi.hoisted(() => ({
  exportJSON: vi.fn(), exportEncryptedJSON: vi.fn(), put: vi.fn(), toast: vi.fn(), activity: vi.fn(),
}));
vi.mock('../lib/export', () => ({ exportJSON: mocked.exportJSON, exportEncryptedJSON: mocked.exportEncryptedJSON }));
vi.mock('../lib/cloud-sync', async (importOriginal) => ({
  ...await importOriginal<typeof import('../lib/cloud-sync')>(), multiCloudPut: mocked.put,
}));
vi.mock('../hooks/useSettings', () => ({ useSettings: () => ({ settings: { backupDestinations: destinations }, updateSettings: vi.fn() }) }));
vi.mock('../hooks/ActivityLogContext', () => ({ useLogActivity: () => mocked.activity }));
vi.mock('../contexts/ToastContext', () => ({ useToast: () => ({ addToast: mocked.toast }) }));
vi.mock('../components/Common/ConfirmDialog', () => ({ ConfirmDialog: ({ open, onConfirm }: { open: boolean; onConfirm: () => void }) =>
  open ? <button onClick={onConfirm}>Confirm cloud backup</button> : null }));

const destinations: BackupDestination[] = [
  { id: 'first', provider: 'oci', label: 'First', enabled: true, url: 'https://objectstorage.example.oraclecloud.com/p/example/o/' },
  { id: 'second', provider: 'oci', label: 'Second', enabled: true, url: 'https://objectstorage.example.oraclecloud.com/p/example/o/' },
];
const portable: ExportData = { version: 1, exportedAt: 123, notes: [], tasks: [], folders: [], tags: [], quickLinks: [] };
const successful: DestinationPutResult[] = destinations.map(({ id, label }) => ({ destinationId: id, label, ok: true, status: 200 }));
const failed: DestinationPutResult[] = successful.map((receipt) => ({ ...receipt, ok: false, status: 503, error: 'HTTP 503' }));
const partial = [successful[0], failed[1]];
const password = 'ordinary-backup-test-password';

function deferred<T>() {
  let resolve: (value: T) => void = () => {};
  const promise = new Promise<T>((yes) => { resolve = yes; });
  return { promise, resolve };
}
function confirmBackup(encrypted = false) {
  fireEvent.click(screen.getByRole('button', { name: encrypted ? 'Push Encrypted Backup' : 'Push Backup' }));
  fireEvent.click(screen.getByRole('button', { name: 'Confirm cloud backup' }));
}
function enableEncryption() {
  fireEvent.click(screen.getByRole('checkbox'));
  fireEvent.change(screen.getByPlaceholderText('Encryption password'), { target: { value: password } });
}
beforeEach(() => {
  vi.resetAllMocks();
  mocked.exportJSON.mockResolvedValue(JSON.stringify(portable));
  mocked.exportEncryptedJSON.mockResolvedValue('{"v":1,"salt":"test","iv":"test","ct":"test"}');
  mocked.put.mockResolvedValue(successful);
});
afterEach(cleanup);

describe('cloud full-backup operation receipts', () => {
  it.each([{ configured: [] }, { configured: destinations.map((destination) => ({ ...destination, enabled: false })) }])('fails before export with no enabled destinations (%j)', async ({ configured }) => {
    const { result } = renderHook(() => useCloudSync(configured));
    await act(async () => {
      expect(await result.current.pushFullBackup()).toEqual({ status: 'failure', results: [], encrypted: false,
        error: 'No backup destinations configured. Go to Settings > Cloud Backup to add one.' });
    });
    expect(mocked.exportJSON).not.toHaveBeenCalled();
    expect(mocked.put).not.toHaveBeenCalled();
    expect(result.current.syncing).toBe(false);
  });

  it.each([
    ['success', successful, null],
    ['partial', partial, '1 of 2 destinations failed'],
    ['failure', failed, 'All destinations failed'],
  ] as const)('returns the actual %s receipt independently of render state', async (status, results, error) => {
    mocked.put.mockResolvedValue(results);
    const { result } = renderHook(() => useCloudSync(destinations));
    await act(async () => {
      expect(await result.current.pushFullBackup()).toEqual({ status, results, encrypted: false, error });
    });
    expect(result.current.lastResults).toEqual(results);
    expect(result.current.error).toBe(error);
    expect(result.current.lastSyncAt === null).toBe(status === 'failure');
    if (status === 'failure') expect(result.current.progress).toBe('');
  });

  it('wraps the canonical plaintext export without nesting it under server backup data', async () => {
    const { result } = renderHook(() => useCloudSync(destinations));
    await act(async () => { await result.current.pushFullBackup(); });
    const uploaded = JSON.parse(mocked.put.mock.calls[0][2]);
    expect(uploaded).toMatchObject({ version: 1, type: 'full-backup', payload: portable });
    expect(uploaded.payload.data).toBeUndefined();
    expect(mocked.exportEncryptedJSON).not.toHaveBeenCalled();
  });

  it('uploads the canonical encrypted export unchanged without first collecting plaintext', async () => {
    const encryptedJSON = '{"v":1,"salt":"portable-salt","iv":"portable-iv","ct":"portable-ciphertext"}';
    mocked.exportEncryptedJSON.mockResolvedValue(encryptedJSON);
    const { result } = renderHook(() => useCloudSync(destinations));
    await act(async () => {
      expect(await result.current.pushFullBackup(password)).toEqual({ status: 'success', results: successful, encrypted: true, error: null });
    });
    expect(mocked.exportEncryptedJSON).toHaveBeenCalledWith(password);
    expect(mocked.exportJSON).not.toHaveBeenCalled();
    expect(mocked.put.mock.calls[0][1]).toMatch(/\.enc\.json$/);
    expect(mocked.put.mock.calls[0][2]).toBe(encryptedJSON);
  });

  it('rejects an explicit empty encryption password without plaintext fallback', async () => {
    const { result } = renderHook(() => useCloudSync(destinations));
    await act(async () => {
      expect(await result.current.pushFullBackup('')).toMatchObject({ status: 'failure', results: [], encrypted: true, error: 'An encryption password is required.' });
    });
    expect(mocked.exportJSON).not.toHaveBeenCalled();
    expect(mocked.exportEncryptedJSON).not.toHaveBeenCalled();
    expect(mocked.put).not.toHaveBeenCalled();
  });

  it.each([false, true])('returns export errors without claiming an upload (encrypted=%s)', async (encrypted) => {
    mocked.exportJSON.mockRejectedValue(new Error('Pending draft could not be saved'));
    mocked.exportEncryptedJSON.mockRejectedValue(new Error('Pending draft could not be saved'));
    const { result } = renderHook(() => useCloudSync(destinations));
    await act(async () => {
      expect(await result.current.pushFullBackup(encrypted ? password : undefined)).toEqual({ status: 'failure', results: [], encrypted,
        error: 'Pending draft could not be saved' });
    });
    expect(mocked.put).not.toHaveBeenCalled();
  });

  it('reports malformed export JSON before upload', async () => {
    mocked.exportJSON.mockResolvedValue('not json');
    const { result } = renderHook(() => useCloudSync(destinations));
    await act(async () => {
      expect(await result.current.pushFullBackup()).toMatchObject({ status: 'failure', results: [], error: 'Failed to parse export data — backup may be corrupted' });
    });
    expect(mocked.put).not.toHaveBeenCalled();
  });

  it('clears previous destination receipts while a retry exports and after an export failure', async () => {
    const { result } = renderHook(() => useCloudSync(destinations));
    await act(async () => { await result.current.pushFullBackup(); });
    const pendingExport = deferred<string>();
    mocked.exportJSON.mockReturnValue(pendingExport.promise);
    let pending: ReturnType<typeof result.current.pushFullBackup> | undefined;
    act(() => { pending = result.current.pushFullBackup(); });
    expect(result.current.lastResults).toEqual([]);
    await act(async () => { pendingExport.resolve('not json'); await pending; });
    expect(result.current.lastResults).toEqual([]);
    expect(result.current.error).toContain('Failed to parse');
  });
});

describe('cloud backup UI consumes the completed receipt', () => {
  it('does not show success or clear the password on a first failed upload, then reports a successful retry despite the previous error', async () => {
    mocked.put.mockResolvedValueOnce(failed).mockResolvedValueOnce(successful);
    render(<CloudBackup />);
    enableEncryption();
    confirmBackup(true);
    await waitFor(() => expect(mocked.toast).toHaveBeenCalledWith('error', 'Cloud backup failed'));
    expect(mocked.toast).not.toHaveBeenCalledWith('success', expect.anything());
    expect(mocked.activity).not.toHaveBeenCalled();
    expect(screen.getByPlaceholderText('Encryption password')).toHaveValue(password);
    confirmBackup(true);
    await waitFor(() => expect(mocked.toast).toHaveBeenCalledWith('success', 'Encrypted cloud backup pushed'));
    expect(screen.getByPlaceholderText('Encryption password')).toHaveValue('');
    expect(mocked.activity).toHaveBeenCalledWith('sync', 'backup', 'Pushed encrypted full backup to 2 destination(s)');
  });

  it('warns on partial success, logs only successful destinations, and retains the password', async () => {
    mocked.put.mockResolvedValue(partial);
    render(<CloudBackup />);
    enableEncryption();
    confirmBackup(true);
    await waitFor(() => expect(mocked.toast).toHaveBeenCalledWith('warning', '1 of 2 destinations failed'));
    expect(mocked.toast).not.toHaveBeenCalledWith('success', expect.anything());
    expect(screen.getByPlaceholderText('Encryption password')).toHaveValue(password);
    expect(mocked.activity).toHaveBeenCalledWith('sync', 'backup', 'Pushed encrypted full backup to 1 of 2 destination(s); remaining destinations failed');
  });

  it('reports an export failure after prior success without logging a second successful backup', async () => {
    render(<CloudBackup />);
    confirmBackup();
    await waitFor(() => expect(mocked.toast).toHaveBeenCalledWith('success', 'Cloud backup pushed'));
    mocked.exportJSON.mockRejectedValue(new Error('Draft save failed'));
    confirmBackup();
    await waitFor(() => expect(mocked.toast).toHaveBeenLastCalledWith('error', 'Cloud backup failed'));
    expect(mocked.activity).toHaveBeenCalledTimes(1);
  });

  it('does not erase a replacement password entered during a pending successful upload', async () => {
    const upload = deferred<DestinationPutResult[]>();
    mocked.put.mockReturnValue(upload.promise);
    render(<CloudBackup />);
    enableEncryption();
    confirmBackup(true);
    await waitFor(() => expect(mocked.put).toHaveBeenCalledOnce());
    fireEvent.change(screen.getByPlaceholderText('Encryption password'), { target: { value: 'next-backup-password' } });
    await act(async () => { upload.resolve(successful); });
    expect(screen.getByPlaceholderText('Encryption password')).toHaveValue('next-backup-password');
  });
});
