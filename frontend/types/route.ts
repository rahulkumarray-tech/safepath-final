export interface Route {
  id: string;
  name: string;
  shortName: string;
  subtitle: string;
  /** OSRM GeoJSON order: [longitude, latitude]. */
  coordinates: [number, number][];
  distanceMeters: number;
  durationSeconds: number;
  color: string;
}
