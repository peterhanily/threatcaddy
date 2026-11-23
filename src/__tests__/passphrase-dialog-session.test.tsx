import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { generateMasterKey, arrayBufferToBase64, base64ToArrayBuffer, deriveWrappingKey, wrapMasterKey, generateSalt } from '../lib/crypto';
import { setEncryptionMeta, clearEncryptionMeta, getEncryptionMeta, getCachedSession } from '../lib/encryptionStore';
import { getSessionKey, lockEncryptionSession, setSessionKey } from '../lib/encryptionMiddleware';

const derive = vi.hoisted(() => async (passphrase: string, salt: ArrayBuffer) => crypto.subtle.deriveKey(
  { name: 'PBKDF2', salt, iterations: 1, hash: 'SHA-256' },
  await crypto.subtle.importKey('raw', new TextEncoder().encode(passphrase), 'PBKDF2', false, ['deriveKey']),
  { name: 'AES-KW', length: 256 }, false, ['wrapKey', 'unwrapKey'],
));
// The same PBKDF2 to AES-KW contract with a test-sized work factor.
vi.mock('../lib/crypto', async importOriginal => ({ ...await importOriginal<typeof import('../lib/crypto')>(), deriveWrappingKey: vi.fn(derive) }));
vi.mock('../lib/workspace-initialization', () => ({ initializeWorkspace: vi.fn(async () => {}) }));
vi.mock('../lib/page-reload', () => ({ reloadPage: vi.fn() }));
import { initializeWorkspace } from '../lib/workspace-initialization';
import { PassphraseDialog } from '../components/Encryption/PassphraseDialog';
import { reloadPage } from '../lib/page-reload';

const PASSPHRASE = 'fictional correct passphrase';
const SESSION_CHANGED = 'The encryption session changed while unlocking';

beforeEach(async () => {
  clearEncryptionMeta(); setSessionKey(null);
  const key = await generateMasterKey();
  const salt = generateSalt();
  const wrapped = await wrapMasterKey(key, await deriveWrappingKey(PASSPHRASE, base64ToArrayBuffer(salt)));
  setEncryptionMeta({
    version: 1, salt, wrappedKey: arrayBufferToBase64(wrapped), recoverySalt: 'test', recoveryWrappedKey: 'test',
    enabledAt: 1, coverageVersion: 2, sessionDuration: '1h',
  });
});
afterEach(() => { cleanup(); vi.clearAllMocks(); clearEncryptionMeta(); setSessionKey(null); });

function unlock(passphrase = PASSPHRASE) {
  fireEvent.change(screen.getByLabelText('Enter your passphrase to unlock your encrypted data.'), { target: { value: passphrase } });
  fireEvent.click(screen.getByRole('button', { name: 'Unlock' }));
}

describe('PassphraseDialog when the session changes during unlock', () => {
  it('explains the change when another tab locks the session after the key is accepted', async () => {
    const onUnlocked = vi.fn();
    vi.mocked(initializeWorkspace).mockImplementationOnce(async () => { lockEncryptionSession(); });
    render(<PassphraseDialog onUnlocked={onUnlocked} />);
    unlock();
    expect(await screen.findByRole('alert')).toHaveTextContent(SESSION_CHANGED);
    expect(onUnlocked).not.toHaveBeenCalled();
    expect(getSessionKey()).toBeNull();
    expect(getCachedSession()).toBeNull();
    expect(screen.getByRole('button', { name: 'Unlock' })).toBeEnabled();
  });

  it('does not call the passphrase wrong when encryption settings change while it is checked', async () => {
    const meta = getEncryptionMeta();
    vi.mocked(deriveWrappingKey).mockImplementationOnce(async (passphrase, salt) => {
      if (meta) setEncryptionMeta({ ...meta, sessionDuration: '8h' });
      return derive(passphrase, salt);
    });
    render(<PassphraseDialog onUnlocked={vi.fn()} />);
    unlock();
    expect(await screen.findByRole('alert')).toHaveTextContent(SESSION_CHANGED);
    expect(screen.getByRole('alert')).not.toHaveTextContent('Wrong passphrase');
  });

  it('still reports a wrong passphrase as wrong', async () => {
    render(<PassphraseDialog onUnlocked={vi.fn()} />);
    unlock('fictional wrong passphrase');
    expect(await screen.findByRole('alert')).toHaveTextContent('Wrong passphrase.');
  });
});

describe('PassphraseDialog Delete All Data', () => {
  it('forgets the names ignored on this device, which are not in the database it deletes', async () => {
    localStorage.setItem('threatcaddy-identities-ignored-v3', JSON.stringify({ v: 3, folders: { case: ['2510b5d1324d7e48'] } }));
    render(<PassphraseDialog onUnlocked={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Forgot passphrase?' }));
    fireEvent.change(screen.getByLabelText('Type DELETE to confirm.'), { target: { value: 'DELETE' } });
    fireEvent.click(screen.getByRole('button', { name: 'Delete All Data & Start Fresh' }));
    await vi.waitFor(() => expect(reloadPage).toHaveBeenCalled());
    expect(localStorage.getItem('threatcaddy-identities-ignored-v3')).toBeNull();
  });
});
