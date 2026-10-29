/**
 * Hazard-ingestion public contract (schema v1).
 * Imported reports are NEWS/ALERT EVIDENCE, never proof that a road is currently blocked.
 */
export const INCIDENT_SCHEMA_VERSION = 1 as const;

export type IncidentCategory =
  | 'flooding'
  | 'landslide'
  | 'road_obstruction'
  | 'public_disruption' // bandh, protest, strike, rally
  | 'traffic_incident'; // accident, collision, jam

/** Imports are always 'unverified'. No verification process exists yet. */
export type VerificationStatus = 'unverified';

export type LocationConfidence =
  | 'none' // no location found in the text
  | 'ambiguous' // several distinct places, or unrecognised source-provided text
  | 'region_level' // only city/state named (e.g. "Guwahati", "Assam")
  | 'area_text' // exactly one known locality named; NOT geocoded
  | 'source_coordinates'; // source supplied valid, in-region coordinates

export type EvidenceType = 'news_article' | 'official_alert';

export type QualityFlag =
  | 'missing_location'
  | 'ambiguous_location'
  | 'region_level_location'
  | 'invalid_coordinates'
  | 'coordinates_outside_region'
  | 'headline_only';

export interface NormalizedIncident {
  schemaVersion: typeof INCIDENT_SCHEMA_VERSION;
  /** Stable: "ext-<sourceId>-<16 hex of sha256(sourceId|canonicalUrl)>". */
  id: string;
  sourceId: string;
  sourceName: string;
  /** Canonical (tracking-stripped) article/alert URL. */
  sourceUrl: string;
  /** URL exactly as received from the source. */
  originalUrl: string;
  description: string;
  category: IncidentCategory;
  evidenceType: EvidenceType;
  /** ISO-8601 UTC. When the SOURCE published/indexed the item, not when the incident happened. */
  publishedAt: string;
  /** Timestamp string exactly as the source sent it. */
  publishedAtRaw: string;
  /** ISO-8601 UTC. When this service fetched it. */
  retrievedAt: string;
  /** Location wording from the source/text. Never a coordinate. */
  locationText: string | null;
  latitude: number | null;
  longitude: number | null;
  verificationStatus: VerificationStatus;
  locationConfidence: LocationConfidence;
  isStale: boolean;
  qualityFlags: QualityFlag[];
}

/** Source-specific record handed from an adapter to the normalizer. Everything is untrusted. */
export interface RawExternalReport {
  sourceId: string;
  sourceName: string;
  evidenceType?: EvidenceType;
  url: unknown;
  title: unknown;
  description?: unknown;
  /** ISO-8601 preferred (adapter converts when it can). */
  publishedAt: unknown;
  /** Original timestamp string from the source, preserved verbatim. */
  publishedAtRaw?: string | null;
  locationText?: unknown;
  latitude?: unknown;
  longitude?: unknown;
}

export type RejectionReason =
  | 'invalid_url'
  | 'missing_description'
  | 'invalid_timestamp'
  | 'future_timestamp'
  | 'not_road_incident'
  | 'malformed_record';

export type NormalizeResult =
  | { ok: true; incident: NormalizedIncident }
  | { ok: false; reason: RejectionReason; detail: string };

export interface BoundingBox {
  minLat: number;
  maxLat: number;
  minLon: number;
  maxLon: number;
}

export interface IngestionConfig {
  staleAfterHours: number;
  httpTimeoutMs: number;
  maxDescriptionLength: number;
  futureToleranceMs: number;
  /** Plausibility box for source-supplied coordinates (approx. Assam). */
  regionBoundingBox: BoundingBox;
  /** Localities recognised in text; matching is whole-word, case-insensitive. */
  knownAreas: string[];
  /** City/state terms that give only region-level location. */
  regionTerms: string[];
}
