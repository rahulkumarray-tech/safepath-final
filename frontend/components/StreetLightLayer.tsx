import { useEffect, useState } from 'react';
import { CircleMarker, Popup, useMap, useMapEvents } from 'react-leaflet';

type Light = { id: number; lat: number; lon: number; lit: string | null; source: string };
type CachedResult = { lights: Light[]; savedAt: number; message: string };

const OVERPASS_ENDPOINTS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
];
const CACHE_TTL_MS = 10 * 60 * 1000;
const viewportCache = new Map<string, CachedResult>();
const failedUntil = new Map<string, number>();

function viewportKey(map: ReturnType<typeof useMap>) {
  const b = map.getBounds();
  // Cache in roughly 1 km-ish viewport cells so small pans do not trigger a new public API request.
  return [b.getSouth(), b.getWest(), b.getNorth(), b.getEast()]
    .map(n => (Math.round(n * 100) / 100).toFixed(2)).join(',');
}

/**
 * Displays mapped street-lamp objects in the current map viewport.
 * OSM presence is not proof that a lamp exists on the ground or currently works.
 */
export function StreetLightLayer({ enabled }: { enabled: boolean }) {
  const map = useMap();
  const [boundsKey, setBoundsKey] = useState('');
  const [lights, setLights] = useState<Light[]>([]);
  const [status, setStatus] = useState<'idle' | 'loading' | 'ready' | 'empty' | 'error'>('idle');
  const [message, setMessage] = useState('');
  const [retryVersion, setRetryVersion] = useState(0);

  useMapEvents({
    moveend() {
      setBoundsKey(viewportKey(map));
    },
  });

  useEffect(() => {
    setBoundsKey(viewportKey(map));
  }, [map]);

  useEffect(() => {
    if (!enabled || !boundsKey) return;
    const cached = viewportCache.get(boundsKey);
    if (cached && Date.now() - cached.savedAt < CACHE_TTL_MS) {
      setLights(cached.lights);
      setStatus(cached.lights.length ? 'ready' : 'empty');
      setMessage(cached.message);
      return;
    }

    const cooldownUntil = failedUntil.get(boundsKey) ?? 0;
    if (cooldownUntil > Date.now()) {
      setStatus('error');
      setMessage('Street-light service recently failed for this area. Wait a little before retrying.');
      return;
    }

    const controller = new AbortController();
    let debounceTimer: ReturnType<typeof setTimeout> | undefined;
    const [southRaw, westRaw, northRaw, eastRaw] = boundsKey.split(',').map(Number);
    if (![southRaw, westRaw, northRaw, eastRaw].every(Number.isFinite)) return;

    // Use the rounded cached bounds for a stable query and avoid excessive area requests.
    const south = southRaw, west = westRaw, north = northRaw, east = eastRaw;
    if ((north - south) * (east - west) > 0.12) {
      setStatus('error');
      setMessage('Zoom in to load street-light data for this area.');
      return () => controller.abort();
    }

    const query = `[out:json][timeout:20];node["highway"="street_lamp"](${south},${west},${north},${east});out body;`;
    const load = async () => {
      setStatus('loading');
      setMessage('Loading mapped street lamps for the visible area. Public map-data servers can be busy.');
      let lastError: unknown;

      for (let i = 0; i < OVERPASS_ENDPOINTS.length; i++) {
        const endpoint = OVERPASS_ENDPOINTS[i];
        try {
          const response = await fetch(endpoint, {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8', Accept: 'application/json' },
            body: new URLSearchParams({ data: query }),
            signal: controller.signal,
          });
          if (!response.ok) {
            const retryAfter = response.headers.get('Retry-After');
            if (response.status === 429) {
              lastError = new Error(`Overpass rate limit (HTTP 429)${retryAfter ? `; Retry-After ${retryAfter}` : ''}`);
              // Do not hammer the same endpoint; try the alternate endpoint once.
              continue;
            }
            lastError = new Error(`Overpass HTTP ${response.status}`);
            if (response.status >= 500) continue;
            break;
          }
          const payload = await response.json() as { elements?: Array<{ id: number; lat?: number; lon?: number; tags?: Record<string, string> }> };
          const mapped = (payload.elements ?? [])
            .filter(e => Number.isFinite(e.lat) && Number.isFinite(e.lon))
            .map(e => ({ id: e.id, lat: e.lat as number, lon: e.lon as number, lit: e.tags?.lit ?? null, source: 'OpenStreetMap / Overpass API' }));
          const successMessage = mapped.length
            ? `${mapped.length} mapped street-lamp objects in this map view.`
            : 'No street-lamp objects are mapped in this view. This does not mean there are no lights.';
          if (!controller.signal.aborted) {
            viewportCache.set(boundsKey, { lights: mapped, savedAt: Date.now(), message: successMessage });
            failedUntil.delete(boundsKey);
            setLights(mapped);
            setStatus(mapped.length ? 'ready' : 'empty');
            setMessage(successMessage);
          }
          return;
        } catch (error) {
          if (controller.signal.aborted) return;
          lastError = error;
        }
      }

      if (!controller.signal.aborted) {
        failedUntil.set(boundsKey, Date.now() + 60_000);
        setStatus('error');
        setMessage(lastError instanceof Error
          ? `${lastError.message}. Both public endpoints may be busy; wait 60 seconds before retrying.`
          : 'Street-light data is temporarily unavailable. Wait 60 seconds before retrying.');
      }
    };

    // Debounce map moves and give public endpoints a short pause instead of firing immediately.
    debounceTimer = setTimeout(() => { void load(); }, 650);
    return () => {
      if (debounceTimer) clearTimeout(debounceTimer);
      controller.abort();
    };
  }, [enabled, boundsKey, retryVersion]);

  if (!enabled) return null;
  return <>
    {lights.map(light => <CircleMarker key={light.id} center={[light.lat, light.lon]} radius={5}
      pathOptions={{ color: '#ffffff', weight: 1.5, fillColor: '#facc15', fillOpacity: 0.95 }}>
      <Popup>
        <strong>Mapped street lamp</strong><br />
        Status: location mapped in OpenStreetMap; working condition unknown.<br />
        {light.lit ? `Road lighting tag: ${light.lit}` : 'Road lighting status: not specified'}<br />
        <small>Source: {light.source}</small>
      </Popup>
    </CircleMarker>)}
    <div className="street-light-status" role="status">
      <strong>Street-light data · {status === 'loading' ? 'Loading' : status === 'ready' ? 'Loaded' : status === 'empty' ? 'No mapped points' : status === 'error' ? 'Unavailable' : 'Waiting'}</strong>
      <span>{message || 'Loading mapped street lamps for the visible area.'}</span>
      {status === 'error' && <button type="button" onClick={() => {
        failedUntil.delete(boundsKey);
        setRetryVersion(v => v + 1);
      }}>Retry street-light data</button>}
      <small>OpenStreetMap data is incomplete and does not confirm whether a lamp is working.</small>
    </div>
  </>;
}
