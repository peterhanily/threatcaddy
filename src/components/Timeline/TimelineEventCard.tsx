import React from 'react';
import { Star, FileText, ListChecks, Trash2, MapPin, Search } from 'lucide-react';
import type { TimelineEvent } from '../../types';
import { TIMELINE_EVENT_TYPE_LABELS, CONFIDENCE_LEVELS } from '../../types';
import { cn, truncate } from '../../lib/utils';
import { getTechniqueLabel } from '../../lib/mitre-attack';
import { ClsBadge } from '../Common/ClsBadge';
import { TagPills } from '../Common/TagPills';

interface TimelineEventCardProps {
  event: TimelineEvent;
  active?: boolean;
  onSelect: (id: string) => void;
  onToggleStar: (id: string) => void;
  onDelete?: (id: string) => void;
}

function formatTime(timestamp: number): string {
  return new Date(timestamp).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false });
}

export const TimelineEventCard = React.memo(function TimelineEventCard({
  event,
  active,
  onSelect,
  onToggleStar,
  onDelete,
}: TimelineEventCardProps) {
  const typeInfo = TIMELINE_EVENT_TYPE_LABELS[event.eventType];
  const confidenceInfo = CONFIDENCE_LEVELS[event.confidence];
  const preview = event.description?.replace(/[#*`_[\]()>-]/g, '').trim() || '';

  return (
    <button
      onClick={() => onSelect(event.id)}
      className={cn(
        'w-full text-left p-3 rounded-lg border transition-colors group',
        active
          ? 'bg-accent/10 border-accent/30'
          : 'bg-gray-800/50 border-gray-800 hover:bg-gray-800 hover:border-gray-700'
      )}
    >
      {/* Top row: time, type badge, confidence, star */}
      <div className="flex items-center gap-2">
        <span className="text-xs text-gray-400 font-mono shrink-0">{formatTime(event.timestamp)}</span>
        <span
          className="px-1.5 py-0.5 rounded-full text-[10px] font-medium whitespace-nowrap"
          style={{
            backgroundColor: `${typeInfo.color}20`,
            color: typeInfo.color,
          }}
        >
          {typeInfo.label}
        </span>
        <span
          className="px-1.5 py-0.5 rounded-full text-[10px] font-medium"
          style={{
            backgroundColor: `${confidenceInfo.color}20`,
            color: confidenceInfo.color,
          }}
        >
          {confidenceInfo.label}
        </span>
        <div className="ml-auto flex items-center gap-0.5 shrink-0">
          {onDelete && (
            <button
              onClick={(e) => { e.stopPropagation(); onDelete(event.id); }}
              className="text-red-500 opacity-0 group-hover:opacity-100 hover:text-red-400 p-0.5 rounded transition-colors"
              title="Delete event"
              aria-label="Delete event"
            >
              <Trash2 size={14} />
            </button>
          )}
          <button
            onClick={(e) => { e.stopPropagation(); onToggleStar(event.id); }}
            className={cn(
              'p-0.5 rounded transition-colors',
              event.starred
                ? 'text-yellow-400'
                : 'text-gray-600 opacity-0 group-hover:opacity-100 hover:text-yellow-400'
            )}
            aria-label={event.starred ? 'Unstar event' : 'Star event'}
          >
            <Star size={14} fill={event.starred ? 'currentColor' : 'none'} />
          </button>
        </div>
      </div>

      {/* Title */}
      <h3 className="font-medium text-sm text-gray-200 truncate mt-1.5">
        {event.title || 'Untitled Event'}
      </h3>

      {/* Description preview */}
      {preview && (
        <p className="text-xs text-gray-500 mt-1 line-clamp-2">{truncate(preview, 150)}</p>
      )}

      {/* Bottom metadata */}
      <div className="flex items-center gap-2 mt-2 flex-wrap">
        {event.source && (
          <span className="text-[10px] px-1.5 rounded-full bg-gray-700/50 text-gray-400 truncate max-w-[100px]">
            {event.source}
          </span>
        )}
        {event.clsLevel && <ClsBadge level={event.clsLevel} />}
        {event.actor && (
          <span className="text-[10px] px-1.5 rounded-full bg-purple-500/15 text-purple-400 truncate max-w-[100px]">
            {event.actor}
          </span>
        )}
        {event.mitreAttackIds.length > 0 && (
          <>
            {event.mitreAttackIds.slice(0, 3).map((id) => (
              <span
                key={id}
                className="text-[10px] px-1.5 py-0.5 rounded-full font-mono"
                style={{ backgroundColor: '#14b8a620', color: '#14b8a6' }}
                title={getTechniqueLabel(id)}
              >
                {id}
              </span>
            ))}
            {event.mitreAttackIds.length > 3 && (
              <span className="text-[10px] text-teal-500">+{event.mitreAttackIds.length - 3}</span>
            )}
          </>
        )}
        {event.linkedNoteIds.length > 0 && (
          <span className="flex items-center gap-0.5 text-[10px] text-gray-500">
            <FileText size={9} />{event.linkedNoteIds.length}
          </span>
        )}
        {event.linkedTaskIds.length > 0 && (
          <span className="flex items-center gap-0.5 text-[10px] text-gray-500">
            <ListChecks size={9} />{event.linkedTaskIds.length}
          </span>
        )}
        {event.latitude != null && event.longitude != null && (
          <span
            className="flex items-center gap-0.5 text-[10px] text-gray-500"
            title={`${event.latitude.toFixed(4)}, ${event.longitude.toFixed(4)}`}
          >
            <MapPin size={9} />
          </span>
        )}
        {event.linkedIOCIds.length > 0 && (
          <span className="flex items-center gap-0.5 text-[10px] text-accent/70">
            <Search size={9} />{event.linkedIOCIds.length}
          </span>
        )}
        {event.assets.length > 0 && (
          <span className="text-[10px] text-gray-500">{event.assets.length} asset{event.assets.length !== 1 ? 's' : ''}</span>
        )}
        <TagPills tags={event.tags} />
      </div>
    </button>
  );
});
