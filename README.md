# Safe Route

A hackathon prototype for hazard-aware route recommendations. The frontend uses React, TypeScript, Leaflet, and React-Leaflet.

## Routing flow

- Search an origin and destination with user-triggered OpenStreetMap Nominatim geocoding.
- Select a matching place for each input; the app does not route unconfirmed or failed searches.
- Request driving routes from the public OSRM Route API with alternatives and full GeoJSON geometry.
- Compare the returned distances and estimated durations, select a route, and view it on the map.
- Curated hazard markers remain synthetic/local demo evidence. In the prototype, approximate marker positions can influence route risk estimates and ranking; they are not real incident coordinates or a production hazard feed.

## Route risk engine

The standalone risk engine and its integration contract are documented in [frontend/riskEngine/INTEGRATION.md](frontend/riskEngine/INTEGRATION.md). Synthetic regression fixtures are isolated in `frontend/riskEngine/fixtures/` and are test-only. Run `npm run test:risk` to execute the engine tests.

The public Nominatim service is queried only after the user initiates a search. Requests are cached and serialized to at most one per second. It is a shared service with usage limits and is not intended for high-volume or autocomplete use. Route duration comes from OSRM and is not guaranteed to reflect live traffic.

The map uses Esri street tiles; review the tile provider's terms and quotas before production use. This prototype is not for emergency navigation.

## Hazard ingestion prototype

`services/hazard-ingestion` is a server-side library for discovering road-incident news from Google News RSS (primary) and GDELT DOC 2.0 (secondary), validating and normalizing reports, and deduplicating results. Both are news indexes, not official traffic feeds. Imported reports are always unverified evidence; the service never invents coordinates, scores routes, or stores data. Sources are fetched in parallel and isolated, so a rate-limited source never empties the feed.

The planner and the Reports page fetch live evidence through the Node API and refresh automatically every 60 seconds. Text-only or ambiguous locations are not plotted, and imported reports do not affect OSRM route recommendations. Reports are not persisted or verified by this prototype.

The same API also proxies current conditions (temperature, precipitation, WMO weather code) from Open-Meteo for the route origin, refreshed every 10 minutes. Weather is informational: it is not fed into the risk score.

## Live data endpoints

| Endpoint | Source | Cache | Purpose |
|---|---|---|---|
| `GET /api/incidents` | Google News RSS + GDELT DOC 2.0 | 2 min | Unverified road-incident headlines with publisher and publication time |
| `GET /api/weather?lat=&lon=` | Open-Meteo | 10 min | Current conditions for the route origin |
| `GET /api/health` | – | – | Liveness probe |

The Vite dev server proxies `/api` to `http://127.0.0.1:3100` by default; set `HAZARD_API_URL` to point it elsewhere. The API itself honours `HAZARD_API_HOST` and `HAZARD_API_PORT`.

GitHub Pages hosts only the static frontend and cannot run this Node API. Deploy the API separately and configure a production API URL/proxy before enabling external evidence there.

Run the mocked unit tests and typecheck:

```bash
npm run test:ingest
npm run typecheck:ingest
```

An opt-in live GDELT request is available for local smoke testing only. It makes one bounded request for at most five records and is not run in CI:

```bash
npm run smoke:gdelt
```

## Run locally

Start the hazard API in one terminal:

```bash
npm install
npm run dev:api
```

Start the frontend in a second terminal:

```bash
npm run dev
```

Then open `http://localhost:3000`.

## Frontend organization

- `frontend/App.tsx` — app composition and page-level state.
- `frontend/components/` — reusable UI and map components.
- `frontend/data/` — clearly labelled local demo data.
- `frontend/services/` — routing, risk-assessment and live-data adapters.
- `frontend/hooks/` — polling hooks that keep live data current.
- `frontend/types/` — app-domain TypeScript interfaces.
- `frontend/utils/` — formatting and coordinate helpers.
- `frontend/riskEngine/` — standalone scoring, comparison, tests, and integration contract.

To verify a production build:

```bash
npm run build
npm run preview
```

## GitHub Pages

The repository includes a GitHub Actions workflow that builds and publishes the Vite output to GitHub Pages whenever `main` is updated. In the repository settings, set **Pages → Source** to **GitHub Actions**.

## Providers

- Geocoding: [Nominatim](https://nominatim.openstreetmap.org/) and [OpenStreetMap contributors](https://www.openstreetmap.org/copyright)
- Driving routes: [OSRM Route API](https://project-osrm.org/docs/v26.5.0/http#route-service)
