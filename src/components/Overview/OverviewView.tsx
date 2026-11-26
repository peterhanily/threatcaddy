import { useId, useMemo, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { AlertTriangle, ArrowRight, Calendar, Clock, Contact, FileOutput, ListChecks, Paperclip, Search } from 'lucide-react';
import type { EvidenceItem, Folder, Identity, InvestigationMember, IOCType, Note, StandaloneIOC, Task, TimelineEvent, ViewMode } from '../../types';
import { IOC_TYPE_LABELS } from '../../types';
import { cn, currentLocale, formatDate, formatFullDate, isOverdue } from '../../lib/utils';
import { countActive, identityGroups, iocTypeCounts, lastChangeAt, latestEvents, latestProducts, openTasks } from '../../lib/case-overview';
import { ClsBadge } from '../Common/ClsBadge';

const SHOWN_TASKS = 5;
const SHOWN_EVENTS = 5;
const SHOWN_NAMES = 3;

export interface OverviewViewProps {
  /** The selected investigation; without one the view only points to the list of investigations. */
  folder?: Pick<Folder, 'name' | 'status' | 'clsLevel' | 'papLevel' | 'createdAt' | 'updatedAt'>;
  /** The investigation's lists exactly as its other views receive them (screenshare-filtered). */
  notes: Note[];
  tasks: Task[];
  events: TimelineEvent[];
  identities: Identity[];
  iocs: StandaloneIOC[];
  evidence: EvidenceItem[];
  products: Note[];
  members?: InvestigationMember[];
  /** True until the lists have loaded, so an investigation never reads as empty while it loads. */
  loading?: boolean;
  onNavigate: (view: ViewMode) => void;
  onOpenTask: (task: Task) => void;
  onOpenEvent: (event: TimelineEvent) => void;
  onOpenIdentity: (identity: Identity) => void;
  /** First actions for an empty investigation; left out where nothing can be added (read only). */
  onImportFiles?: () => void;
  onAddNote?: () => void;
  onAddEvent?: () => void;
}

const STATUS_DOT: Record<string, string> = { active: 'bg-accent-green', closed: 'bg-text-muted', archived: 'bg-accent-amber' };
const focusRing = 'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent';
const rowButton = cn('flex w-full min-h-11 flex-col justify-center gap-0.5 rounded px-2 py-1.5 text-start hover:bg-bg-hover', focusRing);

function Block({ title, icon, summary, linkLabel, onOpen, children, className }: {
  title: string; icon: ReactNode; summary?: ReactNode; linkLabel: string; onOpen: () => void; children: ReactNode; className?: string;
}) {
  const headingId = useId();
  return (
    <section aria-labelledby={headingId} className={cn('rounded-lg border border-border-subtle bg-bg-raised p-4', className)}>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <h2 id={headingId} className="flex items-center gap-2 text-sm font-semibold text-text-primary">
          <span aria-hidden="true" className="text-text-muted">{icon}</span>{title}
        </h2>
        {summary && <p className="text-xs text-text-secondary">{summary}</p>}
        <button type="button" onClick={onOpen}
          className={cn('ms-auto inline-flex min-h-8 items-center gap-1 rounded px-2 text-xs font-medium text-accent hover:bg-bg-hover', focusRing)}>
          {linkLabel}<ArrowRight size={12} aria-hidden="true" className="rtl:rotate-180" />
        </button>
      </div>
      <div className="mt-2">{children}</div>
    </section>
  );
}

const Empty = ({ children }: { children: ReactNode }) => <p className="px-2 py-1.5 text-sm text-text-muted">{children}</p>;

export function OverviewView({
  folder, notes, tasks, events, identities, iocs, evidence, products, members, loading,
  onNavigate, onOpenTask, onOpenEvent, onOpenIdentity, onImportFiles, onAddNote, onAddEvent,
}: OverviewViewProps) {
  const { t } = useTranslation('overview');
  const { t: tInvestigations } = useTranslation('investigations');
  const { t: tIdentities } = useTranslation('identities');

  const { open, overdue } = useMemo(() => openTasks(tasks), [tasks]);
  const newestEvents = useMemo(() => latestEvents(events), [events]);
  const groups = useMemo(() => identityGroups(identities), [identities]);
  const indicators = useMemo(() => iocTypeCounts(notes, tasks, events, iocs), [notes, tasks, events, iocs]);
  const drafts = useMemo(() => latestProducts(products), [products]);
  const evidenceCount = useMemo(() => countActive(evidence), [evidence]);
  const identityCount = groups.reduce((sum, group) => sum + group.identities.length, 0);
  const lastChange = useMemo(() => (folder ? lastChangeAt(folder, [notes, tasks, events, identities, iocs, evidence]) : 0),
    [folder, notes, tasks, events, identities, iocs, evidence]);

  if (!folder) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-3 p-6 text-center">
        <h1 className="text-base font-semibold text-text-primary">{t('noInvestigation.title')}</h1>
        <button type="button" onClick={() => onNavigate('investigations')}
          className={cn('min-h-11 rounded-lg border border-border-subtle bg-bg-deep px-4 py-2 text-sm text-text-primary hover:border-accent', focusRing)}>
          {t('noInvestigation.browse')}
        </button>
      </div>
    );
  }

  const status = folder.status ?? 'active';
  const isEmpty = !loading && countActive(notes) === 0 && countActive(tasks) === 0 && newestEvents.length === 0
    && identityCount === 0 && indicators.total === 0 && evidenceCount === 0 && drafts.length === 0;
  const firstActions = [
    onImportFiles && { label: tInvestigations('firstRun.import'), run: onImportFiles },
    onAddNote && { label: t('empty.addNote'), run: onAddNote },
    onAddEvent && { label: t('empty.addEvent'), run: onAddEvent },
  ].filter((action): action is { label: string; run: () => void } => !!action);
  const day = (value: number | string) => new Date(value).toLocaleDateString(currentLocale(), { year: 'numeric', month: 'short', day: 'numeric' });
  const assignee = (task: Task) => (task.assigneeId ? members?.find(member => member.userId === task.assigneeId)?.displayName : undefined);

  return (
    <div className="flex-1 overflow-y-auto">
      <div className="mx-auto max-w-6xl space-y-4 p-4 sm:p-6">
        <header>
          <p className="text-xs font-semibold uppercase tracking-wider text-text-muted">{t('title')}</p>
          <h1 className="mt-1 break-words text-xl font-semibold text-text-primary"><bdi>{folder.name}</bdi></h1>
          <dl className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-text-secondary">
            <div className="flex items-center gap-1.5">
              <dt className="sr-only">{t('header.status')}</dt>
              <dd className="flex items-center gap-1.5 font-medium text-text-primary">
                <span aria-hidden="true" className={cn('h-2 w-2 rounded-full', STATUS_DOT[status] ?? STATUS_DOT.active)} />
                {tInvestigations(`card.status.${status}`)}
              </dd>
            </div>
            {(folder.clsLevel || folder.papLevel) && (
              <div className="flex items-center gap-1.5">
                <dt className="sr-only">{t('header.classification')}</dt>
                <dd className="flex flex-wrap items-center gap-1.5">
                  {folder.clsLevel && <ClsBadge level={folder.clsLevel} />}
                  {folder.papLevel && <span className="whitespace-nowrap rounded-full border border-border-medium px-1.5 text-[10px] font-medium text-text-secondary">{folder.papLevel}</span>}
                </dd>
              </div>
            )}
            <div className="flex items-center gap-1">
              <dt>{t('header.created')}</dt>
              <dd className="text-text-primary">{day(folder.createdAt)}</dd>
            </div>
            <div className="flex items-center gap-1">
              <dt>{t('header.lastChange')}</dt>
              <dd className="text-text-primary" title={formatFullDate(lastChange)}>{formatDate(lastChange)}</dd>
            </div>
          </dl>
        </header>

        {isEmpty ? (
          <section aria-labelledby="overview-empty" className="rounded-lg border border-border-subtle bg-bg-raised p-5">
            <h2 id="overview-empty" className="text-base font-semibold text-text-primary">{t('empty.title')}</h2>
            <p className="mt-1 text-sm text-text-secondary">{firstActions.length ? t('empty.description') : t('empty.readOnly')}</p>
            {firstActions.length > 0 && (
              <div className="mt-3 flex flex-wrap gap-2">
                {firstActions.map(action => (
                  <button key={action.label} type="button" onClick={action.run}
                    className={cn('min-h-11 rounded-lg border border-border-subtle bg-bg-deep px-4 py-2 text-sm text-text-primary hover:border-accent', focusRing)}>
                    {action.label}
                  </button>
                ))}
              </div>
            )}
          </section>
        ) : !loading && (
          <div className="grid gap-4 lg:grid-cols-2">
            <Block title={t('attention.title')} icon={<ListChecks size={16} />} linkLabel={t('attention.open')} onOpen={() => onNavigate('tasks')}
              summary={<>
                {t('attention.openTasks', { number: open.length })}
                {overdue > 0 && <span className="ms-2 font-medium text-red-400">{t('attention.overdue', { number: overdue })}</span>}
              </>}>
              {open.length === 0 ? <Empty>{t('attention.none')}</Empty> : (
                <ul>
                  {open.slice(0, SHOWN_TASKS).map(task => {
                    const late = isOverdue(task.dueDate);
                    const who = assignee(task);
                    return (
                      <li key={task.id}>
                        <button type="button" className={rowButton} onClick={() => onOpenTask(task)}>
                          <span className="break-words text-sm text-text-primary">{task.title}</span>
                          {(task.dueDate || who) && (
                            <span className="flex flex-wrap items-center gap-x-3 text-xs text-text-secondary">
                              {task.dueDate && (
                                <span className={cn('inline-flex items-center gap-1', late && 'font-medium text-red-400')}>
                                  {late ? <AlertTriangle size={11} aria-hidden="true" /> : <Calendar size={11} aria-hidden="true" />}
                                  {late ? t('attention.overdueSince', { date: day(task.dueDate) }) : t('attention.due', { date: day(task.dueDate) })}
                                </span>
                              )}
                              {who && <bdi>{who}</bdi>}
                            </span>
                          )}
                        </button>
                      </li>
                    );
                  })}
                </ul>
              )}
            </Block>

            <Block title={t('timeline.title')} icon={<Clock size={16} />} linkLabel={t('timeline.open')} onOpen={() => onNavigate('timeline')}
              summary={t('timeline.total', { number: newestEvents.length })}>
              {newestEvents.length === 0 ? <Empty>{t('timeline.none')}</Empty> : (
                <ul>
                  {newestEvents.slice(0, SHOWN_EVENTS).map(event => {
                    const involved = [event.actor, ...event.assets].filter((name): name is string => !!name);
                    return (
                      <li key={event.id}>
                        <button type="button" className={rowButton} onClick={() => onOpenEvent(event)}>
                          <span className="break-words text-sm text-text-primary">{event.title}</span>
                          <span className="flex flex-wrap items-center gap-x-3 text-xs text-text-secondary">
                            <time dateTime={new Date(event.timestamp).toISOString()}>{formatFullDate(event.timestamp)}</time>
                            {involved.map((name, index) => <bdi key={`${index}:${name}`}>{name}</bdi>)}
                          </span>
                        </button>
                      </li>
                    );
                  })}
                </ul>
              )}
            </Block>

            <Block title={t('identities.title')} icon={<Contact size={16} />} linkLabel={t('identities.open')} onOpen={() => onNavigate('identities')}
              summary={t('identities.total', { number: identityCount })}>
              {groups.length === 0 ? <Empty>{t('identities.none')}</Empty> : (
                <dl className="space-y-1.5 px-2">
                  {groups.map(group => (
                    <div key={group.type} className="flex flex-wrap items-baseline gap-x-2 gap-y-1 text-sm">
                      <dt className="text-text-secondary">
                        {group.type === 'other' ? t('identities.other') : tIdentities(`filter.${group.type}`)}
                        <span className="ms-1.5 font-semibold tabular-nums text-text-primary">{group.identities.length}</span>
                      </dt>
                      <dd className="flex min-w-0 flex-wrap items-center gap-1">
                        {group.identities.slice(0, SHOWN_NAMES).map(identity => (
                          <button key={identity.id} type="button" onClick={() => onOpenIdentity(identity)}
                            className={cn('inline-flex min-h-6 max-w-full items-center rounded border border-border-subtle px-1.5 text-xs text-text-primary hover:border-accent', focusRing)}>
                            <bdi className="truncate">{identity.name}</bdi>
                          </button>
                        ))}
                        {group.identities.length > SHOWN_NAMES && (
                          <span className="text-xs text-text-muted">{t('more', { number: group.identities.length - SHOWN_NAMES })}</span>
                        )}
                      </dd>
                    </div>
                  ))}
                </dl>
              )}
            </Block>

            <Block title={t('iocs.title')} icon={<Search size={16} />} linkLabel={t('iocs.open')} onOpen={() => onNavigate('ioc-stats')}
              summary={t('iocs.total', { number: indicators.total })}>
              {indicators.total === 0 ? <Empty>{t('iocs.none')}</Empty> : (
                <ul className="flex flex-wrap gap-1.5 px-2">
                  {indicators.byType.map(([type, count]) => (
                    <li key={type} className="inline-flex items-center gap-1.5 rounded border border-border-subtle px-1.5 py-0.5 text-xs text-text-secondary">
                      {IOC_TYPE_LABELS[type as IOCType]?.label ?? type}
                      <span className="font-semibold tabular-nums text-text-primary">{count}</span>
                    </li>
                  ))}
                </ul>
              )}
            </Block>

            <Block title={t('evidence.title')} icon={<Paperclip size={16} />} linkLabel={t('evidence.open')} onOpen={() => onNavigate('evidence')}
              summary={t('evidence.total', { number: evidenceCount })}>
              {evidenceCount === 0 && <Empty>{t('evidence.none')}</Empty>}
            </Block>

            <Block title={t('products.title')} icon={<FileOutput size={16} />} linkLabel={t('products.open')} onOpen={() => onNavigate('products')}
              summary={t('products.total', { number: drafts.length })}>
              {drafts.length === 0 ? <Empty>{t('products.none')}</Empty> : (
                <p className="px-2 text-sm text-text-secondary">
                  {t('products.latest')}{' '}
                  <bdi className="text-text-primary">{drafts[0].title}</bdi>
                  <span className="ms-2 text-xs text-text-muted">{formatDate(drafts[0].updatedAt)}</span>
                </p>
              )}
            </Block>
          </div>
        )}
      </div>
    </div>
  );
}
