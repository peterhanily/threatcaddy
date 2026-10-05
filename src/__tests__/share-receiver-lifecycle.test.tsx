import { StrictMode } from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ShareReceiver } from '../components/ExecMode/ShareReceiver';
import { sanitizeSharePayload } from '../lib/share-data';
import type { SharePayload } from '../lib/share';

const mocked = vi.hoisted(() => ({ decode: vi.fn() }));
vi.mock('../lib/share', () => ({ decodeSharePayload: (...args: unknown[]) => mocked.decode(...args),
  isEncryptedShare: (data: string) => data.startsWith('encrypted') }));

function deferred<T>() {
  let resolve: (value: T) => void = () => {};
  let reject: (error: Error) => void = () => {};
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
const note = (title: string) => sanitizeSharePayload({ v: 1, s: 'note', t: 1, d: { id: title, title, content: '**Ordinary shared text**' } });
const base = { theme: 'dark' as const, onDismiss: vi.fn() };
beforeEach(() => vi.clearAllMocks());
afterEach(cleanup);

describe('shared-content receiver lifecycle', () => {
  it('only displays and saves the current link when decodes finish out of order', async () => {
    const a = deferred<SharePayload>();
    const b = deferred<SharePayload>();
    mocked.decode.mockImplementation((code: string) => code === 'a' ? a.promise : b.promise);
    const save = vi.fn().mockResolvedValue(undefined);
    const view = render(<ShareReceiver {...base} encodedData="a" onSave={save} />);
    view.rerender(<ShareReceiver {...base} encodedData="b" onSave={save} />);
    await act(async () => { b.resolve(note('Current share')); });
    await act(async () => { a.resolve(note('Previous share')); });
    expect(screen.getByRole('heading', { name: 'Current share' })).toBeInTheDocument();
    expect(screen.queryByText('Previous share')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Save as new copy' }));
    await waitFor(() => expect(save).toHaveBeenCalledOnce());
    expect(save.mock.calls[0][0].d.title).toBe('Current share');
  });

  it('does not apply a previous link save completion to a new link', async () => {
    mocked.decode.mockImplementation(async (code: string) => note(code));
    const pendingSave = deferred<void>();
    const save = vi.fn().mockReturnValue(pendingSave.promise);
    const view = render(<ShareReceiver {...base} encodedData="First share" onSave={save} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Save as new copy' }));
    expect(screen.getByRole('button', { name: 'Saving...' })).toBeDisabled();
    view.rerender(<ShareReceiver {...base} encodedData="Second share" onSave={save} />);
    await screen.findByRole('heading', { name: 'Second share' });
    await act(async () => { pendingSave.resolve(); });
    expect(screen.getByRole('button', { name: 'Save as new copy' })).toBeEnabled();
    expect(screen.queryByRole('button', { name: 'Saved' })).not.toBeInTheDocument();
  });

  it('resets passwords on link change and ignores the previous decryption result', async () => {
    const oldDecode = deferred<SharePayload>();
    mocked.decode.mockReturnValue(oldDecode.promise);
    const view = render(<ShareReceiver {...base} encodedData="encrypted-a" />);
    fireEvent.change(screen.getByPlaceholderText('Enter password...'), { target: { value: 'ordinary-test-password' } });
    fireEvent.click(screen.getByRole('button', { name: 'Decrypt' }));
    view.rerender(<ShareReceiver {...base} encodedData="encrypted-b" />);
    expect(screen.getByPlaceholderText('Enter password...')).toHaveValue('');
    await act(async () => { oldDecode.resolve(note('Old decrypted note')); });
    expect(screen.queryByText('Old decrypted note')).not.toBeInTheDocument();
    expect(screen.getByPlaceholderText('Enter password...')).toHaveValue('');
  });

  it('survives Strict Mode effect replay and renders sanitized legacy content', async () => {
    mocked.decode.mockResolvedValue(note('Legacy note'));
    render(<StrictMode><ShareReceiver {...base} encodedData="legacy" /></StrictMode>);
    expect(await screen.findByRole('heading', { name: 'Legacy note' })).toBeInTheDocument();
    expect(screen.getByText('Ordinary shared text').tagName).toBe('STRONG');
  });

  it('shows a save failure and allows an explicit retry', async () => {
    mocked.decode.mockResolvedValue(note('Retryable share'));
    const save = vi.fn().mockRejectedValueOnce(new Error('Synthetic storage interruption')).mockResolvedValue(undefined);
    render(<ShareReceiver {...base} encodedData="retry" onSave={save} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Save as new copy' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Synthetic storage interruption');
    fireEvent.click(screen.getByRole('button', { name: 'Save as new copy' }));
    expect(await screen.findByRole('button', { name: 'Saved' })).toBeDisabled();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(save).toHaveBeenCalledTimes(2);
  });

  it('does not offer a misleading save action for an unsupported single-entity view', async () => {
    mocked.decode.mockResolvedValue(sanitizeSharePayload({ v: 1, s: 'ioc', t: 1, d: { id: 'ioc', type: 'domain', value: 'example.test' } }));
    render(<ShareReceiver {...base} encodedData="single-ioc" onSave={vi.fn()} />);
    expect(await screen.findByText('Unsupported share type: ioc')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Save as new copy' })).not.toBeInTheDocument();
  });
});
