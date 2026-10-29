# hazard-ingestion (Person A)

Isolated, dependency-free service that discovers external road-incident **news/alert evidence**, normalizes it, and de-duplicates it.
It does **not** score routes, match geometry, build grids, or store anything. Imported records are **unverified** and are not proof a road is blocked.

## Layout
| File | Purpose |
|---|---|
| `types.ts` | Public contract (`NormalizedIncident`, `RawExternalReport`, config) |
| `sourceAdapter.ts` | `SourceAdapter` interface, `SourceError` codes |
| `httpClient.ts` | GET+JSON with hard timeout, 429/Retry-After, throttle-text detection |
| `adapters/googleNewsAdapter.ts` | Google News RSS search adapter (primary live news source) |
| `adapters/gdeltAdapter.ts` | GDELT DOC 2.0 ArtList adapter (secondary; frequently rate-limited) |
| `normalizeIncident.ts` / `location.ts` / `url.ts` / `validation.ts` | Validation, category, text-only location, canonical URL + stable id |
| `deduplicate.ts` / `ingestIncidents.ts` | De-dupe; orchestrator that isolates per-source failures |
| `tests/` | `node:test` suites using clearly labelled SYNTHETIC fixtures |
| `scripts/smokeGdelt.ts` | Opt-in single live request (max 5 records) |

## Run (Node >= 22.18 runs `.ts` directly; no new dependencies)
```bash
node --test "services/hazard-ingestion/tests/*.test.ts"          # unit tests, network mocked
node services/hazard-ingestion/scripts/smokeGdelt.ts              # optional live smoke test
npx tsc -p services/hazard-ingestion/tsconfig.json                # typecheck (needs @types/node)
```
Suggested `package.json` scripts (not applied, shared file): `"test:ingest": "node --test \"services/hazard-ingestion/tests/*.test.ts\""`.

## Environment (all optional; no secrets are needed by GDELT)
`HAZARD_INGEST_STALE_HOURS` (default 48), `HAZARD_INGEST_TIMEOUT_MS` (default 10000) via `loadConfig(process.env)`.
Run this service server-side only. Do not use `VITE_` variables for any future source credential.

## Source behaviour

- `ingestIncidents` runs every adapter in parallel and isolates failures per source. Normalization and de-duplication still run in adapter order, so "first occurrence wins" is deterministic.
- The Google News adapter converts RFC-822 `pubDate` values to ISO-8601, strips the trailing ` - Publisher` suffix, and keeps only headlines naming Guwahati/Gauhati/Kamrup (`requiredTerms`).
- `server.ts` exposes `GET /api/incidents` (2 min cache) and `GET /api/weather` (Open-Meteo current conditions, 10 min cache).

## Usage
```ts
import { ingestIncidents, createGdeltAdapter, loadConfig } from './services/hazard-ingestion/index.ts';
const result = await ingestIncidents([createGdeltAdapter()], { config: loadConfig(process.env), existingIds: new Set(storedIds) });
// result.incidents -> NormalizedIncident[] (unverified); result.sources -> per-source status / retryAfterMs
```

## Data-quality rules
- Coordinates are copied only from a source field, validated (finite, in range, not 0,0, inside Assam box) or set to `null`. GDELT never supplies any.
- Timestamps must be strict ISO-8601 with zone (GDELT `seendate` is converted); missing/malformed/future -> rejected, never guessed. Original string kept in `publishedAtRaw`.
- Stale = older than `staleAfterHours`; kept and flagged unless `dropStale: true`.
- Location is wording only. `locationConfidence`: `none | ambiguous | region_level | area_text | source_coordinates`.
- `verificationStatus` is always `'unverified'`, even for `official_alert`, until a real verification process exists.
- Dedupe: same source + canonical URL, or same domain + identical normalized headline; first occurrence wins. Different outlets are **not** merged and are **not** corroboration.

## Mapping to the existing `Hazard` type (frontend/App.tsx, not exported; no storage layer exists yet)
| Existing field | From `NormalizedIncident` | Note |
|---|---|---|
| `id` | `id` | |
| `type` | `category` | flooding->Flooding; traffic_incident->Traffic incident; road_obstruction/landslide/public_disruption->Road obstruction (Low lighting never produced) |
| `title` / `summary` | `description` | headline text only |
| `location` | `locationText ?? 'Location unresolved'` | |
| `point {x,y}` | **no mapping** | schematic 0-100 canvas coords, not lat/lng; needs an explicit projection decided by Persons B/C |
| `severity` | **none** | imports carry no severity; Person B must choose a documented default |
| `verification` | `verificationStatus` | `unverified` -> `'Needs review'` |
| `freshness` | derive from `publishedAt` | plus `isStale` |
| `source` | `sourceName` + domain of `sourceUrl` | keep `sourceUrl` for attribution |
