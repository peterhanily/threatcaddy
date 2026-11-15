import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render, screen } from '@testing-library/react';

const mocks = vi.hoisted(() => ({ prepare: vi.fn(), importKey: vi.fn(), setKey: vi.fn(), clearCache: vi.fn(), enabled: vi.fn() }));
vi.mock('../App', () => ({ default: () => <div>Workspace ready</div> }));
vi.mock('../db', () => ({ db: {} }));
vi.mock('../components/Encryption/PassphraseDialog', () => ({ PassphraseDialog: ({ initialError }: { initialError?: string }) => <div>Workspace locked {initialError}</div> }));
vi.mock('../lib/encryptionStore', () => ({ encryptionStorageKey: 'threatcaddy-encryption', isEncryptionEnabled: mocks.enabled, getEncryptionMeta: () => ({}), getCachedSession: () => ({ key: 'cached-fixture-key', unlockedAt: 1, expiresAt: 0 }), clearSessionCache: mocks.clearCache }));
vi.mock('../lib/crypto', () => ({ importSessionKey: mocks.importKey, base64ToArrayBuffer: () => new ArrayBuffer(32) }));
vi.mock('../lib/encryptionMiddleware', () => ({ setSessionKey: mocks.setKey, getSessionKey: () => mocks.importKey.mock.results[0]?.value, getSessionGeneration: () => 0, lockEncryptionSession: () => { mocks.setKey(null); mocks.clearCache(); window.dispatchEvent(new Event('workspace-locked')); } }));
vi.mock('../lib/workspace-lock', () => ({ restoreWorkspaceRecovery: vi.fn(async () => {}), RECOVERY_WARNING: 'Recovery warning' }));
vi.mock('../lib/workspace-initialization', () => ({ initializeWorkspace: mocks.prepare }));

import { AppShell } from '../components/Encryption/AppShell';
import { createInstance } from 'i18next';
import { I18nextProvider } from 'react-i18next';
import encryptionEn from '../../public/locales/en/encryption.json';
import encryptionDe from '../../public/locales/de/encryption.json';

beforeEach(() => { vi.clearAllMocks(); mocks.enabled.mockReturnValue(true); mocks.importKey.mockResolvedValue({}); });

describe('cached-key workspace preparation', () => {
  it('waits for coverage conversion before mounting the app', async () => {
    let complete = () => {};
    mocks.prepare.mockReturnValue(new Promise<void>(resolve => { complete = resolve; }));
    render(<AppShell />);
    expect(screen.queryByText('Workspace ready')).not.toBeInTheDocument();
    await act(async () => { complete(); });
    expect(screen.getByText('Workspace ready')).toBeInTheDocument();
  });

  it('keeps the app closed and exposes a recoverable conversion failure', async () => {
    mocks.prepare.mockRejectedValue(new Error('Storage unavailable'));
    render(<AppShell />);
    expect(await screen.findByText('Workspace locked Storage unavailable')).toBeInTheDocument();
    expect(screen.queryByText('Workspace ready')).not.toBeInTheDocument();
    expect(mocks.setKey).toHaveBeenLastCalledWith(null);
    expect(mocks.clearCache).toHaveBeenCalled();
  });

  it('shows the unsaved-work recovery warning in the interface language', async () => {
    const locale = createInstance();
    await locale.init({ lng: 'de', fallbackLng: 'en', defaultNS: 'encryption', interpolation: { escapeValue: false },
      resources: { en: { encryption: encryptionEn }, de: { encryption: encryptionDe } } });
    mocks.prepare.mockResolvedValue(undefined);
    render(<I18nextProvider i18n={locale}><AppShell /></I18nextProvider>);
    expect(await screen.findByText('Workspace ready')).toBeInTheDocument();
    await act(async () => {
      mocks.setKey(null);
      window.dispatchEvent(new CustomEvent('workspace-locked', { detail: { recoveryFailed: true } }));
    });
    const german = (encryptionDe as Record<string, string>)['passphrase.recoveryWarning'];
    expect(german).toBeTruthy();
    expect(screen.getByText(`Workspace locked ${german}`)).toBeInTheDocument();
  });

  it('requires fresh initialization after encryption is disabled in another tab', async () => {
    mocks.prepare.mockResolvedValue(undefined);
    render(<AppShell />);
    expect(await screen.findByText('Workspace ready')).toBeInTheDocument();
    await act(async () => {
      mocks.enabled.mockReturnValue(false);
      window.dispatchEvent(new StorageEvent('storage', { key: 'threatcaddy-encryption' }));
    });
    expect(screen.queryByText('Workspace ready')).not.toBeInTheDocument();
    expect(screen.getByText('Reload to retry')).toBeInTheDocument();
    expect(mocks.setKey).toHaveBeenLastCalledWith(null);
  });
});
