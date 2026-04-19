import { useTranslation } from 'react-i18next';
import { Modal } from './Modal';

interface DemoWelcomeModalProps {
  open: boolean;
  onClose: () => void;
  onStartTour: () => void;
  onDeleteDemo: () => void;
}

export function DemoWelcomeModal({ open, onClose, onStartTour, onDeleteDemo }: DemoWelcomeModalProps) {
  const { t } = useTranslation('common');

  return (
    <Modal open={open} onClose={onClose} title={t('demoModal.title')}>
      <div className="space-y-4">
        <p className="text-sm text-gray-300">
          {t('demoModal.descriptionPrefix')} <strong className="text-gray-100">"Operation FERMENTED PERSISTENCE"</strong> {t('demoModal.descriptionSuffix')}
        </p>

        <div className="text-sm text-gray-400 space-y-1.5">
          <p className="font-medium text-gray-300">{t('demoModal.whatYouCan')}</p>
          <ul className="list-disc ps-5 space-y-1">
            <li>{t('demoModal.browseItems')}</li>
            <li>{t('demoModal.viewGraph')}</li>
            <li>{t('demoModal.tryWhiteboard')}</li>
            <li>{t('demoModal.useLinksPrefix')} <code className="bg-gray-800 px-1 rounded text-xs">[[ThreatCaddyLinks]]</code> {t('demoModal.useLinksSuffix')}</li>
          </ul>
        </div>

        <div className="flex flex-col gap-2 pt-2">
          <button
            onClick={onClose}
            className="w-full px-4 py-2 rounded-lg bg-accent text-white font-medium hover:bg-accent-hover transition-colors"
          >
            {t('demoModal.startExploring')}
          </button>
          <button
            onClick={() => { onClose(); onStartTour(); }}
            className="w-full px-4 py-2 rounded-lg bg-gray-700 text-gray-200 font-medium hover:bg-gray-600 transition-colors"
          >
            {t('demoModal.guidedTour')}
          </button>
          <button
            onClick={() => { onDeleteDemo(); onClose(); }}
            className="w-full px-4 py-2 rounded-lg text-gray-500 hover:text-red-400 text-sm transition-colors"
          >
            {t('demoModal.deleteDemo')}
          </button>
        </div>

        <p className="text-xs text-gray-600 text-center">
          {t('demoModal.removeHint')}
        </p>
      </div>
    </Modal>
  );
}
