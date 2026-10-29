import type { IngestionConfig } from './types.ts';

export const DEFAULT_CONFIG: IngestionConfig = {
  staleAfterHours: 48,
  httpTimeoutMs: 10_000,
  maxDescriptionLength: 500,
  futureToleranceMs: 5 * 60_000,
  regionBoundingBox: { minLat: 24.0, maxLat: 28.3, minLon: 89.6, maxLon: 96.1 },
  knownAreas: [
    'GS Road', 'AT Road', 'Panbazar', 'Paltan Bazaar', 'Fancy Bazar', 'Uzan Bazar', 'Bharalumukh',
    'Ganeshguri', 'Dispur', 'Beltola', 'Khanapara', 'Jalukbari', 'Maligaon', 'Adabari', 'Noonmati',
    'Six Mile', 'Zoo Road', 'Lokhra', 'Chandmari', 'Ulubari', 'Hatigaon', 'Bhangagarh', 'Rehabari',
    'Kahilipara', 'Lachit Nagar', 'Bamunimaidam', 'Basistha', 'Kamakhya',
  ],
  regionTerms: ['Guwahati', 'Gauhati', 'Kamrup', 'Assam'],
};

type Env = Record<string, string | undefined>;

function positiveNumber(value: string | undefined, fallback: number): number {
  if (value === undefined || value.trim() === '') return fallback;
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

/** Reads optional overrides. No secrets are needed by any current source. */
export function loadConfig(env: Env = {}): IngestionConfig {
  return {
    ...DEFAULT_CONFIG,
    staleAfterHours: positiveNumber(env.HAZARD_INGEST_STALE_HOURS, DEFAULT_CONFIG.staleAfterHours),
    httpTimeoutMs: positiveNumber(env.HAZARD_INGEST_TIMEOUT_MS, DEFAULT_CONFIG.httpTimeoutMs),
  };
}
