import { Fragment, useEffect, useRef, useState } from 'react';
import {
  MapContainer,
  Marker,
  Polyline,
  Popup,
  TileLayer,
  Tooltip,
  useMap,
  useMapEvents,
} from 'react-leaflet';
import L from 'leaflet';
import type { LatLngExpression, LeafletMouseEvent } from 'leaflet';
import {
  AlertTriangle,
  Compass,
  Crosshair,
  Maximize2,
  Minimize2,
  Navigation,
  Route as RouteIcon,
  Shield,
  ZoomIn,
  ZoomOut,
} from 'lucide-react';
import type { Hazard } from '../types/hazard';
import type { Route } from '../types/route';
import type { LocationCandidate } from '../services/routing';
import { reverseGeocodeLatLng } from '../services/routing';
import { demoPointToLatLng } from '../utils/coordinates';
import { formatDistance, formatDuration } from '../utils/format';
import { LeafletViewport } from './LeafletViewport';
import { LiveConditions } from './LiveConditions';
import { StreetLightLayer } from './StreetLightLayer';

export type BasemapMode = 'positron' | 'streets' | 'satellite' | 'dark';

interface InteractiveMapProps {
  guwahatiCenter: LatLngExpression;
  routes: Route[];
  activeRouteId: string | null;
  onSelectRoute: (routeId: string) => void;
  snappedWaypoints: [number, number][];
  originSelection: LocationCandidate | null;
  destinationSelection: LocationCandidate | null;
  onSelectLocation: (field: 'origin' | 'destination', location: LocationCandidate) => void;
  hazards: Hazard[];
  showGuwahatiHazards: boolean;
  selectedHazardId: string | null;
  onSelectHazard: (hazardId: string) => void;
  gpsPosition: { latitude: number; longitude: number; accuracy: number } | null;
  isGpsTracking: boolean;
  gpsError: string;
  onToggleGpsTracking: () => void;
}

// Custom Leaflet DivIcons with CSS pulsing beacons
function createPulseIcon(type: 'origin' | 'destination') {
  const isOrigin = type === 'origin';
  return L.divIcon({
    className: 'custom-pin-wrap',
    html: `
      <div class="custom-pin">
        <div class="pulse-beacon ${isOrigin ? 'green' : 'red'}"></div>
        <div class="pin-body ${isOrigin ? 'origin' : 'destination'}">
          <div class="pin-icon">${isOrigin ? 'A' : 'B'}</div>
        </div>
      </div>
    `,
    iconSize: [28, 28],
    iconAnchor: [14, 28],
    popupAnchor: [0, -28],
  });
}

function createHazardIcon(severity: string, isSelected: boolean) {
  const isHigh = severity === 'High' || severity === 'Severe';
  return L.divIcon({
    className: 'custom-hazard-wrap',
    html: `
      <div class="custom-pin" style="transform: scale(${isSelected ? '1.25' : '1'})">
        <div class="pin-body ${isHigh ? 'hazard-critical' : 'hazard'}">
          <div class="pin-icon">!</div>
        </div>
      </div>
    `,
    iconSize: [24, 24],
    iconAnchor: [12, 24],
    popupAnchor: [0, -24],
  });
}

// Leaflet only reacts to window resizes, so container size changes (fullscreen,
// mobile layout) need an explicit invalidateSize or tiles render partially.
function MapSizeSync() {
  const map = useMap();

  useEffect(() => {
    const container = map.getContainer();
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(() => map.invalidateSize({ animate: false }));
    observer.observe(container);
    return () => observer.disconnect();
  }, [map]);

  return null;
}

// Map Click Handler for reverse geocoding & setting Start/Destination
function MapClickHandler({
  onMapClick,
}: {
  onMapClick: (e: LeafletMouseEvent) => void;
}) {
  useMapEvents({
    click(e) {
      onMapClick(e);
    },
  });
  return null;
}

const cartoApiKey = import.meta.env.VITE_CARTO_API_KEY?.trim() ?? '';
const cartoAttribution = '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> &copy; <a href="https://carto.com/">CARTO</a>';
const esriStreetUrl = 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Street_Map/MapServer/tile/{z}/{y}/{x}';
const cartoTileUrl = (style: string) => `https://basemaps.cartocdn.com/${style}/{z}/{x}/{y}{r}.png?key=${encodeURIComponent(cartoApiKey)}`;

const BASEMAP_TILES: Record<BasemapMode, { url: string; attribution: string }> = {
  positron: {
    // CARTO requires a key for raster tiles; retain a working map when local setup is pending.
    url: cartoApiKey ? cartoTileUrl('rastertiles/voyager') : esriStreetUrl,
    attribution: cartoApiKey ? cartoAttribution : 'Tiles &copy; Esri &middot; OpenStreetMap contributors',
  },
  streets: {
    url: esriStreetUrl,
    attribution: 'Tiles &copy; Esri &middot; OpenStreetMap contributors',
  },
  satellite: {
    url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
    attribution: 'Tiles &copy; Esri &middot; Maxar, Earthstar Geographics',
  },
  dark: {
    url: cartoApiKey ? cartoTileUrl('dark_all') : esriStreetUrl,
    attribution: cartoApiKey ? cartoAttribution : 'Tiles &copy; Esri &middot; OpenStreetMap contributors',
  },
};

export function InteractiveMap({
  guwahatiCenter,
  routes,
  activeRouteId,
  onSelectRoute,
  snappedWaypoints,
  originSelection,
  destinationSelection,
  onSelectLocation,
  hazards,
  showGuwahatiHazards,
  selectedHazardId,
  onSelectHazard,
  gpsPosition,
  isGpsTracking,
  gpsError,
  onToggleGpsTracking,
}: InteractiveMapProps) {
  const [basemap, setBasemap] = useState<BasemapMode>(cartoApiKey ? 'positron' : 'streets');
  const [mapZoom, setMapZoom] = useState(1);
  const [recenterKey, setRecenterKey] = useState(0);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [showRoutes, setShowRoutes] = useState(true);
  const [showHazards, setShowHazards] = useState(true);
  const [showStreetLights, setShowStreetLights] = useState(false);
  const [showCorridor, setShowCorridor] = useState(true);

  // Clicked point on map for setting origin/destination
  const [clickedLocation, setClickedLocation] = useState<{
    lat: number;
    lng: number;
    candidate: LocationCandidate | null;
    loading: boolean;
  } | null>(null);

  const activeRoute = routes.find((r) => r.id === activeRouteId) ?? null;
  const reverseController = useRef<AbortController | null>(null);

  useEffect(() => () => reverseController.current?.abort(), []);

  const handleMapClick = async (e: LeafletMouseEvent) => {
    const { lat, lng } = e.latlng;
    reverseController.current?.abort();
    const controller = new AbortController();
    reverseController.current = controller;
    setClickedLocation({ lat, lng, candidate: null, loading: true });
    try {
      const candidate = await reverseGeocodeLatLng(lat, lng, controller.signal);
      if (controller.signal.aborted) return;
      setClickedLocation({ lat, lng, candidate, loading: false });
    } catch (error) {
      if (controller.signal.aborted || (error instanceof Error && error.name === 'AbortError')) return;
      setClickedLocation({
        lat,
        lng,
        candidate: {
          id: `pin-${lat.toFixed(4)},${lng.toFixed(4)}`,
          displayName: `Map point (${lat.toFixed(4)}, ${lng.toFixed(4)})`,
          longitude: lng,
          latitude: lat,
        },
        loading: false,
      });
    }
  };

  return (
    <section className="map-stage">
      {/* Top Map Action Toolbar */}
      <div className="map-toolbar">
        <div className="map-label">
          <span className="map-label-icon">
            <Compass size={16} />
          </span>
          <div>
            <strong>Interactive Road Map</strong>
            <small>
              {activeRoute
                ? `${activeRoute.name} · ${formatDistance(activeRoute.distanceMeters)}`
                : 'Click map to place points or select locations'}
            </small>
          </div>
        </div>

        <div className="map-actions">
          {/* Basemap Switcher Segmented Control */}
          <div className="map-layer-pills" role="radiogroup" aria-label="Basemap style">
            <button
              type="button"
              className={`map-layer-pill ${basemap === 'positron' ? 'active' : ''}`}
              onClick={() => setBasemap('positron')}
              title={cartoApiKey ? 'Clean CARTO basemap' : 'Set VITE_CARTO_API_KEY to enable the CARTO basemap'}
              disabled={!cartoApiKey}
            >
              Clean
            </button>
            <button
              type="button"
              className={`map-layer-pill ${basemap === 'streets' ? 'active' : ''}`}
              onClick={() => setBasemap('streets')}
              title="Detailed Street Map"
            >
              Streets
            </button>
            <button
              type="button"
              className={`map-layer-pill ${basemap === 'satellite' ? 'active' : ''}`}
              onClick={() => setBasemap('satellite')}
              title="Aerial Satellite Imagery"
            >
              Satellite
            </button>
            <button
              type="button"
              className={`map-layer-pill ${basemap === 'dark' ? 'active' : ''}`}
              onClick={() => setBasemap('dark')}
              title={cartoApiKey ? 'High Contrast Night Mode' : 'Set VITE_CARTO_API_KEY to enable the CARTO night basemap'}
              disabled={!cartoApiKey}
            >
              Night
            </button>
          </div>

          {/* Toggle Safety Corridor */}
          <button
            type="button"
            className={`map-control ${showCorridor ? 'active-control' : ''}`}
            onClick={() => setShowCorridor((c) => !c)}
            title="Toggle 50m Hazard Detection Corridor"
            aria-label="Toggle 50m Hazard Detection Corridor"
          >
            <Shield size={16} />
          </button>

          {/* Toggle mapped street-light evidence */}
          <button
            type="button"
            className={`map-control ${showStreetLights ? 'active-control' : ''}`}
            onClick={() => setShowStreetLights((value) => !value)}
            title="Toggle mapped street-light data from OpenStreetMap"
            aria-label="Toggle mapped street-light data"
          >
            <span aria-hidden="true" style={{ fontSize: 16, lineHeight: 1 }}>💡</span>
          </button>

          {/* Toggle Hazards */}
          <button
            type="button"
            className={`map-control ${showHazards ? 'active-control' : ''}`}
            onClick={() => setShowHazards((h) => !h)}
            title="Toggle Hazard Markers"
            aria-label="Toggle Hazard Markers"
          >
            <AlertTriangle size={16} />
          </button>

          {/* Toggle Routes */}
          <button
            type="button"
            className={`map-control ${showRoutes ? 'active-control' : ''}`}
            onClick={() => setShowRoutes((r) => !r)}
            title="Toggle Route Polylines"
            aria-label="Toggle Route Polylines"
          >
            <RouteIcon size={16} />
          </button>

          {/* Live GPS tracking */}
          <button
            type="button"
            className={`map-control ${isGpsTracking ? 'active-control' : ''}`}
            onClick={onToggleGpsTracking}
            title={isGpsTracking ? 'Stop live GPS tracking' : 'Start live GPS tracking'}
            aria-label={isGpsTracking ? 'Stop live GPS tracking' : 'Start live GPS tracking'}
          >
            <Navigation size={16} />
          </button>

          {/* Recenter */}
          <button
            type="button"
            className="map-control"
            onClick={() => setRecenterKey((k) => k + 1)}
            title="Fit Route to View"
            aria-label="Fit Route to View"
            disabled={!activeRoute}
          >
            <Crosshair size={16} />
          </button>

          {/* Zoom In/Out */}
          <button
            type="button"
            className="map-control"
            onClick={() => setMapZoom((z) => Math.min(1.25, z + 0.1))}
            title="Zoom In"
            aria-label="Zoom In"
          >
            <ZoomIn size={16} />
          </button>
          <button
            type="button"
            className="map-control"
            onClick={() => setMapZoom((z) => Math.max(0.85, z - 0.1))}
            title="Zoom Out"
            aria-label="Zoom Out"
          >
            <ZoomOut size={16} />
          </button>

          {/* Fullscreen */}
          <button
            type="button"
            className="map-control"
            onClick={() => setIsFullscreen((f) => !f)}
            title={isFullscreen ? 'Exit Fullscreen' : 'Fullscreen Map'}
            aria-label={isFullscreen ? 'Exit Fullscreen' : 'Fullscreen Map'}
          >
            {isFullscreen ? <Minimize2 size={16} /> : <Maximize2 size={16} />}
          </button>
        </div>
      </div>

      {/* Map Canvas */}
      <div className={`map-canvas-wrap leaflet-map-wrap ${isFullscreen ? 'is-fullscreen' : ''}`}>
        {isFullscreen && (
          <button
            type="button"
            className="fullscreen-exit-btn"
            onClick={() => setIsFullscreen(false)}
          >
            <Minimize2 size={14} /> Exit Fullscreen
          </button>
        )}

        {gpsError && <div className="map-status-message" role="alert">{gpsError}</div>}
        {isGpsTracking && gpsPosition && <div className="map-status-message gps-active" role="status">GPS tracking active · ±{Math.round(gpsPosition.accuracy)} m</div>}

        <MapContainer
          center={guwahatiCenter}
          zoom={13}
          zoomControl={false}
          scrollWheelZoom
          className="leaflet-map"
          aria-label="Interactive road route map"
        >
          <TileLayer
            key={basemap}
            url={BASEMAP_TILES[basemap].url}
            attribution={BASEMAP_TILES[basemap].attribution}
          />

          <StreetLightLayer enabled={showStreetLights} />

          <LeafletViewport
            mapZoom={mapZoom}
            recenterKey={recenterKey}
            route={activeRoute}
            waypoints={snappedWaypoints}
          />

          <MapSizeSync />
          <MapClickHandler onMapClick={handleMapClick} />

          {gpsPosition && (
            <Marker
              position={[gpsPosition.latitude, gpsPosition.longitude]}
              icon={L.divIcon({
                className: 'safepath-gps-marker',
                html: '<div style="width:18px;height:18px;border:3px solid white;border-radius:50%;background:#2563eb;box-shadow:0 0 0 7px rgba(37,99,235,.22),0 2px 8px rgba(0,0,0,.35)"></div>',
                iconSize: [24, 24],
                iconAnchor: [12, 12],
              })}
            >
              <Popup>
                <strong>{isGpsTracking ? 'Live GPS location' : 'Last GPS location'}</strong><br />
                Accuracy: approximately {Math.round(gpsPosition.accuracy)} m
              </Popup>
            </Marker>
          )}

          {/* 50 m Safety Corridor Halo on Active Route */}
          {showCorridor && activeRoute && (
            <Polyline
              positions={activeRoute.coordinates.map(([lng, lat]) => [lat, lng] as [number, number])}
              pathOptions={{
                color: basemap === 'dark' ? '#059669' : '#10b981',
                weight: 28,
                opacity: basemap === 'dark' ? 0.28 : 0.2,
                lineCap: 'round',
                lineJoin: 'round',
              }}
            />
          )}

          {/* Multi-layer Route Polylines */}
          {showRoutes &&
            routes.map((route) => {
              const isActive = route.id === activeRouteId;
              const positions = route.coordinates.map(([lng, lat]) => [lat, lng] as [number, number]);

              return (
                <Fragment key={route.id}>
                  {/* Outer casing stroke for rich depth and contrast */}
                  <Polyline
                    positions={positions}
                    pathOptions={{
                      color: isActive ? (basemap === 'dark' ? '#000000' : '#0e381d') : '#475569',
                      weight: isActive ? 8 : 5,
                      opacity: isActive ? 0.75 : 0.35,
                      lineCap: 'round',
                      lineJoin: 'round',
                    }}
                  />
                  {/* Inner vibrant stroke */}
                  <Polyline
                    positions={positions}
                    pathOptions={{
                      color: isActive ? '#10b981' : route.color,
                      weight: isActive ? 5 : 3.5,
                      opacity: isActive ? 1 : 0.8,
                      lineCap: 'round',
                      lineJoin: 'round',
                    }}
                    eventHandlers={{ click: () => onSelectRoute(route.id) }}
                  >
                    <Tooltip sticky>
                      <div style={{ fontWeight: 700, fontSize: '11px', color: '#fff' }}>
                        {route.name}
                      </div>
                      <div style={{ fontSize: '10px', color: '#d1d5db', marginTop: '2px' }}>
                        {formatDistance(route.distanceMeters)} · {formatDuration(route.durationSeconds)}
                      </div>
                      {isActive ? (
                        <div style={{ color: '#34d399', fontSize: '10px', fontWeight: 700, marginTop: '3px' }}>
                          ● Active Selected Route
                        </div>
                      ) : (
                        <div style={{ color: '#93c5fd', fontSize: '9px', marginTop: '3px' }}>
                          Click to select this alternative
                        </div>
                      )}
                    </Tooltip>
                  </Polyline>
                </Fragment>
              );
            })}

          {/* Interactive Click Point Popup */}
          {clickedLocation && (
            <Popup
              position={[clickedLocation.lat, clickedLocation.lng]}
              eventHandlers={{ remove: () => setClickedLocation(null) }}
            >
              <div className="map-click-popup">
                <h4>{clickedLocation.loading ? 'Resolving location…' : clickedLocation.candidate?.displayName}</h4>
                <p>
                  Coordinates: {clickedLocation.lat.toFixed(4)}, {clickedLocation.lng.toFixed(4)}
                </p>
                <div className="map-click-actions">
                  <button
                    type="button"
                    className="primary-button compact"
                    disabled={clickedLocation.loading || !clickedLocation.candidate}
                    onClick={() => {
                      if (clickedLocation.candidate) {
                        onSelectLocation('origin', clickedLocation.candidate);
                        setClickedLocation(null);
                      }
                    }}
                  >
                    Set as Start
                  </button>
                  <button
                    type="button"
                    className="secondary-button compact"
                    disabled={clickedLocation.loading || !clickedLocation.candidate}
                    onClick={() => {
                      if (clickedLocation.candidate) {
                        onSelectLocation('destination', clickedLocation.candidate);
                        setClickedLocation(null);
                      }
                    }}
                  >
                    Set as End
                  </button>
                </div>
              </div>
            </Popup>
          )}

          {/* Pulse Custom Markers for Origin and Destination */}
          {snappedWaypoints.length >= 2 && (
            <>
              <Marker
                position={[snappedWaypoints[0][1], snappedWaypoints[0][0]]}
                icon={createPulseIcon('origin')}
              >
                <Popup>
                  <strong>Starting Origin</strong>
                  <br />
                  {originSelection?.displayName ?? 'Origin'}
                </Popup>
              </Marker>
              <Marker
                position={[snappedWaypoints[snappedWaypoints.length - 1][1], snappedWaypoints[snappedWaypoints.length - 1][0]]}
                icon={createPulseIcon('destination')}
              >
                <Popup>
                  <strong>Final Destination</strong>
                  <br />
                  {destinationSelection?.displayName ?? 'Destination'}
                </Popup>
              </Marker>
            </>
          )}

          {/* Hazard Pins with Custom Badges */}
          {showHazards &&
            showGuwahatiHazards &&
            activeRoute &&
            hazards.map((hazard) => {
              const isSelected = selectedHazardId === hazard.id;
              return (
                <Marker
                  key={hazard.id}
                  position={demoPointToLatLng(hazard.point)}
                  icon={createHazardIcon(hazard.severity, isSelected)}
                  eventHandlers={{ click: () => onSelectHazard(hazard.id) }}
                >
                  <Popup>
                    <div style={{ padding: '2px' }}>
                      <strong style={{ fontSize: '11px', display: 'block', color: 'var(--ink)' }}>
                        {hazard.title}
                      </strong>
                      <span style={{ fontSize: '10px', color: 'var(--muted)', display: 'block', marginTop: '2px' }}>
                        {hazard.location}
                      </span>
                      <span style={{ fontSize: '9px', fontWeight: 700, color: hazard.severity === 'High' ? 'var(--red)' : 'var(--amber)', display: 'block', marginTop: '2px' }}>
                        Severity: {hazard.severity} · {hazard.verification}
                      </span>
                      <button
                        type="button"
                        className="map-popup-button"
                        onClick={() => onSelectHazard(hazard.id)}
                      >
                        Inspect evidence
                      </button>
                    </div>
                  </Popup>
                </Marker>
              );
            })}
        </MapContainer>

        {/* Legend */}
        <div className="map-legend">
          <div>
            <span className="legend-line green-line" /> Active Route
          </div>
          <div>
            <span className="legend-line amber-line" /> Alternative
          </div>
          <div>
            <span className="legend-dot red-dot" /> Endpoints (A / B)
          </div>
          <div>
            <span className="legend-dot" style={{ background: '#d97706' }} /> Reported Hazard
          </div>
          {showCorridor && (
            <div style={{ fontSize: '9px', color: 'var(--green-deep)', fontWeight: 600 }}>
              Halo: 50m Safety Corridor
            </div>
          )}
        </div>

        <div className="map-attribution">
          Roads by OSRM · Click anywhere on the map to set Start or Destination
        </div>
      </div>

      <div className="map-bottom-bar">
        <div className="map-bottom-status">
          <span className="status-icon">
            <Navigation size={15} />
          </span>
          <span>
            <strong>Routing Engine</strong>
            <small>
              {routes.length > 0
                ? `OSRM driving · ${routes.length} route alternative${routes.length === 1 ? '' : 's'} · click map to re-route`
                : 'Choose or click places on the map to generate road routes'}
            </small>
          </span>
        </div>
        <div className="map-bottom-live">
          <LiveConditions point={snappedWaypoints[0] ?? null} />
          <span className="map-source-disclaimer">Click map to set locations</span>
        </div>
      </div>
    </section>
  );
}
