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
const UNAVAILABLE = "This browser can't keep ThreatCaddy available offline. It still works online, and your investigations stay saved in this browser either way.";
const report = (status: OfflineStatus) => act(() => mocks.onChange(status));
beforeEach(() => {
  // The status is shared for the page; start every test from an unknown status.
  mocks.onChange('checking');
  mocks.observe.mockImplementation((options: ObserveOptions) => { mocks.onChange = options.onChange; return mocks.stop; });
  mocks.observe.mockClear(); mocks.stop.mockClear();
  localStorage.clear();
});
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); vi.useRealTimers(); });

describe('offline notice in the app shell', () => {
  it('shows nothing while checking or once offline use is installed', () => {
    const view = render(<OfflineStatusNotice />);
    expect(view.container).toBeEmptyDOMElement();
    report('installed');
    expect(view.container).toBeEmptyDOMElement();
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });

  it('asks the user to keep the tab open only when a first install outlasts a short delay', () => {
    vi.useFakeTimers();
    const view = render(<OfflineStatusNotice />);
    report('installing');
    act(() => vi.advanceTimersByTime(OFFLINE_INSTALL_NOTICE_DELAY_MS - 100));
    report('installed');
    act(() => vi.advanceTimersByTime(OFFLINE_INSTALL_NOTICE_DELAY_MS));
    expect(view.container).toBeEmptyDOMElement();

    report('installing');
    act(() => vi.advanceTimersByTime(OFFLINE_INSTALL_NOTICE_DELAY_MS - 1));
    expect(view.container).toBeEmptyDOMElement();
    act(() => vi.advanceTimersByTime(1));
    expect(screen.getByRole('status')).toHaveTextContent(INSTALLING);
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
    report('installed');
    expect(view.container).toBeEmptyDOMElement();
  });

  it('says plainly when this browser cannot keep it offline and remembers the dismissal per browser', () => {
    const first = render(<OfflineStatusNotice />);
    report('unavailable');
    expect(screen.getByRole('status')).toHaveTextContent(UNAVAILABLE);
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }));
    expect(first.container).toBeEmptyDOMElement();
    expect(localStorage.getItem(DISMISSED_KEY)).toBe('1');
    first.unmount();

    const reopened = render(<OfflineStatusNotice />);
    report('unavailable');
    expect(reopened.container).toBeEmptyDOMElement();
  });

  it('still shows and dismisses the note when browser storage is blocked', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new DOMException('Denied', 'SecurityError'); });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new DOMException('Denied', 'SecurityError'); });
    const view = render(<OfflineStatusNotice />);
    report('unavailable');
    expect(screen.getByRole('status')).toHaveTextContent(UNAVAILABLE);
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }));
    expect(view.container).toBeEmptyDOMElement();
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
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
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
      'offlineStatus.backupNote', 'offlineStatus.dismissNotice', 'offlineStatus.installingNotice',
      'offlineStatus.settingChecking', 'offlineStatus.settingInstalled', 'offlineStatus.settingInstalling',
      'offlineStatus.settingTitle', 'offlineStatus.settingUnavailable', 'offlineStatus.unavailableNotice',
    ]);
    for (const [, text] of offline) expect(text).not.toMatch(/worker|evict|cache|PWA/i);
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
