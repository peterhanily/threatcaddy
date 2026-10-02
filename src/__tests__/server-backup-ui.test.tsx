import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { ServerBackup } from '../components/Settings/ServerBackup';
import type { BackupPayload } from '../lib/backup-crypto';

const mocks = vi.hoisted(() => ({
  list: vi.fn(), download: vi.fn(), create: vi.fn(), remove: vi.fn(), decrypt: vi.fn(), encrypt: vi.fn(),
  full: vi.fn(), differential: vi.fn(), preview: vi.fn(), replace: vi.fn(), merge: vi.fn(), toast: vi.fn(),
}));
vi.mock('../hooks/useSettings', () => ({ useSettings: () => ({ settings: { serverUrl: 'http://localhost' } }) }));
vi.mock('../contexts/ToastContext', () => ({ useToast: () => ({ addToast: mocks.toast }) }));
vi.mock('../lib/server-api', () => ({ listBackups: mocks.list, downloadBackup: mocks.download, createBackup: mocks.create, deleteBackup: mocks.remove }));
vi.mock('../lib/backup-crypto', () => ({ decryptBackup: mocks.decrypt, encryptBackup: mocks.encrypt }));
vi.mock('../lib/backup-data', () => ({ buildFullBackupPayload: mocks.full, buildDifferentialPayload: mocks.differential, countPayloadEntities: () => 1 }));
vi.mock('../lib/backup-restore', () => ({ previewRestore: mocks.preview, restoreFullReplace: mocks.replace, restoreMerge: mocks.merge }));
vi.mock('../lib/entity-drafts', () => ({ hasPendingEntityDrafts: () => true }));

const base: BackupPayload = { version: 1, type: 'full', scope: 'all', createdAt: 100, data: {} };
const delta: BackupPayload = { version: 2, type: 'differential', scope: 'all', createdAt: 200, parentBackupId: 'base', data: {} };
const preview = { scope: 'all', added: 1, updated: 0, deleted: 0, tables: ['notes'], sharedPreserved: 0,
  changes: [{ table: 'notes', added: 1, updated: 0, deleted: 0 }] };
const fakeBlob = (id: string) => ({ text: async () => JSON.stringify({ id }) });

beforeEach(() => {
  vi.resetAllMocks();
  mocks.list.mockResolvedValue({ backups: [{ id: 'delta', name: 'Differential backup', type: 'differential', scope: 'all', createdAt: '2026-01-02', sizeBytes: 100, entityCount: 1 },
    { id: 'base', name: 'Full backup', type: 'full', scope: 'all', createdAt: '2026-01-01', sizeBytes: 100, entityCount: 1 }] });
  mocks.download.mockImplementation(async id => fakeBlob(id));
  mocks.decrypt.mockImplementation(async (_password, envelope) => envelope.id === 'base' ? base : delta);
  mocks.differential.mockResolvedValue(delta);
  mocks.encrypt.mockResolvedValue({ v: 1, salt: 'salt', iv: 'iv', ct: 'ciphertext' });
  mocks.preview.mockResolvedValue(preview);
  mocks.merge.mockResolvedValue({ added: 1, updated: 0, deleted: 0, tables: ['notes'] });
});

async function selectDifferential() {
  await screen.findByText('Full backup');
  fireEvent.change(screen.getAllByRole('combobox')[1], { target: { value: 'differential' } });
  fireEvent.change(screen.getByPlaceholderText('Encryption password'), { target: { value: 'full-parent-password' } });
  fireEvent.change(screen.getByPlaceholderText('Confirm password'), { target: { value: 'full-parent-password' } });
  fireEvent.click(screen.getByRole('button', { name: 'Create Backup' }));
}

async function decryptSelected() {
  await screen.findByText('Differential backup');
  fireEvent.click(screen.getAllByRole('button', { name: /^Restore$/ })[0]);
  fireEvent.change(screen.getByPlaceholderText('Enter backup password'), { target: { value: 'full-parent-password' } });
  fireEvent.click(screen.getByRole('button', { name: 'Decrypt' }));
}

describe('server backup parent orchestration and cancellation', () => {
  it('decrypts the actual full parent before generating and uploading a differential', async () => {
    render(<ServerBackup />);
    await selectDifferential();
    await waitFor(() => expect(mocks.create).toHaveBeenCalled());
    expect(mocks.download).toHaveBeenCalledWith('base');
    expect(mocks.decrypt).toHaveBeenCalledWith('full-parent-password', { id: 'base' });
    expect(mocks.differential).toHaveBeenCalledWith('all', base, 'base', undefined);
    expect(mocks.create.mock.calls[0][0]).toMatchObject({ type: 'differential', parentBackupId: 'base' });
  });

  it('does not create an unverifiable differential when the parent password is wrong', async () => {
    mocks.decrypt.mockRejectedValue(new Error('Wrong password or corrupted backup'));
    render(<ServerBackup />);
    await selectDifferential();
    await screen.findByText('Wrong password or corrupted backup');
    expect(mocks.differential).not.toHaveBeenCalled();
    expect(mocks.create).not.toHaveBeenCalled();
  });

  it('downloads and decrypts the matching parent for both preview and restore', async () => {
    render(<ServerBackup />);
    await decryptSelected();
    fireEvent.click(await screen.findByRole('button', { name: 'Confirm restore' }));
    await waitFor(() => expect(mocks.merge).toHaveBeenCalledWith(delta, preview, base));
    expect(mocks.download.mock.calls.map(args => args[0])).toEqual(['delta', 'base']);
    expect(mocks.preview).toHaveBeenCalledWith(delta, 'merge', base);
    expect(mocks.decrypt.mock.calls.map(args => args[0])).toEqual(['full-parent-password', 'full-parent-password']);
  });

  it('cannot reopen a restore panel after its pending download is cancelled', async () => {
    let finish!: (value: ReturnType<typeof fakeBlob>) => void;
    mocks.download.mockReturnValueOnce(new Promise(resolve => { finish = resolve; }));
    render(<ServerBackup />);
    await decryptSelected();
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    await act(async () => { finish(fakeBlob('delta')); });
    expect(screen.queryByText('Restore Backup')).not.toBeInTheDocument();
    expect(mocks.decrypt).not.toHaveBeenCalled();
    expect(mocks.preview).not.toHaveBeenCalled();
  });

  it('cannot publish an old preview after cancelling and selecting another backup', async () => {
    let finish!: (value: typeof preview) => void;
    mocks.preview.mockReturnValueOnce(new Promise(resolve => { finish = resolve; }));
    render(<ServerBackup />);
    await decryptSelected();
    await waitFor(() => expect(mocks.preview).toHaveBeenCalled());
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    fireEvent.click(screen.getAllByRole('button', { name: /^Restore$/ })[1]);
    await act(async () => { finish(preview); });
    expect(screen.getByPlaceholderText('Enter backup password')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Confirm restore' })).not.toBeInTheDocument();
  });
});
