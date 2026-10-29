import { resolveLocationText } from './location.ts';
import { canonicalizeUrl, stableIncidentId } from './url.ts';
import { cleanText, isRecord, isWithinBox, parseCoordinates, parseIsoTimestamp } from './validation.ts';
import { INCIDENT_SCHEMA_VERSION } from './types.ts';
import type {
  IncidentCategory, IngestionConfig, LocationConfidence, NormalizeResult, QualityFlag, RawExternalReport,
} from './types.ts';

// Ordered: first match wins. Headline keywords are a heuristic, not evidence of an active hazard.
const CATEGORY_RULES: Array<[IncidentCategory, RegExp]> = [
  ['flooding', /\b(flood\w*|waterlog\w*|inundat\w*)\b/i],
  ['landslide', /\b(landslides?|landslips?|mudslides?)\b/i],
  ['road_obstruction', /\b(road (?:is |was )?(?:closed|blocked)|roads? (?:closure|blockade)|blockades?|blocked|diversions?|closed to traffic|sinkhole|potholes?|cave-?in)\b/i],
  ['public_disruption', /\b(bandh|hartal|protests?|strike|rally|dharna|agitation|procession)\b/i],
  ['traffic_incident', /\b(accident|collision|collide[sd]?|crash(?:es|ed)?|pile-?up|overturn\w*|traffic (?:jam|snarl|congestion)|gridlock|hit-and-run|mishap)\b/i],
];

export function classifyCategory(text: string): IncidentCategory | null {
  for (const [category, pattern] of CATEGORY_RULES) if (pattern.test(text)) return category;
  return null;
}

export function normalizeIncident(raw: RawExternalReport, retrievedAt: Date, config: IngestionConfig): NormalizeResult {
  if (!isRecord(raw) || typeof raw.sourceId !== 'string' || typeof raw.sourceName !== 'string' || raw.sourceId === '') {
    return { ok: false, reason: 'malformed_record', detail: 'Record has no usable source identity.' };
  }

  const sourceUrl = canonicalizeUrl(raw.url);
  if (!sourceUrl) return { ok: false, reason: 'invalid_url', detail: 'URL is missing or not a valid http(s) URL.' };

  const title = cleanText(raw.title, config.maxDescriptionLength);
  const explicitDescription = cleanText(raw.description, config.maxDescriptionLength);
  const description = explicitDescription || title;
  if (!description) return { ok: false, reason: 'missing_description', detail: 'No title or description text.' };

  const publishedAtDate = parseIsoTimestamp(raw.publishedAt);
  if (!publishedAtDate) return { ok: false, reason: 'invalid_timestamp', detail: 'Publication timestamp is missing or malformed.' };
  if (publishedAtDate.getTime() > retrievedAt.getTime() + config.futureToleranceMs) {
    return { ok: false, reason: 'future_timestamp', detail: 'Publication timestamp is in the future.' };
  }

  const searchText = `${title} ${explicitDescription}`;
  const category = classifyCategory(searchText);
  if (!category) return { ok: false, reason: 'not_road_incident', detail: 'No road-incident keyword found.' };

  const flags: QualityFlag[] = [];
  if (!explicitDescription) flags.push('headline_only');

  // Coordinates: only ever copied from the source, and only if valid and plausible for the region.
  let latitude: number | null = null;
  let longitude: number | null = null;
  const coords = parseCoordinates(raw.latitude, raw.longitude);
  if (coords.ok) {
    if (isWithinBox(coords.latitude, coords.longitude, config.regionBoundingBox)) {
      latitude = coords.latitude;
      longitude = coords.longitude;
    } else flags.push('coordinates_outside_region');
  } else if (coords.reason === 'invalid') flags.push('invalid_coordinates');

  // Location wording.
  const sourceLocation = cleanText(raw.locationText, 200);
  const resolved = resolveLocationText(sourceLocation || searchText, config);
  let locationText = sourceLocation || resolved.locationText;
  let confidence: LocationConfidence = resolved.confidence;
  if (sourceLocation && confidence === 'none') confidence = 'ambiguous'; // unrecognised source text
  if (latitude !== null && longitude !== null) confidence = 'source_coordinates';
  if (confidence === 'none') flags.push('missing_location');
  if (confidence === 'ambiguous') flags.push('ambiguous_location');
  if (confidence === 'region_level') flags.push('region_level_location');
  if (confidence === 'none') locationText = null;

  const ageMs = retrievedAt.getTime() - publishedAtDate.getTime();
  const isStale = ageMs > config.staleAfterHours * 3_600_000;

  return {
    ok: true,
    incident: {
      schemaVersion: INCIDENT_SCHEMA_VERSION,
      id: stableIncidentId(raw.sourceId, sourceUrl),
      sourceId: raw.sourceId,
      sourceName: raw.sourceName,
      sourceUrl,
      originalUrl: String(raw.url).trim(),
      description,
      category,
      evidenceType: raw.evidenceType ?? 'news_article',
      publishedAt: publishedAtDate.toISOString(),
      publishedAtRaw: raw.publishedAtRaw ?? String(raw.publishedAt),
      retrievedAt: retrievedAt.toISOString(),
      locationText,
      latitude,
      longitude,
      verificationStatus: 'unverified',
      locationConfidence: confidence,
      isStale,
      qualityFlags: flags,
    },
  };
}
