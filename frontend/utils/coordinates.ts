import type { MapPoint } from '../types/hazard';

/** Convert the prototype's abstract demo-map coordinates to approximate Guwahati coordinates. */
export function demoPointToLatLng(point: MapPoint): [number, number] {
  return [26.205 - (point.y / 70) * 0.105, 91.73 + (point.x / 100) * 0.16];
}
