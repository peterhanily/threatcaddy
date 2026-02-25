import { Clock } from 'lucide-react';
import type { TimelineEvent } from '../../types';
import { TimelineEventCard } from './TimelineEventCard';

interface TimelineFeedProps {
  events: TimelineEvent[];
  selectedId?: string;
  onSelect: (id: string) => void;
  onToggleStar: (id: string) => void;
  onDelete?: (id: string) => void;
}

function formatDateHeader(dateKey: string): string {
  const today = new Date();
  const yesterday = new Date(today);
  yesterday.setDate(yesterday.getDate() - 1);

  const todayKey = today.toISOString().slice(0, 10);
  const yesterdayKey = yesterday.toISOString().slice(0, 10);

  if (dateKey === todayKey) return 'Today';
  if (dateKey === yesterdayKey) return 'Yesterday';

  const date = new Date(dateKey + 'T00:00:00');
  return date.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' });
}

function groupByDate(events: TimelineEvent[]): Map<string, TimelineEvent[]> {
  const groups = new Map<string, TimelineEvent[]>();
  for (const event of events) {
    const key = new Date(event.timestamp).toISOString().slice(0, 10);
    const group = groups.get(key);
    if (group) {
      group.push(event);
    } else {
      groups.set(key, [event]);
    }
  }
  return groups;
}

export function TimelineFeed({ events, selectedId, onSelect, onToggleStar, onDelete }: TimelineFeedProps) {
  if (events.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-16 text-gray-600">
        <Clock size={32} className="mb-2" />
        <p className="text-sm">No timeline events yet</p>
        <p className="text-xs mt-1">Click "New Event" to add an incident timeline entry</p>
      </div>
    );
  }

  const groups = groupByDate(events);

  return (
    <div className="space-y-4 max-w-3xl mx-auto">
      {Array.from(groups.entries()).map(([dateKey, groupEvents]) => (
        <div key={dateKey}>
          <div className="sticky top-0 z-10 bg-gray-900/95 backdrop-blur-sm py-1.5 px-1 mb-2">
            <div className="flex items-center gap-2">
              <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wider">
                {formatDateHeader(dateKey)}
              </h3>
              <span className="text-[10px] text-gray-600">{groupEvents.length} event{groupEvents.length !== 1 ? 's' : ''}</span>
            </div>
          </div>
          <div className="space-y-1.5">
            {groupEvents.map((event) => (
              <TimelineEventCard
                key={event.id}
                event={event}
                active={event.id === selectedId}
                onClick={() => onSelect(event.id)}
                onToggleStar={() => onToggleStar(event.id)}
                onDelete={onDelete}
              />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
