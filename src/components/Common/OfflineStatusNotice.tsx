import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { observeOfflineStatus, offlineWorkerTarget, type OfflineStatus } from '../../lib/offline-status';

function HostedOfflineStatus() {
  const { t } = useTranslation('common');
  const [status, setStatus] = useState<OfflineStatus>('checking');
  useEffect(() => {
    let container: ServiceWorkerContainer | undefined;
    try { container = navigator.serviceWorker; } catch { /* Some browser contexts deny access. */ }
    return observeOfflineStatus({
      container,
      lifecycle: window,
      ...offlineWorkerTarget(window.location.href, import.meta.url, import.meta.env.BASE_URL, import.meta.env.PROD),
      onChange: setStatus,
    });
  }, []);
  return <details data-testid="offline-status" data-status={status}
    className="min-w-0 shrink-0 border-b border-border-subtle bg-bg-surface px-3 text-xs text-text-secondary">
    <summary className="min-h-11 cursor-pointer content-center break-words py-2">
      <span role="status" aria-live="polite">{t(`offlineStatus.${status}`)}</span>
    </summary>
    <div className="max-h-40 overflow-y-auto break-words pb-3" tabIndex={0}>
      {status !== 'installed' && <p className="mb-2">{t(`offlineStatus.${status}Help`)}</p>}
      <p>{t('offlineStatus.caveat')}</p>
    </div>
  </details>;
}

export function OfflineStatusNotice() {
  // Standalone files do not use the hosted PWA worker, even when served over HTTP.
  if ((typeof __STANDALONE__ !== 'undefined' && __STANDALONE__) || window.location.protocol === 'file:') return null;
  return <HostedOfflineStatus />;
}
