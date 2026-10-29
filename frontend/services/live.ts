export type LiveWeather = {
  temperatureC: number | null;
  precipitationMm: number | null;
  rainMm: number | null;
  weatherCode: number | null;
  observedAt: string | null;
  retrievedAt: string;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function asNumberOrNull(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

/** Current conditions for a point, proxied and cached by the local hazard API (Open-Meteo). */
export async function fetchLiveWeather(latitude: number, longitude: number, signal: AbortSignal): Promise<LiveWeather> {
  const parameters = new URLSearchParams({ lat: latitude.toFixed(4), lon: longitude.toFixed(4) });
  let response: Response;
  try {
    response = await fetch(`/api/weather?${parameters}`, { headers: { Accept: 'application/json' }, signal });
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') throw error;
    throw new Error('Unable to reach the live weather API.');
  }

  const body: unknown = await response.json().catch(() => null);
  if (!response.ok || !isRecord(body)) {
    const detail = isRecord(body) && typeof body.error === 'string' ? body.error : `Live weather failed (HTTP ${response.status}).`;
    throw new Error(detail);
  }

  return {
    temperatureC: asNumberOrNull(body.temperatureC),
    precipitationMm: asNumberOrNull(body.precipitationMm),
    rainMm: asNumberOrNull(body.rainMm),
    weatherCode: asNumberOrNull(body.weatherCode),
    observedAt: typeof body.observedAt === 'string' ? body.observedAt : null,
    retrievedAt: typeof body.retrievedAt === 'string' ? body.retrievedAt : new Date().toISOString(),
  };
}

/** WMO weather interpretation codes used by Open-Meteo. */
export function describeWeatherCode(code: number | null): string {
  if (code === null) return 'Conditions unavailable';
  if (code === 0) return 'Clear sky';
  if (code === 1) return 'Mainly clear';
  if (code === 2) return 'Partly cloudy';
  if (code === 3) return 'Overcast';
  if (code === 45 || code === 48) return 'Fog';
  if (code >= 51 && code <= 57) return 'Drizzle';
  if (code >= 61 && code <= 67) return 'Rain';
  if (code >= 71 && code <= 77) return 'Snow';
  if (code >= 80 && code <= 82) return 'Rain showers';
  if (code === 85 || code === 86) return 'Snow showers';
  if (code >= 95) return 'Thunderstorm';
  return 'Mixed conditions';
}
