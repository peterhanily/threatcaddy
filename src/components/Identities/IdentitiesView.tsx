import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import { Contact, Plus, Star } from 'lucide-react';
import type { Folder, Identity, Note, StandaloneIOC, TimelineEvent } from '../../types';
import { useToast } from '../../contexts/ToastContext';
import { useScreenshare } from '../../hooks/ScreenshareContext';
import { BUILTIN_TYPES, byName, foundNames, identityMatches, isBuiltinType, looseText, type FoundName } from '../../lib/identity-model';
import { useIgnoredNames } from '../../hooks/useIgnoredNames';
import { activityOf, noteMatchText } from '../../lib/identity-match';
import { IdentityActivitySection } from './IdentityActivity';
import { cn } from '../../lib/utils';
import { IdentityAvatar, InvestigationPill } from './identity-ui';
import { STATUS_DOT, identitySubtitle, prefillFromFound, useIdentityLabels, withOtherName, type IdentityChange } from './identity-labels';
import { IdentityProfile } from './IdentityProfile';
import { IdentityFormModal, type AddPrefill } from './IdentityFormModal';
import { FoundNameDialog, FoundNamesPanel } from './FoundNames';
import { OrgCharts } from './OrgCharts';

type Filter = 'all' | 'contact' | 'other' | (typeof BUILTIN_TYPES)[number];
const FILTERS: Filter[] = ['all', 'person', 'contact', 'organization', 'system', 'account', 'other'];
const matchesFilter = (identity: Identity, filter: Filter) => filter === 'all' || (filter === 'contact' ? !!identity.contact
  : filter === 'other' ? !isBuiltinType(identity.type) : identity.type === filter);

export interface IdentitiesViewProps {
  /** Identities in the selected investigation, or in every investigation (any state; trashed and archived ones are left out here). */
  identities: Identity[];
  /** Every identity that can be shown, for "Also in another investigation". */
  allIdentities: Identity[];
  folders: Folder[];
  folderId?: string;
  /** Timeline events and IOCs in the same scope, for the names not yet in Identities. */
  events: TimelineEvent[];
  iocs: StandaloneIOC[];
  /** Notes in the same scope, for each profile's Activity. */
  notes?: Note[];
  /** Threat actor names from Settings, tracked separately from identities. */
  threatActors?: string[];
  readOnly?: boolean;
  defaultFolderId?: string;
  /** Opens an identity, for example from search; `query` filters the list (text more than one identity holds). */
  selectRequest?: { id: string; request: number; query?: string };
  /** Opens Add, for example from the New menu; `onAddHandled` clears it so it opens once. */
  addRequest?: number;
  onAddHandled?: () => void;
  onCreate: (partial: Partial<Identity>) => Promise<Identity>;
  onUpdate: (id: string, change: IdentityChange) => Promise<void>;
  onTrash: (id: string) => Promise<void>;
  onMerge: (keepId: string, goneId: string) => Promise<void>;
  /** Shows an identity that belongs to another investigation. */
  onOpenElsewhere?: (identity: Identity) => void;
  /** Open an item from a profile's Activity. */
  onOpenEvent?: (event: TimelineEvent) => void;
  onOpenNote?: (note: Note) => void;
  onOpenIOC?: (ioc: StandaloneIOC) => void;
  /** Starts a note about an identity; absent when read-only. */
  onAddNote?: (identity: Identity) => Promise<unknown>;
}

export function IdentitiesView(props: IdentitiesViewProps) {
  const { identities, allIdentities, folders, folderId, events, iocs, notes, threatActors, readOnly = false, defaultFolderId, selectRequest, addRequest,
    onAddHandled, onCreate, onUpdate, onTrash, onMerge, onOpenElsewhere, onOpenEvent, onOpenNote, onOpenIOC, onAddNote } = props;
  const labels = useIdentityLabels();
  const { t } = labels;
  const ids = useId();
  const { addToast } = useToast();
  const screensharing = useScreenshare().maxLevel !== null;
  const [tab, setTab] = useState<'rolodex' | 'org'>('rolodex');
  const [selectedId, setSelectedId] = useState(selectRequest?.id ?? '');
  const [organizationId, setOrganizationId] = useState('');
  const [query, setQuery] = useState(selectRequest?.query ?? '');
  const [filter, setFilter] = useState<Filter>('all');
  const [form, setForm] = useState<{ editing?: Identity; prefill?: AddPrefill } | null>(null);
  const [picked, setPicked] = useState<FoundName | null>(null);
  const { isIgnored, ignore: ignoreName } = useIgnoredNames();

  // Requests from outside (search, the New menu) are applied once, while rendering.
  const [seenSelect, setSeenSelect] = useState(selectRequest);
  if (selectRequest !== seenSelect) {
    setSeenSelect(selectRequest);
    if (selectRequest) { setSelectedId(selectRequest.id); setTab('rolodex'); setQuery(selectRequest.query ?? ''); setFilter('all'); }
  }
  const [seenAdd, setSeenAdd] = useState<number>();
  if (addRequest !== seenAdd) {
    setSeenAdd(addRequest);
    // Adding needs an investigation to put the identity in.
    if (addRequest && !readOnly && folders.length > 0) setForm({});
  }
  useEffect(() => { if (addRequest) onAddHandled?.(); }, [addRequest, onAddHandled]);

  const showInvestigation = !folderId;
  const live = useMemo(() => identities.filter(identity => !identity.trashed && !identity.archived).sort(byName), [identities]);
  const everywhere = useMemo(() => allIdentities.filter(identity => !identity.trashed && !identity.archived), [allIdentities]);
  const byId = useMemo(() => new Map([...allIdentities, ...identities].map(identity => [identity.id, identity])), [allIdentities, identities]);
  // Archived identities still name things, so their names are not "found" again.
  const known = useMemo(() => identities.filter(identity => !identity.trashed), [identities]);
  const found = useMemo(() => (readOnly ? [] : foundNames({ identities: known, events, iocs, threatActors, isIgnored })),
    [readOnly, known, events, iocs, threatActors, isIgnored]);

  const rows = live.filter(identity => matchesFilter(identity, filter) && identityMatches(identity, query, labels.typeLabel(identity.type)));
  const selected = live.find(identity => identity.id === selectedId) ?? rows[0] ?? live[0];
  const filters = FILTERS.filter(option => option === 'all' || option === filter || live.some(identity => matchesFilter(identity, option)));
  // Note text is normalised once per change to the notes, not each time an identity is chosen.
  const noteTexts = useMemo(() => new Map((notes ?? []).map(note => [note.id, noteMatchText(note)])), [notes]);
  const activity = useMemo(() => (selected ? activityOf(selected, { events, notes: notes ?? [], iocs, noteTexts }) : undefined), [selected, events, notes, iocs, noteTexts]);

  /** Reports a failed save, then rejects, so a form that waits for it stays open. */
  const run = useCallback(async (action: () => Promise<unknown>, success?: string) => {
    try { await action(); if (success) addToast('success', success); }
    catch (cause) { addToast('error', t('toast.failed', { error: cause instanceof Error ? cause.message : String(cause) })); throw cause; }
  }, [addToast, t]);
  const searchBox = useRef<HTMLInputElement>(null);
  const open = useCallback((identity: Identity) => {
    if (folderId && identity.folderId !== folderId) { onOpenElsewhere?.(identity); return; }
    setSelectedId(identity.id); setTab('rolodex');
    if (!rows.some(row => row.id === identity.id)) { setQuery(''); setFilter('all'); }
  }, [folderId, onOpenElsewhere, rows]);
  const ignore = (name: FoundName) => {
    ignoreName(name.folderId, name.text); setPicked(null);
    addToast('info', t('toast.ignored', { text: name.text }));
  };

  // A letter heading before the first name that starts with it; accents do not split a letter (Ö goes under O).
  const initialOf = (identity: Identity) => [...looseText(identity.name)][0]?.toUpperCase() ?? '';
  const headings = rows.map((identity, index) => (index === 0 || initialOf(identity) !== initialOf(rows[index - 1]) ? initialOf(identity) : null));
  const canAdd = !readOnly && folders.length > 0;
  return (
    <div className="flex flex-1 flex-col overflow-hidden bg-bg-primary">
      <header className="flex shrink-0 flex-wrap items-center gap-3 border-b border-border-subtle px-4 py-3">
        <div className="flex min-w-0 flex-1 items-center gap-2">
          <Contact size={20} className="shrink-0 text-accent-blue" aria-hidden="true" />
          <div className="min-w-0">
            <h1 className="text-base font-semibold text-text-primary">{t('header.title')}</h1>
            <p className="text-xs text-text-muted">{folderId ? t('header.descScoped') : t('header.descAll')}</p>
          </div>
        </div>
        {!readOnly && (
          <button type="button" disabled={!canAdd} title={canAdd ? undefined : t('header.addBlocked')} onClick={() => setForm({})}
            className="inline-flex items-center gap-1.5 rounded-md bg-accent px-3 py-1.5 text-xs font-medium text-white hover:bg-accent-hover disabled:cursor-not-allowed disabled:bg-bg-raised disabled:text-text-muted">
            <Plus size={14} />{t('header.add')}
          </button>
        )}
      </header>
      <nav aria-label={t('tabs.label')} className="flex shrink-0 gap-0 border-b border-border-subtle px-4">
        {(['rolodex', 'org'] as const).map(id => (
          <button key={id} type="button" aria-current={tab === id ? 'page' : undefined} onClick={() => setTab(id)}
            className={cn('border-b-2 px-3 py-2 text-xs font-medium', tab === id ? 'border-accent text-accent' : 'border-transparent text-text-muted hover:text-text-primary')}>
            {id === 'rolodex' ? t('tabs.rolodex') : t('tabs.orgCharts')}
          </button>
        ))}
      </nav>
      <div className="flex-1 overflow-y-auto p-4">
        <div className="mx-auto flex max-w-6xl flex-col gap-4">
          {readOnly && <p className="rounded-md border border-border-subtle bg-bg-surface px-3 py-2 text-xs text-text-muted">{t('readOnly.remote')}</p>}
          {tab === 'org' ? (
            <OrgCharts identities={live} folders={folders} showInvestigation={showInvestigation} selectedOrganizationId={organizationId}
              labels={labels} onSelectOrganization={setOrganizationId} onOpen={open} />
          ) : (
            <>
              <FoundNamesPanel found={found} folders={folders} showInvestigation={showInvestigation} labels={labels} onPick={setPicked} />
              <div className="grid items-start gap-4 lg:grid-cols-[minmax(16rem,0.8fr)_minmax(0,1.6fr)]">
                <section aria-label={t('list.label')} className="flex min-w-0 flex-col gap-2">
                  <label htmlFor={`${ids}-search`} className="sr-only">{t('search.label')}</label>
                  <input ref={searchBox} id={`${ids}-search`} type="search" value={query} placeholder={t('search.placeholder')} onChange={event => setQuery(event.target.value)}
                    className="w-full rounded-md border border-border-subtle bg-bg-surface px-3 py-1.5 text-sm text-text-primary focus:border-accent focus:outline-none" />
                  <div role="group" aria-label={t('filter.label')} className="flex flex-wrap gap-1">
                    {filters.map(option => (
                      <button key={option} type="button" aria-pressed={filter === option} onClick={() => setFilter(option)}
                        className={cn('rounded-full border px-2 py-0.5 text-xs', filter === option ? 'border-accent bg-accent/15 text-accent' : 'border-border-subtle text-text-secondary hover:text-text-primary')}>
                        {t(`filter.${option}`)} <span className="text-text-muted">{live.filter(identity => matchesFilter(identity, option)).length}</span>
                      </button>
                    ))}
                  </div>
                  <div role="list" className="max-h-[70vh] overflow-y-auto rounded-lg border border-border-subtle bg-bg-surface p-1">
                    {rows.map((identity, index) => {
                      const heading = headings[index];
                      return (
                        <div key={identity.id} role="listitem">
                          {heading && <div aria-hidden="true" className="px-2 pt-2 text-[10px] font-semibold text-text-muted">{heading}</div>}
                          <button type="button" aria-current={selected?.id === identity.id ? 'true' : undefined} onClick={() => setSelectedId(identity.id)}
                            className={cn('flex w-full min-w-0 items-center gap-2 rounded-md px-2 py-1.5 text-start hover:bg-bg-hover', selected?.id === identity.id && 'bg-accent/10')}>
                            <IdentityAvatar identity={identity} />
                            <span className="min-w-0 flex-1">
                              <span className="flex items-center gap-1 truncate text-sm text-text-primary">
                                {identity.name}
                                {identity.contact && <><Star size={12} aria-hidden="true" className="shrink-0 fill-current text-amber-400" /><span className="sr-only">{t('list.contactSr')}</span></>}
                              </span>
                              <span className="block truncate text-xs text-text-muted">
                                {showInvestigation && <><InvestigationPill folder={folders.find(folder => folder.id === identity.folderId)} missingLabel={t('list.orphan')} />{' '}</>}
                                {identitySubtitle(identity, byId, labels)}
                              </span>
                            </span>
                            {identity.status && <><span aria-hidden="true" className={cn('h-2 w-2 shrink-0 rounded-full', STATUS_DOT[identity.status])} /><span className="sr-only">, {labels.statusLabel(identity.status)}</span></>}
                          </button>
                        </div>
                      );
                    })}
                    {!rows.length && <p role="listitem" className="p-3 text-xs text-text-muted">{live.length ? t('list.noMatches') : t('list.empty')}</p>}
                  </div>
                </section>
                {selected ? (
                  <IdentityProfile
                    key={selected.id}
                    identity={selected}
                    byId={byId}
                    sameInvestigation={live.filter(identity => identity.folderId === selected.folderId)}
                    everywhere={everywhere}
                    folders={folders}
                    showInvestigation={showInvestigation}
                    readOnly={readOnly}
                    screensharing={screensharing}
                    labels={labels}
                    onUpdate={(id, updates) => run(() => onUpdate(id, updates))}
                    onEdit={() => setForm({ editing: selected })}
                    onOpen={open}
                    onOpenChart={organization => { setOrganizationId(organization.id); setTab('org'); }}
                  >
                    {activity && (
                      <IdentityActivitySection identity={selected} activity={activity} labels={labels} onOpenEvent={onOpenEvent}
                        onOpenNote={onOpenNote} onOpenIOC={onOpenIOC}
                        onAddNote={readOnly || !onAddNote ? undefined : identity => { void run(() => onAddNote(identity)).catch(() => { /* Reported. */ }); }} />
                    )}
                  </IdentityProfile>
                ) : <p className="rounded-lg border border-border-subtle bg-bg-surface p-4 text-sm text-text-muted">{live.length ? t('profile.select') : t('list.empty')}</p>}
              </div>
            </>
          )}
        </div>
      </div>
      {form && (
        <IdentityFormModal
          editing={form.editing}
          prefill={form.prefill}
          folders={folders}
          defaultFolderId={folderId ?? defaultFolderId}
          identities={form.editing ? live : everywhere.length ? everywhere : live}
          byId={byId}
          labels={labels}
          onClose={() => setForm(null)}
          onCreate={onCreate}
          onUpdate={onUpdate}
          onMerge={onMerge}
          onTrash={async identity => {
            await onTrash(identity.id);
            setForm(null);
            if (selectedId === identity.id) setSelectedId('');
            addToast('success', t('toast.trashed', { name: identity.name }));
            // Its profile is gone; continue from the list.
            searchBox.current?.focus();
          }}
          onSaved={(identity, message) => {
            setForm(null);
            setSelectedId(identity.id);
            if (message) addToast('success', message);
          }}
        />
      )}
      {picked && (
        <FoundNameDialog
          found={picked}
          folders={folders}
          identities={live}
          labels={labels}
          onClose={() => setPicked(null)}
          onIgnore={() => ignore(picked)}
          onAddNew={() => { setPicked(null); setForm({ prefill: prefillFromFound(picked, labels) }); }}
          onAddAsOtherName={identity => {
            const text = picked.text;
            setPicked(null);
            void run(() => onUpdate(identity.id, withOtherName(text)), t('toast.otherNameAdded', { text, name: identity.name })).catch(() => { /* Reported. */ });
            setSelectedId(identity.id);
          }}
        />
      )}
    </div>
  );
}
