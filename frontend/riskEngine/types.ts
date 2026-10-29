export interface GeoPoint { lat: number; lng: number }
export interface RouteInput { id: string; coordinates: ReadonlyArray<GeoPoint>; distanceM?: number | null; durationS?: number | null }
export type HazardSource = 'official' | 'community' | 'demo' | 'unknown';
export type VerificationStatus = 'verified' | 'unverified' | 'disputed' | 'resolved' | 'unknown';
export type RiskCategory = 'Low' | 'Moderate' | 'High' | 'Very High';
export type CoverageLevel = 'adequate' | 'limited' | 'insufficient' | 'unknown';
export interface HazardInput {
  id: string; type: string; lat: number; lng: number; severity?: number | string | null;
  description?: string | null; timestamp?: string | number | Date | null;
  source?: HazardSource | string | null; verification?: VerificationStatus | string | null;
  confidence?: number | null;
}
export interface NormalizedHazard {
  id: string; type: string; lat: number; lng: number; severity: number;
  severityWasMissing: boolean; description: string; timestampMs: number | null;
  source: HazardSource; verification: VerificationStatus; confidence: number | null;
}
export interface RejectedHazard { id: string | null; reason: string }
export interface NearbyHazard { hazard: NormalizedHazard; distanceToRouteM: number; nearestSegmentIndex: number; nearestPoint: GeoPoint }
export interface HazardFactors { severity: number; recency: number; proximity: number; evidence: number }
export interface HazardContribution {
  hazardId: string; type: string; description: string; location: GeoPoint; severityLevel: number;
  severityAssumed: boolean; distanceToRouteM: number; ageDays: number | null; source: HazardSource;
  verification: VerificationStatus; factors: HazardFactors; contribution: number; standalonePoints: number;
  corroboratingReports: number; mergedHazardIds: string[]; isCritical: boolean; hasReliableBlockingEvidence: boolean;
}
export interface CriticalWarning { hazardId: string; type: string; description: string; distanceToRouteM: number; evidenceLevel: 'reliable' | 'unconfirmed'; message: string }
export interface BlockedStatus { isBlocked: boolean; hazardIds: string[]; reason: string | null }
export interface CoverageInfo { level: CoverageLevel; score: number; basedOn: 'caller-hint' | 'nearby-report-density' | 'no-route-geometry'; regionalReports: number; recentRegionalReports: number; nonDemoRegionalReports: number; note: string }
export interface DataQuality { hazardsReceived: number; hazardsUsed: number; rejected: RejectedHazard[]; duplicateIdsRemoved: number; nearDuplicatesMerged: number; unknownTimestamps: number; missingSeverity: number; demoHazardsCounted: number; routePointsReceived: number; routePointsDropped: number }
export interface FactorSummary { severity: number | null; recency: number | null; proximity: number | null; evidence: number | null }
export interface ScoreComponents { strongestHazardPoints: number; accumulationPoints: number }
export interface RouteSummary { id: string; distanceM: number | null; durationS: number | null; distanceSource: 'provided' | 'geometry' | 'none'; validPointCount: number }
export interface RouteRiskResult {
  routeId: string; route: RouteSummary; assessment: 'assessed' | 'not-assessable'; score: number;
  category: RiskCategory | null; displayLabel: string; nearbyHazards: HazardContribution[];
  factorSummary: FactorSummary; scoreComponents: ScoreComponents; criticalWarnings: CriticalWarning[];
  blocked: BlockedStatus; coverage: CoverageInfo; dataQuality: DataQuality; explanations: string[]; disclaimer: string;
}
export interface RiskEngineConfig {
  corridorM: number; coreDistanceM: number; minProximityWeight: number; severityWeights: readonly number[];
  defaultSeverity: number; recencyHalfLifeDays: number; minRecencyWeight: number; unknownTimestampWeight: number;
  verificationWeights: Record<VerificationStatus, number>; sourceWeights: Record<HazardSource, number>;
  impactScale: number; duplicateClusterRadiusM: number;
  categoryThresholds: { moderate: number; high: number; veryHigh: number }; criticalTypes: readonly string[];
  criticalSeverity: number; criticalCategoryFloor: RiskCategory | null; blockingTypes: readonly string[];
  blockingMaxDistanceM: number; blockingMaxAgeDays: number; reliableEvidenceMin: number;
  confirmedBlockingHazardIds: readonly string[]; coverageRadiusM: number; coverageFreshDays: number;
  coverageHint: number | null; nowMs: number | null;
}
export type RiskEngineOptions = Partial<Omit<RiskEngineConfig, 'verificationWeights' | 'sourceWeights' | 'categoryThresholds'>> & {
  verificationWeights?: Partial<Record<VerificationStatus, number>>;
  sourceWeights?: Partial<Record<HazardSource, number>>;
  categoryThresholds?: Partial<RiskEngineConfig['categoryThresholds']>;
};
