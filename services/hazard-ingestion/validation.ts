import type { BoundingBox } from './types.ts';

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function cleanText(value: unknown, maxLength = 500): string {
  if (typeof value !== 'string') return '';
  // eslint-disable-next-line no-control-regex
  const text = value.replace(/[\u0000-\u001f\u007f]+/g, ' ').replace(/\s+/g, ' ').trim();
  return text.length > maxLength ? `${text.slice(0, maxLength - 1)}…` : text;
}

export type CoordinateCheck =
  | { ok: true; latitude: number; longitude: number }
  | { ok: false; reason: 'missing' | 'invalid' };

function toNumber(value: unknown): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value === 'string' && value.trim() !== '') {
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

/** Both values must be present, finite, in range, and not the (0,0) "null island" placeholder. */
export function parseCoordinates(lat: unknown, lon: unknown): CoordinateCheck {
  const absent = (v: unknown) => v === undefined || v === null || v === '';
  if (absent(lat) && absent(lon)) return { ok: false, reason: 'missing' };
  const latitude = toNumber(lat);
  const longitude = toNumber(lon);
  if (latitude === null || longitude === null) return { ok: false, reason: 'invalid' };
  if (latitude < -90 || latitude > 90 || longitude < -180 || longitude > 180) return { ok: false, reason: 'invalid' };
  if (latitude === 0 && longitude === 0) return { ok: false, reason: 'invalid' };
  return { ok: true, latitude, longitude };
}

export function isWithinBox(lat: number, lon: number, box: BoundingBox): boolean {
  return lat >= box.minLat && lat <= box.maxLat && lon >= box.minLon && lon <= box.maxLon;
}

const ISO_RE = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.\d{1,3})?)?(Z|[+-]\d{2}:\d{2})$/;

function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

/** Strict ISO-8601 with explicit zone; rejects impossible dates (e.g. Feb 31). Returns null if malformed. */
export function parseIsoTimestamp(value: unknown): Date | null {
  if (typeof value !== 'string') return null;
  const m = ISO_RE.exec(value.trim());
  if (!m) return null;
  const [year, month, day, hour, minute] = [m[1], m[2], m[3], m[4], m[5]].map(Number);
  const second = m[6] === undefined ? 0 : Number(m[6]);
  if (month < 1 || month > 12 || day < 1 || day > daysInMonth(year, month)) return null;
  if (hour > 23 || minute > 59 || second > 59) return null;
  const parsed = new Date(value.trim());
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

/** GDELT "seendate" format: YYYYMMDDTHHMMSSZ (UTC). Returns an ISO string or null. */
export function gdeltSeenDateToIso(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const m = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/.exec(value);
  if (!m) return null;
  const iso = `${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6]}Z`;
  return parseIsoTimestamp(iso) ? iso : null;
}
