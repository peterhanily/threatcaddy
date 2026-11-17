import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ExportImport } from '../components/Settings/ExportImport';

const mocked = vi.hoisted(() => ({ exportJSON: vi.fn(), toast: vi.fn() }));
vi.mock('../lib/export', async (importOriginal) => ({ ...await importOriginal<typeof import('../lib/export')>(), exportJSON: mocked.exportJSON }));
vi.mock('../contexts/ToastContext', () => ({ useToast: () => ({ addToast: mocked.toast }) }));
vi.mock('../hooks/ActivityLogContext', () => ({ useLogActivity: () => vi.fn() }));

beforeEach(() => { vi.clearAllMocks(); });

describe('Settings export', () => {
  it('says in plain words, next to the backup export, that offline use is not a backup', () => {
    render(<ExportImport notes={[]} onImportComplete={vi.fn()} />);
    const note = screen.getByText(/^Offline use is not a backup\./);
    expect(note).toHaveTextContent('Export a JSON backup regularly and keep the file somewhere safe.');
    expect(note).not.toHaveTextContent(/worker|evict|cache/i);
    const exportButton = screen.getByRole('button', { name: 'Export JSON Backup' });
    expect(note.compareDocumentPosition(exportButton) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('shows why a backup could not be exported', async () => {
    mocked.exportJSON.mockRejectedValue(new Error('Invalid backup field agentMeetings.updatedAt (unsupported) in record agentMeetings:m1; no data was changed.'));
    render(<ExportImport notes={[]} onImportComplete={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Export JSON Backup' }));
    await waitFor(() => expect(mocked.toast).toHaveBeenCalledWith('error',
      'Failed to export backup: Invalid backup field agentMeetings.updatedAt (unsupported) in record agentMeetings:m1; no data was changed.'));
  });
});
