import { useTranslation } from 'react-i18next';
import { useUIModals } from '../../contexts/UIModalContext';

/** A persistent warning occupies layout space instead of covering recovery controls. */
export function SyncErrorBanner({ error }: { error: string }) {
  const { t } = useTranslation('common');
  const { screenshareMaxLevel, openSettings, setForceAnalystMode, setMobileSidebarOpen } = useUIModals();
  return <aside role="alert" className="relative shrink-0 flex flex-wrap items-center gap-3 border-b border-amber-500 bg-gray-950 px-4 py-3 text-sm text-amber-100">
    <p tabIndex={0} className="min-w-0 flex-1 max-h-28 overflow-y-auto break-words">
      {screenshareMaxLevel ? t('syncStatus.screenshareHidden') : error}
    </p>
    {!screenshareMaxLevel && <button type="button" className="min-h-11 shrink-0 rounded border border-amber-500 px-3 py-2 underline" onClick={() => {
      setForceAnalystMode(true);
      setMobileSidebarOpen(false);
      openSettings('general');
    }}>{t('syncStatus.review')}</button>}
  </aside>;
}
