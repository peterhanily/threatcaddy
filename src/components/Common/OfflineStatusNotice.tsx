import { useEffect, useState, useSyncExternalStore } from 'react';
import { useTranslation } from 'react-i18next';
import { observeOfflineStatus, offlineWorkerTarget, type OfflineStatus } from '../../lib/offline-status';

/** Fast installs finish before this and show nothing. */
export const OFFLINE_INSTALL_NOTICE_DELAY_MS = 3_000;
const UNAVAILABLE_DISMISSED_KEY = 'threatcaddy-offline-unavailable-dismissed';
const SETTING_TEXT = {
  checking: 'offlineStatus.settingChecking',
  installing: 'offlineStatus.settingInstalling',
  installed: 'offlineStatus.settingInstalled',
  unconfirmed: 'offlineStatus.settingUnconfirmed',
  unavailable: 'offlineStatus.settingUnavailable',
} as const satisfies Record<OfflineStatus, string>;

// One observer serves the app shell and the Settings row, so Settings shows
// the status the shell already knows instead of starting a new check. The
// last known status also survives a remount (for example switching between
// the analyst and executive layouts) while a new observer confirms it.
let sharedStatus: OfflineStatus = 'checking';
const subscribers = new Set<() => void>();
let stopSharedObserver: (() => void) | undefined;
function subscribeOfflineStatus(onStoreChange: () => void) {
  subscribers.add(onStoreChange);
  if (!stopSharedObserver) {
    let container: ServiceWorkerContainer | undefined;
    try { container = navigator.serviceWorker; } catch { /* Some browser contexts deny access. */ }
    let starting = true;
    stopSharedObserver = observeOfflineStatus({
      container,
      lifecycle: window,
      ...offlineWorkerTarget(window.location.href, import.meta.url, import.meta.env.BASE_URL, import.meta.env.PROD),
      onChange: status => {
        if (starting && status === 'checking') return;
        sharedStatus = status;
        for (const notify of subscribers) notify();
      },
    });
    starting = false;
  }
  return () => {
    subscribers.delete(onStoreChange);
    if (subscribers.size) return;
    stopSharedObserver?.();
    stopSharedObserver = undefined;
  };
}
const useOfflineStatus = () => useSyncExternalStore(subscribeOfflineStatus, () => sharedStatus);

// Standalone files do not use the hosted PWA worker, even when served over HTTP.
const isStandalone = () => (typeof __STANDALONE__ !== 'undefined' && __STANDALONE__) || window.location.protocol === 'file:';

function HostedOfflineNotice() {
  const { t } = useTranslation('common');
  const status = useOfflineStatus();
  const [installingDue, setInstallingDue] = useState(false);
  const [dismissed, setDismissed] = useState(() => {
    try { return localStorage.getItem(UNAVAILABLE_DISMISSED_KEY) === '1'; } catch { return false; }
  });
  useEffect(() => {
    if (status !== 'installing') return;
    const timer = setTimeout(() => setInstallingDue(true), OFFLINE_INSTALL_NOTICE_DELAY_MS);
    return () => clearTimeout(timer);
  }, [status]);
  const shown = status === 'installing' && installingDue ? 'installing'
    : status === 'unavailable' && !dismissed ? 'unavailable' : undefined;
  // One live region stays mounted: screen readers announce text put into an
  // existing region, but often miss a region inserted together with its text.
  return <div data-testid={shown && 'offline-notice'} data-status={shown}
    className={shown && 'flex min-w-0 shrink-0 flex-wrap items-center gap-x-3 border-b border-border-subtle bg-bg-surface px-3 text-xs text-text-secondary'}>
    <p role="status" className={shown && 'min-w-0 flex-1 break-words py-2'}>
      {shown && t(shown === 'installing' ? 'offlineStatus.installingNotice' : 'offlineStatus.unavailableNotice')}
    </p>
    {shown === 'unavailable' && <button type="button" className="min-h-11 min-w-11 shrink-0 rounded px-2 text-text-primary underline focus-visible:outline-2 focus-visible:outline-accent"
      onClick={() => {
        try { localStorage.setItem(UNAVAILABLE_DISMISSED_KEY, '1'); } catch { /* Hide it for this page only. */ }
        setDismissed(true);
      }}>
      {t('offlineStatus.dismissNotice')}
    </button>}
  </div>;
}

/** App shell: speaks only when the user must act (keep the tab open) or cannot rely on offline use. */
export function OfflineStatusNotice() {
  if (isStandalone()) return null;
  return <HostedOfflineNotice />;
}

function HostedOfflineUseSetting() {
  const { t } = useTranslation('common');
  const status = useOfflineStatus();
  return <div className="space-y-2" data-testid="offline-status" data-status={status}>
    <h3 className="text-sm font-semibold text-gray-300">{t('offlineStatus.settingTitle')}</h3>
    <p role="status" className="text-sm text-gray-400">{t(SETTING_TEXT[status])}</p>
  </div>;
}

/** Settings > General status row. */
export function OfflineUseSetting() {
  if (isStandalone()) return null;
  return <HostedOfflineUseSetting />;
}

/** Settings > Data guidance next to the backup export. */
export function OfflineBackupNote() {
  const { t } = useTranslation('common');
  if (isStandalone()) return null;
  return <p className="text-xs text-gray-500">{t('offlineStatus.backupNote')}</p>;
}
