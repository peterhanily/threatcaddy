import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render, screen } from '@testing-library/react';

const mocks = vi.hoisted(() => ({ prepare: vi.fn(), importKey: vi.fn(), setKey: vi.fn(), clearCache: vi.fn(), enabled: vi.fn() }));
vi.mock('../App', () => ({ default: () => <div>Workspace ready</div> }));
vi.mock('../db', () => ({ db: {} }));
vi.mock('../components/Encryption/PassphraseDialog', () => ({ PassphraseDialog: ({ initialError }: { initialError?: string }) => <div>Workspace locked {initialError}</div> }));
vi.mock('../lib/encryptionStore', () => ({ encryptionStorageKey: 'threatcaddy-encryption', isEncryptionEnabled: mocks.enabled, getCachedSessionKey: () => 'cached-fixture-key', clearSessionCache: mocks.clearCache }));
vi.mock('../lib/crypto', () => ({ importSessionKey: mocks.importKey, base64ToArrayBuffer: () => new ArrayBuffer(32) }));
vi.mock('../lib/encryptionMiddleware', () => ({ setSessionKey: mocks.setKey, getSessionKey: () => ({}) }));
vi.mock('../lib/workspace-initialization', () => ({ initializeWorkspace: mocks.prepare }));

import { AppShell } from '../components/Encryption/AppShell';

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
