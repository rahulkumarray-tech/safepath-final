import type { GeoPoint } from './types';
const R = 6_371_008.8;
const RAD = Math.PI / 180;
export function clamp(n: number, min: number, max: number): number { return Math.min(max, Math.max(min, n)); }
export function isValidLatLng(lat: unknown, lng: unknown): boolean {
  return typeof lat === 'number' && Number.isFinite(lat) && lat >= -90 && lat <= 90 && typeof lng === 'number' && Number.isFinite(lng) && lng >= -180 && lng <= 180;
}
export function haversineDistanceM(a: GeoPoint, b: GeoPoint): number {
  const dLat = (b.lat - a.lat) * RAD, dLng = (b.lng - a.lng) * RAD;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * RAD) * Math.cos(b.lat * RAD) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}
function wrap(d: number): number { while (d > 180) d -= 360; while (d < -180) d += 360; return d; }
export interface SegmentProjection { distanceM: number; nearestPoint: GeoPoint }
export function distanceToSegment(p: GeoPoint, a: GeoPoint, b: GeoPoint): SegmentProjection {
  const cos = Math.max(Math.cos(p.lat * RAD), 1e-6);
  const xy = (q: GeoPoint) => ({ x: wrap(q.lng - p.lng) * RAD * cos * R, y: (q.lat - p.lat) * RAD * R });
  const A = xy(a), B = xy(b), dx = B.x - A.x, dy = B.y - A.y;
  const length = dx * dx + dy * dy, t = length === 0 ? 0 : clamp((-A.x * dx - A.y * dy) / length, 0, 1);
  const x = A.x + t * dx, y = A.y + t * dy;
  return { distanceM: Math.hypot(x, y), nearestPoint: { lat: p.lat + y / R / RAD, lng: p.lng + x / (R * cos) / RAD } };
}
export interface PolylineProjection extends SegmentProjection { segmentIndex: number }
export function distanceToPolyline(p: GeoPoint, line: ReadonlyArray<GeoPoint>): PolylineProjection | null {
  const first = line[0]; if (!first) return null;
  if (line.length === 1) return { distanceM: haversineDistanceM(p, first), nearestPoint: first, segmentIndex: 0 };
  let best: PolylineProjection | null = null;
  for (let i = 0; i < line.length - 1; i++) { const a = line[i], b = line[i + 1]; if (!a || !b) continue; const d = distanceToSegment(p, a, b); if (!best || d.distanceM < best.distanceM) best = { ...d, segmentIndex: i }; }
  return best;
}
export function polylineLengthM(line: ReadonlyArray<GeoPoint>): number {
  let n = 0; for (let i = 0; i < line.length - 1; i++) { const a = line[i], b = line[i + 1]; if (a && b) n += haversineDistanceM(a, b); } return n;
}
export interface BoundingBox { minLat: number; maxLat: number; minLng: number; maxLng: number }
export function boundingBoxOf(points: ReadonlyArray<GeoPoint>): BoundingBox | null {
  if (!points.length) return null;
  return points.reduce((b, p) => ({ minLat: Math.min(b.minLat, p.lat), maxLat: Math.max(b.maxLat, p.lat), minLng: Math.min(b.minLng, p.lng), maxLng: Math.max(b.maxLng, p.lng) }), { minLat: Infinity, maxLat: -Infinity, minLng: Infinity, maxLng: -Infinity });
}
export function expandBox(b: BoundingBox, meters: number): BoundingBox {
  const dLat = meters / 111_320, cos = Math.max(Math.cos(Math.max(Math.abs(b.minLat), Math.abs(b.maxLat)) * RAD), 0.01), dLng = meters / (111_320 * cos);
  return { minLat: b.minLat - dLat, maxLat: b.maxLat + dLat, minLng: b.minLng - dLng, maxLng: b.maxLng + dLng };
}
export function boxContains(b: BoundingBox, p: GeoPoint): boolean { return p.lat >= b.minLat && p.lat <= b.maxLat && p.lng >= b.minLng && p.lng <= b.maxLng; }
