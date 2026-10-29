# Route risk engine contract

This module is independent of React, Leaflet, the routing service, hazard storage, and ingestion. Keep provider-specific translation at an adapter boundary; do not make the scoring engine depend on a provider model.

## Required route input

A route is passed as a `RouteInput`:

- `id: string` — stable identifier for this route candidate.
- `coordinates: ReadonlyArray<GeoPoint>` — road geometry in travel order. Each point is an object `{ lat: number, lng: number }` in WGS84 decimal degrees. Coordinates must not be `[lat, lng]` or `[lng, lat]` tuples.
- `distanceM?: number | null` — optional route length in metres.
- `durationS?: number | null` — optional estimated travel time in seconds.

At least one valid point is assessable; a road polyline should normally have two or more points. When the source is OSRM GeoJSON, positions are `[longitude, latitude]`; convert them with `geoJsonPositionsToGeoPoints` or `osrmRouteToRouteInput` before scoring. Leaflet tuples use `[latitude, longitude]` and can be converted with `leafletTuplesToGeoPoints`.

## Required hazard input

Each normalized record passed to the engine conforms to `HazardInput`:

- `id: string` — stable report identifier; duplicate IDs are de-duplicated, retaining the newest usable timestamp.
- `type: string` — provider category translated to a normalized type. Map closure categories to `road_closure`, `road_blocked`, `bridge_closed`, or `bridge_collapse` (or configure the engine's closure lists).
- `lat: number`, `lng: number` — WGS84 decimal-degree coordinates.
- `severity?: number | string | null` — numeric 1–5 or a recognized severity word. Missing/unrecognized values default to 2 and are flagged; map a provider-specific scale explicitly rather than passing it through blindly.
- `timestamp?: string | number | Date | null` — ISO/date string, `Date`, or epoch time. Numeric magnitudes below `1e11` are interpreted as seconds; larger values as milliseconds. Missing time is down-weighted; malformed, pre-2000, and excessively future timestamps are rejected.
- `source?: 'official' | 'community' | 'demo' | 'unknown' | string | null` — unknown values become `unknown`; simulated/sample sources must be `demo`.
- `verification?: 'verified' | 'unverified' | 'disputed' | 'resolved' | 'unknown' | string | null` — resolved reports are excluded; unknown values become `unknown`.
- `description?: string | null` and `confidence?: number | null` — optional display/evidence fields; confidence is used only when it is a finite number in the range 0–1.

Records missing IDs or valid coordinates are rejected. `(0,0)` is treated as an absent-coordinate placeholder. Coordinates, source and verification semantics, severity mapping, timestamp units, and closure mapping must be confirmed with the owning service before production integration.

## Adapter boundary for A/B integration

`integration.ts` defines a transport-neutral `HazardRecordAdapter<RawRecord>` that maps one external record to `HazardInput` or returns `null` when it cannot map the record safely. `HazardSnapshot<RawRecord>` is an internal handoff envelope for records and an optional caller-provided `coverageHint` from 0 to 1. `adaptHazardSnapshot` maps records without fetching, storing, or ingesting anything. These are SafePath-side seams—not assumptions about Person A's or Person B's eventual API. Do not edit their service/storage interfaces until they provide the real contract.

If no defensible monitored-area coverage value is available, omit the hint (or pass `null`) and the engine uses its explicitly approximate nearby-report-density heuristic. Do not infer authoritative coverage from an empty response.

## Synthetic test fixtures

`fixtures/syntheticRiskFixtures.ts` is test-only data. Every fixture is fabricated and must not be presented as a real report, used as production evidence, or confused with the app's local UI demo markers. `npm run test:risk` runs the dependency-light regression harness.

## Information needed to finish provider integration

**From Person A (ingestion):** the actual ingested record schema; which fields are trustworthy and normalized; source/provenance and simulated-data markers; severity scale and category vocabulary; timestamp format/time zone/units; verification/resolution states; whether coordinates are original, geocoded, or approximate; closure and flood/bridge event taxonomy; confidence/corroboration semantics; refresh cadence and stale-record handling.

**From Person B (hazard service/grid):** the actual fetch method and parameters; returned record type and whether results are already spatially filtered; coordinate reference system and coordinate order; route corridor/query support and radius units; pagination/limits and error/empty-result semantics; duplicate identity rules; whether the grid represents report density or monitored coverage; a documented coverage signal (if one exists) and its scale; how resolved/deleted records are represented.

Also confirm with both owners the expected route corridor, applicable operating geography, and the intended closure/blocking policy. No database or live feed is implemented here.
