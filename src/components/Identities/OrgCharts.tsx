import { useId, useMemo, useState, type ReactNode } from 'react';
import { Star } from 'lucide-react';
import type { Folder, Identity } from '../../types';
import { chartableOrganizations, orgChart, type OrgChart } from '../../lib/identity-model';
import { cn } from '../../lib/utils';
import { IdentityAvatar } from './identity-ui';
import type { IdentityLabels } from './identity-labels';

/** Levels of a team shown under one another (each indents further, so more would leave no width for
 * the cards); a deeper chain shows a note instead. */
const MAX_DEPTH = 10;
/** Members of one team drawn before "more". */
const TEAM_LIMIT = 50;

const STATUS_TEXT = { compromised: 'text-red-400', suspicious: 'text-amber-400', cleared: 'text-green-400' } as const;

export function OrgCharts({ identities, folders, showInvestigation, selectedOrganizationId, labels, onSelectOrganization, onOpen }: {
  /** Live identities in scope. */
  identities: Identity[]; folders: Folder[]; showInvestigation: boolean; selectedOrganizationId?: string; labels: IdentityLabels;
  onSelectOrganization: (id: string) => void; onOpen: (identity: Identity) => void;
}) {
  const { t } = labels;
  const ids = useId();
  const [open, setOpen] = useState<Record<string, boolean>>({});
  // A team of thousands shows its first members until asked for all.
  const [allTeams, setAllTeams] = useState<Record<string, boolean>>({});
  const listed = (person: Identity, reports: Identity[]) => (allTeams[person.id] ? reports : reports.slice(0, TEAM_LIMIT));
  const more = (person: Identity, reports: Identity[]) => reports.length > TEAM_LIMIT && (
    <button type="button" aria-expanded={!!allTeams[person.id]} onClick={() => setAllTeams(previous => ({ ...previous, [person.id]: !previous[person.id] }))}
      className="self-start text-xs font-medium text-accent hover:underline">
      {allTeams[person.id] ? t('found.fewer') : t('found.more', { count: reports.length - TEAM_LIMIT })}
    </button>
  );
  // Worked out when the identities or the organisation change, not when a team is shown or hidden.
  const organizations = useMemo(() => chartableOrganizations(identities), [identities]);
  const organization = organizations.find(candidate => candidate.id === selectedOrganizationId) ?? organizations[0];
  const chart = useMemo(() => (organization ? orgChart(organization, identities) : undefined), [organization, identities]);
  if (!organization || !chart) return <p className="rounded-lg border border-border-subtle bg-bg-surface p-4 text-sm text-text-muted">{t('org.empty')}</p>;

  const card = (person: Identity) => (
    <button type="button" onClick={() => onOpen(person)} className="flex w-full min-w-0 items-center gap-2 rounded-md border border-border-subtle bg-bg-raised p-2 text-start hover:border-accent">
      <IdentityAvatar identity={person} size="md" />
      <span className="min-w-0">
        <span className="flex items-center gap-1 truncate text-sm font-medium text-text-primary">
          {person.name}{person.contact && <><Star size={12} aria-hidden="true" className="shrink-0 fill-current text-amber-400" /><span className="sr-only">{t('list.contactSr')}</span></>}
        </span>
        {person.description && <span className="block truncate text-xs text-text-muted">{person.description}</span>}
        {person.status && <span className={cn('block text-xs', STATUS_TEXT[person.status])}>{labels.statusLabel(person.status)}</span>}
      </span>
    </button>
  );
  const team = (person: Identity, current: OrgChart, depth = 1): ReactNode => {
    const reports = current.reportsOf(person);
    if (!reports.length) return null;
    // A reporting chain can be thousands deep (synced or imported data): levels past this many say so.
    if (depth > MAX_DEPTH) return <p className="mt-1 text-xs text-text-muted">{t('org.deeper', { count: current.teamSize(person) })}</p>;
    const expanded = open[person.id] ?? current.flagged(person);
    const size = current.teamSize(person);
    return (
      <>
        <button type="button" aria-expanded={expanded} onClick={() => setOpen(previous => ({ ...previous, [person.id]: !expanded }))}
          className="mt-1 text-xs font-medium text-accent hover:underline">
          {expanded ? t('org.hideTeam', { count: size }) : t('org.showTeam', { count: size })}
        </button>
        {expanded && (
          <ul className="mt-1 flex flex-col gap-1.5 border-s border-border-subtle ps-3">
            {listed(person, reports).map(report => <li key={report.id}>{card(report)}{team(report, current, depth + 1)}</li>)}
            {more(person, reports) && <li>{more(person, reports)}</li>}
          </ul>
        )}
      </>
    );
  };

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-end gap-x-4 gap-y-2">
        <label className="flex flex-col gap-1 text-xs text-text-secondary" htmlFor={`${ids}-org`}>{t('org.organization')}
          <select id={`${ids}-org`} value={organization.id} onChange={event => onSelectOrganization(event.target.value)}
            className="rounded-md border border-border-subtle bg-bg-primary px-2 py-1.5 text-sm text-text-primary">
            {organizations.map(candidate => (
              <option key={candidate.id} value={candidate.id}>
                {candidate.name}{showInvestigation ? ` · ${folders.find(folder => folder.id === candidate.folderId)?.name ?? t('list.orphan')}` : ''}
              </option>
            ))}
          </select>
        </label>
        <p className="min-w-[16rem] flex-1 text-xs text-text-muted">{t('org.desc', { name: organization.name })}</p>
      </div>
      {chart.roots.map(root => (
        <div key={root.id} className="flex flex-col gap-3">
          <div className="w-full max-w-xs">{card(root)}</div>
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {listed(root, chart.reportsOf(root)).map(report => (
              <section key={report.id} aria-label={t('org.teamAria', { name: report.name })} className="rounded-lg border border-border-subtle bg-bg-surface p-2">
                {card(report)}{team(report, chart)}
              </section>
            ))}
          </div>
          {more(root, chart.reportsOf(root))}
        </div>
      ))}
      {chart.unplaced.length > 0 && (chart.roots.length
        ? <p className="text-xs text-text-muted">{t('org.noManager', { names: labels.list(chart.unplaced.map(person => person.name)) })}</p>
        : (
          <section aria-label={organization.name} className="flex flex-col gap-2 rounded-lg border border-border-subtle bg-bg-surface p-2">
            <p className="text-xs text-text-muted">{t('org.nobodyManaged', { name: organization.name })}</p>
            {chart.unplaced.map(person => <div key={person.id}>{card(person)}</div>)}
          </section>
        ))}
    </div>
  );
}
