import type { HazardInput, RouteInput } from '../types';

/**
 * SYNTHETIC TEST FIXTURES ONLY.
 * These records are fabricated for deterministic tests; they are not real
 * incidents, production data, or connected to the app's local demo reports.
 */
export const FIXTURE_NOW_MS = Date.UTC(2026, 9, 29, 12, 0, 0);
const baseLat = 22.5726;
const baseLng = 88.3639;
const metersToLatitudeDegrees = (meters: number): number => meters / 111_195;

/** Parallel sample roads let tests compare exposure to the same hazard. */
export const SAMPLE_ROUTE_EXPOSED: RouteInput = {
  id: 'fixture-route-exposed',
  coordinates: [
    { lat: baseLat, lng: baseLng },
    { lat: baseLat, lng: baseLng + 0.003 },
    { lat: baseLat, lng: baseLng + 0.006 },
    { lat: baseLat, lng: baseLng + 0.009 },
  ],
  distanceM: 920,
  durationS: 150,
};

export const SAMPLE_ROUTE_ALTERNATIVE: RouteInput = {
  id: 'fixture-route-alternative',
  coordinates: SAMPLE_ROUTE_EXPOSED.coordinates.map(({ lat, lng }) => ({
    lat: lat + metersToLatitudeDegrees(350),
    lng,
  })),
  distanceM: 1_180,
  durationS: 210,
};

export const SAMPLE_NEARBY_SEVERE_HAZARD: HazardInput = {
  id: 'fixture-severe-001',
  type: 'road_obstruction',
  lat: baseLat + metersToLatitudeDegrees(8),
  lng: baseLng + 0.0045,
  severity: 5,
  description: 'Synthetic severe obstruction used by a unit test.',
  timestamp: FIXTURE_NOW_MS - 60 * 60 * 1000,
  source: 'official',
  verification: 'verified',
};

export const SAMPLE_UNVERIFIED_HAZARD: HazardInput = {
  ...SAMPLE_NEARBY_SEVERE_HAZARD,
  id: 'fixture-unverified-001',
  verification: 'unverified',
  source: 'community',
};

export const SAMPLE_DISTANT_HAZARD: HazardInput = {
  ...SAMPLE_NEARBY_SEVERE_HAZARD,
  id: 'fixture-distant-001',
  lat: baseLat + metersToLatitudeDegrees(200),
};

/** A deliberately malformed external record used to exercise runtime validation. */
export const SAMPLE_MISSING_COORDINATES_HAZARD: unknown = {
  id: 'fixture-missing-coordinates',
  type: 'road_obstruction',
  severity: 5,
  description: 'Synthetic malformed record; latitude/longitude intentionally omitted.',
};
