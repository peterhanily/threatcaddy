import { useTranslation } from 'react-i18next';

export interface FirstRunGuideProps {
  onCreate: () => void;
  onImport?: () => void;
  onLoadDemo?: () => void;
  /** Offered until the tour has been taken once. */
  onStartTour?: () => void;
}

/** Shared empty-workspace entry points. No provider or account setup is required. */
export function FirstRunGuide({ onCreate, onImport, onLoadDemo, onStartTour }: FirstRunGuideProps) {
  const { t } = useTranslation('investigations');
  const buttonClass = 'min-h-11 px-4 py-2 rounded-lg bg-bg-deep border border-border-subtle text-sm text-text-primary hover:border-accent focus-visible:outline-2 focus-visible:outline-accent';
  return (
    <section aria-label={t('firstRun.title')} className="mb-6 rounded-lg border border-border-subtle bg-bg-raised p-5 space-y-3">
      <h2 className="text-base font-semibold text-text-primary">{t('firstRun.title')}</h2>
      <p className="text-sm text-text-secondary">{t('firstRun.description')}</p>
      <div className="flex flex-wrap gap-2">
        <button className={buttonClass} onClick={onCreate}>{t('hub.createInvestigation')}</button>
        {onImport && <button className={buttonClass} onClick={onImport}>{t('firstRun.import')}</button>}
        {onLoadDemo && <button className={buttonClass} onClick={onLoadDemo}>{t('firstRun.demo')}</button>}
        {onStartTour && <button className={buttonClass} onClick={onStartTour}>{t('firstRun.tour')}</button>}
      </div>
      <p className="text-sm text-text-secondary">{t('firstRun.report')}</p>
    </section>
  );
}
