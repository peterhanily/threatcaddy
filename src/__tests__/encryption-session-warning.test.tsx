import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { generateMasterKey, exportKeyRaw, arrayBufferToBase64, base64ToArrayBuffer, deriveWrappingKey, wrapMasterKey, generateSalt } from '../lib/crypto';
import { setEncryptionMeta, clearEncryptionMeta, cacheSessionKey, getCachedSession, getEncryptionMeta } from '../lib/encryptionStore';
import { getSessionKey, setSessionKey } from '../lib/encryptionMiddleware';

vi.mock('../lib/crypto', async importOriginal => {
  const actual = await importOriginal<typeof import('../lib/crypto')>();
  // The same PBKDF2 to AES-KW contract with a test-sized work factor.
  const derive = async (passphrase: string, salt: ArrayBuffer) => crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt, iterations: 1, hash: 'SHA-256' },
    await crypto.subtle.importKey('raw', new TextEncoder().encode(passphrase), 'PBKDF2', false, ['deriveKey']),
    { name: 'AES-KW', length: 256 }, false, ['wrapKey', 'unwrapKey'],
  );
  return { ...actual, deriveWrappingKey: vi.fn(derive) };
});
const app = vi.hoisted(() => ({ formOpen: false, closeForm: vi.fn() }));
vi.mock('../App', async () => {
  const { Modal } = await import('../components/Common/Modal');
  return { default: () => <>
    <div>Private workspace content</div>
    <Modal open={app.formOpen} onClose={app.closeForm} title="Edit task"><input aria-label="Task description" /></Modal>
  </> };
});
vi.mock('../components/Encryption/PassphraseDialog', () => ({ PassphraseDialog: () => <div>Workspace locked</div> }));
vi.mock('../lib/workspace-initialization', () => ({ initializeWorkspace: vi.fn(async () => {}) }));
import { AppShell } from '../components/Encryption/AppShell';

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const START = 1_800_000_000_000;
const PASSPHRASE = 'fictional correct passphrase';
let raw: string;

beforeEach(async () => {
  clearEncryptionMeta(); setSessionKey(null);
  vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(START);
  const key = await generateMasterKey();
  raw = arrayBufferToBase64(await exportKeyRaw(key));
  const salt = generateSalt();
  const wrapped = await wrapMasterKey(key, await deriveWrappingKey(PASSPHRASE, base64ToArrayBuffer(salt)));
  setEncryptionMeta({
    version: 1, salt, wrappedKey: arrayBufferToBase64(wrapped), recoverySalt: 'test', recoveryWrappedKey: 'test',
    enabledAt: 1, coverageVersion: 2, sessionDuration: '1h',
  });
  cacheSessionKey(raw, '1h', START);
});
afterEach(() => { cleanup(); app.formOpen = false; vi.restoreAllMocks(); vi.useRealTimers(); clearEncryptionMeta(); setSessionKey(null); });

async function openWorkspace() {
  render(<AppShell />);
  await screen.findByText('Private workspace content');
  // Run the session timers on the fake clock from the original unlock time.
  vi.useFakeTimers({ toFake: ['Date', 'setTimeout', 'clearTimeout'] }); vi.setSystemTime(START);
  act(() => { setSessionKey(getSessionKey(), raw, START); });
}
const warning = () => screen.queryByRole('region', { name: 'Workspace locks soon' });
async function submit(passphrase: string) {
  fireEvent.change(screen.getByLabelText('Current passphrase'), { target: { value: passphrase } });
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Stay unlocked' })); });
}

describe('timed session expiry warning', () => {
  it('warns two minutes before the deadline and still locks at the deadline if ignored', async () => {
    await openWorkspace();
    act(() => { vi.advanceTimersByTime(HOUR - 2 * MINUTE - 1); });
    expect(warning()).not.toBeInTheDocument();
    act(() => { vi.advanceTimersByTime(1); });
    expect(warning()).toBeInTheDocument();
    expect(warning()).toHaveTextContent(/other unsaved form input is lost/);
    expect(screen.getByText('Private workspace content')).toBeInTheDocument();
    act(() => { vi.advanceTimersByTime(2 * MINUTE); });
    expect(screen.getByText('Workspace locked')).toBeInTheDocument();
    expect(warning()).not.toBeInTheDocument();
    expect(getSessionKey()).toBeNull();
  });

  it('shows the warning at once when the workspace opens inside the warning window', async () => {
    vi.setSystemTime(START + HOUR - MINUTE);
    render(<AppShell />);
    await screen.findByText('Private workspace content');
    expect(warning()).toBeInTheDocument();
  });

  it('restarts the timed session from now after the passphrase is entered again', async () => {
    await openWorkspace();
    act(() => { vi.advanceTimersByTime(HOUR - MINUTE); });
    await submit(PASSPHRASE);
    await vi.waitFor(() => expect(warning()).not.toBeInTheDocument(), { timeout: 10_000 });
    const renewed = getCachedSession();
    expect(renewed?.unlockedAt).toBeGreaterThanOrEqual(START + HOUR - MINUTE);
    expect(renewed?.expiresAt).toBe((renewed?.unlockedAt ?? 0) + HOUR);
    act(() => { vi.advanceTimersByTime(2 * MINUTE); });
    expect(screen.getByText('Private workspace content')).toBeInTheDocument();
    expect(getSessionKey()).not.toBeNull();
    act(() => { vi.advanceTimersByTime((renewed?.expiresAt ?? 0) - Date.now()); });
    expect(screen.getByText('Workspace locked')).toBeInTheDocument();
  });

  it('rejects a wrong passphrase without extending the deadline', async () => {
    await openWorkspace();
    act(() => { vi.advanceTimersByTime(HOUR - MINUTE); });
    await submit('fictional wrong passphrase');
    await vi.waitFor(() => expect(warning()).toHaveTextContent('Wrong passphrase.'), { timeout: 10_000 });
    expect(getCachedSession()?.expiresAt).toBe(START + HOUR);
    act(() => { vi.advanceTimersByTime(START + HOUR - Date.now()); });
    expect(screen.getByText('Workspace locked')).toBeInTheDocument();
  });

  it('accepts the passphrase while an open form dialog keeps its own focus trap', async () => {
    app.formOpen = true;
    await openWorkspace();
    act(() => { vi.advanceTimersByTime(HOUR - MINUTE); });
    const input = screen.getByLabelText('Current passphrase');
    act(() => { input.focus(); });
    expect(input).toHaveFocus();
    fireEvent.keyDown(input, { key: 'Escape' });
    expect(app.closeForm).not.toHaveBeenCalled();
    expect(screen.getByLabelText('Task description')).toBeInTheDocument();
  });

  it('keeps Escape typed in the warning away from the global Escape shortcut', async () => {
    // useKeyboardShortcuts listens on window and closes app views such as
    // Settings, which would unmount an open editor and lose its text.
    const globalEscape = vi.fn();
    const listener = (event: KeyboardEvent) => { if (event.key === 'Escape') globalEscape(); };
    window.addEventListener('keydown', listener);
    try {
      await openWorkspace();
      act(() => { vi.advanceTimersByTime(HOUR - MINUTE); });
      fireEvent.keyDown(screen.getByText('Private workspace content'), { key: 'Escape' });
      expect(globalEscape).toHaveBeenCalledTimes(1);
      fireEvent.keyDown(screen.getByLabelText('Current passphrase'), { key: 'Escape' });
      expect(globalEscape).toHaveBeenCalledTimes(1);
      expect(warning()).toBeInTheDocument();
    } finally {
      window.removeEventListener('keydown', listener);
    }
  });

  it('is announced and reachable with Tab from an open form dialog, and Tab returns to the form', async () => {
    app.formOpen = true;
    await openWorkspace();
    act(() => { vi.advanceTimersByTime(HOUR - MINUTE); });
    expect(within(screen.getByRole('region', { name: 'Workspace locks soon' })).getByRole('alert')).toHaveTextContent(/This workspace locks at/);
    const task = screen.getByLabelText('Task description');
    const input = screen.getByLabelText('Current passphrase');
    act(() => { task.focus(); });
    fireEvent.keyDown(task, { key: 'Tab' });
    expect(input).toHaveFocus();
    fireEvent.keyDown(input, { key: 'Tab', shiftKey: true });
    expect(task).toHaveFocus();
    fireEvent.keyDown(task, { key: 'Tab' });
    fireEvent.keyDown(input, { key: 'Tab' });
    expect(screen.getByRole('button', { name: 'Close' })).toHaveFocus();
    expect(screen.getByLabelText('Task description')).toBeInTheDocument();
  });

  it('lifts aria-modal from an open form dialog while the warning is shown, and restores it afterwards', async () => {
    // Screen readers that honour aria-modal treat the warning, outside the dialog, as inert.
    app.formOpen = true;
    await openWorkspace();
    const dialog = screen.getByRole('dialog', { name: 'Edit task' });
    expect(dialog).toHaveAttribute('aria-modal', 'true');
    act(() => { vi.advanceTimersByTime(HOUR - MINUTE); });
    expect(warning()).toBeInTheDocument();
    expect(document.querySelectorAll('[aria-modal="true"]')).toHaveLength(0);
    await submit(PASSPHRASE);
    await vi.waitFor(() => expect(warning()).not.toBeInTheDocument(), { timeout: 10_000 });
    expect(dialog).toHaveAttribute('aria-modal', 'true');
    expect(screen.getByLabelText('Task description')).toBeInTheDocument();
  });

  it('does not revive the key when the deadline passes while the passphrase is being checked', async () => {
    await openWorkspace();
    act(() => { vi.advanceTimersByTime(HOUR - MINUTE); });
    let derive!: () => void;
    const wrappingKey = deriveWrappingKey(PASSPHRASE, base64ToArrayBuffer(getEncryptionMeta()?.salt ?? ''));
    vi.mocked(deriveWrappingKey).mockImplementationOnce(() => new Promise(resolve => { derive = () => resolve(wrappingKey); }));
    await submit(PASSPHRASE);
    act(() => { vi.advanceTimersByTime(MINUTE); });
    expect(screen.getByText('Workspace locked')).toBeInTheDocument();
    await act(async () => { derive(); await wrappingKey; });
    await vi.waitFor(() => expect(getCachedSession()).toBeNull());
    expect(getSessionKey()).toBeNull();
    expect(screen.getByText('Workspace locked')).toBeInTheDocument();
  });

  it('locks instead of extending when the deadline has passed but its suspended timer has not fired', async () => {
    await openWorkspace();
    act(() => { vi.advanceTimersByTime(HOUR - MINUTE); });
    // A sleeping device: the clock is past the deadline, the expiry timer has not run.
    vi.setSystemTime(START + HOUR + MINUTE);
    await submit(PASSPHRASE);
    await vi.waitFor(() => expect(screen.getByText('Workspace locked')).toBeInTheDocument(), { timeout: 10_000 });
    expect(getSessionKey()).toBeNull();
    expect(getCachedSession()).toBeNull();
  });
});
