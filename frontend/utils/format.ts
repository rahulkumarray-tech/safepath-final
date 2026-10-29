export function formatDistance(distanceMeters: number): string {
  return distanceMeters >= 1000
    ? `${(distanceMeters / 1000).toFixed(1)} km`
    : `${Math.round(distanceMeters)} m`;
}

export function formatDuration(durationSeconds: number): string {
  const minutes = Math.max(1, Math.round(durationSeconds / 60));
  if (minutes < 60) return `${minutes} min`;
  return `${Math.floor(minutes / 60)} hr ${minutes % 60} min`;
}

/** Short "time since" label for live feeds. */
export function formatRelativeTime(timestampMs: number, nowMs = Date.now()): string {
  const minutes = Math.max(0, Math.round((nowMs - timestampMs) / 60_000));
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} hr ago`;
  return `${Math.round(hours / 24)} d ago`;
}

export function formatClockTime(value: string | number | null): string {
  if (value === null) return 'time unknown';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'time unknown';
  return new Intl.DateTimeFormat('en-IN', { hour: '2-digit', minute: '2-digit', hour12: false }).format(date);
}
