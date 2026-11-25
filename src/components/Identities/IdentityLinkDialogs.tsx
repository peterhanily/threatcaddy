import { useMemo, useState } from 'react';
import type { Folder, Identity } from '../../types';
import type { FoundName } from '../../lib/identity-model';
import { useToast } from '../../contexts/ToastContext';
import { FoundNameDialog } from './FoundNames';
import { IdentityFormModal, type AddPrefill } from './IdentityFormModal';
import { prefillFromFound, useIdentityLabels, withOtherName, type IdentityChange } from './identity-labels';

const nothing = async () => {};

/** The "not yet in Identities" dialog, and the Add form it can open, for a name outside the Identities view. */
export function IdentityLinkDialogs({ found, folders, identities, named, onClose, onIgnore, onCreate, onUpdate, onTrackActor }: {
  found: FoundName; folders: Folder[]; identities: Identity[];
  /** Every identity whose names are taken (archived ones too), for the Add form's duplicate check. */
  named?: Identity[];
  onClose: () => void; onIgnore: () => void; onTrackActor?: (name: string) => void;
  onCreate: (partial: Partial<Identity>) => Promise<Identity>;
  onUpdate: (id: string, change: IdentityChange) => Promise<void>;
}) {
  const labels = useIdentityLabels();
  const { t } = labels;
  const { addToast } = useToast();
  const [prefill, setPrefill] = useState<AddPrefill | null>(null);
  const byId = useMemo(() => new Map(identities.map(identity => [identity.id, identity])), [identities]);
  const failed = (cause: unknown) => addToast('error', t('toast.failed', { error: cause instanceof Error ? cause.message : String(cause) }));

  if (prefill) {
    return (
      <IdentityFormModal prefill={prefill} folders={folders} defaultFolderId={found.folderId} identities={identities} named={named} byId={byId} labels={labels}
        onClose={onClose} onCreate={onCreate} onUpdate={onUpdate} onMerge={nothing} onTrash={nothing}
        onSaved={(_identity, message) => { onClose(); if (message) addToast('success', message); }} />
    );
  }
  return (
    <FoundNameDialog found={found} folders={folders} identities={identities} labels={labels} onClose={onClose}
      onIgnore={() => { onIgnore(); onClose(); addToast('info', t('toast.ignored', { text: found.text })); }}
      onTrackActor={onTrackActor && (() => { onTrackActor(found.text); onClose(); addToast('success', t('toast.trackedActor', { text: found.text })); })}
      onAddNew={() => setPrefill(prefillFromFound(found, labels))}
      onAddAsOtherName={identity => {
        onClose();
        onUpdate(identity.id, withOtherName(found.text))
          .then(() => addToast('success', t('toast.otherNameAdded', { text: found.text, name: identity.name })), failed);
      }} />
  );
}
