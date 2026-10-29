export interface MapPoint {
  x: number;
  y: number;
}

export type HazardType =
  | 'Road obstruction'
  | 'Road closure'
  | 'Low lighting'
  | 'Pothole'
  | 'Flooding'
  | 'Traffic incident';

export type Verification = 'Verified' | 'Reported' | 'Needs review';
export type HazardSeverity = 'Severe' | 'High' | 'Medium' | 'Low';

/** Local demo UI record; not the canonical risk-engine input. */
export interface Hazard {
  id: string;
  type: HazardType;
  title: string;
  location: string;
  point: MapPoint;
  severity: HazardSeverity;
  verification: Verification;
  freshness: string;
  source: string;
  summary: string;
  reportedAtMs: number | null;
}
