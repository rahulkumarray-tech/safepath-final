import { useEffect, useRef, useState } from 'react';
import {
  AlertTriangle,
  ArrowDownUp,
  ArrowRight,
  ArrowUpRight,
  Bell,
  Check,
  CircleDot,
  Clock3,
  Compass,
  FileText,
  Flag,
  Info,
  LocateFixed,
  MapPin,
  Menu,
  Navigation,
  Navigation2,
  Plus,
  RefreshCw,
  Route as RouteIcon,
  Shield,
  Sparkles,
  X,
} from 'lucide-react';
import type { LatLngExpression } from 'leaflet';
import { fetchRoadRoutes, geocodeAddress, reverseGeocodeLatLng, GUWAHATI_PRESETS } from './services/routing';
import type { LocationCandidate } from './services/routing';
import ExternalIncidents from './components/ExternalIncidents';
import { assessRoutes, adaptDemoHazards, getHazardsAlongRoute } from './services/riskAssessment';
import { initialDemoHazards } from './data/demoHazards';
import type { Hazard, HazardType, MapPoint } from './types/hazard';
import type { Route } from './types/route';
import { formatDistance, formatDuration } from './utils/format';
import { compareRoutes } from './riskEngine';
import type { RoutePreference, RouteRiskResult } from './riskEngine';
import 'leaflet/dist/leaflet.css';
import './styles.css';
import { RiskFactorBreakdown } from './components/RiskFactorBreakdown';
import { DataQualityPanel } from './components/DataQualityPanel';
import { NearbyHazardContributions } from './components/NearbyHazardContributions';
import { RouteRankingExplanation } from './components/RouteRankingExplanation';
import { NavigationMode } from './components/NavigationMode';
import { InteractiveMap } from './components/InteractiveMap';
import { LiveReportsPanel } from './components/LiveReportsPanel';
import { defaultGuwahatiRoutes } from './data/defaultRoute';

type Tab = 'planner' | 'reports' | 'methodology';

const defaultOriginCandidate: LocationCandidate = {
  id: '242134214',
  displayName: 'Guwahati Railway Station, Ambari, Guwahati',
  longitude: 91.7507423,
  latitude: 26.1821371,
};

const defaultDestinationCandidate: LocationCandidate = {
  id: '240610846',
  displayName: 'Assam Down Town University, Panikhaiti, Guwahati',
  longitude: 91.8622787,
  latitude: 26.2017061,
};

const initialRoadRoutes: Route[] = defaultGuwahatiRoutes.routes.map((route, index) => ({
  id: route.id,
  name: index === 0 ? 'Direct road corridor' : 'Alternative via Zoo Road',
  shortName: index === 0 ? 'Direct corridor' : 'Zoo Road Alt',
  subtitle: index === 0 ? 'OSRM driving · via Panikhaiti road' : 'OSRM driving · via Zoo Road / GS corridor',
  coordinates: route.coordinates as [number, number][],
  distanceMeters: route.distanceMeters,
  durationSeconds: route.durationSeconds,
  color: ['#15803d', '#d97706', '#2563eb'][index % 3],
}));

const guwahatiCenter: LatLngExpression = [26.182, 91.785];

function App() {
  const [activeTab, setActiveTab] = useState<Tab>('planner');
  const [originText, setOriginText] = useState(defaultOriginCandidate.displayName);
  const [destinationText, setDestinationText] = useState(defaultDestinationCandidate.displayName);
  const [originSelection, setOriginSelection] = useState<LocationCandidate | null>(defaultOriginCandidate);
  const [destinationSelection, setDestinationSelection] = useState<LocationCandidate | null>(defaultDestinationCandidate);
  const [originResults, setOriginResults] = useState<LocationCandidate[]>([]);
  const [destinationResults, setDestinationResults] = useState<LocationCandidate[]>([]);
  const [searchingLocation, setSearchingLocation] = useState<'origin' | 'destination' | null>(null);
  const [routes, setRoutes] = useState<Route[]>(initialRoadRoutes);
  const [snappedWaypoints, setSnappedWaypoints] = useState<[number, number][]>(defaultGuwahatiRoutes.waypoints as [number, number][]);
  const [activeRouteId, setActiveRouteId] = useState<string | null>(initialRoadRoutes[0]?.id ?? null);
  const [routePreference, setRoutePreference] = useState<RoutePreference>('balanced');
  const [routeState, setRouteState] = useState<'idle' | 'loading' | 'ready' | 'error'>('ready');
  const [routeError, setRouteError] = useState('');
  const [inputError, setInputError] = useState('');
  const [hazards, setHazards] = useState(initialDemoHazards);
  const [selectedHazardId, setSelectedHazardId] = useState<string | null>(null);
  const [showReport, setShowReport] = useState(false);
  const [showNavigation, setShowNavigation] = useState(false);
  const [toast, setToast] = useState('');
  const [mobileMenu, setMobileMenu] = useState(false);
  const [gpsPosition, setGpsPosition] = useState<{ latitude: number; longitude: number; accuracy: number } | null>(null);
  const [isGpsTracking, setIsGpsTracking] = useState(false);
  const [gpsError, setGpsError] = useState('');

  const gpsWatchId = useRef<number | null>(null);
  const originSearchController = useRef<AbortController | null>(null);
  const destinationSearchController = useRef<AbortController | null>(null);
  const routeController = useRef<AbortController | null>(null);
  const searchDebounceTimer = useRef<number | null>(null);
  const toastTimer = useRef<number | null>(null);

  const activeRoute = routes.find((route) => route.id === activeRouteId) ?? null;
  const showGuwahatiHazards = snappedWaypoints.length === 2
    && snappedWaypoints.every(([longitude, latitude]) => latitude >= 25.9 && latitude <= 26.4 && longitude >= 91.5 && longitude <= 92.2);
  const routeDemoHazards = getHazardsAlongRoute(activeRoute, hazards, showGuwahatiHazards);
  const selectedHazard = routeDemoHazards.find((hazard) => hazard.id === selectedHazardId) ?? null;
  const engineHazards = adaptDemoHazards(hazards, showGuwahatiHazards);
  const routeRiskResults = assessRoutes(routes, engineHazards);
  const routeComparison = compareRoutes(routeRiskResults, routePreference);
  const activeRisk = routeRiskResults.find((result) => result.routeId === activeRouteId) ?? null;

  const notify = (message: string) => {
    if (toastTimer.current) window.clearTimeout(toastTimer.current);
    setToast(message);
    toastTimer.current = window.setTimeout(() => {
      setToast('');
      toastTimer.current = null;
    }, 3000);
  };

  useEffect(() => () => {
    if (toastTimer.current) window.clearTimeout(toastTimer.current);
    if (searchDebounceTimer.current) window.clearTimeout(searchDebounceTimer.current);
    if (gpsWatchId.current !== null && navigator.geolocation) navigator.geolocation.clearWatch(gpsWatchId.current);
  }, []);

  const toggleGpsTracking = () => {
    if (isGpsTracking) {
      if (gpsWatchId.current !== null) navigator.geolocation.clearWatch(gpsWatchId.current);
      gpsWatchId.current = null;
      setIsGpsTracking(false);
      notify('Live GPS tracking stopped');
      return;
    }
    if (!navigator.geolocation) {
      setGpsError('This browser does not support GPS location.');
      return;
    }
    setGpsError('');
    gpsWatchId.current = navigator.geolocation.watchPosition(
      (position) => {
        setGpsPosition({ latitude: position.coords.latitude, longitude: position.coords.longitude, accuracy: position.coords.accuracy });
        setGpsError('');
        setIsGpsTracking(true);
      },
      (error) => {
        const message = error.code === error.PERMISSION_DENIED
          ? 'Location permission denied. Allow location access in your browser.'
          : error.code === error.TIMEOUT
            ? 'GPS request timed out. Try again in an open area.'
            : 'GPS location is unavailable. Check device location settings.';
        setGpsError(message);
        setIsGpsTracking(false);
        if (gpsWatchId.current !== null) navigator.geolocation.clearWatch(gpsWatchId.current);
        gpsWatchId.current = null;
      },
      { enableHighAccuracy: true, maximumAge: 3000, timeout: 15000 }
    );
    setIsGpsTracking(true);
    notify('Live GPS tracking started');
  };

  const clearRoutes = () => {
    routeController.current?.abort();
    setRoutes([]);
    setSnappedWaypoints([]);
    setActiveRouteId(null);
    setRouteState('idle');
    setRouteError('');
  };

  const searchLocationWith = async (field: 'origin' | 'destination', queryText: string) => {
    if (!queryText.trim()) return;
    const controllerRef = field === 'origin' ? originSearchController : destinationSearchController;
    const setResults = field === 'origin' ? setOriginResults : setDestinationResults;
    controllerRef.current?.abort();
    const controller = new AbortController();
    controllerRef.current = controller;
    setSearchingLocation(field);
    setInputError('');
    setRouteError('');
    try {
      const results = await geocodeAddress(queryText, controller.signal);
      setResults(results);
    } catch (error) {
      if (error instanceof Error && error.name !== 'AbortError') {
        setResults([]);
        setInputError(error.message || `Unable to search ${field} locations. Please try again.`);
      }
    } finally {
      if (controllerRef.current === controller) setSearchingLocation(null);
    }
  };

  const searchLocation = async (field: 'origin' | 'destination') => {
    const query = field === 'origin' ? originText : destinationText;
    if (!query.trim()) {
      setInputError(`Enter a ${field === 'origin' ? 'starting' : 'destination'} location first.`);
      return;
    }
    await searchLocationWith(field, query);
  };

  const computeRoutes = async (overrideOrigin?: LocationCandidate, overrideDest?: LocationCandidate) => {
    const orig = overrideOrigin ?? originSelection;
    const dest = overrideDest ?? destinationSelection;

    if (!orig || !dest) {
      setInputError('Select both a starting location and destination before routing.');
      if (!originSelection) setRouteError('Search for an origin and choose a matching place from the suggestions.');
      else if (!destinationSelection) setRouteError('Search for a destination and choose a matching place from the suggestions.');
      return;
    }

    routeController.current?.abort();
    const controller = new AbortController();
    routeController.current = controller;
    setRouteError('');
    setInputError('');
    setRouteState('loading');

    try {
      const result = await fetchRoadRoutes(orig, dest, controller.signal);
      const candidateRoutes = result.routes;
      const receivedRoutes = candidateRoutes.map((route, index): Route => {
        const isPrimary = index === 0;
        return {
          id: route.id,
          name: isPrimary ? 'Fastest road route' : `Alternative ${index + 1}`,
          shortName: isPrimary ? 'Fastest' : `Alt ${index + 1}`,
          subtitle: isPrimary ? 'OSRM driving · fastest returned road route' : 'OSRM driving · additional road route',
          coordinates: route.coordinates as [number, number][],
          distanceMeters: route.distanceMeters,
          durationSeconds: route.durationSeconds,
          color: ['#15803d', '#d97706', '#2563eb'][index % 3],
        };
      });
      const localCoverage = result.waypoints.length === 2
        && result.waypoints.every(([longitude, latitude]) => latitude >= 25.9 && latitude <= 26.4 && longitude >= 91.5 && longitude <= 92.2);
      const initialAssessments = assessRoutes(receivedRoutes, adaptDemoHazards(hazards, localCoverage));
      const recommendation = compareRoutes(initialAssessments, routePreference).recommendedRouteId;
      setRoutes(receivedRoutes);
      setSnappedWaypoints(result.waypoints);
      setActiveRouteId(recommendation ?? receivedRoutes[0].id);
      setRouteState('ready');
    } catch (error) {
      if (error instanceof Error && error.name !== 'AbortError') {
        setRouteError(error.message || 'Unable to calculate this route. Check your connection and try again.');
        setRouteState('error');
      }
    } finally {
      if (routeController.current === controller) routeController.current = null;
    }
  };

  const selectLocation = (field: 'origin' | 'destination', location: LocationCandidate) => {
    let nextOrigin = originSelection;
    let nextDest = destinationSelection;
    if (field === 'origin') {
      nextOrigin = location;
      setOriginSelection(location);
      setOriginText(location.displayName);
      setOriginResults([]);
    } else {
      nextDest = location;
      setDestinationSelection(location);
      setDestinationText(location.displayName);
      setDestinationResults([]);
    }
    setInputError('');
    if (nextOrigin && nextDest) {
      void computeRoutes(nextOrigin, nextDest);
    }
  };

  const updateLocationText = (field: 'origin' | 'destination', value: string) => {
    if (field === 'origin') {
      originSearchController.current?.abort();
      setOriginText(value);
      setOriginSelection(null);
    } else {
      destinationSearchController.current?.abort();
      setDestinationText(value);
      setDestinationSelection(null);
    }
    setInputError('');

    if (searchDebounceTimer.current) {
      window.clearTimeout(searchDebounceTimer.current);
    }
    if (value.trim().length >= 2) {
      searchDebounceTimer.current = window.setTimeout(() => {
        void searchLocationWith(field, value);
      }, 300);
    } else {
      if (field === 'origin') setOriginResults([]);
      else setDestinationResults([]);
    }
  };

  const handleUseCurrentLocation = () => {
    if (!navigator.geolocation) {
      setInputError('Geolocation is not supported by your browser.');
      return;
    }
    setSearchingLocation('origin');
    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        setSearchingLocation(null);
        try {
          const candidate = await reverseGeocodeLatLng(pos.coords.latitude, pos.coords.longitude);
          selectLocation('origin', candidate);
          notify('Origin set to current GPS location');
        } catch {
          selectLocation('origin', {
            id: `gps-${Date.now()}`,
            displayName: `My GPS Location (${pos.coords.latitude.toFixed(4)}, ${pos.coords.longitude.toFixed(4)})`,
            longitude: pos.coords.longitude,
            latitude: pos.coords.latitude,
          });
          notify('Origin set to GPS coordinates');
        }
      },
      () => {
        setSearchingLocation(null);
        setInputError('Could not get GPS position. Check browser location permissions.');
      },
      { timeout: 8000 }
    );
  };

  const swapRouteInputs = () => {
    originSearchController.current?.abort();
    destinationSearchController.current?.abort();
    setOriginText(destinationText);
    setDestinationText(originText);
    setOriginSelection(destinationSelection);
    setDestinationSelection(originSelection);
    setOriginResults([]);
    setDestinationResults([]);
    setSearchingLocation(null);
    setInputError('');
    if (destinationSelection && originSelection) {
      void computeRoutes(destinationSelection, originSelection);
    }
  };

  const submitHazard = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const type = String(form.get('type') || 'Road obstruction') as HazardType;
    const locationKey = String(form.get('location') || 'AT Road');
    const locationMap: Record<string, { label: string; point: MapPoint }> = {
      'AT Road': { label: 'AT Road corridor', point: { x: 15.7, y: 13.3 } },
      'GS Road': { label: 'GS Road / Zoo Tiniali', point: { x: 52.5, y: 30.7 } },
      'Panbazar': { label: 'Panbazar approach', point: { x: 13.5, y: 17.3 } },
      'Bhangagarh': { label: 'Guwahati-Shillong Road, Bhangagarh', point: { x: 43.8, y: 15.1 } },
      'Christian Basti': { label: 'GS Road, Christian Basti', point: { x: 62.8, y: 16.4 } },
      'Anil Nagar': { label: 'Anil Nagar connector road', point: { x: 36.9, y: 14.5 } },
      'Six Mile': { label: 'GS Road, Six Mile junction', point: { x: 66.2, y: 15.7 } },
    };
    const selectedLocation = locationMap[locationKey] ?? locationMap['AT Road'];
    const severity = String(form.get('severity') || 'Medium') as Hazard['severity'];
    const description = String(form.get('description') || 'User-submitted field report.');
    const newHazard: Hazard = {
      id: `report-${Date.now()}`,
      type,
      title: `${type} reported`,
      location: selectedLocation.label,
      point: selectedLocation.point,
      severity,
      verification: 'Needs review',
      freshness: 'just now',
      source: 'Community report · submitted in demo',
      summary: description,
      reportedAtMs: Date.now(),
    };
    setHazards((current) => [...current, newHazard]);
    setSelectedHazardId(newHazard.id);
    setShowReport(false);
    notify('Demo report added. Its approximate map position is included in this route estimate.');
    event.currentTarget.reset();
  };

  return (
    <div className="app-shell">
      <header className="topbar">
        <div className="brand-lockup">
          <div className="brand-mark"><Shield size={19} strokeWidth={2.4} /></div>
          <div>
            <div className="brand-name">Safe Route</div>
            <div className="brand-subtitle">Guwahati civic pilot</div>
          </div>
        </div>
        <nav className={`topnav ${mobileMenu ? 'is-open' : ''}`}>
          <button className={activeTab === 'planner' ? 'nav-link active' : 'nav-link'} onClick={() => { setActiveTab('planner'); setMobileMenu(false); }}><RouteIcon size={15} /> Route planner</button>
          <button className={activeTab === 'reports' ? 'nav-link active' : 'nav-link'} onClick={() => { setActiveTab('reports'); setMobileMenu(false); }}><Bell size={15} /> Recent reports <span className="nav-count">{routeDemoHazards.length}</span></button>
          <button className={activeTab === 'methodology' ? 'nav-link active' : 'nav-link'} onClick={() => { setActiveTab('methodology'); setMobileMenu(false); }}><FileText size={15} /> About & methodology</button>
        </nav>
        <div className="topbar-actions">
          <div className="sync-badge"><span className="live-dot" /> Live Demo · Guwahati</div>
          <button className="report-top-button" onClick={() => setShowReport(true)}><AlertTriangle size={15} /> Report hazard</button>
          <button className="mobile-menu-button" onClick={() => setMobileMenu((value) => !value)} aria-label="Toggle menu"><Menu size={18} /></button>
          <div className="profile-dot">SR</div>
        </div>
      </header>

      <main className="page-content">
        <section className="demo-banner">
          <div className="banner-copy"><Info size={16} /><span><strong>Prototype risk estimate:</strong> demo hazard pins use approximate map positions; this score is not a probability or a safety guarantee.</span></div>
          <div className="banner-meta">Routing <strong>OSRM driving</strong></div>
        </section>

        {activeTab === 'planner' && (
          <div className="workspace">
            <aside className="inspection-panel">
              <section className="panel-card route-search-card">
                <div className="panel-heading">
                  <div className="heading-with-icon"><span className="icon-box green"><Compass size={17} /></span><div><h1>Road route planner</h1><p>Type to search, pick preset destinations, or click on the map</p></div></div>
                  <span className="version-chip">OSRM</span>
                </div>

                <div className="route-fields">
                  <label className="route-field">
                    <CircleDot size={15} className="green-text" />
                    <span>
                      <small>Origin (Start)</small>
                      <input
                        aria-label="Origin location"
                        value={originText}
                        placeholder="Type starting place or use GPS..."
                        onChange={(event) => updateLocationText('origin', event.target.value)}
                        onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); void searchLocation('origin'); } }}
                      />
                    </span>
                    <div className="route-field-actions">
                      {originText && (
                        <button type="button" className="field-action-btn" title="Clear origin" onClick={() => updateLocationText('origin', '')}>
                          <X size={12} />
                        </button>
                      )}
                      <button
                        type="button"
                        className="field-action-btn"
                        title="Use my current GPS location"
                        onClick={handleUseCurrentLocation}
                        disabled={searchingLocation === 'origin'}
                      >
                        <LocateFixed size={14} />
                      </button>
                    </div>
                  </label>

                  <button className="swap-button" onClick={swapRouteInputs} aria-label="Swap origin and destination" title="Swap origin and destination">
                    <ArrowDownUp size={14} />
                  </button>

                  <label className="route-field">
                    <MapPin size={16} className="red-text" />
                    <span>
                      <small>Destination (End)</small>
                      <input
                        aria-label="Destination location"
                        value={destinationText}
                        placeholder="Type destination or pick below..."
                        onChange={(event) => updateLocationText('destination', event.target.value)}
                        onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); void searchLocation('destination'); } }}
                      />
                    </span>
                    <div className="route-field-actions">
                      {destinationText && (
                        <button type="button" className="field-action-btn" title="Clear destination" onClick={() => updateLocationText('destination', '')}>
                          <X size={12} />
                        </button>
                      )}
                      <button
                        type="button"
                        className="field-action-btn"
                        title="Search destination"
                        onClick={() => void searchLocation('destination')}
                        disabled={searchingLocation === 'destination'}
                      >
                        <Navigation size={14} />
                      </button>
                    </div>
                  </label>
                </div>

                {/* Instant Suggestions Dropdown */}
                {(searchingLocation || originResults.length > 0 || destinationResults.length > 0) && (
                  <div className="location-suggestions" aria-live="polite">
                    {searchingLocation && <div className="location-search-status">Searching {searchingLocation} locations…</div>}
                    {originResults.length > 0 && (
                      <div>
                        <div className="eyebrow">Select Origin Result</div>
                        {originResults.map((location) => {
                          const parts = location.displayName.split(',');
                          return (
                            <button type="button" className="location-suggestion" key={location.id} onClick={() => selectLocation('origin', location)}>
                              <strong style={{ display: 'block', color: 'var(--ink)' }}>{parts[0]}</strong>
                              <span style={{ fontSize: '9px', color: 'var(--muted)' }}>{parts.slice(1, 3).join(',')}</span>
                            </button>
                          );
                        })}
                      </div>
                    )}
                    {destinationResults.length > 0 && (
                      <div>
                        <div className="eyebrow">Select Destination Result</div>
                        {destinationResults.map((location) => {
                          const parts = location.displayName.split(',');
                          return (
                            <button type="button" className="location-suggestion" key={location.id} onClick={() => selectLocation('destination', location)}>
                              <strong style={{ display: 'block', color: 'var(--ink)' }}>{parts[0]}</strong>
                              <span style={{ fontSize: '9px', color: 'var(--muted)' }}>{parts.slice(1, 3).join(',')}</span>
                            </button>
                          );
                        })}
                      </div>
                    )}
                  </div>
                )}

                {/* 1-Click Quick Destinations Preset Chips */}
                <div className="preset-section">
                  <div className="preset-heading">
                    <span>Quick Destinations (Guwahati)</span>
                    <span style={{ color: 'var(--green-deep)', fontSize: '9px' }}>1-click plan</span>
                  </div>
                  <div className="preset-chips">
                    {GUWAHATI_PRESETS.map((preset) => (
                      <button
                        key={preset.id}
                        type="button"
                        className="preset-chip"
                        onClick={() => selectLocation('destination', preset)}
                        title={`Route to ${preset.displayName}`}
                      >
                        <MapPin size={10} />
                        <span>{preset.displayName.split(',')[0]}</span>
                      </button>
                    ))}
                  </div>
                </div>

                {originSelection && destinationSelection && (
                  <div className="selected-location-note" style={{ marginTop: '8px' }}>
                    <Check size={13} /> Selected route endpoints confirmed
                  </div>
                )}

                {inputError && <div className="routing-message error-message" role="alert">{inputError}</div>}

                <div className="action-row">
                  <button className="primary-button" onClick={() => void computeRoutes()} disabled={routeState === 'loading' || searchingLocation !== null}>
                    {routeState === 'loading' ? <><RefreshCw size={16} className="spin-icon" /> Finding road routes…</> : <><Sparkles size={16} /> Re-calculate routes</>}</button>
                  <button className="icon-button" onClick={swapRouteInputs} title="Swap locations" aria-label="Swap locations"><ArrowDownUp size={16} /></button>
                </div>
              </section>

              <section className="routes-section">
                <div className="section-heading">
                  <div>
                    <div className="heading-with-icon"><RouteIcon size={17} /><h2>Road routes <span className="muted">({routes.length})</span></h2></div>
                    <p>Ranked by travel time and estimated reported hazards</p>
                  </div>
                  <span className="freshness"><span className="live-dot" /> {routeState === 'ready' ? 'scored' : 'OSRM'}</span>
                </div>

                {routes.length > 0 && (
                  <div className="preference-control" role="group" aria-label="Route ranking preference">
                    <span>Preference</span>
                    {(['quickest', 'balanced', 'lower-risk'] as const).map((preference) => (
                      <button
                        key={preference}
                        type="button"
                        className={routePreference === preference ? 'active' : ''}
                        aria-pressed={routePreference === preference}
                        onClick={() => {
                          setRoutePreference(preference);
                          const recommended = compareRoutes(routeRiskResults, preference).recommendedRouteId;
                          if (recommended) setActiveRouteId(recommended);
                        }}
                      >
                        {preference === 'lower-risk' ? 'Lower risk' : preference[0]?.toUpperCase() + preference.slice(1)}
                      </button>
                    ))}
                  </div>
                )}

                {routeState === 'loading' && <div className="routing-message" role="status">Requesting road routes from OSRM…</div>}
                {routeState === 'error' && <div className="routing-message error-message" role="alert">{routeError}</div>}
                {routeState === 'idle' && <div className="routing-message">Search for both locations or click preset destinations above.</div>}

                <div className="route-card-list">
                  {routeComparison.ranked.map((rankedRoute) => {
                    const route = routes.find((candidate) => candidate.id === rankedRoute.routeId);
                    if (!route) return null;
                    const risk = rankedRoute.result;
                    const isActive = route.id === activeRouteId;
                    const saferAlternative = routeComparison.ranked
                      .filter((candidate) => candidate.routeId !== rankedRoute.routeId && !candidate.blocked && candidate.riskScore < rankedRoute.riskScore)
                      .sort((a, b) => a.riskScore - b.riskScore || (a.travelTimeS ?? Number.POSITIVE_INFINITY) - (b.travelTimeS ?? Number.POSITIVE_INFINITY))[0] ?? null;
                    const saferRoute = saferAlternative ? routes.find((candidate) => candidate.id === saferAlternative.routeId) : null;
                    const avoidedHazards = saferAlternative
                      ? risk.nearbyHazards.filter((hazard) => !saferAlternative.result.nearbyHazards.some((alternativeHazard) => alternativeHazard.hazardId === hazard.hazardId))
                      : [];
                    return (
                      <div
                        key={route.id}
                        role="button"
                        tabIndex={0}
                        className={`route-card ${isActive ? 'selected' : ''}`}
                        onClick={() => { setActiveRouteId(route.id); setSelectedHazardId(null); }}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' || e.key === ' ') {
                            e.preventDefault();
                            setActiveRouteId(route.id);
                            setSelectedHazardId(null);
                          }
                        }}
                      >
                        <div className="route-card-top">
                          <div>
                            <div className="route-title-row">
                              <span className="route-index">0{rankedRoute.rank}</span>
                              <h3>{route.name}</h3>
                              {rankedRoute.rank === 1 && routeComparison.recommendedRouteId && <span className="recommended-chip">Best match</span>}
                              {rankedRoute.blocked && <span className="risk-chip danger">Reported closure</span>}
                            </div>
                            <p>{route.subtitle}</p>
                          </div>
                          <ArrowUpRight size={17} className="muted" />
                        </div>
                        <div className="metric-grid">
                          <div><span className="metric-label">Distance</span><strong>{formatDistance(route.distanceMeters)}</strong></div>
                          <div><span className="metric-label">Estimated time</span><strong>{formatDuration(route.durationSeconds)}</strong></div>
                          <div><span className="metric-label">Road type</span><strong>Driving</strong></div>
                        </div>
                        <div className="route-risk-row">
                          <span className={`risk-chip ${risk.category === 'High' || risk.category === 'Very High' ? 'danger' : risk.coverage.level !== 'adequate' ? 'caution' : 'good'}`}>{risk.displayLabel}</span>
                          <strong>{risk.assessment === 'assessed' ? `${risk.score}/100` : '—'}</strong>
                        </div>
                        {rankedRoute.criticalWarnings.length > 0 && <div className="route-warning-preview"><AlertTriangle size={13} /> {rankedRoute.criticalWarnings[0]?.message}</div>}
                        <div className={`safer-alternative ${saferRoute ? 'available' : ''}`}>
                          {saferRoute && saferAlternative ? (
                            <>
                              <div className="safer-alternative-title">Lower estimated hazard risk: <strong>{saferRoute.name}</strong></div>
                              <ul>
                                <li>Reported-hazard score is {saferAlternative.riskScore}/100 vs {rankedRoute.riskScore}/100 on this route.</li>
                                {avoidedHazards.length > 0 && <li>Its route corridor avoids {avoidedHazards.slice(0, 2).map((hazard) => hazard.type.replace(/_/g, ' ')).join(' and ')} report{avoidedHazards.length === 1 ? '' : 's'} seen on this route.</li>}
                                {saferAlternative.travelTimeS !== null && rankedRoute.travelTimeS !== null && Math.abs(saferAlternative.travelTimeS - rankedRoute.travelTimeS) >= 60 && <li>Estimated travel time is {formatDuration(Math.abs(saferAlternative.travelTimeS - rankedRoute.travelTimeS))} {saferAlternative.travelTimeS > rankedRoute.travelTimeS ? 'longer' : 'shorter'}.</li>}
                                {saferAlternative.uncertain && <li>Data coverage is limited; a lower score is not proof that the route is safer.</li>}
                              </ul>
                              <button type="button" onClick={(event) => { event.stopPropagation(); setActiveRouteId(saferRoute.id); setSelectedHazardId(null); }}>View this alternative</button>
                            </>
                          ) : (
                            <div className="safer-alternative-title">{routes.length > 1 ? 'No returned alternative has a lower estimated hazard score.' : 'OSRM returned no alternate route to compare.'}</div>
                          )}
                        </div>
                        <RouteRankingExplanation explanations={rankedRoute.explanation} rank={rankedRoute.rank} />
                        {isActive && <div className="selected-line"><Check size={13} /> Selected route · highlighted on map</div>}
                      </div>
                    );
                  })}
                  {routes.length > 0 && <div className="comparison-note">{routeComparison.notes.join(' ')}</div>}
                </div>
              </section>

              <LiveReportsPanel />

              {/* Selected Route Inspection Detail */}
              <section className="panel-card active-detail-card">
                {activeRoute ? (
                  <>
                    <div className="section-heading">
                      <div><div className="eyebrow">Selected OSRM route</div><h2>{activeRoute.name}</h2></div>
                      <span className="status-label good">Driving</span>
                    </div>
                    <div className="detail-summary">
                      <div><span className="metric-label">Estimated time</span><strong>{formatDuration(activeRoute.durationSeconds)}</strong><small>not live traffic</small></div>
                      <div><span className="metric-label">Distance</span><strong>{formatDistance(activeRoute.distanceMeters)}</strong><small>OSRM road geometry</small></div>
                      <div><span className="metric-label">Alternatives</span><strong>{routes.length}</strong><small>returned by OSRM</small></div>
                    </div>

                    <div style={{ margin: '8px 0 12px' }}>
                      <button type="button" className="primary-button" style={{ width: '100%' }} onClick={() => setShowNavigation(true)}>
                        <Navigation2 size={15} /> Start demo turn guidance
                      </button>
                    </div>

                    {activeRisk && (
                      <section className="risk-detail" aria-label="Selected route hazard assessment">
                        <div className="risk-detail-heading">
                          <div><div className="eyebrow">Estimated reported-hazard risk</div><h3>{activeRisk.displayLabel}</h3></div>
                          <span className={`risk-score ${activeRisk.category === 'High' || activeRisk.category === 'Very High' ? 'danger' : ''}`}>
                            {activeRisk.assessment === 'assessed' ? `${activeRisk.score}/100` : 'Unknown'}
                          </span>
                        </div>
                        <div className="coverage-note">
                          <Info size={14} /><span>Data coverage: <strong>{activeRisk.coverage.level}</strong>. {activeRisk.coverage.note}</span>
                        </div>
                        {activeRisk.criticalWarnings.map((warning) => (
                          <div className="critical-warning" key={warning.hazardId}><AlertTriangle size={15} /><span>{warning.message}</span></div>
                        ))}
                        {activeRisk.blocked.isBlocked && (
                          <div className="critical-warning blocked-note"><Shield size={15} /><span>{activeRisk.blocked.reason}</span></div>
                        )}
                        <ul className="risk-explanations">
                          {activeRisk.explanations.slice(0, 5).map((explanation, index) => (
                            <li key={`${index}-${explanation}`}>{explanation}</li>
                          ))}
                        </ul>
                        <p className="risk-disclaimer">Relative prototype score only—not a probability of harm. Demo pins are approximate and the absence of reports does not mean a road is safe.</p>

                        <RiskFactorBreakdown
                          factorSummary={activeRisk.factorSummary}
                          scoreComponents={activeRisk.scoreComponents}
                          totalScore={activeRisk.score}
                        />
                        <NearbyHazardContributions
                          nearbyHazards={activeRisk.nearbyHazards}
                          onSelectHazard={(id) => setSelectedHazardId(id)}
                        />
                        <DataQualityPanel dataQuality={activeRisk.dataQuality} />
                      </section>
                    )}
                  </>
                ) : (
                  <div className="empty-route-detail">
                    <div className="eyebrow">Route details</div>
                    <p>Select two locations and request road routes to see distance and estimated duration.</p>
                  </div>
                )}
              </section>
            </aside>

{/* Upgraded Interactive Leaflet Map with Basemaps, Corridor, and Click-to-Route */}
            <div style={{ position: 'relative' }}>
              <InteractiveMap
                guwahatiCenter={guwahatiCenter}
                routes={routes}
                activeRouteId={activeRouteId}
                onSelectRoute={(id) => { setActiveRouteId(id); setSelectedHazardId(null); }}
                snappedWaypoints={snappedWaypoints}
                originSelection={originSelection}
                destinationSelection={destinationSelection}
                onSelectLocation={selectLocation}
                hazards={routeDemoHazards}
                showGuwahatiHazards={showGuwahatiHazards}
                selectedHazardId={selectedHazardId}
                onSelectHazard={(id) => setSelectedHazardId(id)}
                gpsPosition={gpsPosition}
                isGpsTracking={isGpsTracking}
                gpsError={gpsError}
                onToggleGpsTracking={toggleGpsTracking}
              />

              {selectedHazard && <HazardDrawer hazard={selectedHazard} onClose={() => setSelectedHazardId(null)} />}
            </div>
          </div>
        )}

        {activeTab === 'reports' && <ReportsView hazards={routeDemoHazards} routeName={activeRoute?.name ?? null} onSelect={(id) => { setActiveTab('planner'); setSelectedHazardId(id); }} onReport={() => setShowReport(true)} />}
        {activeTab === 'methodology' && <MethodologyView />}
      </main>

      <footer className="site-footer">
        <div><Shield size={14} /> OSRM returns road-based driving routes. Estimated duration may not reflect live traffic and does not guarantee safety.</div>
        <div>Geocoding: Nominatim &middot; OpenStreetMap contributors &middot; Basemaps: CARTO &amp; Esri</div>
      </footer>

      {showNavigation && activeRoute && (
        <NavigationMode
          route={activeRoute}
          riskResult={activeRisk}
          originName={originText}
          destinationName={destinationText}
          onClose={() => setShowNavigation(false)}
        />
      )}
      {showReport && <ReportModal onClose={() => setShowReport(false)} onSubmit={submitHazard} />}
      {toast && <div className="toast"><Check size={15} /> {toast}</div>}
    </div>
  );
}

function HazardDrawer({ hazard, onClose }: { hazard: Hazard; onClose: () => void }) {
  return (
    <aside className="hazard-drawer">
      <div className="drawer-top">
        <div className="heading-with-icon">
          <span className={`icon-box ${hazard.severity === 'High' ? 'red' : 'amber'}`}><AlertTriangle size={17} /></span>
          <div><div className="eyebrow">Demo evidence detail</div><h2>{hazard.title}</h2></div>
        </div>
        <button className="icon-button" onClick={onClose}><X size={16} /></button>
      </div>
      <div className="drawer-status-row">
        <span className={`status-label ${hazard.verification === 'Verified' ? 'good' : hazard.verification === 'Reported' ? 'warn' : 'neutral'}`}>{hazard.verification}</span>
        <span className="freshness-label"><Clock3 size={13} /> {hazard.freshness}</span>
      </div>
      <div className="drawer-grid">
        <div><span className="metric-label">Location</span><strong>{hazard.location}</strong></div>
        <div><span className="metric-label">Severity</span><strong className={hazard.severity === 'High' ? 'red-text' : 'amber-text'}>{hazard.severity}</strong></div>
        <div><span className="metric-label">Source</span><strong>{hazard.source}</strong></div>
      </div>
      <p className="drawer-summary">{hazard.summary}</p>
      <div className="uncertainty-box">
        <Info size={15} /><span>Approximate demo pin for Guwahati; its translated map position is used for this prototype estimate, not authoritative hazard coordinates.</span>
      </div>
      <div className="button-row"><button className="text-button" onClick={onClose}>Close <X size={13} /></button></div>
    </aside>
  );
}

function ReportsView({ hazards, routeName, onSelect, onReport }: { hazards: Hazard[]; routeName: string | null; onSelect: (id: string) => void; onReport: () => void }) {
  return (
    <div className="content-page">
      <div className="content-page-header">
        <div>
          <div className="eyebrow">Evidence ledger · Guwahati pilot</div>
          <h1>Reports near the selected road</h1>
          <p>{routeName ? `Showing approximate demo reports within 50 m of ${routeName}. Other road reports stay hidden until you select a route that passes nearby.` : 'Select a Guwahati road route to see nearby demo reports. These sample reports are not real incidents.'}</p>
        </div>
        <button className="primary-button" onClick={onReport}><Plus size={16} /> Report a hazard</button>
      </div>
      <div className="report-summary-strip">
        <div><strong>{hazards.length}</strong><span>tracked items</span></div>
        <div><strong>{hazards.filter((h) => h.verification === 'Verified').length}</strong><span>verified signals</span></div>
        <div><strong>{hazards.filter((h) => h.verification === 'Needs review').length}</strong><span>needs review</span></div>
        <div><strong>Demo</strong><span>local session only</span></div>
      </div>
      <div className="report-list">
        {hazards.length === 0 ? (
          <div className="routing-message">No demo reports are near this selected road. Sample reports on other roads are hidden.</div>
        ) : hazards.map((hazard) => (
          <button className="report-row" key={hazard.id} onClick={() => onSelect(hazard.id)}>
            <div className={`report-icon ${hazard.severity.toLowerCase()}`}><AlertTriangle size={17} /></div>
            <div className="report-main">
              <div className="report-title-row">
                <h2>{hazard.title}</h2>
                <span className={`status-label ${hazard.verification === 'Verified' ? 'good' : hazard.verification === 'Reported' ? 'warn' : 'neutral'}`}>{hazard.verification}</span>
              </div>
              <p>{hazard.summary}</p>
              <div className="report-meta">
                <span><MapPin size={13} /> {hazard.location}</span>
                <span><Clock3 size={13} /> {hazard.freshness}</span>
                <span><FileText size={13} /> {hazard.source}</span>
              </div>
            </div>
            <div className="report-impact">
              <span className="metric-label">Evidence</span>
              <strong>{hazard.severity}</strong>
              <ArrowRight size={15} />
            </div>
          </button>
        ))}
      </div>
      <ExternalIncidents />
    </div>
  );
}

function MethodologyView() {
  return (
    <div className="content-page methodology-page">
      <div className="content-page-header">
        <div>
          <div className="eyebrow">Routing sources</div>
          <h1>About road routing</h1>
          <p>Locations are resolved with user-triggered OpenStreetMap Nominatim searches. Selected coordinates are sent to OSRM for driving routes.</p>
        </div>
        <div className="method-badge"><RouteIcon size={17} /> OSRM driving</div>
      </div>
      <div className="method-grid">
        <section className="method-card">
          <div className="method-card-heading">
            <span className="number-badge">01</span>
            <div><h2>Confirm locations</h2><p>Each entered address must be searched and a matching place selected before routing. Ambiguous text is never converted to an assumed coordinate.</p></div>
          </div>
        </section>
        <section className="method-card">
          <div className="method-card-heading">
            <span className="number-badge">02</span>
            <div><h2>Compare returned roads</h2><p>OSRM supplies route geometry, distance, and estimated duration. It may return fewer alternatives than requested.</p></div>
          </div>
        </section>
        <section className="method-card">
          <div className="method-card-heading">
            <span className="number-badge">03</span>
            <div><h2>Prototype hazard scoring</h2><p>Local demo markers are translated from approximate map positions and scored against OSRM geometry. There is no production hazard feed or authoritative hazard geocoding.</p></div>
          </div>
        </section>
        <section className="method-card wide limitation-card">
          <Info size={18} className="amber-text" />
          <div><h2>Important limitation</h2><p>Risk is a relative estimate, not a probability or safety guarantee. Demo positions and coverage are approximate; use a verified hazard service before relying on real-world recommendations. This prototype is not for emergency navigation.</p></div>
        </section>
      </div>
    </div>
  );
}

function ReportModal({ onClose, onSubmit }: { onClose: () => void; onSubmit: (event: React.FormEvent<HTMLFormElement>) => void }) {
  return (
    <div className="modal-scrim">
      <div className="modal-card">
        <div className="modal-heading">
          <div><div className="eyebrow">Community evidence · demo</div><h2>Report a hazard</h2><p>Local demo submissions affect prototype estimates using approximate map positions.</p></div>
          <button className="icon-button" onClick={onClose}><X size={17} /></button>
        </div>
        <form onSubmit={onSubmit}>
          <div className="form-grid">
            <label>Hazard type
              <select name="type" defaultValue="Road obstruction">
                <option>Road obstruction</option>
                <option>Road closure</option>
                <option>Low lighting</option>
                <option>Pothole</option>
                <option>Flooding</option>
                <option>Traffic incident</option>
              </select>
            </label>
            <label>Severity
              <select name="severity" defaultValue="Medium">
                <option>Low</option>
                <option>Medium</option>
                <option>High</option>
                <option>Severe</option>
              </select>
            </label>
            <label>Nearby corridor
              <select name="location" defaultValue="AT Road">
                <option>AT Road</option>
                <option>GS Road</option>
                <option>Panbazar</option>
                <option>Bhangagarh</option>
                <option>Christian Basti</option>
                <option>Anil Nagar</option>
                <option>Six Mile</option>
              </select>
            </label>
            <label className="full-width">What did you observe?
              <textarea name="description" required minLength={10} placeholder="Describe the issue briefly, including what a traveller should look out for." />
            </label>
          </div>
          <div className="form-note"><Info size={14} /> Do not include personal information. This prototype stores the report only in the current demo session.</div>
          <div className="modal-actions">
            <button type="button" className="secondary-button" onClick={onClose}>Cancel</button>
            <button type="submit" className="primary-button"><Flag size={15} /> Submit report</button>
          </div>
        </form>
      </div>
    </div>
  );
}

export default App;
