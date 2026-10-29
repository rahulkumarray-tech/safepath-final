import { useEffect } from 'react';
import { useMap } from 'react-leaflet';
import type { Route } from '../types/route';

interface LeafletViewportProps {
  mapZoom: number;
  recenterKey: number;
  route: Route | null;
  waypoints: [number, number][];
}

/** Keeps the Leaflet viewport synchronized with the selected OSRM route. */
export function LeafletViewport({ mapZoom, recenterKey, route, waypoints }: LeafletViewportProps) {
  const map = useMap();

  useEffect(() => {
    map.setZoom(Math.round(13 + (mapZoom - 1) * 5), { animate: true });
  }, [map, mapZoom]);

  useEffect(() => {
    if (!route) return;
    const positions = [...route.coordinates, ...waypoints].map(
      ([longitude, latitude]) => [latitude, longitude] as [number, number],
    );
    map.fitBounds(positions, { padding: [28, 28], maxZoom: 15, animate: true });
  }, [map, recenterKey, route, waypoints]);

  return null;
}
