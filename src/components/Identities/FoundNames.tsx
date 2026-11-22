import { useId, useState } from 'react';
import { Plus } from 'lucide-react';
import type { Folder, Identity } from '../../types';
import { Modal } from '../Common/Modal';
import { byName, type FoundName } from '../../lib/identity-model';
import { InvestigationPill } from './identity-ui';
import type { IdentityLabels } from './identity-labels';

const SHOWN = 10;
const button = 'rounded-md border border-border-subtle px-3 py-1.5 text-sm text-text-secondary hover:bg-bg-hover hover:text-text-primary disabled:cursor-not-allowed disabled:opacity-50';
const primary = 'inline-flex items-center gap-1.5 rounded-md bg-accent px-3 py-1.5 text-sm font-medium text-white hover:bg-accent-hover';

const whereOf = (found: FoundName, labels: IdentityLabels) =>
  labels.list([...new Set(found.sources.map(source => labels.t(`found.where.${source.kind}`)))]);

export function FoundNamesPanel({ found, folders, showInvestigation, labels, onPick }: {
  found: FoundName[]; folders: Folder[]; showInvestigation: boolean; labels: IdentityLabels; onPick: (found: FoundName) => void;
}) {
  const { t } = labels;
  const ids = useId();
  const [all, setAll] = useState(false);
  if (!found.length) return null;
  const shown = all ? found : found.slice(0, SHOWN);
  return (
    <section aria-labelledby={`${ids}-heading`} className="rounded-lg border border-dashed border-border-medium bg-bg-surface p-3">
      <h2 id={`${ids}-heading`} className="flex items-center gap-2 text-sm font-semibold text-text-primary">
        {t('found.heading')}<span className="rounded-full bg-bg-raised px-1.5 text-xs text-text-muted">{found.length}</span>
      </h2>
      <div className="mt-2 flex flex-wrap gap-1.5">
        {shown.map(name => (
          <button key={name.key} type="button" onClick={() => onPick(name)}
            className="inline-flex max-w-full items-center gap-1 rounded-full border border-dashed border-border-medium px-2 py-0.5 text-xs text-text-primary hover:border-accent">
            <Plus size={12} aria-hidden="true" />
            <span className="truncate">{name.text}</span>
            {showInvestigation && <InvestigationPill folder={folders.find(folder => folder.id === name.folderId)} missingLabel={t('list.orphan')} />}
            <span className="sr-only">, {whereOf(name, labels)}</span>
          </button>
        ))}
        {found.length > SHOWN && (
          <button type="button" aria-expanded={all} className="text-xs font-medium text-accent hover:underline" onClick={() => setAll(value => !value)}>
            {all ? t('found.fewer') : t('found.more', { count: found.length - SHOWN })}
          </button>
        )}
      </div>
      <p className="mt-2 text-xs text-text-muted">{t('found.hint')}</p>
    </section>
  );
}

/** What to do with a found name: add it, add it as another name of an identity, or ignore it. */
export function FoundNameDialog({ found, folders, identities, labels, onClose, onAddNew, onAddAsOtherName, onIgnore }: {
  found: FoundName; folders: Folder[]; identities: Identity[]; labels: IdentityLabels;
  onClose: () => void; onAddNew: () => void; onAddAsOtherName: (identity: Identity) => void; onIgnore: () => void;
}) {
  const { t } = labels;
  const ids = useId();
  const [target, setTarget] = useState('');
  const choices = identities.filter(identity => identity.folderId === found.folderId).sort(byName);
  const investigation = folders.find(folder => folder.id === found.folderId)?.name ?? t('list.orphan');
  const near = found.looksLike;
  const titles = [...new Set(found.sources.map(source => source.title))];
  return (
    <Modal open onClose={onClose} title={t('found.dialogTitle', { text: found.text })}>
      <div className="flex flex-col gap-3 text-sm">
        <div className="text-text-secondary">
          <p>{t('found.pickWhere', { where: whereOf(found, labels), investigation })}</p>
          <ul className="mt-1 list-disc ps-5 text-xs text-text-muted">{titles.slice(0, 3).map(title => <li key={title} className="break-words">{title}</li>)}</ul>
        </div>
        {near ? (
          <>
            <div className="flex flex-wrap items-center gap-2">
              <button type="button" autoFocus className={primary} onClick={() => onAddAsOtherName(near)}>{t('found.looksLike', { name: near.name })}</button>
              <span className="text-xs text-text-muted">{t('found.looksLikeHint')}</span>
            </div>
            <p className="text-xs text-text-muted">{t('found.or')}</p>
            <div><button type="button" className={button} onClick={onAddNew}><Plus size={14} className="me-1 inline" />{t('found.addNew')}</button></div>
          </>
        ) : (
          <div className="flex flex-wrap items-center gap-2">
            <button type="button" autoFocus className={primary} onClick={onAddNew}><Plus size={14} />{t('found.addNew')}</button>
            <span className="text-xs text-text-muted">{t('found.addNewHint')}</span>
          </div>
        )}
        {choices.length > 0 && (
          <form className="flex flex-col gap-2" onSubmit={event => { event.preventDefault(); const identity = choices.find(choice => choice.id === target); if (identity) onAddAsOtherName(identity); }}>
            <label htmlFor={`${ids}-target`} className="text-xs text-text-muted">{t('found.otherNameOf')}</label>
            <div className="flex flex-wrap gap-2">
              <select id={`${ids}-target`} value={target} onChange={event => setTarget(event.target.value)}
                className="min-w-[12rem] flex-1 rounded-md border border-border-subtle bg-bg-primary px-2 py-1.5 text-sm text-text-primary">
                <option value="">{t('form.choose')}</option>
                {choices.map(identity => <option key={identity.id} value={identity.id}>{identity.name} · {labels.typeLabel(identity.type)}</option>)}
              </select>
              <button type="submit" disabled={!target} className={button}>{t('found.addOtherName')}</button>
            </div>
          </form>
        )}
        <div className="flex justify-end gap-2 border-t border-border-subtle pt-3">
          <button type="button" className={button} onClick={onIgnore}>{t('found.ignore')}</button>
          <button type="button" className={button} onClick={onClose}>{t('form.cancel')}</button>
        </div>
      </div>
    </Modal>
  );
}
