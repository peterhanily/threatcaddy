import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Clock } from 'lucide-react';
import type { TimelineEvent } from '../../types';
import { TimelineEventCard } from './TimelineEventCard';
import { currentLocale } from '../../lib/utils';
import { GroupedVirtuoso } from 'react-virtuoso';

interface TimelineFeedProps {
  events: TimelineEvent[];
  selectedId?: string;
  onSelect: (id: string) => void;
  onToggleStar: (id: string) => void;
  onDelete?: (id: string) => void;
}

function formatDateHeader(dateKey: string, t: (key: string) => string): string {
  const today = new Date();
  const yesterday = new Date(today);
  yesterday.setDate(yesterday.getDate() - 1);

  const todayKey = today.toISOString().slice(0, 10);
  const yesterdayKey = yesterday.toISOString().slice(0, 10);

  if (dateKey === todayKey) return t('feed.today');
  if (dateKey === yesterdayKey) return t('feed.yesterday');

  const date = new Date(dateKey + 'T00:00:00');
  return date.toLocaleDateString(currentLocale(), { weekday: 'long', month: 'long', day: 'numeric' });
}

export function TimelineFeed({ events, selectedId, onSelect, onToggleStar, onDelete }: TimelineFeedProps) {
  const { t } = useTranslation('timeline');
  const { groupCounts, dateKeys, flatEvents } = useMemo(() => {
    const groupMap = new Map<string, TimelineEvent[]>();
    for (const event of events) {
      const key = new Date(event.timestamp).toISOString().slice(0, 10);
      const group = groupMap.get(key);
      if (group) {
        group.push(event);
      } else {
        groupMap.set(key, [event]);
      }
    }
    const keys: string[] = [];
    const counts: number[] = [];
    const flat: TimelineEvent[] = [];
    for (const [key, group] of groupMap) {
      keys.push(key);
      counts.push(group.length);
      flat.push(...group);
    }
    return { groupCounts: counts, dateKeys: keys, flatEvents: flat };
  }, [events]);

  if (events.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center gap-3 py-16 text-gray-500">
        <Clock size={40} strokeWidth={1.5} className="text-gray-600" />
        <p className="text-sm">{t('emptyState')}</p>
      </div>
    );
  }

  return (
    <div className="max-w-3xl mx-auto h-full">
      <GroupedVirtuoso
        groupCounts={groupCounts}
        groupContent={(index) => {
          const dateKey = dateKeys[index];
          const count = groupCounts[index];
          return (
            <div className="sticky top-0 z-10 bg-gray-900/95 backdrop-blur-sm py-1.5 px-1 mb-2">
              <div className="flex items-center gap-2">
                <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wider">
                  {formatDateHeader(dateKey, t)}
                </h3>
                <span className="text-[10px] text-gray-600">{t('feed.eventCount', { count })}</span>
              </div>
            </div>
          );
        }}
        itemContent={(index) => {
          const event = flatEvents[index];
          return (
            <div className="pb-1.5">
              <TimelineEventCard
                event={event}
                active={event.id === selectedId}
                onSelect={onSelect}
                onToggleStar={onToggleStar}
                onDelete={onDelete}
              />
            </div>
          );
        }}
      />
    </div>
  );
}
