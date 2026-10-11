import { MapContainer, TileLayer, Marker } from 'react-leaflet';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';

const iconCache = new Map<string, L.Icon>();

function getMarkerIcon(color: string): L.Icon {
  const cached = iconCache.get(color);
  if (cached) return cached;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="25" height="41" viewBox="0 0 25 41">
    <path d="M12.5 0C5.6 0 0 5.6 0 12.5C0 21.9 12.5 41 12.5 41S25 21.9 25 12.5C25 5.6 19.4 0 12.5 0Z" fill="${color}" stroke="#000" stroke-width="1" stroke-opacity="0.3"/>
    <circle cx="12.5" cy="12.5" r="5" fill="white" fill-opacity="0.9"/>
  </svg>`;
  const icon = L.icon({ iconUrl: `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`,
    iconSize: [25, 41], iconAnchor: [12, 41] });
  iconCache.set(color, icon);
  return icon;
}

/** Loaded only when the displayed event actually has coordinates. */
export function ExecEventMap({ latitude, longitude, color }: { latitude: number; longitude: number; color: string }) {
  return <MapContainer center={[latitude, longitude]} zoom={10}
    style={{ height: '100%', width: '100%' }} zoomControl={false} attributionControl={false}
    dragging={false} scrollWheelZoom={false} doubleClickZoom={false} touchZoom={false}>
    <TileLayer url="https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png" />
    <Marker position={[latitude, longitude]} icon={getMarkerIcon(color)} />
  </MapContainer>;
}
