import { getHazardsNearRoute, scoreRouteRisk } from '../riskEngine';
import type { HazardInput } from '../riskEngine';
import type { Hazard } from '../types/hazard';
import type { Route } from '../types/route';
import { demoPointToLatLng } from '../utils/coordinates';

/** Map local demo-only display records to the risk engine's provider-neutral input. */
export function adaptDemoHazards(hazards: Hazard[], includeGuwahatiData: boolean): HazardInput[] {
  if (!includeGuwahatiData) return [];

  return hazards.map((hazard) => {
    const [lat, lng] = demoPointToLatLng(hazard.point);
    const type = hazard.type === 'Road closure'
      ? 'road_closure'
      : hazard.type === 'Road obstruction'
        ? 'road_obstruction'
        : hazard.type === 'Low lighting'
          ? 'low_lighting'
          : hazard.type === 'Pothole'
            ? 'pothole'
            : hazard.type === 'Flooding'
              ? 'flooding'
              : 'traffic_incident';

    return {
      id: hazard.id,
      type,
      lat,
      lng,
      severity: hazard.severity === 'Severe'
        ? 5
        : hazard.severity === 'High'
          ? 4
          : hazard.severity === 'Medium'
            ? 3
            : 2,
      description: hazard.summary,
      timestamp: hazard.reportedAtMs,
      source: 'demo',
      verification: hazard.verification === 'Verified' ? 'verified' : 'unverified',
    };
  });
}

/** Return demo records whose approximate positions fall within the active road corridor. */
export function getHazardsAlongRoute(route: Route | null, hazards: Hazard[], includeGuwahatiData: boolean): Hazard[] {
  if (!route || !includeGuwahatiData) return [];

  const nearbyIds = new Set(getHazardsNearRoute({
    id: route.id,
    coordinates: route.coordinates.map(([lng, lat]) => ({ lat, lng })),
    distanceM: route.distanceMeters,
    durationS: route.durationSeconds,
  }, adaptDemoHazards(hazards, true)).map(({ hazard }) => hazard.id));

  return hazards.filter((hazard) => nearbyIds.has(hazard.id));
}

/** Convert OSRM route UI values and score each candidate against supplied hazards. */
export function assessRoutes(routes: Route[], hazards: HazardInput[]) {
  return routes.map((route) => scoreRouteRisk({
    id: route.id,
    coordinates: route.coordinates.map(([lng, lat]) => ({ lat, lng })),
    distanceM: route.distanceMeters,
    durationS: route.durationSeconds,
  }, hazards));
}
