import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ShareDialog } from '../components/ExecMode/ShareDialog';
import { sanitizeSharePayload } from '../lib/share-data';

const mocked = vi.hoisted(() => ({ encode: vi.fn(), url: vi.fn() }));
vi.mock('../lib/share', () => ({ encodeSharePayload: (...args: unknown[]) => mocked.encode(...args),
  buildShareUrl: (code: string) => mocked.url(code), MAX_URL_LENGTH: 40 }));
vi.mock('../contexts/AuthContext', () => ({ useAuth: () => ({ connected: false }) }));
vi.mock('../lib/sync-engine', () => ({ syncEngine: {} }));

function deferred<T>() {
  let resolve: (value: T) => void = () => {};
  const promise = new Promise<T>(yes => { resolve = yes; });
  return { promise, resolve };
}
const note = (content: string) => sanitizeSharePayload({ v: 1, s: 'note', t: 1, d: { id: 'same-note', title: 'Same note', content } });
const base = { open: true, onClose: vi.fn() };
function generate() {
  fireEvent.change(screen.getByPlaceholderText('Enter password...'), { target: { value: 'ordinary-test-password' } });
  fireEvent.click(screen.getByRole('button', { name: 'Generate Share Link' }));
}
beforeEach(() => {
  vi.clearAllMocks();
  mocked.url.mockImplementation((code: string) => `https://app.test/#share=${code}`);
});
afterEach(cleanup);

describe('share dialog content ownership', () => {
  it('replaces ownership when content changes on the same entity, ignoring a pending old encode', async () => {
    const oldEncode = deferred<string>();
    const newEncode = deferred<string>();
    mocked.encode.mockReturnValueOnce(oldEncode.promise).mockReturnValueOnce(newEncode.promise);
    const first = note('First content');
    const second = note('Second content');
    const view = render(<ShareDialog {...base} payload={first} />);
    generate();
    view.rerender(<ShareDialog {...base} payload={second} />);
    expect(screen.getByPlaceholderText('Enter password...')).toHaveValue('');
    generate();
    await act(async () => { newEncode.resolve('new'); oldEncode.resolve('old'); });
    expect(screen.getByText('https://app.test/#share=new')).toBeInTheDocument();
    expect(screen.queryByText('https://app.test/#share=old')).not.toBeInTheDocument();
    expect(mocked.encode.mock.calls[1][0].d.content).toBe('Second content');
  });

  it('preserves unchanged password input and generated content across incidental renders', async () => {
    mocked.encode.mockResolvedValue('current');
    const payload = note('Unchanged content');
    const view = render(<ShareDialog {...base} payload={payload} />);
    fireEvent.change(screen.getByPlaceholderText('Enter password...'), { target: { value: 'keep-this-input' } });
    view.rerender(<ShareDialog {...base} payload={payload} onClose={vi.fn()} />);
    expect(screen.getByPlaceholderText('Enter password...')).toHaveValue('keep-this-input');
    fireEvent.click(screen.getByRole('button', { name: 'Generate Share Link' }));
    await screen.findByText('https://app.test/#share=current');
    view.rerender(<ShareDialog {...base} payload={payload} onClose={vi.fn()} />);
    expect(screen.getByText('https://app.test/#share=current')).toBeInTheDocument();
    expect(mocked.encode).toHaveBeenCalledOnce();
  });

  it('labels oversized raw codes honestly without promising a nonexistent paste workflow', async () => {
    mocked.encode.mockResolvedValue('ordinary-code');
    mocked.url.mockReturnValue('https://app.test/#share=ordinary-long-code-example');
    render(<ShareDialog {...base} payload={note('Normal content')} />);
    generate();
    expect(await screen.findByRole('button', { name: 'Copy Raw Share Code' })).toBeInTheDocument();
    expect(screen.getByText(/raw share code below is not a backup file/)).toBeInTheDocument();
    expect(screen.queryByText(/They can paste it into the import dialog/)).not.toBeInTheDocument();
  });
});
