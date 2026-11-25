import { useId, useState } from 'react';
import { Clock, FileText, Search } from 'lucide-react';
import type { Identity, Note, StandaloneIOC, TimelineEvent } from '../../types';
import type { IdentityActivity } from '../../lib/identity-match';
import { formatDate } from '../../lib/utils';
import { isolate, type IdentityLabels } from './identity-labels';
import { IsolatedText } from './identity-ui';

const SHOWN = 8;
const ICONS = { event: Clock, note: FileText, ioc: Search } as const;

/** Where an identity appears in its investigation, newest first, each opening its item. */
export function IdentityActivitySection({ identity, activity, labels, onOpenEvent, onOpenNote, onOpenIOC, onAddNote }: {
  identity: Identity;
  activity: IdentityActivity;
  labels: IdentityLabels;
  onOpenEvent?: (event: TimelineEvent) => void;
  onOpenNote?: (note: Note) => void;
  onOpenIOC?: (ioc: StandaloneIOC) => void;
  /** Absent when the investigation is read-only. */
  onAddNote?: (identity: Identity) => void;
}) {
  const { t } = labels;
  const ids = useId();
  const [all, setAll] = useState(false);
  const items = [
    ...activity.events.map(event => ({ key: `event:${event.id}`, kind: 'event' as const, when: event.timestamp, title: event.title, open: onOpenEvent && (() => onOpenEvent(event)) })),
    ...activity.notes.map(note => ({ key: `note:${note.id}`, kind: 'note' as const, when: note.updatedAt, title: note.title, open: onOpenNote && (() => onOpenNote(note)) })),
    ...activity.iocs.map(ioc => ({ key: `ioc:${ioc.id}`, kind: 'ioc' as const, when: ioc.updatedAt, title: ioc.value, open: onOpenIOC && (() => onOpenIOC(ioc)) })),
  ].sort((a, b) => b.when - a.when);
  const shown = all ? items : items.slice(0, SHOWN);
  return (
    <section aria-labelledby={`${ids}-activity`} className="flex flex-col gap-2 border-t border-border-subtle pt-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 id={`${ids}-activity`} className="text-xs font-semibold uppercase tracking-wide text-text-muted">{t('activity.heading', { count: items.length })}</h3>
        {onAddNote && (
          <button type="button" className="text-xs font-medium text-accent hover:underline" onClick={() => onAddNote(identity)}>
            <IsolatedText text={t('activity.addNote', { name: isolate(identity.name) })} />
          </button>
        )}
      </div>
      {items.length ? (
        <ul className="flex flex-col gap-0.5">
          {shown.map(item => {
            const Icon = ICONS[item.kind];
            const body = (
              <>
                <Icon size={13} aria-hidden="true" className="shrink-0 text-text-muted" />
                <span className="min-w-0 flex-1 truncate text-sm text-text-primary">{item.title || t('activity.untitled')}</span>
                <span className="shrink-0 text-[11px] text-text-muted">{t(`activity.kind.${item.kind}`)} · {formatDate(item.when)}</span>
              </>
            );
            return (
              <li key={item.key}>
                {item.open
                  ? <button type="button" onClick={item.open} className="flex w-full min-w-0 items-center gap-2 rounded-md px-1.5 py-1 text-start hover:bg-bg-hover">{body}</button>
                  : <span className="flex w-full min-w-0 items-center gap-2 px-1.5 py-1">{body}</span>}
              </li>
            );
          })}
        </ul>
      ) : <p className="text-xs text-text-muted"><IsolatedText text={t('activity.none', { name: isolate(identity.name) })} /></p>}
      {activity.partial && <p className="text-xs text-text-muted">{t('activity.partial')}</p>}
      {items.length > SHOWN && (
        <button type="button" aria-expanded={all} className="self-start text-xs font-medium text-accent hover:underline" onClick={() => setAll(value => !value)}>
          {all ? t('found.fewer') : t('found.more', { count: items.length - SHOWN })}
        </button>
      )}
    </section>
  );
}
