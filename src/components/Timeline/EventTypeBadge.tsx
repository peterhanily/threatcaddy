import type { TimelineEventType } from '../../types';
import { TIMELINE_EVENT_TYPE_LABELS } from '../../types';

interface EventTypeBadgeProps {
  type: TimelineEventType;
  active?: boolean;
  onClick?: () => void;
}

export function EventTypeBadge({ type, active, onClick }: EventTypeBadgeProps) {
  const { label, color } = TIMELINE_EVENT_TYPE_LABELS[type] ?? { label: type, color: '#6b7280', icon: '📌' };

  return (
    <button
      onClick={onClick}
      className="flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-medium transition-colors whitespace-nowrap"
      style={{
        backgroundColor: active ? `${color}30` : `${color}15`,
        color: active ? color : `${color}99`,
        border: `1px solid ${active ? `${color}60` : `${color}20`}`,
      }}
    >
      <span>{label}</span>
    </button>
  );
}
