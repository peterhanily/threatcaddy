import { useState, useMemo, useCallback, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { MapContainer, TileLayer, Marker, Popup, useMapEvents, useMap } from 'react-leaflet';
import MarkerClusterGroup from 'react-leaflet-cluster';
import L from 'leaflet';
import { Crosshair, MapPin, Star, Trash2 } from 'lucide-react';
import type { TimelineEvent } from '../../types';
import { TIMELINE_EVENT_TYPE_LABELS, CONFIDENCE_LEVELS } from '../../types';
import { cn, currentLocale } from '../../lib/utils';
import 'leaflet/dist/leaflet.css';

interface TimelineMapProps {
  events: TimelineEvent[];
  onSelect: (id: string) => void;
  onToggleStar: (id: string) => void;
  onDelete?: (id: string) => void;
  onCreateEventAtLocation?: (lat: number, lng: number) => void;
}

// Cache marker icons by color to avoid recreating them
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
    popupAnchor: [1, -34],
  });

  iconCache.set(color, icon);
  return icon;
}

function formatTime(timestamp: number): string {
  return new Date(timestamp).toLocaleString(currentLocale(), {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
}

// Always-on double-click handler: creates event at clicked location
function DblClickHandler({ onPlace }: { onPlace: (lat: number, lng: number) => void }) {
  const map = useMapEvents({
    dblclick(e) {
      L.DomEvent.stopPropagation(e.originalEvent);
      onPlace(e.latlng.lat, e.latlng.lng);
    },
  });
  // Disable default double-click zoom so our handler works
  useEffect(() => {
    map.doubleClickZoom.disable();
    return () => { map.doubleClickZoom.enable(); };
  }, [map]);
  return null;
}

// Place-mode single-click handler for precision placement
function ClickHandler({ onPlace }: { onPlace: (lat: number, lng: number) => void }) {
  const map = useMapEvents({
    click(e) {
      onPlace(e.latlng.lat, e.latlng.lng);
    },
  });
  // Disable double-click zoom in place mode so single clicks fire immediately
  useEffect(() => {
    map.doubleClickZoom.disable();
    return () => { map.doubleClickZoom.enable(); };
  }, [map]);
  return null;
}

function FitBounds({ bounds }: { bounds: L.LatLngBounds }) {
  const map = useMap();
  useEffect(() => {
    map.fitBounds(bounds, { padding: [40, 40] });
  }, [map, bounds]);
  return null;
}

// Default: world view centered at 20N, 0E
const DEFAULT_CENTER: [number, number] = [20, 0];
const DEFAULT_ZOOM = 2;

export function TimelineMap({ events, onSelect, onToggleStar, onDelete, onCreateEventAtLocation }: TimelineMapProps) {
  const { t } = useTranslation('timeline');
  const hasAnyMapped = events.some((e) => e.latitude != null && e.longitude != null);
  const [placeMode, setPlaceMode] = useState(!hasAnyMapped);

  // Track theme reactively via MutationObserver so tile URL updates on toggle
  const [isLight, setIsLight] = useState(() => document.documentElement.classList.contains('light'));
  useEffect(() => {
    const el = document.documentElement;
    const observer = new MutationObserver(() => {
      setIsLight(el.classList.contains('light'));
    });
    observer.observe(el, { attributes: true, attributeFilter: ['class'] });
    return () => observer.disconnect();
  }, []);

  const mappedEvents = useMemo(
    () => events.filter((e) => e.latitude != null && e.longitude != null),
    [events]
  );

  const unmappedCount = events.length - mappedEvents.length;

  const bounds = useMemo(() => {
    if (mappedEvents.length === 0) return null;
    return L.latLngBounds(
      mappedEvents.map((e) => [e.latitude as number, e.longitude as number] as [number, number])
    );
  }, [mappedEvents]);

  const handlePlace = useCallback(
    (lat: number, lng: number) => {
      if (onCreateEventAtLocation) {
        onCreateEventAtLocation(lat, lng);
        setPlaceMode(false);
      }
    },
    [onCreateEventAtLocation]
  );

  // Double-click always creates, doesn't exit any mode
  const handleDblClickPlace = useCallback(
    (lat: number, lng: number) => {
      if (onCreateEventAtLocation) {
        onCreateEventAtLocation(lat, lng);
      }
    },
    [onCreateEventAtLocation]
  );

  const tileUrl = isLight
    ? 'https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png'
    : 'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png';

  const tileAttribution = '&copy; <a href="https://www.openstreetmap.org/copyright">OSM</a> &copy; <a href="https://carto.com/">CARTO</a>';

  return (
    <div className="flex flex-col h-full">
      {/* Status bar */}
      <div className="flex items-center gap-2 px-3 py-1.5 border-b border-gray-800 text-xs text-gray-500 shrink-0">
        <MapPin size={12} />
        {mappedEvents.length > 0 ? (
          <span>{t('map.mapped', { count: mappedEvents.length })}</span>
        ) : (
          <span>{t('map.doubleClickToPlace')}</span>
        )}
        {unmappedCount > 0 && (
          <span className="text-gray-600">&middot; {t('map.withoutLocation', { count: unmappedCount })}</span>
        )}
        <div className="ml-auto">
          {onCreateEventAtLocation && (
            <button
              onClick={() => setPlaceMode(!placeMode)}
              className={cn(
                'flex items-center gap-1 px-2 py-0.5 rounded text-xs transition-colors',
                placeMode
                  ? 'bg-accent/20 text-accent'
                  : 'text-gray-500 hover:text-gray-300 hover:bg-gray-800'
              )}
              title={placeMode ? t('map.cancelPlaceMode') : t('map.enablePlacement')}
            >
              <Crosshair size={12} />
              {t('map.place')}
            </button>
          )}
        </div>
      </div>

      {/* Map */}
      <div className={cn('flex-1 min-h-0', placeMode && 'cursor-crosshair')}>
        <MapContainer
          center={DEFAULT_CENTER}
          zoom={DEFAULT_ZOOM}
          style={{ height: '100%', width: '100%' }}
          zoomControl={true}
        >
          <TileLayer url={tileUrl} attribution={tileAttribution} />
          {bounds && <FitBounds bounds={bounds} />}
          {/* Double-click to create event (when not in single-click place mode) */}
          {onCreateEventAtLocation && !placeMode && <DblClickHandler onPlace={handleDblClickPlace} />}
          {/* Place mode: single-click for precision placement */}
          {onCreateEventAtLocation && placeMode && <ClickHandler onPlace={handlePlace} />}
          <MarkerClusterGroup
            chunkedLoading
            maxClusterRadius={50}
            iconCreateFunction={(cluster: { getChildCount: () => number }) => {
              const count = cluster.getChildCount();
              return L.divIcon({
                html: `<div class="leaflet-cluster-icon">${count}</div>`,
                className: 'leaflet-cluster-marker',
                iconSize: L.point(36, 36),
              });
            }}
          >
            {mappedEvents.map((event) => {
              const typeInfo = TIMELINE_EVENT_TYPE_LABELS[event.eventType] ?? { label: event.eventType || 'Unknown', color: '#6b7280' };
              const confidenceInfo = CONFIDENCE_LEVELS[event.confidence] ?? { label: event.confidence || 'unknown', color: '#6b7280', description: '' };
              return (
                <Marker
                  key={event.id}
                  position={[event.latitude as number, event.longitude as number]}
                  icon={getMarkerIcon(typeInfo.color)}
                >
                  <Popup>
                    <div className="min-w-[200px] max-w-[280px]">
                      <div className="flex items-center gap-1.5 mb-1">
                        <span
                          className="px-1.5 py-0.5 rounded-full text-[10px] font-medium"
                          style={{
                            backgroundColor: `${typeInfo.color}30`,
                            color: typeInfo.color,
                          }}
                        >
                          {typeInfo.label}
                        </span>
                        <span
                          className="px-1.5 py-0.5 rounded-full text-[10px] font-medium"
                          style={{
                            backgroundColor: `${confidenceInfo.color}30`,
                            color: confidenceInfo.color,
                          }}
                        >
                          {confidenceInfo.label}
                        </span>
                      </div>
                      <h4 className="font-medium text-sm mb-1 leading-tight">
                        {event.title || t('eventCard.untitledEvent')}
                      </h4>
                      <p className="text-xs opacity-70 mb-2">{formatTime(event.timestamp)}</p>
                      {event.description && (
                        <p className="text-xs opacity-60 mb-2 line-clamp-2">
                          {event.description.replace(/[#*`_[\]()>-]/g, '').trim().slice(0, 120)}
                        </p>
                      )}
                      <div className="flex items-center gap-1 pt-1 border-t border-current/10">
                        <button
                          onClick={(e) => { e.stopPropagation(); onSelect(event.id); }}
                          className="text-xs px-2 py-0.5 rounded hover:bg-black/10 transition-colors"
                        >
                          {t('common:edit')}
                        </button>
                        <button
                          onClick={(e) => { e.stopPropagation(); onToggleStar(event.id); }}
                          className={cn('p-0.5 rounded transition-colors', event.starred ? 'text-yellow-400' : 'opacity-50 hover:opacity-100')}
                          title={event.starred ? t('map.unstar') : t('map.star')}
                        >
                          <Star size={14} fill={event.starred ? 'currentColor' : 'none'} />
                        </button>
                        {onDelete && (
                          <button
                            onClick={(e) => { e.stopPropagation(); onDelete(event.id); }}
                            className="p-0.5 rounded text-red-400 opacity-50 hover:opacity-100 transition-colors"
                            title={t('common:delete')}
                          >
                            <Trash2 size={14} />
                          </button>
                        )}
                        <span className="ml-auto text-[10px] opacity-40 font-mono">
                          {(event.latitude as number).toFixed(3)}, {(event.longitude as number).toFixed(3)}
                        </span>
                      </div>
                    </div>
                  </Popup>
                </Marker>
              );
            })}
          </MarkerClusterGroup>
        </MapContainer>
      </div>
    </div>
  );
}
