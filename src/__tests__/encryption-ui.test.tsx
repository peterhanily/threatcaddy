import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

// ── Mocks ────────────────────────────────────────────────────────────
// vi.mock paths are resolved relative to the test file

vi.mock('../lib/crypto', () => ({
  generateMasterKey: vi.fn(async () => ({})),
  deriveWrappingKey: vi.fn(async () => ({})),
  wrapMasterKey: vi.fn(async () => new ArrayBuffer(32)),
  unwrapMasterKey: vi.fn(async () => ({})),
  exportKeyRaw: vi.fn(async () => new ArrayBuffer(32)),
  generateRecoveryPhrase: vi.fn(() => 'word1 word2 word3 word4 word5 word6 word7 word8 word9 word10 word11 word12 word13 word14 word15 word16 word17 word18 word19 word20 word21 word22 word23 word24'),
  generateSalt: vi.fn(() => 'dGVzdC1zYWx0'),
  arrayBufferToBase64: vi.fn(() => 'dGVzdC1rZXk='),
  base64ToArrayBuffer: vi.fn(() => new ArrayBuffer(16)),
  isSecureContext: vi.fn(() => true),
}));

const mockIsEncryptionEnabled = vi.fn(() => false);
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const mockGetEncryptionMeta = vi.fn((): any => null);
const mockGetSessionDuration = vi.fn(() => 'tab-close' as const);

vi.mock('../lib/encryptionStore', () => ({
  setEncryptionMeta: vi.fn(),
  getEncryptionMeta: (...args: unknown[]) => mockGetEncryptionMeta(...args as []),
  clearEncryptionMeta: vi.fn(),
  isEncryptionEnabled: (...args: unknown[]) => mockIsEncryptionEnabled(...args as []),
  getSessionDuration: (...args: unknown[]) => mockGetSessionDuration(...args as []),
  cacheSessionKey: vi.fn(),
  clearSessionCache: vi.fn(),
  SESSION_DURATION_LABELS: {
    'every-load': 'Every page load',
    'tab-close': 'Until tab is closed',
    '1h': '1 hour',
    '8h': '8 hours',
    '24h': '24 hours',
  },
}));

vi.mock('../lib/encryptionMiddleware', () => ({
  setSessionKey: vi.fn(),
  encryptAllExistingData: vi.fn(async () => {}),
  decryptAllExistingData: vi.fn(async () => {}),
  getSessionKeyRaw: vi.fn(() => null),
}));

vi.mock('../db', () => ({
  db: { delete: vi.fn(async () => {}) },
}));

vi.mock('../contexts/ToastContext', () => ({
  useToast: () => ({ addToast: vi.fn(), toasts: [], removeToast: vi.fn() }),
}));
// Storage-backed cleanup consent is covered separately by legacy-cleanup-ui.
vi.mock('../components/Encryption/LegacyDataCleanup', () => ({ LegacyDataCleanup: () => null }));
vi.mock('../components/Encryption/LegacyDataRecovery', () => ({ LegacyDataRecovery: () => null }));
vi.mock('../lib/db-migration', () => ({ getLegacyCleanupStatus: vi.fn(async () => ({ exists: false, verified: false, records: 0 })) }));

// Import after all mocks
import { EncryptionSetup } from '../components/Encryption/EncryptionSetup';
import { PassphraseDialog } from '../components/Encryption/PassphraseDialog';
import { EncryptionSettings } from '../components/Encryption/EncryptionSettings';

// ── Helpers ──────────────────────────────────────────────────────────

function changeInput(input: HTMLElement, value: string) {
  fireEvent.change(input, { target: { value } });
}

// ── EncryptionSetup ──────────────────────────────────────────────────

describe('EncryptionSetup', () => {
  it('renders nothing when closed', () => {
    const { container } = render(
      <EncryptionSetup open={false} onClose={vi.fn()} onEnabled={vi.fn()} />,
    );
    expect(container.innerHTML).toBe('');
  });

  it('renders step 1 with passphrase fields when open', () => {
    render(
      <EncryptionSetup open={true} onClose={vi.fn()} onEnabled={vi.fn()} />,
    );
    expect(screen.getByText('Enable Encryption')).toBeInTheDocument();
    expect(screen.getByText(/Step 1 of 2/)).toBeInTheDocument();
    expect(screen.getByPlaceholderText('Enter passphrase...')).toBeInTheDocument();
    expect(screen.getByPlaceholderText('Confirm passphrase...')).toBeInTheDocument();
  });

  it('shows error when passphrase is too short', () => {
    render(
      <EncryptionSetup open={true} onClose={vi.fn()} onEnabled={vi.fn()} />,
    );
    const passInput = screen.getByPlaceholderText('Enter passphrase...');
    const confirmInput = screen.getByPlaceholderText('Confirm passphrase...');

    changeInput(passInput, 'short');
    changeInput(confirmInput, 'short');
    fireEvent.click(screen.getByText('Continue'));

    expect(screen.getByText('Passphrase must be at least 8 characters.')).toBeInTheDocument();
  });

  it('shows error when passphrases do not match', () => {
    render(
      <EncryptionSetup open={true} onClose={vi.fn()} onEnabled={vi.fn()} />,
    );
    const passInput = screen.getByPlaceholderText('Enter passphrase...');
    const confirmInput = screen.getByPlaceholderText('Confirm passphrase...');

    changeInput(passInput, 'valid-passphrase-123');
    changeInput(confirmInput, 'different-passphrase');
    fireEvent.click(screen.getByText('Continue'));

    expect(screen.getByText('Passphrases do not match.')).toBeInTheDocument();
  });

  it('advances to step 2 when valid passphrase is provided', () => {
    render(
      <EncryptionSetup open={true} onClose={vi.fn()} onEnabled={vi.fn()} />,
    );
    const passInput = screen.getByPlaceholderText('Enter passphrase...');
    const confirmInput = screen.getByPlaceholderText('Confirm passphrase...');

    changeInput(passInput, 'my-strong-passphrase');
    changeInput(confirmInput, 'my-strong-passphrase');
    fireEvent.click(screen.getByText('Continue'));

    expect(screen.getByText(/Step 2 of 2/)).toBeInTheDocument();
    expect(screen.getByText(/Save Recovery Key/)).toBeInTheDocument();
  });

  it('disables Continue button when fields are empty', () => {
    render(
      <EncryptionSetup open={true} onClose={vi.fn()} onEnabled={vi.fn()} />,
    );
    const continueBtn = screen.getByText('Continue');
    expect(continueBtn).toBeDisabled();
  });
});

// ── PassphraseDialog ─────────────────────────────────────────────────

describe('PassphraseDialog', () => {
  it('renders passphrase input and unlock button', () => {
    render(<PassphraseDialog onUnlocked={vi.fn()} />);
    expect(screen.getByText('Unlock ThreatCaddy')).toBeInTheDocument();
    expect(screen.getByPlaceholderText('Enter passphrase...')).toBeInTheDocument();
    expect(screen.getByText('Unlock')).toBeInTheDocument();
  });

  it('disables unlock button when passphrase is empty', () => {
    render(<PassphraseDialog onUnlocked={vi.fn()} />);
    expect(screen.getByText('Unlock')).toBeDisabled();
  });

  it('enables unlock button when passphrase is entered', () => {
    render(<PassphraseDialog onUnlocked={vi.fn()} />);
    changeInput(screen.getByPlaceholderText('Enter passphrase...'), 'mypassphrase');
    expect(screen.getByText('Unlock')).not.toBeDisabled();
  });

  it('can toggle to recovery key mode', () => {
    render(<PassphraseDialog onUnlocked={vi.fn()} />);
    fireEvent.click(screen.getByText('Use recovery key'));
    expect(screen.getByPlaceholderText('Enter your 24-word recovery key...')).toBeInTheDocument();
    expect(screen.getByText(/Enter your 24-word recovery key/)).toBeInTheDocument();
  });

  it('toggles back to passphrase mode', () => {
    render(<PassphraseDialog onUnlocked={vi.fn()} />);
    fireEvent.click(screen.getByText('Use recovery key'));
    fireEvent.click(screen.getByText('Use passphrase instead'));
    expect(screen.getByPlaceholderText('Enter passphrase...')).toBeInTheDocument();
  });

  it('shows "Forgot passphrase?" button leading to reset', () => {
    render(<PassphraseDialog onUnlocked={vi.fn()} />);
    expect(screen.getByText('Forgot passphrase?')).toBeInTheDocument();
    fireEvent.click(screen.getByText('Forgot passphrase?'));
    expect(screen.getByText('Start Fresh')).toBeInTheDocument();
    expect(screen.getByText(/permanently delete/i)).toBeInTheDocument();
  });
});

// ── EncryptionSettings ───────────────────────────────────────────────

describe('EncryptionSettings', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockIsEncryptionEnabled.mockReturnValue(false);
    mockGetEncryptionMeta.mockReturnValue(null);
    mockGetSessionDuration.mockReturnValue('tab-close');
  });

  it('renders setup option when encryption is not enabled', () => {
    render(<EncryptionSettings />);
    expect(screen.getByText('Enable Encryption')).toBeInTheDocument();
    expect(screen.getByText(/Encrypt your data at rest/)).toBeInTheDocument();
  });

  it('renders enabled state when encryption is on', () => {
    mockIsEncryptionEnabled.mockReturnValue(true);
    mockGetEncryptionMeta.mockReturnValue({
      version: 1,
      salt: 'salt',
      wrappedKey: 'key',
      recoverySalt: 'rsalt',
      recoveryWrappedKey: 'rkey',
      enabledAt: 1700000000000,
    });

    render(<EncryptionSettings />);
    expect(screen.getByText('Encryption is enabled')).toBeInTheDocument();
    expect(screen.getByText('Change Passphrase')).toBeInTheDocument();
    expect(screen.getByText('Disable Encryption')).toBeInTheDocument();
  });

  it('shows session duration selector when enabled', () => {
    mockIsEncryptionEnabled.mockReturnValue(true);
    mockGetEncryptionMeta.mockReturnValue({
      version: 1,
      salt: 'salt',
      wrappedKey: 'key',
      recoverySalt: 'rsalt',
      recoveryWrappedKey: 'rkey',
      enabledAt: Date.now(),
    });

    render(<EncryptionSettings />);
    expect(screen.getByText('Session duration')).toBeInTheDocument();
    const select = screen.getByRole('combobox');
    expect(select).toBeInTheDocument();
  });
});
