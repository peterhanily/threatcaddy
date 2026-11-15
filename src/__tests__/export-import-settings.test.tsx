import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ExportImport } from '../components/Settings/ExportImport';

const mocked = vi.hoisted(() => ({ exportJSON: vi.fn(), toast: vi.fn() }));
vi.mock('../lib/export', async (importOriginal) => ({ ...await importOriginal<typeof import('../lib/export')>(), exportJSON: mocked.exportJSON }));
vi.mock('../contexts/ToastContext', () => ({ useToast: () => ({ addToast: mocked.toast }) }));
vi.mock('../hooks/ActivityLogContext', () => ({ useLogActivity: () => vi.fn() }));

beforeEach(() => { vi.clearAllMocks(); });

describe('Settings export', () => {
  it('shows why a backup could not be exported', async () => {
    mocked.exportJSON.mockRejectedValue(new Error('Invalid backup field agentMeetings.updatedAt (unsupported) in record agentMeetings:m1; no data was changed.'));
    render(<ExportImport notes={[]} onImportComplete={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Export JSON Backup' }));
    await waitFor(() => expect(mocked.toast).toHaveBeenCalledWith('error',
      'Failed to export backup: Invalid backup field agentMeetings.updatedAt (unsupported) in record agentMeetings:m1; no data was changed.'));
  });
});
