import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { OfflineBackupNote, OfflineStatusNotice, OfflineUseSetting, OFFLINE_INSTALL_NOTICE_DELAY_MS } from '../components/Common/OfflineStatusNotice';
import type { observeOfflineStatus, OfflineStatus } from '../lib/offline-status';
import commonEn from '../../public/locales/en/common.json';

const mocks = vi.hoisted(() => ({ observe: vi.fn(), stop: vi.fn(), onChange: (() => {}) as (status: OfflineStatus) => void }));
vi.mock('../lib/offline-status', async importOriginal => ({
  ...await importOriginal<typeof import('../lib/offline-status')>(), observeOfflineStatus: mocks.observe,
}));
type ObserveOptions = Parameters<typeof observeOfflineStatus>[0];
const DISMISSED_KEY = 'threatcaddy-offline-unavailable-dismissed';
const INSTALLING = 'ThreatCaddy is still saving itself for offline use. Keep this tab open.';
const FAILED = "ThreatCaddy couldn't finish saving itself for offline use. It still works online and will try again next time you open it.";
const UNAVAILABLE = "This browser can't keep ThreatCaddy available offline. It still works online. To keep a copy of your investigations, save a backup from Settings → Data.";
const report = (status: OfflineStatus) => act(() => mocks.onChange(status));
beforeEach(() => {
  // The status is shared for the page; start every test from an unknown status.
  mocks.onChange('checking');
  mocks.observe.mockImplementation((options: ObserveOptions) => { mocks.onChange = options.onChange; return mocks.stop; });
  mocks.observe.mockClear(); mocks.stop.mockClear();
  localStorage.clear();
});
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); vi.useRealTimers(); });

// The shell keeps one empty live region mounted; nothing is shown or announced.
const expectNoNotice = () => {
  expect(screen.queryByTestId('offline-notice')).not.toBeInTheDocument();
  expect(screen.getByRole('status')).toBeEmptyDOMElement();
};

describe('offline notice in the app shell', () => {
  it('shows nothing while checking, while offline use is not confirmed yet, or once it is installed', () => {
    render(<OfflineStatusNotice />);
    expectNoNotice();
    // A late or interrupted download is not a reason to tell the user this browser can't work offline.
    report('unconfirmed');
    expectNoNotice();
    report('installed');
    expectNoNotice();
  });

  it('asks the user to keep the tab open only when a first install outlasts a short delay', () => {
    vi.useFakeTimers();
    render(<OfflineStatusNotice />);
    report('installing');
    act(() => vi.advanceTimersByTime(OFFLINE_INSTALL_NOTICE_DELAY_MS - 100));
    report('installed');
    act(() => vi.advanceTimersByTime(OFFLINE_INSTALL_NOTICE_DELAY_MS));
    expectNoNotice();

    report('installing');
    act(() => vi.advanceTimersByTime(OFFLINE_INSTALL_NOTICE_DELAY_MS - 1));
    expectNoNotice();
    act(() => vi.advanceTimersByTime(1));
    expect(screen.getByRole('status')).toHaveTextContent(INSTALLING);
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
    report('installed');
    expectNoNotice();
  });

  it('waits the full delay again for every later installation, for example an update after a slow first install', () => {
    vi.useFakeTimers();
    render(<OfflineStatusNotice />);
    report('installing');
    act(() => vi.advanceTimersByTime(OFFLINE_INSTALL_NOTICE_DELAY_MS));
    expect(screen.getByRole('status')).toHaveTextContent(INSTALLING);
    report('installed');
    expectNoNotice();

    report('installing');
    expectNoNotice();
    act(() => vi.advanceTimersByTime(OFFLINE_INSTALL_NOTICE_DELAY_MS - 1));
    expectNoNotice();
    act(() => vi.advanceTimersByTime(1));
    expect(screen.getByRole('status')).toHaveTextContent(INSTALLING);
  });

  it('keeps one live region mounted so screen readers announce a notice when its text appears', () => {
    vi.useFakeTimers();
    render(<OfflineStatusNotice />);
    const region = screen.getByRole('status');
    expect(region).toBeEmptyDOMElement();
    report('installing');
    act(() => vi.advanceTimersByTime(OFFLINE_INSTALL_NOTICE_DELAY_MS));
    expect(screen.getByRole('status')).toBe(region);
    expect(region).toHaveTextContent(INSTALLING);
    report('failed');
    expect(screen.getByRole('status')).toBe(region);
    expect(region).toHaveTextContent(FAILED);
    // The button is not part of the announced text.
    const dismiss = screen.getByRole('button', { name: 'Dismiss' });
    expect(region).not.toContainElement(dismiss);
    fireEvent.click(dismiss);
    expect(screen.getByRole('status')).toBe(region);
    expectNoNotice();
  });

  it('says plainly when this browser cannot keep it offline and remembers the dismissal per browser', () => {
    const first = render(<OfflineStatusNotice />);
    report('unavailable');
    expect(screen.getByRole('status')).toHaveTextContent(UNAVAILABLE);
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }));
    expectNoNotice();
    expect(localStorage.getItem(DISMISSED_KEY)).toBe('1');
    first.unmount();

    render(<OfflineStatusNotice />);
    report('unavailable');
    expectNoNotice();
  });

  it('says a failed attempt will be retried instead of blaming the browser, and shares the dismissal', () => {
    const first = render(<OfflineStatusNotice />);
    report('failed');
    expect(screen.getByRole('status')).toHaveTextContent(FAILED);
    expect(screen.getByRole('status')).not.toHaveTextContent(/this browser can't/i);
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }));
    expectNoNotice();
    expect(localStorage.getItem(DISMISSED_KEY)).toBe('1');
    first.unmount();

    // Both notes mean offline use can't be relied on here; one dismissal hides both.
    render(<OfflineStatusNotice />);
    report('failed');
    expectNoNotice();
    report('unavailable');
    expectNoNotice();
  });

  it('still shows and dismisses the note when browser storage is blocked', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new DOMException('Denied', 'SecurityError'); });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new DOMException('Denied', 'SecurityError'); });
    render(<OfflineStatusNotice />);
    report('unavailable');
    expect(screen.getByRole('status')).toHaveTextContent(UNAVAILABLE);
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }));
    expectNoNotice();
  });

  it('shares one observer with the Settings row and disposes it with the last view', () => {
    const shell = render(<OfflineStatusNotice />);
    const settings = render(<OfflineUseSetting />);
    expect(mocks.observe).toHaveBeenCalledTimes(1);
    report('unavailable');
    expect(screen.getByTestId('offline-status')).toHaveAttribute('data-status', 'unavailable');
    shell.unmount();
    expect(mocks.stop).not.toHaveBeenCalled();
    settings.unmount();
    expect(mocks.stop).toHaveBeenCalledTimes(1);
  });

  it('keeps the known status across a remount while a new observer starts checking again', () => {
    const first = render(<OfflineStatusNotice />);
    report('unavailable');
    first.unmount();
    expect(mocks.stop).toHaveBeenCalledTimes(1);
    // Like the real observer, a new one reports 'checking' synchronously when it starts.
    mocks.observe.mockImplementation((options: ObserveOptions) => {
      mocks.onChange = options.onChange; options.onChange('checking'); return mocks.stop;
    });
    render(<OfflineStatusNotice />);
    expect(mocks.observe).toHaveBeenCalledTimes(2);
    expect(screen.getByRole('status')).toHaveTextContent(UNAVAILABLE);
    report('installed');
    expectNoNotice();
  });
});

describe('offline use in Settings', () => {
  it('states each observed status in one plain sentence', () => {
    render(<OfflineUseSetting />);
    expect(screen.getByRole('heading', { name: 'Offline use' })).toBeInTheDocument();
    const row = screen.getByTestId('offline-status');
    expect(row).toHaveAttribute('data-status', 'checking');
    expect(row).toHaveTextContent('Checking whether this browser can keep ThreatCaddy available offline.');
    report('installing');
    expect(row).toHaveTextContent('ThreatCaddy is saving itself for offline use; keep this tab open until it finishes.');
    report('installed');
    expect(row).toHaveAttribute('data-status', 'installed');
    expect(row).toHaveTextContent('ThreatCaddy opens in this browser without an internet connection; team sync, AI and other online services still need one.');
    report('unconfirmed');
    expect(row).toHaveAttribute('data-status', 'unconfirmed');
    expect(row).toHaveTextContent("Offline use isn't confirmed in this browser yet. ThreatCaddy still works online and tries again next time you open it.");
    report('failed');
    expect(row).toHaveAttribute('data-status', 'failed');
    expect(row).toHaveTextContent("The last attempt to save ThreatCaddy for offline use didn't finish. ThreatCaddy still works online and tries again next time you open it.");
    report('unavailable');
    expect(row).toHaveTextContent("This browser can't keep ThreatCaddy available offline, but it still works online.");
  });

  it('puts the not-a-backup guidance in plain words for the Data tab', () => {
    render(<OfflineBackupNote />);
    expect(screen.getByText(/^Offline use is not a backup\. .*Export a JSON backup regularly and keep the file somewhere safe\.$/)).toBeInTheDocument();
  });

  it('uses no technical jargon in any offline text', () => {
    const offline = Object.entries(commonEn).filter(([key]) => key.startsWith('offlineStatus.'));
    expect(offline.map(([key]) => key).sort()).toEqual([
      'offlineStatus.backupNote', 'offlineStatus.dismissNotice', 'offlineStatus.failedNotice', 'offlineStatus.installingNotice',
      'offlineStatus.settingChecking', 'offlineStatus.settingFailed', 'offlineStatus.settingInstalled', 'offlineStatus.settingInstalling',
      'offlineStatus.settingTitle', 'offlineStatus.settingUnavailable', 'offlineStatus.settingUnconfirmed',
      'offlineStatus.unavailableNotice',
    ]);
    for (const [, text] of offline) expect(text).not.toMatch(/worker|evict|cache|PWA/i);
    // Browsers that refuse offline use often keep data only for the session, so promise nothing about it.
    for (const [, text] of offline) expect(text).not.toMatch(/either way|stay saved/i);
  });
});

describe('standalone build', () => {
  it('shows none of the offline notices, rows or guidance', () => {
    vi.stubGlobal('__STANDALONE__', true);
    const view = render(<><OfflineStatusNotice /><OfflineUseSetting /><OfflineBackupNote /></>);
    expect(view.container).toBeEmptyDOMElement();
    expect(mocks.observe).not.toHaveBeenCalled();
  });
});
