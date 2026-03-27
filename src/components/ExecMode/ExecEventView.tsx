import { useMemo } from 'react';
import { Share2 } from 'lucide-react';
import { MapContainer, TileLayer, Marker } from 'react-leaflet';
import L from 'leaflet';
import type { TimelineEvent } from '../../types';
import { TIMELINE_EVENT_TYPE_LABELS, CONFIDENCE_LEVELS } from '../../types';
import { renderMarkdown } from '../../lib/markdown';
import { formatFullDate } from '../../lib/utils';
import { ExecDetailNav } from './ExecDetailNav';
import 'leaflet/dist/leaflet.css';

interface ExecEventViewProps {
  event: TimelineEvent;
  onBack: () => void;
  onShare?: () => void;
  currentIndex?: number;
  totalCount?: number;
  onNavigate?: (direction: 'prev' | 'next') => void;
}

const iconCache = new Map<string, L.Icon>();

function getMarkerIcon(color: string): L.Icon {
  const cached = iconCache.get(color);
  if (cached) return cached;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="25" height="41" viewBox="0 0 25 41">
    <path d="M12.5 0C5.6 0 0 5.6 0 12.5C0 21.9 12.5 41 12.5 41S25 21.9 25 12.5C25 5.6 19.4 0 12.5 0Z" fill="${color}" stroke="#000" stroke-width="1" stroke-opacity="0.3"/>
    <circle cx="12.5" cy="12.5" r="5" fill="white" fill-opacity="0.9"/>
  </svg>`;
  const icon = L.icon({
    iconUrl: `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`,
    iconSize: [25, 41],
    iconAnchor: [12, 41],
  });
  iconCache.set(color, icon);
  return icon;
}

export function ExecEventView({ event, onShare, currentIndex, totalCount, onNavigate }: ExecEventViewProps) {
  const typeInfo = TIMELINE_EVENT_TYPE_LABELS[event.eventType];
  const confInfo = CONFIDENCE_LEVELS[event.confidence];

  const descHtml = useMemo(
    () => event.description ? renderMarkdown(event.description) : null,
    [event.description],
  );

  return (
    <div className="flex flex-col gap-3">
      {onShare && (
        <div className="flex justify-end">
          <button onClick={onShare} className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-accent bg-accent/10 active:bg-accent/20 text-xs font-medium">
            <Share2 size={14} />
            Share
          </button>
        </div>
      )}

      <h2 className="text-lg font-bold text-text-primary">{event.title || 'Untitled'}</h2>

      <div className="flex flex-wrap gap-2">
        <span className="text-xs font-semibold px-2 py-0.5 rounded-full" style={{ backgroundColor: (typeInfo?.color ?? '#6b7280') + '33', color: typeInfo?.color ?? '#6b7280' }}>
          {typeInfo?.label ?? event.eventType}
        </span>
        <span className="text-xs font-semibold px-2 py-0.5 rounded-full" style={{ backgroundColor: (confInfo?.color ?? '#6b7280') + '33', color: confInfo?.color ?? '#6b7280' }}>
          {confInfo?.label ?? event.confidence}
        </span>
        {event.clsLevel && <span className="text-xs font-semibold text-accent-amber bg-accent-amber/10 px-2 py-0.5 rounded-full">{event.clsLevel}</span>}
      </div>

      <div className="flex flex-wrap gap-x-4 gap-y-1 text-[10px] text-text-muted">
        <span>Timestamp {formatFullDate(event.timestamp)}</span>
        {event.timestampEnd && <span>End {formatFullDate(event.timestampEnd)}</span>}
        {event.source && <span>Source: {event.source}</span>}
      </div>

      {event.actor && <p className="text-xs text-text-secondary"><span className="font-semibold">Actor:</span> {event.actor}</p>}

      {event.assets.length > 0 && (
        <p className="text-xs text-text-secondary"><span className="font-semibold">Assets:</span> {event.assets.join(', ')}</p>
      )}

      {event.mitreAttackIds.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {event.mitreAttackIds.map((id) => (
            <span key={id} className="text-[10px] font-mono bg-red-500/10 text-red-400 px-2 py-0.5 rounded-full">{id}</span>
          ))}
        </div>
      )}

      {event.tags.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {event.tags.map((tag) => (
            <span key={tag} className="text-[10px] bg-accent/10 text-accent px-2 py-0.5 rounded-full">#{tag}</span>
          ))}
        </div>
      )}

      {descHtml && (
        <div className="bg-bg-raised rounded-xl p-4 markdown-preview" dangerouslySetInnerHTML={{ __html: descHtml }} />
      )}

      {event.latitude != null && event.longitude != null && (
        <div className="rounded-xl overflow-hidden border border-border-subtle" style={{ height: 200 }}>
          <MapContainer
            center={[event.latitude, event.longitude]}
            zoom={10}
            style={{ height: '100%', width: '100%' }}
            zoomControl={false}
            attributionControl={false}
            dragging={false}
            scrollWheelZoom={false}
            doubleClickZoom={false}
            touchZoom={false}
          >
            <TileLayer url="https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png" />
            <Marker
              position={[event.latitude, event.longitude]}
              icon={getMarkerIcon(typeInfo?.color ?? '#6b7280')}
            />
          </MapContainer>
        </div>
      )}

      {onNavigate && totalCount != null && currentIndex != null && (
        <ExecDetailNav currentIndex={currentIndex} totalCount={totalCount} onPrev={() => onNavigate('prev')} onNext={() => onNavigate('next')} />
      )}
    </div>
  );
}
