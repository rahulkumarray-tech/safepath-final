export type LocationCandidate = {
  id: string;
  displayName: string;
  longitude: number;
  latitude: number;
};

export type RoadRoute = {
  id: string;
  distanceMeters: number;
  durationSeconds: number;
  coordinates: [number, number][];
};

export type RouteSearchResult = {
  routes: RoadRoute[];
  waypoints: [number, number][];
};

type JsonRecord = Record<string, unknown>;

export const GUWAHATI_PRESETS: LocationCandidate[] = [
  {
    id: 'preset-station',
    displayName: 'Guwahati Railway Station, Ambari',
    longitude: 91.7507423,
    latitude: 26.1821371,
  },
  {
    id: 'preset-adtu',
    displayName: 'Assam Down Town University, Panikhaiti',
    longitude: 91.8622787,
    latitude: 26.2017061,
  },
  {
    id: 'preset-airport',
    displayName: 'LGBI Airport (GAU), Borjhar',
    longitude: 91.5859,
    latitude: 26.1061,
  },
  {
    id: 'preset-kamakhya',
    displayName: 'Kamakhya Temple, Nilachal Hill',
    longitude: 91.7056,
    latitude: 26.1664,
  },
  {
    id: 'preset-iit',
    displayName: 'IIT Guwahati, Amingaon',
    longitude: 91.6916,
    latitude: 26.1878,
  },
  {
    id: 'preset-zoo',
    displayName: 'Zoo Road / RG Baruah Road Tiniali',
    longitude: 91.7825,
    latitude: 26.1620,
  },
  {
    id: 'preset-khanapara',
    displayName: 'Khanapara Transit Hub, GS Road',
    longitude: 91.8210,
    latitude: 26.1180,
  },
  {
    id: 'preset-paltan',
    displayName: 'Paltan Bazar / ASTC Central Station',
    longitude: 91.7485,
    latitude: 26.1788,
  },
  {
    id: 'preset-dispur',
    displayName: 'Assam Secretariat, Dispur Capital Complex',
    longitude: 91.7895,
    latitude: 26.1432,
  },
];

const locationCache = new Map<string, LocationCandidate[]>();
const reverseLocationCache = new Map<string, LocationCandidate>();
const REVERSE_CACHE_LIMIT = 60;
let lastLocationRequestAt = 0;
let locationRequestQueue: Promise<void> = Promise.resolve();

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === 'object' && value !== null;
}

function isCoordinate(value: unknown): value is [number, number] {
  return Array.isArray(value)
    && value.length >= 2
    && typeof value[0] === 'number'
    && Number.isFinite(value[0])
    && typeof value[1] === 'number'
    && Number.isFinite(value[1]);
}

function abortError() {
  return new DOMException('The request was cancelled.', 'AbortError');
}

function waitForNominatimSlot(signal?: AbortSignal) {
  const delay = Math.max(0, lastLocationRequestAt + 1000 - Date.now());
  if (signal?.aborted) return Promise.reject(abortError());
  if (delay === 0) return Promise.resolve();

  return new Promise<void>((resolve, reject) => {
    const timer = window.setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, delay);
    const onAbort = () => {
      window.clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
      reject(abortError());
    };
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

export async function geocodeAddress(query: string, signal: AbortSignal): Promise<LocationCandidate[]> {
  const normalizedQuery = query.trim();
  if (!normalizedQuery) throw new Error('Enter a location before searching.');

  const lower = normalizedQuery.toLowerCase();
  // "ADTU" / "Down Town" are aliases for the campus preset; every other query is
  // matched against preset names so a search like "Paltan Bazar station" still
  // returns the Paltan Bazar preset instead of being forced to the railway station.
  const adtuAlias = lower.includes('downtown') || lower.includes('down town') || lower.includes('adtu');
  const words = lower.split(/\s+/).filter((word) => word.length > 2);
  const matchedPresets = GUWAHATI_PRESETS
    .map((preset, order) => {
      if (adtuAlias) return preset.id === 'preset-adtu' ? { preset, score: 1, order } : null;
      const presetName = preset.displayName.toLowerCase();
      if (presetName.includes(lower)) return { preset, score: 1000 + lower.length, order };
      const score = words.reduce((total, word) => (presetName.includes(word) ? total + word.length : total), 0);
      return score > 0 ? { preset, score, order } : null;
    })
    .filter((match): match is { preset: LocationCandidate; score: number; order: number } => match !== null)
    .sort((a, b) => b.score - a.score || a.order - b.order)
    .map((match) => match.preset);
  if (matchedPresets.length > 0) {
    return matchedPresets;
  }

  const cacheKey = normalizedQuery.toLocaleLowerCase();
  const cachedResults = locationCache.get(cacheKey);
  if (cachedResults) return cachedResults;

  const request = locationRequestQueue.then(async () => {
    await waitForNominatimSlot(signal);
    lastLocationRequestAt = Date.now();

    const parameters = new URLSearchParams({
      q: normalizedQuery,
      format: 'jsonv2',
      addressdetails: '1',
      viewbox: '91.45,26.35,92.15,25.90',
      limit: '6',
    });
    let response: Response;
    try {
      response = await fetch(`https://nominatim.openstreetmap.org/search?${parameters}`, {
        headers: { Accept: 'application/json' },
        referrerPolicy: 'strict-origin-when-cross-origin',
        signal,
      });
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') throw error;
      throw new Error('Unable to reach Nominatim. Check your connection and try the location search again.');
    }

    if (!response.ok) {
      throw new Error(`Location search failed (HTTP ${response.status}). Please try again later.`);
    }

    const data: unknown = await response.json();
    if (!Array.isArray(data)) throw new Error('Location search returned an invalid response.');

    return data.flatMap((item, index): LocationCandidate[] => {
      if (!isRecord(item)) return [];
      const latitude = Number(item.lat);
      const longitude = Number(item.lon);
      if (!Number.isFinite(latitude) || !Number.isFinite(longitude) || typeof item.display_name !== 'string') return [];

      return [{
        id: String(item.place_id ?? item.osm_id ?? `${index}:${latitude}:${longitude}`),
        displayName: item.display_name,
        longitude,
        latitude,
      }];
    });
  });

  locationRequestQueue = request.then(() => undefined, () => undefined);
  const results = await request;
  locationCache.set(cacheKey, results);
  return results;
}

export async function fetchRoadRoutes(
  origin: LocationCandidate,
  destination: LocationCandidate,
  signal: AbortSignal,
): Promise<RouteSearchResult> {
  const coordinates = `${origin.longitude},${origin.latitude};${destination.longitude},${destination.latitude}`;
  const parameters = new URLSearchParams({
    // Ask OSRM for up to three route alternatives; the public service may return fewer.
    alternatives: '3',
    steps: 'false',
    geometries: 'geojson',
    overview: 'full',
  });
  let response: Response;
  let data: unknown;
  const requestController = new AbortController();
  let timedOut = false;
  const abortRequest = () => requestController.abort();
  if (signal.aborted) requestController.abort();
  else signal.addEventListener('abort', abortRequest, { once: true });
  const timeout = window.setTimeout(() => {
    timedOut = true;
    requestController.abort();
  }, 15_000);

  try {
    response = await fetch(`https://router.project-osrm.org/route/v1/driving/${coordinates}?${parameters}`, {
      headers: { Accept: 'application/json' },
      signal: requestController.signal,
    });
    data = await response.json().catch(() => null);
  } catch (error) {
    if (timedOut) throw new Error('Road routing timed out after 15 seconds. Check your connection and try again.');
    if (signal.aborted || (error instanceof Error && error.name === 'AbortError')) throw abortError();
    throw new Error('Unable to reach OSRM. Check your connection and try again.');
  } finally {
    window.clearTimeout(timeout);
    signal.removeEventListener('abort', abortRequest);
  }
  if (!isRecord(data)) {
    throw new Error(`Road routing failed (HTTP ${response.status}). Please try again.`);
  }
  if (data.code === 'NoRoute') throw new Error('No drivable route was found between these locations.');
  if (data.code === 'NoSegment') throw new Error('One of these locations is too far from a drivable road. Choose another result.');
  if (!response.ok) {
    throw new Error(`Road routing failed (HTTP ${response.status}). Please try again.`);
  }
  if (data.code !== 'Ok') {
    const detail = typeof data.message === 'string' ? ` ${data.message}` : '';
    throw new Error(`Road routing could not process these locations (${String(data.code)}).${detail}`);
  }
  if (!Array.isArray(data.routes) || data.routes.length === 0) {
    throw new Error('No drivable route was found between these locations.');
  }
  if (!Array.isArray(data.waypoints) || data.waypoints.length < 2) {
    throw new Error('Road routing returned incomplete location data. Please try again.');
  }

  const waypoints = data.waypoints.map((waypoint) => {
    if (!isRecord(waypoint) || !isCoordinate(waypoint.location)) {
      throw new Error('Road routing returned invalid endpoint coordinates.');
    }
    return [waypoint.location[0], waypoint.location[1]] as [number, number];
  });

  const routes = data.routes.map((route, index): RoadRoute => {
    if (!isRecord(route) || !isRecord(route.geometry) || !Array.isArray(route.geometry.coordinates)) {
      throw new Error('Road routing returned invalid route geometry.');
    }
    const distanceMeters = route.distance;
    const durationSeconds = route.duration;
    const routeCoordinates = route.geometry.coordinates.filter(isCoordinate);
    if (
      typeof distanceMeters !== 'number'
      || !Number.isFinite(distanceMeters)
      || typeof durationSeconds !== 'number'
      || !Number.isFinite(durationSeconds)
      || routeCoordinates.length < 2
    ) {
      throw new Error('Road routing returned an incomplete route. Please try again.');
    }

    return {
      id: `osrm-${index}`,
      distanceMeters,
      durationSeconds,
      coordinates: routeCoordinates,
    };
  });

  return { routes, waypoints };
}

export async function reverseGeocodeLatLng(lat: number, lng: number, signal?: AbortSignal): Promise<LocationCandidate> {
  const roundedLat = Math.round(lat * 10000) / 10000;
  const roundedLng = Math.round(lng * 10000) / 10000;
  // The clicked point stays the route endpoint: only its label is reverse geocoded.
  const fallback: LocationCandidate = {
    id: `pin-${roundedLat},${roundedLng}`,
    displayName: `Map point (${roundedLat.toFixed(4)}, ${roundedLng.toFixed(4)})`,
    longitude: roundedLng,
    latitude: roundedLat,
  };

  const cacheKey = `${roundedLat},${roundedLng}`;
  const cached = reverseLocationCache.get(cacheKey);
  if (cached) return cached;

  // Reverse lookups share the Nominatim queue so rapid map clicks cannot exceed
  // the public service's one-request-per-second policy.
  const request = locationRequestQueue.then(async () => {
    await waitForNominatimSlot(signal);
    lastLocationRequestAt = Date.now();

    const response = await fetch(
      `https://nominatim.openstreetmap.org/reverse?lat=${roundedLat}&lon=${roundedLng}&format=jsonv2`,
      { headers: { Accept: 'application/json' }, referrerPolicy: 'strict-origin-when-cross-origin', signal },
    );
    if (!response.ok) return fallback;

    const data: unknown = await response.json().catch(() => null);
    if (!isRecord(data) || typeof data.display_name !== 'string') return fallback;

    const shortName = data.display_name.split(',').map((part) => part.trim()).slice(0, 3).join(', ');
    return shortName ? { ...fallback, displayName: shortName } : fallback;
  });

  locationRequestQueue = request.then(() => undefined, () => undefined);

  try {
    const candidate = await request;
    if (reverseLocationCache.size >= REVERSE_CACHE_LIMIT) {
      const oldestKey = reverseLocationCache.keys().next().value;
      if (oldestKey !== undefined) reverseLocationCache.delete(oldestKey);
    }
    reverseLocationCache.set(cacheKey, candidate);
    return candidate;
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') throw error;
    return fallback;
  }
}