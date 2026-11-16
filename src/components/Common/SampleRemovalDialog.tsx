import { useTranslation } from 'react-i18next';
import { ConfirmDialog } from './ConfirmDialog';
import type { SampleInvestigationKind } from '../../lib/sample-investigation-store';

export interface SampleRemovalRequest { kind: SampleInvestigationKind; name: string; userItems: number }

interface SampleRemovalDialogProps {
  request: SampleRemovalRequest | null;
  onClose: () => void;
  onRemove: (request: SampleRemovalRequest, keepUserItems: boolean) => void;
}

/** Removing a demo is permanent; anything the user added can be kept instead. */
export function SampleRemovalDialog({ request, onClose, onRemove }: SampleRemovalDialogProps) {
  const { t } = useTranslation('investigations');
  const name = request?.name ?? '';
  const userItems = request?.userItems ?? 0;
  return (
    <ConfirmDialog
      open={!!request}
      onClose={onClose}
      onConfirm={() => { if (request) onRemove(request, false); }}
      title={t('sample.removeTitle')}
      message={userItems ? t('sample.removeMessageWithUserItems', { name, number: userItems }) : t('sample.removeMessage', { name })}
      confirmLabel={userItems ? t('sample.deleteEverything') : t('sample.removeConfirm')}
      secondaryAction={request && userItems ? () => onRemove(request, true) : undefined}
      secondaryLabel={t('sample.keepUserItems')}
      danger
    />
  );
}
