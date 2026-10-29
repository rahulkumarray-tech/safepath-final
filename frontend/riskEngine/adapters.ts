import type { GeoPoint, HazardInput, RouteInput } from './types';
/** Minimal OSRM route shape when geometries=geojson is requested. */
export interface OsrmLikeRoute { geometry:{coordinates:ReadonlyArray<ReadonlyArray<number>>}; distance?:number; duration?:number }
/** GeoJSON coordinates are [longitude, latitude]. */
export function geoJsonPositionsToGeoPoints(positions:ReadonlyArray<ReadonlyArray<number>>):GeoPoint[] { return positions.map(pair=>({lng:pair[0]??Number.NaN,lat:pair[1]??Number.NaN})); }
/** Leaflet tuples are [latitude, longitude]. */
export function leafletTuplesToGeoPoints(tuples:ReadonlyArray<readonly [number,number]>):GeoPoint[] { return tuples.map(([lat,lng])=>({lat,lng})); }
export function osrmRouteToRouteInput(id:string,route:OsrmLikeRoute):RouteInput { return {id,coordinates:geoJsonPositionsToGeoPoints(route.geometry.coordinates),distanceM:route.distance??null,durationS:route.duration??null}; }
/** Generic adapter example only; map this to the real application's evidence model. */
export interface ExampleRawHazard { id:string|number; category?:string; latitude:number; longitude:number; severity?:number|string; notes?:string; reportedAt?:string; isVerified?:boolean; isDemo?:boolean }
export function exampleHazardAdapter(raw:ExampleRawHazard):HazardInput { return {id:String(raw.id),type:raw.category??'other',lat:raw.latitude,lng:raw.longitude,severity:raw.severity,description:raw.notes,timestamp:raw.reportedAt,source:raw.isDemo?'demo':'community',verification:raw.isVerified?'verified':'unverified'}; }
