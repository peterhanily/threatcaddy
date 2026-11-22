import { useEffect, useId, useMemo, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { Lock, LockOpen, Pencil, Star, X } from 'lucide-react';
import { nanoid } from 'nanoid';
import type { Folder, Identity, IdentityStatus, IdentityDetail } from '../../types';
import { IDENTITY_STATUSES } from '../../lib/entity-enums';
import {
  CONNECTION_PHRASES, alsoElsewhere, byName, canonicalPhrase, connectionsOf, isOrganization, isPerson, maskDetail, membersOf, sameText,
} from '../../lib/identity-model';
import { cn } from '../../lib/utils';
import type { IdentityChange } from './identity-labels';
import { IdentityAvatar, InvestigationPill } from './identity-ui';
import { STATUS_DOT, identitySubtitle, type IdentityLabels } from './identity-labels';

const MONO_LABEL = /mail|ip|host|domain|iban|user|handle|tag|website|url/i;
const field = 'w-full rounded-md border border-border-subtle bg-bg-primary px-2 py-1.5 text-sm text-text-primary focus:border-accent focus:outline-none';
const smallButton = 'inline-flex items-center gap-1.5 rounded-md border border-border-subtle px-2.5 py-1 text-xs font-medium text-text-secondary hover:bg-bg-hover hover:text-text-primary disabled:cursor-not-allowed disabled:opacity-50';
const linkButton = 'text-xs font-medium text-accent hover:underline';

interface Props {
  identity: Identity;
  /** Every identity this view can resolve, in any investigation. */
  byId: ReadonlyMap<string, Identity>;
  /** Live identities in this identity's investigation (connection targets). */
  sameInvestigation: Identity[];
  /** Live identities everywhere visible, for "Also in another investigation". */
  everywhere: Identity[];
  folders: Folder[];
  showInvestigation: boolean;
  readOnly: boolean;
  screensharing: boolean;
  labels: IdentityLabels;
  onUpdate: (id: string, change: IdentityChange) => Promise<void>;
  onEdit: () => void;
  onOpen: (identity: Identity) => void;
  onOpenChart: (organization: Identity) => void;
  /** Shown below details and connections (the Activity list). */
  children?: ReactNode;
}

/** A detail made private or public; a public detail carries no `private` field. */
function withPrivacy(detail: IdentityDetail, isPrivate: boolean): IdentityDetail {
  const { private: _wasPrivate, ...rest } = detail;
  void _wasPrivate;
  return isPrivate ? { ...rest, private: true } : rest;
}

export function IdentityProfile({ identity, byId, sameInvestigation, everywhere, folders, showInvestigation, readOnly, screensharing, labels, onUpdate, onEdit, onOpen, onOpenChart, children }: Props) {
  const { t } = labels;
  const ids = useId();
  const [shown, setShown] = useState<ReadonlySet<string>>(new Set());
  const [detailForm, setDetailForm] = useState<{ label: string; value: string; private: boolean; error?: string } | null>(null);
  const [connectionForm, setConnectionForm] = useState<{ phrase: string; to: string; error?: string } | null>(null);
  // Closing an inline form returns focus to the button that opened it.
  const detailButton = useRef<HTMLButtonElement>(null);
  const connectionButton = useRef<HTMLButtonElement>(null);
  // Used once, after the form has gone and its button is back.
  const returnFocus = useRef<'detail' | 'connection' | null>(null);
  useEffect(() => {
    const button = returnFocus.current === 'detail' ? detailButton.current : returnFocus.current === 'connection' ? connectionButton.current : null;
    if (button) { button.focus(); returnFocus.current = null; }
  });
  const closeDetail = () => { setDetailForm(null); returnFocus.current = 'detail'; };
  const closeConnection = () => { setConnectionForm(null); returnFocus.current = 'connection'; };
  /** A failed save keeps the form and what was typed; the view has already said why. */
  const save = async (id: string, change: IdentityChange) => { try { await onUpdate(id, change); return true; } catch { return false; } };

  const folder = folders.find(candidate => candidate.id === identity.folderId);
  const connections = useMemo(() => connectionsOf(identity, byId, sameInvestigation), [identity, byId, sameInvestigation]);
  const others = useMemo(() => alsoElsewhere(identity, everywhere), [identity, everywhere]);
  const members = useMemo(() => (isOrganization(identity) ? membersOf(identity, sameInvestigation) : null), [identity, sameInvestigation]);
  const chartable = members !== null && members.people.length > 0;
  const targets = useMemo(() => sameInvestigation.filter(other => other.id !== identity.id).sort(byName), [identity.id, sameInvestigation]);

  const addDetail = async (event: FormEvent) => {
    event.preventDefault();
    if (!detailForm) return;
    const label = detailForm.label.trim(), value = detailForm.value.trim();
    if (!label) { setDetailForm({ ...detailForm, error: t('detailForm.errorLabel') }); return; }
    if (!value) { setDetailForm({ ...detailForm, error: t('detailForm.errorValue') }); return; }
    const detail = { id: nanoid(), label, value, ...(detailForm.private ? { private: true } : {}) };
    if (await save(identity.id, current => ({ details: [...current.details, detail] }))) closeDetail();
  };
  const addConnection = async (event: FormEvent) => {
    event.preventDefault();
    if (!connectionForm) return;
    const { label, reversed } = canonicalPhrase(connectionForm.phrase, labels.phraseLabels, labels.reverseLabels);
    if (!label) { setConnectionForm({ ...connectionForm, error: t('connectionForm.errorPhrase') }); return; }
    if (!connectionForm.to) { setConnectionForm({ ...connectionForm, error: t('connectionForm.errorTarget') }); return; }
    // "Lee manages Dana" is stored as "Dana reports to Lee", so charts and both sides read it.
    const [owner, edge] = reversed ? [connectionForm.to, { targetId: identity.id, label }] : [identity.id, { targetId: connectionForm.to, label }];
    // The same connection added again (from either side) is stored once.
    if (await save(owner, current => ({ connections: current.connections.some(other => other.targetId === edge.targetId && other.label === edge.label)
      ? current.connections : [...current.connections, edge] }))) closeConnection();
  };
  /** Removes the edge from whichever identity holds it, matched in the stored row rather than by position. */
  const removeConnection = async (ownerId: string, edge: { targetId: string; label: string }) => {
    // The removed row's button goes away: focus continues from "Add a connection".
    connectionButton.current?.focus();
    await save(ownerId, current => {
      const position = current.connections.findIndex(candidate => candidate.targetId === edge.targetId && candidate.label === edge.label);
      return { connections: position < 0 ? current.connections : current.connections.filter((_, index) => index !== position) };
    });
  };

  const chip = (other: Identity) => (
    <button type="button" onClick={() => onOpen(other)} className="inline-flex max-w-full items-center gap-1 rounded-full border border-border-subtle bg-bg-raised px-1.5 py-0.5 text-xs text-text-primary hover:border-accent">
      <IdentityAvatar identity={other} size="xs" /><span className="truncate">{other.name}</span>
    </button>
  );

  return (
    <article aria-label={identity.name} className="flex min-w-0 flex-col gap-4 rounded-lg border border-border-subtle bg-bg-surface p-4">
      <header className="flex flex-wrap items-start gap-3">
        <IdentityAvatar identity={identity} size="lg" />
        <div className="min-w-0 flex-1">
          <h2 className="break-words text-lg font-semibold text-text-primary">{identity.name}</h2>
          <p className="text-sm text-text-secondary">{identitySubtitle(identity, byId, labels)}</p>
          {identity.aliases.length > 0 && <p className="text-xs text-text-muted">{t('profile.otherNames', { names: labels.list(identity.aliases) })}</p>}
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <label className="sr-only" htmlFor={`${ids}-status`}>{t('status.label')}</label>
            <select
              id={`${ids}-status`}
              value={identity.status ?? ''}
              disabled={readOnly}
              onChange={event => void save(identity.id, { status: (event.target.value || undefined) as IdentityStatus | undefined })}
              className="rounded-md border border-border-subtle bg-bg-primary px-2 py-1 text-xs text-text-primary disabled:opacity-60"
            >
              <option value="">{labels.statusLabel()}</option>
              {IDENTITY_STATUSES.map(status => <option key={status} value={status}>{labels.statusLabel(status)}</option>)}
            </select>
            {identity.status && <span aria-hidden="true" className={cn('h-2 w-2 rounded-full', STATUS_DOT[identity.status])} />}
            {isPerson(identity) && (
              <button type="button" aria-pressed={!!identity.contact} disabled={readOnly} onClick={() => void save(identity.id, { contact: identity.contact ? undefined : true })}
                className={cn(smallButton, identity.contact && 'border-amber-500/60 text-amber-400')}>
                <Star size={13} className={identity.contact ? 'fill-current' : ''} />{t('profile.contact')}
              </button>
            )}
            {showInvestigation && <InvestigationPill folder={folder} missingLabel={t('list.orphan')} />}
          </div>
        </div>
        {!readOnly && <button type="button" onClick={onEdit} className={smallButton}><Pencil size={13} />{t('profile.edit')}</button>}
      </header>

      {members && (
        <section aria-labelledby={`${ids}-people`} className="flex flex-col gap-2">
          <div className="flex flex-wrap items-center gap-3">
            <h3 id={`${ids}-people`} className="text-xs font-semibold uppercase tracking-wide text-text-muted">{t('people.heading', { count: members.people.length })}</h3>
            {chartable && <button type="button" className={linkButton} onClick={() => onOpenChart(identity)}>{t('people.openChart')}</button>}
          </div>
          {members.people.length ? (
            <ul className="flex flex-col gap-1">
              {members.people.slice(0, 8).map(person => (
                <li key={person.id} className="flex min-w-0 flex-wrap items-center gap-2">
                  {chip(person)}
                  {person.contact && <span className="inline-flex items-center gap-1 text-[11px] text-amber-400"><Star size={11} className="fill-current" />{t('profile.contact')}</span>}
                  {person.description && <span className="truncate text-xs text-text-muted">{person.description}</span>}
                </li>
              ))}
            </ul>
          ) : <p className="text-xs text-text-muted">{t('people.none', { name: identity.name })}</p>}
          {members.people.length > 8 && <p className="text-xs text-text-muted">{t('people.more', { count: members.people.length - 8 })}</p>}
          {members.things.length > 0 && (
            <div className="flex flex-wrap items-center gap-1.5"><span className="text-xs text-text-muted">{t('people.things')}</span>{members.things.map(thing => <span key={thing.id}>{chip(thing)}</span>)}</div>
          )}
        </section>
      )}

      <div className="grid gap-4 md:grid-cols-2">
        <section aria-labelledby={`${ids}-details`} className="flex min-w-0 flex-col gap-2">
          <h3 id={`${ids}-details`} className="text-xs font-semibold uppercase tracking-wide text-text-muted">{t('details.heading')}</h3>
          {/* Said on screen, not only in the disabled Show button's tooltip (keyboard, touch and screen readers miss it). */}
          {screensharing && identity.details.some(detail => detail.private) && (
            <p id={`${ids}-sharing`} className="text-xs text-text-muted">{t('details.hiddenWhileSharing')}</p>
          )}
          <ul className="flex flex-col gap-1.5">
            {identity.details.map((detail, position) => {
              const visible = !detail.private || (shown.has(detail.id) && !screensharing);
              // Two details with one label get distinct button names ("Remove Email 2"), never their private value.
              const same = identity.details.filter(other => sameText(other.label) === sameText(detail.label));
              const named = same.length > 1 ? `${detail.label} ${identity.details.slice(0, position + 1).filter(other => sameText(other.label) === sameText(detail.label)).length}` : detail.label;
              return (
                <li key={detail.id} className="grid grid-cols-[minmax(5rem,auto)_1fr_auto] items-start gap-2 text-sm">
                  <span className="text-xs text-text-muted">{detail.label}</span>
                  <span className="flex min-w-0 flex-wrap items-center gap-1.5">
                    <span className={cn('break-all text-text-primary', MONO_LABEL.test(detail.label) && 'font-mono text-xs')}>{visible ? detail.value : maskDetail(detail, screensharing)}</span>
                    {detail.private && (visible
                      ? <span className="inline-flex items-center gap-0.5 rounded bg-bg-raised px-1 text-[10px] text-text-muted"><Lock size={10} />{t('details.private')}</span>
                      : <button type="button" disabled={screensharing} title={screensharing ? t('details.hiddenWhileSharing') : undefined}
                          aria-describedby={screensharing ? `${ids}-sharing` : undefined}
                          aria-label={t('details.showAria', { label: named.toLowerCase() })} className={cn(linkButton, 'disabled:cursor-not-allowed disabled:opacity-50')}
                          onClick={() => setShown(previous => new Set(previous).add(detail.id))}>{t('details.show')}</button>)}
                  </span>
                  {!readOnly && (
                    <span className="flex items-center gap-0.5">
                      {/* Private or public can be changed later, e.g. after an import; making one public while screensharing would show it. */}
                      <button type="button" disabled={!!detail.private && screensharing}
                        aria-label={t(detail.private ? 'details.makePublicAria' : 'details.makePrivateAria', { label: named })}
                        title={detail.private && screensharing ? t('details.hiddenWhileSharing') : t(detail.private ? 'details.makePublic' : 'details.makePrivate')}
                        className="rounded p-0.5 text-text-muted hover:text-text-primary disabled:cursor-not-allowed disabled:opacity-50"
                        onClick={() => {
                          if (!detail.private) setShown(previous => { const next = new Set(previous); next.delete(detail.id); return next; });
                          void save(identity.id, current => ({ details: current.details.map(other => (other.id !== detail.id ? other : withPrivacy(other, !other.private))) }));
                        }}>{detail.private ? <LockOpen size={13} /> : <Lock size={13} />}</button>
                      <button type="button" aria-label={t('details.remove', { label: named })} className="rounded p-0.5 text-text-muted hover:text-text-primary"
                        onClick={() => { detailButton.current?.focus(); /* The row's button goes away: continue from "Add a detail". */ void save(identity.id, current => ({ details: current.details.filter(other => other.id !== detail.id) })); }}><X size={13} /></button>
                    </span>
                  )}
                </li>
              );
            })}
            {!identity.details.length && <li className="text-xs text-text-muted">{t('details.none')}</li>}
          </ul>
          {!readOnly && (detailForm ? (
            <form onSubmit={event => void addDetail(event)} onKeyDown={event => { if (event.key === 'Escape') { event.stopPropagation(); closeDetail(); } }} className="flex flex-col gap-2 rounded-md border border-border-subtle p-2">
              <div className="grid gap-2 sm:grid-cols-2">
                <label className="flex flex-col gap-1 text-xs text-text-secondary">{t('detailForm.label')}
                  <input autoFocus list={`${ids}-labels`} value={detailForm.label} maxLength={100} placeholder={t('detailForm.labelPlaceholder')} className={field}
                    onChange={event => setDetailForm({ ...detailForm, label: event.target.value, private: labels.privateByDefault(event.target.value) || (detailForm.private && !labels.privateByDefault(detailForm.label)) })} />
                </label>
                <label className="flex flex-col gap-1 text-xs text-text-secondary">{t('detailForm.value')}
                  <input value={detailForm.value} maxLength={2000} className={field} onChange={event => setDetailForm({ ...detailForm, value: event.target.value })} />
                </label>
              </div>
              <datalist id={`${ids}-labels`}>{labels.detailLabels.map(label => <option key={label} value={label} />)}</datalist>
              <label className="flex items-start gap-2 text-xs text-text-secondary">
                <input type="checkbox" className="mt-0.5" checked={detailForm.private} onChange={event => setDetailForm({ ...detailForm, private: event.target.checked })} />
                {t('detailForm.private')}
              </label>
              {detailForm.error && <p role="alert" className="text-xs text-red-400">{detailForm.error}</p>}
              <div className="flex gap-2">
                <button type="submit" className="rounded-md bg-accent px-3 py-1 text-xs font-medium text-white hover:bg-accent-hover">{t('form.add')}</button>
                <button type="button" className={smallButton} onClick={closeDetail}>{t('form.cancel')}</button>
              </div>
            </form>
          ) : <button ref={detailButton} type="button" className={cn(linkButton, 'self-start')} onClick={() => { setDetailForm({ label: '', value: '', private: false }); setConnectionForm(null); }}>{t('details.add')}</button>)}
          {others.length > 0 && (
            <p className="flex flex-wrap items-center gap-1.5 text-xs text-text-muted">{t('also.heading')}
              {others.map(other => (
                <span key={other.id} className="inline-flex items-center gap-1">{chip(other)}<InvestigationPill folder={folders.find(candidate => candidate.id === other.folderId)} missingLabel={t('list.orphan')} /></span>
              ))}
            </p>
          )}
        </section>

        <section aria-labelledby={`${ids}-connections`} className="flex min-w-0 flex-col gap-2">
          <h3 id={`${ids}-connections`} className="text-xs font-semibold uppercase tracking-wide text-text-muted">{t('connections.heading')}</h3>
          <ul className="flex flex-col gap-1.5">
            {connections.map(connection => (
              <li key={`${connection.ownerId}:${connection.index}`} className="flex min-w-0 flex-wrap items-center gap-1.5 text-sm">
                {connection.outgoing || Object.hasOwn(CONNECTION_PHRASES, connection.label) ? (
                  <><span className="text-text-secondary">{labels.phrase(connection.label, connection.outgoing)}</span>{chip(connection.other)}</>
                ) : (
                  <>{chip(connection.other)}<span className="text-text-secondary">{t('connections.incomingCustom', { label: connection.label, name: identity.name })}</span></>
                )}
                {!readOnly && <button type="button" aria-label={t('connections.removeAria', { phrase: labels.phrase(connection.label, connection.outgoing), name: connection.other.name })} className="ms-auto rounded p-0.5 text-text-muted hover:text-text-primary"
                  onClick={() => void removeConnection(connection.ownerId, { targetId: connection.outgoing ? connection.other.id : identity.id, label: connection.label })}><X size={13} /></button>}
              </li>
            ))}
            {!connections.length && <li className="text-xs text-text-muted">{t('connections.none')}</li>}
          </ul>
          {!readOnly && (connectionForm ? (
            <form onSubmit={event => void addConnection(event)} onKeyDown={event => { if (event.key === 'Escape') { event.stopPropagation(); closeConnection(); } }} className="flex flex-col gap-2 rounded-md border border-border-subtle p-2">
              {targets.length ? (
                <div className="grid gap-2 sm:grid-cols-2">
                  <label className="flex flex-col gap-1 text-xs text-text-secondary">{t('connectionForm.phrase', { name: identity.name })}
                    <input autoFocus list={`${ids}-phrases`} value={connectionForm.phrase} maxLength={100} placeholder={t('connectionForm.phrasePlaceholder')} className={field}
                      onChange={event => setConnectionForm({ ...connectionForm, phrase: event.target.value })} />
                  </label>
                  <label className="flex flex-col gap-1 text-xs text-text-secondary">{t('connectionForm.target')}
                    <select value={connectionForm.to} className={field} onChange={event => setConnectionForm({ ...connectionForm, to: event.target.value })}>
                      <option value="">{t('form.choose')}</option>
                      {targets.map(other => <option key={other.id} value={other.id}>{other.name} · {labels.typeLabel(other.type)}</option>)}
                    </select>
                  </label>
                  <datalist id={`${ids}-phrases`}>{Object.values(labels.phraseLabels).map(phrase => <option key={phrase} value={phrase} />)}</datalist>
                </div>
              ) : <p className="text-xs text-text-muted">{t('connectionForm.noOthers')}</p>}
              {connectionForm.error && <p role="alert" className="text-xs text-red-400">{connectionForm.error}</p>}
              <div className="flex gap-2">
                {targets.length > 0 && <button type="submit" className="rounded-md bg-accent px-3 py-1 text-xs font-medium text-white hover:bg-accent-hover">{t('form.add')}</button>}
                <button type="button" className={smallButton} onClick={closeConnection}>{t('form.cancel')}</button>
              </div>
            </form>
          ) : <button ref={connectionButton} type="button" className={cn(linkButton, 'self-start')} onClick={() => { setConnectionForm({ phrase: '', to: '' }); setDetailForm(null); }}>{t('connections.add')}</button>)}
        </section>
      </div>
      {children}
    </article>
  );
}
