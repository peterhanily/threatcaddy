import { useTranslation } from 'react-i18next';
import type { TimelineEventType } from '../../types';
import { TIMELINE_EVENT_TYPE_LABELS } from '../../types';
import { EventTypeBadge } from './EventTypeBadge';

interface EventTypeFilterBarProps {
  selectedTypes: TimelineEventType[];
  onChange: (types: TimelineEventType[]) => void;
}

const ALL_EVENT_TYPES = Object.keys(TIMELINE_EVENT_TYPE_LABELS) as TimelineEventType[];

export function EventTypeFilterBar({ selectedTypes, onChange }: EventTypeFilterBarProps) {
  const { t } = useTranslation('timeline');
  const toggleType = (type: TimelineEventType) => {
    if (selectedTypes.includes(type)) {
      onChange(selectedTypes.filter((st) => st !== type));
    } else {
      onChange([...selectedTypes, type]);
    }
  };

  return (
    <div className="flex gap-1 overflow-x-auto px-3 py-1.5 border-b border-gray-800 scrollbar-thin">
      {ALL_EVENT_TYPES.map((type) => (
        <EventTypeBadge
          key={type}
          type={type}
          active={selectedTypes.includes(type)}
          onClick={() => toggleType(type)}
        />
      ))}
      {selectedTypes.length > 0 && (
        <button
          onClick={() => onChange([])}
          className="text-[11px] text-gray-500 hover:text-gray-300 px-2 whitespace-nowrap"
        >
          {t('filter.clear')}
        </button>
      )}
    </div>
  );
}
