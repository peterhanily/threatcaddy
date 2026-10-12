import { describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { BackupImportDialog } from '../components/Common/BackupImportDialog';

function fileWithText(text = '{"notes":[]}') {
  const file = new File([text], 'synthetic-backup.json', { type: 'application/json' });
  Object.defineProperty(file, 'text', { value: vi.fn().mockResolvedValue(text) });
  return file;
}

describe('BackupImportDialog', () => {
  it('keeps committed-data notices visible without offering a destructive retry', async () => {
    const onImport = vi.fn().mockResolvedValue({ warnings: ['Entity data restored; quick-link settings could not be saved.'] });
    const onClose = vi.fn();
    render(<BackupImportDialog file={fileWithText()} onImport={onImport} onClose={onClose} />);
    fireEvent.change(screen.getByLabelText('Backup password (only for encrypted files)'), { target: { value: 'synthetic password' } });
    fireEvent.click(screen.getByRole('button', { name: 'Replace All' }));
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('quick-link settings could not be saved'));
    expect(screen.queryByRole('button', { name: 'Replace All' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Merge' })).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Backup password (only for encrypted files)')).not.toBeInTheDocument();
    expect(onClose).not.toHaveBeenCalled();
    fireEvent.click(screen.getAllByRole('button', { name: 'Close' })[1]);
    expect(onClose).toHaveBeenCalledOnce();
  });

  it('does not start a restore if unmounted while the file is still being read', async () => {
    let finish!: (text: string) => void;
    const file = new File(['old'], 'same-name.json');
    Object.defineProperty(file, 'text', { value: () => new Promise<string>(resolve => { finish = resolve; }) });
    const onImport = vi.fn();
    const onClose = vi.fn();
    const { unmount } = render(<BackupImportDialog file={file} onImport={onImport} onClose={onClose} />);
    fireEvent.click(screen.getByRole('button', { name: 'Replace All' }));
    unmount();
    await act(async () => finish('old data'));
    expect(onImport).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
  });

  it('gives a replacement file a fresh session and ignores completion of an old read', async () => {
    let finish!: (text: string) => void;
    const file = new File(['old'], 'same-name.json');
    Object.defineProperty(file, 'text', { value: () => new Promise<string>(resolve => { finish = resolve; }) });
    const replacement = new File(['new'], 'same-name.json');
    Object.defineProperty(replacement, 'text', { value: async () => 'new data' });
    const onImport = vi.fn().mockResolvedValue(undefined);
    const onClose = vi.fn();
    const { rerender } = render(<BackupImportDialog file={file} onImport={onImport} onClose={onClose} />);
    fireEvent.change(screen.getByLabelText('Backup password (only for encrypted files)'), { target: { value: 'old secret' } });
    fireEvent.click(screen.getByRole('button', { name: 'Replace All' }));
    rerender(<BackupImportDialog file={replacement} onImport={onImport} onClose={onClose} />);
    expect(screen.getByLabelText('Backup password (only for encrypted files)')).toHaveValue('');
    await act(async () => finish('old data'));
    expect(onImport).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Merge' }));
    await waitFor(() => expect(onClose).toHaveBeenCalledOnce());
    expect(onImport).toHaveBeenCalledExactlyOnceWith('new data', 'merge', undefined);
  });

  it('does not dismiss a replacement selection when an already-started restore finishes', async () => {
    let finish!: () => void;
    const onImport = vi.fn(() => new Promise<void>(resolve => { finish = resolve; }));
    const onClose = vi.fn();
    const { rerender } = render(<BackupImportDialog file={fileWithText()} onImport={onImport} onClose={onClose} />);
    fireEvent.click(screen.getByRole('button', { name: 'Replace All' }));
    await waitFor(() => expect(onImport).toHaveBeenCalledOnce());
    rerender(<BackupImportDialog file={fileWithText('next')} onImport={onImport} onClose={onClose} />);
    await act(async () => finish());
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Replace All' })).toBeEnabled();
  });

  it('waits for committed restore before closing and blocks duplicate actions and dismissal', async () => {
    let finish!: () => void;
    const onImport = vi.fn(() => new Promise<void>(resolve => { finish = resolve; }));
    const onClose = vi.fn();
    render(<BackupImportDialog file={fileWithText()} onImport={onImport} onClose={onClose} />);
    fireEvent.click(screen.getByRole('button', { name: 'Replace All' }));
    fireEvent.click(screen.getByRole('button', { name: 'Merge' }));
    await waitFor(() => expect(onImport).toHaveBeenCalledOnce());
    expect(onImport).toHaveBeenCalledWith('{"notes":[]}', 'replace', undefined);
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeDisabled();
    fireEvent.keyDown(document, { key: 'Escape' });
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(onClose).not.toHaveBeenCalled();
    await act(async () => finish());
    expect(onClose).toHaveBeenCalledOnce();
  });

  it('keeps the selected file and password on failure, then supports a corrected retry', async () => {
    const file = fileWithText('encrypted synthetic data');
    const onImport = vi.fn().mockRejectedValueOnce(new Error('Wrong password or corrupted backup')).mockResolvedValueOnce(undefined);
    const onClose = vi.fn();
    render(<BackupImportDialog file={file} onImport={onImport} onClose={onClose} />);
    const password = screen.getByLabelText('Backup password (only for encrypted files)');
    fireEvent.change(password, { target: { value: 'first synthetic password' } });
    fireEvent.click(screen.getByRole('button', { name: 'Merge' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Wrong password or corrupted backup');
    expect(onClose).not.toHaveBeenCalled();
    expect(password).toHaveValue('first synthetic password');
    fireEvent.change(password, { target: { value: 'correct synthetic password' } });
    fireEvent.click(screen.getByRole('button', { name: 'Merge' }));
    await waitFor(() => expect(onClose).toHaveBeenCalledOnce());
    expect(onImport).toHaveBeenLastCalledWith('encrypted synthetic data', 'merge', 'correct synthetic password');
    expect(password).toHaveValue('');
  });

  it('rejects oversized files before reading or invoking the importer', async () => {
    const file = fileWithText();
    Object.defineProperty(file, 'size', { value: 50 * 1024 * 1024 + 1 });
    const onImport = vi.fn();
    render(<BackupImportDialog file={file} onImport={onImport} onClose={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Replace All' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Backup file too large');
    expect(file.text).not.toHaveBeenCalled();
    expect(onImport).not.toHaveBeenCalled();
  });

  it('allows cancel without reading or importing and offers replace-only mode', () => {
    const file = fileWithText();
    const onClose = vi.fn();
    const onImport = vi.fn();
    render(<BackupImportDialog file={file} onImport={onImport} onClose={onClose} allowMerge={false} />);
    expect(screen.queryByRole('button', { name: 'Merge' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(onClose).toHaveBeenCalledOnce();
    expect(file.text).not.toHaveBeenCalled();
    expect(onImport).not.toHaveBeenCalled();
  });
});
