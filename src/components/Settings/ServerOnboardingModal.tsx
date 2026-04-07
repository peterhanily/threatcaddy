import { FolderOpen, MessageSquare, RefreshCw, Users } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Modal } from '../Common/Modal';

interface ServerOnboardingModalProps {
  open: boolean;
  onClose: () => void;
  serverName: string;
}

const featureKeys = [
  { icon: FolderOpen, titleKey: 'server.onboarding.sharedInvestigations', descKey: 'server.onboarding.sharedInvestigationsDesc' },
  { icon: MessageSquare, titleKey: 'server.onboarding.caddyShack', descKey: 'server.onboarding.caddyShackDesc' },
  { icon: RefreshCw, titleKey: 'server.onboarding.realTimeSync', descKey: 'server.onboarding.realTimeSyncDesc' },
  { icon: Users, titleKey: 'server.onboarding.presence', descKey: 'server.onboarding.presenceDesc' },
];

export function ServerOnboardingModal({ open, onClose, serverName }: ServerOnboardingModalProps) {
  const { t } = useTranslation('settings');
  return (
    <Modal open={open} onClose={onClose} title={t('server.onboarding.welcome', { name: serverName })}>
      <div className="space-y-5">
        <p className="text-sm text-gray-400">
          {t('server.onboarding.intro')}
        </p>

        <div className="space-y-3">
          {featureKeys.map((feat) => (
            <div key={feat.titleKey} className="flex gap-3">
              <div className="w-8 h-8 rounded-full bg-blue-500/15 flex items-center justify-center shrink-0 mt-0.5">
                <feat.icon size={16} className="text-blue-400" />
              </div>
              <div>
                <p className="text-sm font-medium text-gray-200">{t(feat.titleKey)}</p>
                <p className="text-xs text-gray-500 mt-0.5">{t(feat.descKey)}</p>
              </div>
            </div>
          ))}
        </div>

        <button
          onClick={onClose}
          className="w-full mt-2 px-4 py-2.5 bg-blue-600 hover:bg-blue-500 text-white text-sm font-medium rounded-lg transition-colors"
        >
          {t('server.onboarding.getStarted')}
        </button>
      </div>
    </Modal>
  );
}
