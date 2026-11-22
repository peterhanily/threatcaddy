import { useId, useState, type FormEvent } from 'react';
import type { Identity } from '../../types';
import { Modal } from '../Common/Modal';
import { canonicalPhrase } from '../../lib/identity-model';
import type { IdentityChange, IdentityLabels } from '../Identities/identity-labels';

const field = 'w-full rounded-md border border-border-subtle bg-bg-primary px-2 py-1.5 text-sm text-text-primary focus:border-accent focus:outline-none';

/** Records a connection between two identities dropped onto each other on the graph (Alt+drag). */
export function GraphConnectDialog({ from, to, labels, onClose, onUpdate }: {
  from: Identity; to: Identity; labels: IdentityLabels;
  onClose: () => void;
  onUpdate: (id: string, change: IdentityChange) => Promise<void>;
}) {
  const { t } = labels;
  const ids = useId();
  const [phrase, setPhrase] = useState('');
  const [error, setError] = useState('');
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!phrase.trim()) { setError(t('connectionForm.errorPhrase')); return; }
    // The other side's wording ("manages") is stored the right way round, on the other identity.
    const { label, reversed } = canonicalPhrase(phrase, labels.phraseLabels, labels.reverseLabels);
    const [source, target] = reversed ? [to, from] : [from, to];
    try {
      await onUpdate(source.id, current => ({
        connections: current.connections.some(edge => edge.targetId === target.id && edge.label === label)
          ? current.connections : [...current.connections, { targetId: target.id, label }],
      }));
      onClose();
    } catch (cause) {
      setError(t('toast.failed', { error: cause instanceof Error ? cause.message : String(cause) }));
    }
  };
  return (
    <Modal open onClose={onClose} title={t('graphConnect.title', { from: from.name, to: to.name })}>
      <form className="flex flex-col gap-3 text-sm" onSubmit={submit}>
        <label htmlFor={`${ids}-phrase`} className="flex flex-col gap-1 text-xs text-text-secondary">
          {t('connectionForm.phrase', { name: from.name })}
          <input id={`${ids}-phrase`} className={field} list={`${ids}-phrases`} autoFocus value={phrase} maxLength={100}
            placeholder={t('connectionForm.phrasePlaceholder')} onChange={event => setPhrase(event.target.value)} />
        </label>
        <datalist id={`${ids}-phrases`}>{Object.values(labels.phraseLabels).map(value => <option key={value} value={value} />)}</datalist>
        <p className="text-xs text-text-muted">{t('graphConnect.target', { name: to.name })}</p>
        {error && <p role="alert" className="text-xs text-red-400">{error}</p>}
        <div className="flex justify-end gap-2 border-t border-border-subtle pt-3">
          <button type="button" onClick={onClose} className="rounded-md border border-border-subtle px-3 py-1.5 text-sm text-text-secondary hover:bg-bg-hover">{t('form.cancel')}</button>
          <button type="submit" className="rounded-md bg-accent px-3 py-1.5 text-sm font-medium text-white hover:bg-accent-hover">{t('form.add')}</button>
        </div>
      </form>
    </Modal>
  );
}
