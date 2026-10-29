import { useEffect, useState } from 'react';
import { CloudSun } from 'lucide-react';
import { describeWeatherCode, fetchLiveWeather } from '../services/live';
import type { LiveWeather } from '../services/live';
import { formatClockTime } from '../utils/format';

const REFRESH_INTERVAL_MS = 10 * 60_000;

interface LiveConditionsProps {
  /** Route origin as [longitude, latitude]; falls back to central Guwahati. */
  point: [number, number] | null;
}

export function LiveConditions({ point }: LiveConditionsProps) {
  const [weather, setWeather] = useState<LiveWeather | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const longitude = point?.[0] ?? 91.785;
  const latitude = point?.[1] ?? 26.182;

  useEffect(() => {
    let cancelled = false;
    let controller: AbortController | null = null;

    const load = async () => {
      controller?.abort();
      controller = new AbortController();
      try {
        const result = await fetchLiveWeather(latitude, longitude, controller.signal);
        if (cancelled) return;
        setWeather(result);
        setError('');
      } catch (loadError) {
        if (cancelled || (loadError instanceof Error && loadError.name === 'AbortError')) return;
        setError(loadError instanceof Error ? loadError.message : 'Live weather unavailable.');
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    setLoading(true);
    void load();
    const timer = window.setInterval(() => { void load(); }, REFRESH_INTERVAL_MS);

    return () => {
      cancelled = true;
      window.clearInterval(timer);
      controller?.abort();
    };
  }, [latitude, longitude]);

  if (error) {
    return <span className="live-conditions is-error" title={error}>Live weather offline</span>;
  }
  if (!weather && loading) {
    return <span className="live-conditions">Loading live weather…</span>;
  }
  if (!weather) return null;

  const temperature = weather.temperatureC === null ? '—' : `${Math.round(weather.temperatureC)}°C`;
  const rain = weather.precipitationMm === null ? '—' : `${weather.precipitationMm.toFixed(1)} mm`;
  const observed = formatClockTime(weather.observedAt ?? weather.retrievedAt);

  return (
    <span className="live-conditions" title={`Open-Meteo current conditions, observed ${observed}`}>
      <span className="live-dot" />
      <CloudSun size={13} />
      {temperature} · {describeWeatherCode(weather.weatherCode)} · {rain} rain
    </span>
  );
}
