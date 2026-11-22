/**
 * The Data Import preview's Private choice per identity detail column: it defaults from the
 * private-label rule, follows a person's choice, and a new file starts from its own defaults.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { DataImportModal } from '../components/Import/DataImportModal';
import { ToastProvider } from '../contexts/ToastContext';

afterEach(() => cleanup());

const props = {
  open: true, onClose: vi.fn(), folders: [{ id: 'case', name: 'Fictional case', order: 0, createdAt: 1, updatedAt: 1 }], timelines: [],
  defaultFolderId: 'case', onCreateTimeline: vi.fn(), onImportComplete: vi.fn(),
};

async function parse(user: ReturnType<typeof userEvent.setup>, csv: string) {
  const input = screen.getAllByRole('textbox')[0];
  await user.clear(input);
  await user.click(input);
  await user.paste(csv);
  await user.click(screen.getByRole('button', { name: 'Parse & Preview' }));
}
const privateBox = (column: string) => screen.getByRole('checkbox', { name: `Import ${column} as a private detail` });

describe('the import preview\'s Private choice', () => {
  it('defaults from the column name, follows the person, and starts afresh for a new file', async () => {
    const user = userEvent.setup();
    render(<ToastProvider><DataImportModal {...props} /></ToastProvider>);
    await parse(user, 'Name,Company,Email,MobilePhone,Phone\nAda Quill,OpenSlaw.ai,ada@openslaw.example,+1 555 0142,+1 555 0100');
    expect(privateBox('Email')).not.toBeChecked();
    expect(privateBox('MobilePhone')).toBeChecked();
    expect(privateBox('Phone')).toBeChecked();
    await user.click(privateBox('Phone'));
    expect(privateBox('Phone')).not.toBeChecked();
    // Back, and another file with a Phone column: its own default again, not the last file's choice.
    await user.click(screen.getByRole('button', { name: /Back/ }));
    await parse(user, 'Name,Company,Phone\nLee Park,OpenSlaw.ai,+1 555 0199');
    expect(privateBox('Phone')).toBeChecked();
  });
});
