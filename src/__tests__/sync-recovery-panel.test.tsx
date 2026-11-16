import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { createInstance } from 'i18next';
import { I18nextProvider } from 'react-i18next';
import { SyncRecoveryPanel } from '../components/Settings/SyncRecoveryPanel';
import { SYNC_RECOVERY_ERROR_CODES } from '../lib/sync-recovery';
import { PendingChangesError } from '../lib/pending-changes';
import settingsEn from '../../public/locales/en/settings.json';
import settingsDe from '../../public/locales/de/settings.json';

const mocks = vi.hoisted(() => ({
  prepare: vi.fn(), reconcile: vi.fn(), restore: vi.fn(), download: vi.fn(), start: vi.fn(), stop: vi.fn(),
  auth: { serverUrl: 'https://team.example' as string | null, user: { id: 'alice' } as { id: string } | null },
}));
vi.mock('../contexts/AuthContext', () => ({ useAuth: () => mocks.auth }));
vi.mock('../lib/export', () => ({ downloadFile: mocks.download }));
vi.mock('../lib/sync-recovery', async importOriginal => ({ ...await importOriginal<typeof import('../lib/sync-recovery')>(),
  prepareSyncRecovery: mocks.prepare, reconcileSyncWorkspace: mocks.reconcile, restoreSyncRecovery: mocks.restore }));
vi.mock('../lib/sync-engine', () => ({ syncEngine: { start: mocks.start, stop: mocks.stop } }));

const settings = import.meta.glob<{ default: Record<string, string> }>('../../public/locales/*/settings.json', { eager: true });
const common = import.meta.glob<{ default: Record<string, string> }>('../../public/locales/*/common.json', { eager: true });
const catalog = (glob: typeof settings, lng: string, ns: string) => glob[`../../public/locales/${lng}/${ns}.json`].default;
const de = (key: string) => {
  const value = (settingsDe as Record<string, string>)[key];
  expect(value, key).toEqual(expect.any(String));
  return value;
};
const passphrase = 'synthetic archive passphrase';

async function renderGerman() {
  const locale = createInstance();
  await locale.init({ lng: 'de', fallbackLng: 'en', defaultNS: 'settings', interpolation: { escapeValue: false },
    resources: { en: { settings: settingsEn }, de: { settings: settingsDe } } });
  render(<I18nextProvider i18n={locale}><SyncRecoveryPanel /></I18nextProvider>);
  return locale;
}
function enterPassphrase() {
  fireEvent.change(screen.getByLabelText(de('syncRecovery.password')), { target: { value: passphrase } });
  fireEvent.change(screen.getByLabelText(de('syncRecovery.repeatPassword')), { target: { value: passphrase } });
}
async function chooseArchive(file: File) {
  await act(async () => { fireEvent.change(screen.getByLabelText(de('syncRecovery.restoreArchive')), { target: { files: [file] } }); });
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.auth.serverUrl = 'https://team.example';
  mocks.auth.user = { id: 'alice' };
});
afterEach(cleanup);

describe('sync history recovery in the interface language', () => {
  it('shows every instruction, field and action translated', async () => {
    await renderGerman();
    expect(screen.getByText(de('syncRecovery.title')).tagName).toBe('SUMMARY');
    for (const key of ['syncRecovery.intro', 'syncRecovery.legacyLimits', 'syncRecovery.beforeYouStart', 'syncRecovery.restoreGuidance']) {
      expect(screen.getByText(de(key)).tagName).toBe('P');
    }
    expect(screen.getByLabelText(de('syncRecovery.password'))).toHaveAttribute('type', 'password');
    expect(screen.getByLabelText(de('syncRecovery.repeatPassword'))).toHaveAttribute('type', 'password');
    expect(screen.getByRole('button', { name: de('syncRecovery.prepare') })).toBeDisabled();
    expect(screen.getByRole('checkbox', { name: de('syncRecovery.reconcileConfirm') })).not.toBeChecked();
    expect(screen.getByLabelText(de('syncRecovery.restoreArchive'))).toBeDisabled();
    for (const english of ['Sync history recovery', 'server restore', 'signed-out edit', 'Close other tabs', 'empty local workspace',
      'Archive password', 'Repeat password', 'download verified archive', 'I confirm reconciliation', 'recovery archive']) {
      expect(document.body).not.toHaveTextContent(english);
    }
  });

  it('confirms the archive and the reconciliation in the interface language', async () => {
    mocks.prepare.mockResolvedValue({ blob: { fixture: true }, filename: 'recovery.json' });
    await renderGerman();
    enterPassphrase();
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: de('syncRecovery.prepare') })); });
    expect(screen.getByRole('status')).toHaveTextContent(de('syncRecovery.prepared'));
    expect(mocks.download).toHaveBeenCalledExactlyOnceWith(JSON.stringify({ fixture: true }), 'recovery.json', 'application/json');
    fireEvent.click(screen.getByRole('checkbox', { name: de('syncRecovery.savedConfirm') }));
    fireEvent.click(screen.getByRole('checkbox', { name: de('syncRecovery.reconcileConfirm') }));
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: de('syncRecovery.reconcile') })); });
    expect(screen.getByRole('status')).toHaveTextContent(de('syncRecovery.reconciled'));
    expect(mocks.start).toHaveBeenCalledOnce();
  });

  it('refuses reconciliation without the original server in the interface language', async () => {
    mocks.prepare.mockResolvedValue({ blob: {}, filename: 'recovery.json' });
    mocks.auth.serverUrl = null;
    await renderGerman();
    enterPassphrase();
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: de('syncRecovery.prepare') })); });
    fireEvent.click(screen.getByRole('checkbox', { name: de('syncRecovery.savedConfirm') }));
    fireEvent.click(screen.getByRole('checkbox', { name: de('syncRecovery.reconcileConfirm') }));
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: de('syncRecovery.reconcile') })); });
    expect(screen.getByRole('alert')).toHaveTextContent(de('syncRecovery.signInFirst'));
    expect(mocks.reconcile).not.toHaveBeenCalled();
  });

  it('reports archive restores, refusals and unexpected failures in the interface language', async () => {
    const locale = await renderGerman();
    fireEvent.click(screen.getByRole('checkbox', { name: de('syncRecovery.reconcileConfirm') }));
    enterPassphrase();
    const oversized = new File(['{}'], 'recovery.json');
    Object.defineProperty(oversized, 'size', { value: 512 * 1024 * 1024 + 1 });
    await chooseArchive(oversized);
    expect(screen.getByRole('alert')).toHaveTextContent(de('syncRecovery.archiveTooLarge'));
    expect(mocks.restore).not.toHaveBeenCalled();

    mocks.restore.mockResolvedValue(3);
    await chooseArchive(new File(['{}'], 'recovery.json'));
    expect(mocks.restore).toHaveBeenCalledExactlyOnceWith(passphrase, {}, true);
    const restored = locale.t('syncRecovery.restored', { count: 3 });
    expect(restored).toContain('3');
    expect(restored).not.toBe(locale.getFixedT('en')('syncRecovery.restored', { count: 3 }));
    expect(screen.getByRole('status')).toHaveTextContent(restored);

    enterPassphrase();
    mocks.restore.mockRejectedValue('synthetic non-error failure');
    await chooseArchive(new File(['{}'], 'recovery.json'));
    expect(screen.getByRole('alert')).toHaveTextContent(de('syncRecovery.failed'));
  });

  it.each(SYNC_RECOVERY_ERROR_CODES)('shows the %s refusal in the interface language', async code => {
    const params = { count: 2, records: '["notes","a"], ["notes","b"]' };
    const locale = await renderGerman();
    fireEvent.click(screen.getByRole('checkbox', { name: de('syncRecovery.reconcileConfirm') }));
    enterPassphrase();
    mocks.restore.mockRejectedValue(Object.assign(new Error('Synthetic English refusal'), { code, params }));
    await chooseArchive(new File(['{}'], 'recovery.json'));
    const key = `syncRecovery.error.${code}`;
    expect(de(key)).not.toBe((settingsEn as Record<string, string>)[key]);
    expect(screen.getByRole('alert')).toHaveTextContent(locale.t(key, params));
    expect(screen.getByRole('alert')).not.toHaveTextContent('Synthetic English refusal');
    expect(screen.getByRole('alert')).not.toHaveTextContent('{{');
  });

  it('shows pending work and an unreadable file in the interface language, and keeps other failures as reported', async () => {
    await renderGerman();
    fireEvent.click(screen.getByRole('checkbox', { name: de('syncRecovery.reconcileConfirm') }));
    enterPassphrase();
    mocks.restore.mockRejectedValueOnce(new PendingChangesError('Resolve pending work first.'));
    await chooseArchive(new File(['{}'], 'recovery.json'));
    expect(screen.getByRole('alert')).toHaveTextContent(de('syncRecovery.error.pendingWork'));
    await chooseArchive(new File(['not a recovery archive'], 'recovery.json'));
    expect(screen.getByRole('alert')).toHaveTextContent(de('syncRecovery.error.unsupportedArchive'));
    expect(mocks.restore).toHaveBeenCalledOnce();
    mocks.restore.mockRejectedValueOnce(Object.assign(new Error('Synthetic server failure'), { code: 'SYNC_CURSOR_RESET' }));
    await chooseArchive(new File(['{}'], 'recovery.json'));
    expect(screen.getByRole('alert')).toHaveTextContent('Synthetic server failure');
  });
});

describe('sync history recovery navigation names the panel heading in every locale', () => {
  const locales = Object.keys(settings).map(path => path.split('/').at(-2) as string);

  it('covers all 21 interface languages', () => {
    expect(locales).toHaveLength(21);
  });

  it.each(locales)('%s', lng => {
    const settingsCatalog = catalog(settings, lng, 'settings');
    const commonCatalog = catalog(common, lng, 'common');
    const panel = settingsCatalog['syncRecovery.title'];
    expect(panel).toEqual(expect.any(String));
    if (lng !== 'en') expect(panel).not.toBe('Sync history recovery');
    const arrow = ['ar', 'fa', 'he'].includes(lng) ? '←' : '→';
    const path = [settingsCatalog.title, settingsCatalog['tabs.general'], panel].join(` ${arrow} `);
    for (const [ns, key, text] of [
      ['settings', 'data.syncBoundRestoreNotice', settingsCatalog['data.syncBoundRestoreNotice']],
      ['settings', 'data.syncUnsentRestoreBlocked', settingsCatalog['data.syncUnsentRestoreBlocked']],
      ['common', 'syncStatus.pausedCapture', commonCatalog['syncStatus.pausedCapture']],
      ['common', 'syncStatus.pausedHistory', commonCatalog['syncStatus.pausedHistory']],
    ]) expect(text, `${ns}:${key}`).toContain(path);
  });
});
