import type { IncomingMessage, ServerResponse } from 'node:http';
import { createGdeltAdapter } from './adapters/gdeltAdapter.ts';
import { createGoogleNewsAdapter } from './adapters/googleNewsAdapter.ts';
import { loadConfig } from './config.ts';
import { ingestIncidents } from './ingestIncidents.ts';
import type { IngestionResult } from './ingestIncidents.ts';

// Google News RSS is the primary live news source; GDELT is kept as a second
// (frequently rate-limited) source with a short timeout so it cannot stall the feed.
const adapters = [
  createGoogleNewsAdapter({ maxRecords: 30 }),
  createGdeltAdapter({ maxRecords: 50, timespan: '24h', timeoutMs: 5000 }),
];
const cacheDurationMs = 2 * 60_000;
let cachedResult: { result: IngestionResult; expiresAt: number } | null = null;
let refreshInProgress: Promise<IngestionResult> | null = null;

const weatherCacheDurationMs = 10 * 60_000;
const weatherCache = new Map<string, { body: WeatherSnapshot; expiresAt: number }>();

interface WeatherSnapshot {
  latitude: number;
  longitude: number;
  temperatureC: number | null;
  precipitationMm: number | null;
  rainMm: number | null;
  weatherCode: number | null;
  observedAt: string | null;
  timezone: string | null;
  retrievedAt: string;
}

function sendJson(response: ServerResponse, status: number, body: unknown) {
  response.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
  });
  response.end(JSON.stringify(body));
}

function getIncidents() {
  if (cachedResult && cachedResult.expiresAt > Date.now()) return Promise.resolve(cachedResult.result);
  if (refreshInProgress) return refreshInProgress;

  refreshInProgress = ingestIncidents(adapters, { config: loadConfig(process.env) })
    .then((result) => {
      if (result.sources.some((source) => source.status === 'ok')) {
        cachedResult = { result, expiresAt: Date.now() + cacheDurationMs };
      }
      return result;
    })
    .finally(() => {
      refreshInProgress = null;
    });

  return refreshInProgress;
}

function asFiniteNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

async function getWeather(latitude: number, longitude: number): Promise<WeatherSnapshot> {
  const cacheKey = `${latitude.toFixed(3)},${longitude.toFixed(3)}`;
  const cached = weatherCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) return cached.body;

  const parameters = new URLSearchParams({
    latitude: latitude.toFixed(4),
    longitude: longitude.toFixed(4),
    current: 'temperature_2m,precipitation,rain,weather_code',
    timezone: 'Asia/Kolkata',
  });
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8000);
  try {
    const upstream = await fetch(`https://api.open-meteo.com/v1/forecast?${parameters}`, {
      headers: { Accept: 'application/json' },
      signal: controller.signal,
    });
    if (!upstream.ok) throw new Error(`Open-Meteo returned HTTP ${upstream.status}.`);
    const payload: unknown = await upstream.json();
    if (typeof payload !== 'object' || payload === null) throw new Error('Open-Meteo returned an invalid body.');
    const record = payload as Record<string, unknown>;
    const current = typeof record.current === 'object' && record.current !== null
      ? record.current as Record<string, unknown>
      : {};

    const snapshot: WeatherSnapshot = {
      latitude,
      longitude,
      temperatureC: asFiniteNumber(current.temperature_2m),
      precipitationMm: asFiniteNumber(current.precipitation),
      rainMm: asFiniteNumber(current.rain),
      weatherCode: asFiniteNumber(current.weather_code),
      observedAt: typeof current.time === 'string' ? `${current.time}:00+05:30` : null,
      timezone: typeof record.timezone === 'string' ? record.timezone : null,
      retrievedAt: new Date().toISOString(),
    };
    weatherCache.set(cacheKey, { body: snapshot, expiresAt: Date.now() + weatherCacheDurationMs });
    return snapshot;
  } finally {
    clearTimeout(timer);
  }
}

export async function handleHazardRequest(request: IncomingMessage, response: ServerResponse): Promise<void> {
  const requestUrl = new URL(request.url ?? '/', `http://${request.headers.host ?? 'localhost'}`);

  if (requestUrl.pathname === '/api/health' && request.method === 'GET') {
    sendJson(response, 200, { status: 'ok' });
    return;
  }

  if (request.method === 'GET' && requestUrl.pathname === '/api/weather') {
    const latitude = Number(requestUrl.searchParams.get('lat'));
    const longitude = Number(requestUrl.searchParams.get('lon'));
    if (!Number.isFinite(latitude) || !Number.isFinite(longitude) || Math.abs(latitude) > 90 || Math.abs(longitude) > 180) {
      sendJson(response, 400, { error: 'Query parameters lat and lon must be valid coordinates.' });
      return;
    }
    try {
      sendJson(response, 200, await getWeather(latitude, longitude));
    } catch {
      sendJson(response, 503, { error: 'Live weather is temporarily unavailable.' });
    }
    return;
  }

  if (requestUrl.pathname !== '/api/incidents') {
    sendJson(response, 404, { error: 'Not found.' });
    return;
  }
  if (request.method !== 'GET') {
    response.setHeader('Allow', 'GET');
    sendJson(response, 405, { error: 'Method not allowed.' });
    return;
  }

  try {
    const result = await getIncidents();
    const allSourcesFailed = result.sources.length > 0 && result.sources.every((source) => source.status === 'failed');
    sendJson(response, allSourcesFailed ? 503 : 200, result);
  } catch {
    sendJson(response, 503, { error: 'Incident source is temporarily unavailable.' });
  }
}
