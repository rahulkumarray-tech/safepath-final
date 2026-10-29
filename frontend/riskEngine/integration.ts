import type { HazardInput } from './types';

/**
 * Adapter seam for future hazard services. The generic RawRecord intentionally
 * makes no assumptions about Person A's or Person B's eventual data models.
 */
export interface HazardRecordAdapter<RawRecord> {
  /** Return null when a raw record cannot be safely mapped to engine fields. */
  toHazardInput(record: RawRecord): HazardInput | null;
}

/** Internal transport-neutral boundary; this is not a proposed service API. */
export interface HazardSnapshot<RawRecord> {
  records: ReadonlyArray<RawRecord>;
  /** Optional monitored-area coverage provided by the owning service (0..1). */
  coverageHint?: number | null;
  /** Optional snapshot timestamp for diagnostics; engine reports retain source timestamps. */
  asOf?: string | number | Date | null;
}

export interface AdaptedHazardSnapshot {
  hazards: HazardInput[];
  coverageHint: number | null;
  asOf: string | number | Date | null;
}

/** Convert external records only; fetching, persistence, and ingestion stay with their owners. */
export function adaptHazardSnapshot<RawRecord>(
  snapshot: HazardSnapshot<RawRecord>,
  adapter: HazardRecordAdapter<RawRecord>,
): AdaptedHazardSnapshot {
  return {
    hazards: snapshot.records.flatMap((record) => {
      const mapped = adapter.toHazardInput(record);
      return mapped === null ? [] : [mapped];
    }),
    coverageHint: snapshot.coverageHint ?? null,
    asOf: snapshot.asOf ?? null,
  };
}
