import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { LegacyDataCleanup } from '../components/Encryption/LegacyDataCleanup';
const mocks = vi.hoisted(() => ({ status: vi.fn(), prepare: vi.fn(), remove: vi.fn(), download: vi.fn() }));
vi.mock('../lib/db-migration', () => ({ getLegacyCleanupStatus: mocks.status, prepareLegacyCleanup: mocks.prepare, removeLegacyDatabase: mocks.remove }));
vi.mock('../lib/export', () => ({ downloadFile: mocks.download }));
const receipt = { filename: 'recovery.enc.json', records: 2, blob: { v: 1, salt: 's', iv: 'i', ct: 'c' } };
beforeEach(() => {
  vi.resetAllMocks();
  mocks.status.mockResolvedValue({ exists: true, verified: true, records: 2 });
  mocks.prepare.mockResolvedValue(receipt);
  mocks.remove.mockResolvedValue(undefined);
});
describe('explicit legacy copy cleanup consent', () => {
  it('does nothing destructive until a backup is downloaded and both confirmations are checked', async () => {
    render(<LegacyDataCleanup />);
    fireEvent.change(await screen.findByLabelText('Recovery archive password (at least 12 characters)'), { target: { value: 'recovery-long-password' } });
    fireEvent.change(screen.getByLabelText('Confirm recovery archive password'), { target: { value: 'recovery-long-password' } });
    expect(mocks.remove).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Create and download verified encrypted archive' }));
    const remove = await screen.findByRole('button', { name: 'Permanently remove legacy database' });
    expect(mocks.download).toHaveBeenCalledWith(JSON.stringify(receipt.blob), receipt.filename, 'application/json');
    expect(remove).toBeDisabled();
    fireEvent.click(screen.getByLabelText(/I saved the encrypted recovery archive/));
    expect(remove).toBeDisabled();
    fireEvent.click(screen.getByLabelText(/I closed all other BrowserNotes tabs/));
    fireEvent.click(remove);
    await waitFor(() => expect(mocks.remove).toHaveBeenCalledWith(receipt, { backupSaved: true, deleteConfirmed: true }, expect.any(Function)));
    expect(await screen.findByText(/old BrowserNotes database was removed/)).toBeInTheDocument();
  });
  it('does not offer deletion when transfer verification is incomplete', async () => {
    mocks.status.mockResolvedValue({ exists: true, verified: false, records: 2 });
    render(<LegacyDataCleanup />);
    expect(await screen.findByRole('alert')).toHaveTextContent('Complete and verify');
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
    expect(mocks.prepare).not.toHaveBeenCalled();
    expect(mocks.remove).not.toHaveBeenCalled();
  });
});
