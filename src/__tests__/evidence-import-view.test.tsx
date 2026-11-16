import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { EvidenceView } from '../components/Evidence/EvidenceView';
import type { EvidenceItem } from '../types';

const i18n = vi.hoisted(() => ({ t: (key: string) => key }));
vi.mock('react-i18next', () => ({ useTranslation: () => i18n }));
const file = new File(['Synthetic evidence'], 'report.txt', { type: 'text/plain' });
function fileInput(container: HTMLElement): Element {
  const input = container.querySelector('input[type=file]');
  if (!input) throw new Error('Expected the evidence file picker');
  return input;
}
function waitingImport() {
  return vi.fn((_files: File[], signal?: AbortSignal) => new Promise<EvidenceItem[]>((_resolve, reject) => {
    signal?.addEventListener('abort', () => reject(signal.reason), { once: true });
  }));
}

describe('evidence import cancellation controls', () => {
  it('lets the analyst cancel then retry without leaving the import button stuck', async () => {
    const onImportFiles = waitingImport();
    const { container, unmount } = render(<EvidenceView folderId="case" items={[]} onImportFiles={onImportFiles} onOpenChat={() => {}} />);
    const input = fileInput(container);
    fireEvent.change(input, { target: { files: [file] } });
    expect(onImportFiles).toHaveBeenCalledOnce();
    expect(onImportFiles.mock.calls[0][1]?.aborted).toBe(false);
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'common:cancel' })); });
    expect(onImportFiles.mock.calls[0][1]?.aborted).toBe(true);
    await waitFor(() => expect(screen.getByRole('button', { name: 'actions.import' })).not.toBeDisabled());
    fireEvent.change(input, { target: { files: [file] } });
    expect(onImportFiles).toHaveBeenCalledTimes(2);
    expect(onImportFiles.mock.calls[1][1]?.aborted).toBe(false);
    await act(async () => { unmount(); });
  });

  it('cancels the old destination on folder changes and the current destination on unmount', async () => {
    const onImportFiles = waitingImport();
    const props = { items: [], onImportFiles, onOpenChat: () => {} };
    const { container, rerender, unmount } = render(<EvidenceView {...props} folderId="first" />);
    fireEvent.change(fileInput(container), { target: { files: [file] } });
    await act(async () => { rerender(<EvidenceView {...props} folderId="second" />); });
    expect(onImportFiles.mock.calls[0][1]?.aborted).toBe(true);
    expect(screen.getByRole('button', { name: 'actions.import' })).not.toBeDisabled();
    fireEvent.change(fileInput(container), { target: { files: [file] } });
    expect(onImportFiles.mock.calls[1][1]?.aborted).toBe(false);
    await act(async () => { unmount(); });
    expect(onImportFiles.mock.calls[1][1]?.aborted).toBe(true);
  });

  it('clears the file picker as soon as files are read, so the same file can be chosen after a folder change', async () => {
    const onImportFiles = waitingImport();
    const props = { items: [], onImportFiles, onOpenChat: () => {} };
    const { container, rerender, unmount } = render(<EvidenceView {...props} folderId="first" />);
    const input = fileInput(container) as HTMLInputElement;
    // Browsers fire no change event for an unchanged selection.
    const assigned = vi.spyOn(input, 'value', 'set');
    fireEvent.change(input, { target: { files: [file] } });
    expect(assigned).toHaveBeenCalledWith('');
    await act(async () => { rerender(<EvidenceView {...props} folderId="second" />); });
    expect(onImportFiles.mock.calls[0][1]?.aborted).toBe(true);
    expect(assigned).toHaveBeenLastCalledWith('');
    await act(async () => { unmount(); });
  });

  it('disables importing and states why when the destination cannot accept evidence', async () => {
    const onImportFiles = waitingImport();
    const { container } = render(<EvidenceView folderId="case" items={[]} onImportFiles={onImportFiles} onOpenChat={() => {}} importBlockedReason="screenshareActive" />);
    expect(screen.getByRole('button', { name: 'actions.import' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'dropzone.browse' })).toBeDisabled();
    expect(screen.getByRole('status')).toHaveTextContent('importError.screenshareActive');
    const dropzone = screen.getByText('dropzone.label').closest('div[class*="border-dashed"]');
    if (!dropzone) throw new Error('Expected the evidence drop zone');
    fireEvent.drop(dropzone, { dataTransfer: { files: [file] } });
    fireEvent.change(fileInput(container), { target: { files: [file] } });
    expect(onImportFiles).not.toHaveBeenCalled();
    expect(screen.getByText('importError.screenshareActive', { selector: 'span' })).toBeVisible();
  });
});
