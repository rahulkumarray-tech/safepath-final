import { DEFAULT_CONFIG } from './config.ts';
import { deduplicateIncidents } from './deduplicate.ts';
import type { DuplicateRecord } from './deduplicate.ts';
import { normalizeIncident } from './normalizeIncident.ts';
import { SourceError } from './sourceAdapter.ts';
import type { FetchLike, SourceAdapter, SourceErrorCode } from './sourceAdapter.ts';
import type { IngestionConfig, NormalizedIncident, RejectionReason } from './types.ts';

export interface IngestOptions {
  config?: IngestionConfig;
  fetchFn?: FetchLike;
  now?: () => Date;
  /** Ids already persisted by the storage layer; matching items are reported as duplicates. */
  existingIds?: ReadonlySet<string>;
  /** Drop stale incidents instead of returning them flagged. Default false. */
  dropStale?: boolean;
}

export interface SourceReport {
  sourceId: string;
  status: 'ok' | 'failed';
  fetched: number;
  skippedMalformed: number;
  errorCode?: SourceErrorCode;
  errorMessage?: string;
  retryAfterMs?: number;
}

export interface RejectedReport {
  sourceId: string;
  url: string | null;
  reason: RejectionReason;
  detail: string;
}

export interface IngestionResult {
  retrievedAt: string;
  incidents: NormalizedIncident[];
  duplicates: DuplicateRecord[];
  rejected: RejectedReport[];
  droppedStale: number;
  sources: SourceReport[];
}

/**
 * Runs every adapter independently and in parallel: one failing source never discards another
 * source's data, and a slow source does not delay the rest of the feed. Normalization and
 * de-duplication still happen in adapter order, so "first occurrence wins" stays deterministic.
 */
export async function ingestIncidents(adapters: SourceAdapter[], options: IngestOptions = {}): Promise<IngestionResult> {
  const config = options.config ?? DEFAULT_CONFIG;
  const now = options.now ?? (() => new Date());
  const fetchFn: FetchLike = options.fetchFn ?? ((input, init) => fetch(input, init));
  const retrievedAt = now();

  const normalized: NormalizedIncident[] = [];
  const rejected: RejectedReport[] = [];
  const sources: SourceReport[] = [];

  const fetched = await Promise.all(adapters.map(async (adapter) => {
    try {
      return { adapter, result: await adapter.fetchReports({ fetchFn, now, timeoutMs: config.httpTimeoutMs }) };
    } catch (error) {
      return { adapter, error };
    }
  }));

  for (const entry of fetched) {
    const { adapter } = entry;
    if ('error' in entry) {
      const error = entry.error;
      const known = error instanceof SourceError;
      sources.push({
        sourceId: adapter.id,
        status: 'failed',
        fetched: 0,
        skippedMalformed: 0,
        errorCode: known ? error.code : 'network',
        errorMessage: known ? error.message : 'Unexpected adapter failure.',
        retryAfterMs: known ? error.retryAfterMs : undefined,
      });
      continue;
    }

    const { reports, skippedMalformed } = entry.result;
    for (const raw of reports) {
      const result = normalizeIncident(raw, retrievedAt, config);
      if (result.ok) normalized.push(result.incident);
      else rejected.push({ sourceId: adapter.id, url: typeof raw?.url === 'string' ? raw.url : null, reason: result.reason, detail: result.detail });
    }
    sources.push({ sourceId: adapter.id, status: 'ok', fetched: reports.length, skippedMalformed });
  }

  const { unique, duplicates } = deduplicateIncidents(normalized, options.existingIds);
  const kept = options.dropStale ? unique.filter((i) => !i.isStale) : unique;
  return {
    retrievedAt: retrievedAt.toISOString(),
    incidents: kept,
    duplicates,
    rejected,
    droppedStale: unique.length - kept.length,
    sources,
  };
}
