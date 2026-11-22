import { useId, useMemo, useState, type FormEvent } from 'react';
import { nanoid } from 'nanoid';
import type { Folder, Identity } from '../../types';
import { Modal } from '../Common/Modal';
import { ConfirmDialog } from '../Common/ConfirmDialog';
import { byName, canonicalType, isOrganization, organizationOf, sameText, withOrganization } from '../../lib/identity-model';
import type { IdentityChange, IdentityLabels } from './identity-labels';

const field = 'w-full rounded-md border border-border-subtle bg-bg-primary px-2 py-1.5 text-sm text-text-primary focus:border-accent focus:outline-none';
const label = 'flex flex-col gap-1 text-xs text-text-secondary';
const button = 'rounded-md border border-border-subtle px-3 py-1.5 text-sm text-text-secondary hover:bg-bg-hover hover:text-text-primary disabled:cursor-not-allowed disabled:opacity-50';

export interface AddPrefill { name?: string; type?: string; detailLabel?: string; detailValue?: string; folderId?: string; fromText?: string }

interface Props {
  /** Undefined to add a new identity. */
  editing?: Identity;
  prefill?: AddPrefill;
  folders: Folder[];
  defaultFolderId?: string;
  /** Every live identity this view knows, for organisations, merge choices and types in use. */
  identities: Identity[];
  byId: ReadonlyMap<string, Identity>;
  labels: IdentityLabels;
  onClose: () => void;
  onCreate: (partial: Partial<Identity>) => Promise<Identity>;
  onUpdate: (id: string, change: IdentityChange) => Promise<void>;
  onMerge: (keepId: string, goneId: string) => Promise<void>;
  onTrash: (identity: Identity) => Promise<void>;
  onSaved: (identity: Identity, message?: string) => void;
}

export function IdentityFormModal({ editing, prefill, folders, defaultFolderId, identities, byId, labels, onClose, onCreate, onUpdate, onMerge, onTrash, onSaved }: Props) {
  const { t } = labels;
  const ids = useId();
  const [name, setName] = useState(editing?.name ?? prefill?.name ?? '');
  const [type, setType] = useState(editing ? labels.typeLabel(editing.type) : labels.typeLabel(prefill?.type ?? 'person'));
  const [folderId, setFolderId] = useState(editing?.folderId ?? prefill?.folderId ?? defaultFolderId ?? '');
  const [description, setDescription] = useState(editing?.description ?? '');
  // The organisation shown when editing began: only an edge to it is ever replaced.
  const [initialOrganizationId] = useState(editing ? organizationOf(editing, byId)?.id ?? '' : '');
  const [organizationId, setOrganizationId] = useState(initialOrganizationId);
  const [contact, setContact] = useState(false);
  const [detailLabel, setDetailLabel] = useState(prefill?.detailLabel ?? '');
  const [detailValue, setDetailValue] = useState(prefill?.detailValue ?? '');
  // One per line: names such as "Okafor, Dana" or "Acme, Inc." contain commas.
  const [otherNames, setOtherNames] = useState(editing?.aliases.join('\n') ?? '');
  const [mergeWith, setMergeWith] = useState('');
  const [confirm, setConfirm] = useState<'merge' | 'trash' | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const typesInUse = useMemo(() => [...new Set(identities.map(identity => identity.type))], [identities]);
  const resolvedType = canonicalType(type, labels.typeLabels, typesInUse);
  const person = resolvedType === 'person';
  const organizations = identities.filter(identity => isOrganization(identity) && identity.folderId === folderId && identity.id !== editing?.id).sort(byName);
  const mergeChoices = editing ? identities.filter(identity => identity.folderId === editing.folderId && identity.id !== editing.id).sort(byName) : [];
  const typeChoices = [...new Set([...Object.values(labels.typeLabels), ...typesInUse.map(labels.typeLabel)])];

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setError('');
    if (!name.trim()) { setError(t('form.errorName')); return; }
    if (!type.trim()) { setError(t('form.errorType')); return; }
    if (!editing && !folderId) { setError(t('form.errorInvestigation')); return; }
    if (!editing && detailValue.trim() && !detailLabel.trim()) { setError(t('form.errorDetailLabel')); return; }
    setBusy(true);
    try {
      if (editing) {
        const aliases = otherNames.split('\n').map(alias => alias.trim())
          .filter((alias, index, all) => alias && sameText(alias) !== sameText(name) && all.findIndex(other => sameText(other) === sameText(alias)) === index);
        const organizationChanged = !isOrganization({ type: resolvedType }) && organizationId !== initialOrganizationId;
        // Only what was changed in the form is applied, on top of the stored identity, so another
        // name or a description added meanwhile (sync, an agent, another tab) is not overwritten.
        const removed = editing.aliases.filter(alias => !aliases.some(kept => sameText(kept) === sameText(alias)));
        const added = aliases.filter(alias => !editing.aliases.some(old => sameText(old) === sameText(alias)));
        await onUpdate(editing.id, current => ({
          name: sameText(name) === sameText(editing.name) ? current.name : name.trim(),
          type: resolvedType === editing.type ? current.type : resolvedType,
          description: description.trim() === (editing.description ?? '').trim() ? current.description : description.trim() || undefined,
          aliases: [...current.aliases.filter(alias => !removed.some(gone => sameText(gone) === sameText(alias))),
            ...added.filter(alias => !current.aliases.some(other => sameText(other) === sameText(alias)))]
            .filter(alias => sameText(alias) !== sameText(name)),
          ...(organizationChanged ? { connections: withOrganization({ ...current, type: resolvedType }, initialOrganizationId || undefined, organizationId || undefined) } : {}),
        }));
        onSaved({ ...editing, name: name.trim() });
      } else {
        const details = detailValue.trim() ? [{ id: nanoid(), label: detailLabel.trim(), value: detailValue.trim(), ...(labels.privateByDefault(detailLabel) ? { private: true } : {}) }] : [];
        const created = await onCreate({
          folderId, type: resolvedType, name: name.trim(), description: description.trim() || undefined, details,
          ...(person && contact ? { contact: true } : {}),
          connections: organizationId && !isOrganization({ type: resolvedType }) ? [{ targetId: organizationId, label: person ? 'works at' : 'belongs to' }] : [],
        });
        onSaved(created, t('toast.added', { name: created.name }));
      }
    } catch (cause) {
      setError(t('toast.failed', { error: cause instanceof Error ? cause.message : String(cause) }));
    } finally { setBusy(false); }
  };

  const title = editing ? t('form.editTitle', { name: editing.name }) : prefill?.fromText ? t('form.addFromTitle', { text: prefill.fromText }) : t('form.addTitle');
  const gone = mergeChoices.find(identity => identity.id === mergeWith);
  return (
    <>
      <Modal open onClose={onClose} title={title}>
        <form onSubmit={event => void submit(event)} className="flex flex-col gap-3" aria-describedby={error ? `${ids}-error` : undefined}>
          {prefill?.fromText && <p className="text-xs text-text-muted">{t('form.addFromHint')}</p>}
          <label className={label}>{t('form.name')}
            <input autoFocus value={name} onChange={event => setName(event.target.value)} className={field} />
          </label>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className={label}>{t('form.type')}
              <input list={`${ids}-types`} value={type} placeholder={t('form.typePlaceholder')} onChange={event => setType(event.target.value)} className={field} />
              <datalist id={`${ids}-types`}>{typeChoices.map(choice => <option key={choice} value={choice} />)}</datalist>
            </label>
            {!editing && (
              <label className={label}>{t('form.investigation')}
                <select value={folderId} onChange={event => { setFolderId(event.target.value); setOrganizationId(''); }} className={field}>
                  <option value="">{t('form.choose')}</option>
                  {folders.map(folder => <option key={folder.id} value={folder.id}>{folder.name}</option>)}
                </select>
              </label>
            )}
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className={label}>{person ? t('form.jobTitle') : t('form.description')}
              <input value={description} placeholder={t('form.optional')} onChange={event => setDescription(event.target.value)} className={field} />
            </label>
            {!isOrganization({ type: resolvedType }) && (
              <label className={label}>{person ? t('form.worksAt') : t('form.belongsTo')}
                <select value={organizationId} onChange={event => setOrganizationId(event.target.value)} className={field}>
                  <option value="">{organizations.length ? t('form.notRecorded') : t('form.noOrganizations')}</option>
                  {organizations.map(organization => <option key={organization.id} value={organization.id}>{organization.name}</option>)}
                </select>
              </label>
            )}
          </div>
          {!editing && person && (
            <label className="flex items-center gap-2 text-xs text-text-secondary"><input type="checkbox" checked={contact} onChange={event => setContact(event.target.checked)} />{t('form.contact')}</label>
          )}
          {!editing && (
            <div className="grid gap-3 sm:grid-cols-2">
              <label className={label}>{t('form.detail')}
                <input list={`${ids}-labels`} value={detailLabel} placeholder={t('detailForm.labelPlaceholder')} onChange={event => setDetailLabel(event.target.value)} className={field} />
                <datalist id={`${ids}-labels`}>{labels.detailLabels.map(choice => <option key={choice} value={choice} />)}</datalist>
              </label>
              <label className={label}>{t('form.detailValue')}
                <input value={detailValue} placeholder={t('form.optional')} onChange={event => setDetailValue(event.target.value)} className={field} />
              </label>
            </div>
          )}
          {editing && (
            <label className={label}>{t('form.otherNames')}
              <textarea rows={Math.min(6, Math.max(2, otherNames.split('\n').length + 1))} value={otherNames}
                onChange={event => setOtherNames(event.target.value)} className={field} />
            </label>
          )}
          {error && <p id={`${ids}-error`} role="alert" className="text-sm text-red-400">{error}</p>}
          <div className="flex justify-end gap-2">
            <button type="button" className={button} onClick={onClose}>{t('form.cancel')}</button>
            <button type="submit" disabled={busy} className="rounded-md bg-accent px-3 py-1.5 text-sm font-medium text-white hover:bg-accent-hover disabled:opacity-50">{editing ? t('form.save') : t('form.add')}</button>
          </div>
          {editing && (
            <div className="mt-2 flex flex-wrap items-end gap-2 border-t border-border-subtle pt-3">
              <label className={`${label} min-w-[14rem] flex-1`}>{t('merge.label')}
                <select value={mergeWith} onChange={event => setMergeWith(event.target.value)} className={field}>
                  <option value="">{t('form.choose')}</option>
                  {mergeChoices.map(identity => <option key={identity.id} value={identity.id}>{identity.name} · {labels.typeLabel(identity.type)}</option>)}
                </select>
              </label>
              <button type="button" className={button} disabled={!mergeWith || busy} onClick={() => setConfirm('merge')}>{t('merge.button')}</button>
              <span className="flex-1" />
              <button type="button" disabled={busy} className="rounded-md border border-red-500/50 px-3 py-1.5 text-sm text-red-400 hover:bg-red-500/10" onClick={() => setConfirm('trash')}>{t('trash.button')}</button>
            </div>
          )}
        </form>
      </Modal>
      {editing && (
        <ConfirmDialog
          open={confirm !== null}
          onClose={() => setConfirm(null)}
          danger
          title={confirm === 'merge' ? t('merge.confirmTitle') : t('trash.confirmTitle', { name: editing.name })}
          message={confirm === 'merge' && gone ? t('merge.confirmMessage', { gone: gone.name, keep: editing.name }) : t('trash.confirmMessage')}
          confirmLabel={confirm === 'merge' ? t('merge.button') : t('trash.button')}
          onConfirm={() => {
            const action = confirm;
            setConfirm(null);
            setBusy(true);
            void (async () => {
              try {
                if (action === 'merge' && gone) { await onMerge(editing.id, gone.id); onSaved(editing, t('toast.merged', { gone: gone.name, keep: editing.name })); }
                if (action === 'trash') await onTrash(editing);
              } catch (cause) {
                setError(t('toast.failed', { error: cause instanceof Error ? cause.message : String(cause) }));
              } finally { setBusy(false); }
            })();
          }}
        />
      )}
    </>
  );
}
