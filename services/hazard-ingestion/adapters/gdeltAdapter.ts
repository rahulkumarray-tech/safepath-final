import { fetchJson } from '../httpClient.ts';
import { SourceError } from '../sourceAdapter.ts';
import type { AdapterContext, AdapterFetchResult, SourceAdapter } from '../sourceAdapter.ts';
import type { RawExternalReport } from '../types.ts';
import { gdeltSeenDateToIso, isRecord } from '../validation.ts';

export const GDELT_SOURCE_ID = 'gdelt-doc-2';
const GDELT_BASE_URL = 'https://api.gdeltproject.org/api/v2/doc/doc';

export const DEFAULT_GDELT_QUERY =
  '(Guwahati OR Dispur) (accident OR flood OR flooding OR waterlogging OR landslide OR bandh OR blockade OR "road blocked" OR "traffic jam") sourcecountry:IN';

export interface GdeltAdapterOptions {
  baseUrl?: string;
  query?: string;
  /** GDELT relative window, e.g. "24h", "3d". */
  timespan?: string;
  /** GDELT caps ArtList at 250. */
  maxRecords?: number;
  /** Minimum gap between requests from this adapter instance. Public guidance on limits is inconsistent; default is conservative. */
  minIntervalMs?: number;
  /** Cap for this source so a throttled GDELT request cannot hold up the whole feed. */
  timeoutMs?: number;
  sleep?: (ms: number) => Promise<void>;
}

export function buildGdeltUrl(options: GdeltAdapterOptions = {}): string {
  const params = new URLSearchParams({
    query: options.query ?? DEFAULT_GDELT_QUERY,
    mode: 'ArtList',
    format: 'json',
    maxrecords: String(Math.min(Math.max(1, Math.trunc(options.maxRecords ?? 50)), 250)),
    timespan: options.timespan ?? '24h',
    sort: 'DateDesc',
  });
  return `${options.baseUrl ?? GDELT_BASE_URL}?${params}`;
}

export function createGdeltAdapter(options: GdeltAdapterOptions = {}): SourceAdapter {
  const minIntervalMs = options.minIntervalMs ?? 5000;
  const sleep = options.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  let lastRequestAt: number | null = null;

  return {
    id: GDELT_SOURCE_ID,
    name: 'GDELT DOC 2.0 (news index; not an official traffic feed)',
    async fetchReports(context: AdapterContext): Promise<AdapterFetchResult> {
      if (lastRequestAt !== null) {
        const wait = lastRequestAt + minIntervalMs - context.now().getTime();
        if (wait > 0) await sleep(wait);
      }
      lastRequestAt = context.now().getTime();

      const json = await fetchJson(buildGdeltUrl(options), {
        sourceId: GDELT_SOURCE_ID,
        fetchFn: context.fetchFn,
        timeoutMs: Math.min(context.timeoutMs, options.timeoutMs ?? context.timeoutMs),
        nowMs: context.now().getTime(),
        allowEmptyBody: true,
      });

      // Blank body or `{}` = no matches (assumed; not confirmed against the live API).
      if (json === undefined || (isRecord(json) && Object.keys(json).length === 0)) return { reports: [], skippedMalformed: 0 };
      if (!isRecord(json) || !Array.isArray(json.articles)) {
        throw new SourceError('malformed_response', GDELT_SOURCE_ID, 'GDELT response has no "articles" array.');
      }

      const reports: RawExternalReport[] = [];
      let skippedMalformed = 0;
      for (const article of json.articles as unknown[]) {
        if (!isRecord(article)) {
          skippedMalformed += 1;
          continue;
        }
        const rawSeen = typeof article.seendate === 'string' ? article.seendate : null;
        reports.push({
          sourceId: GDELT_SOURCE_ID,
          sourceName: 'GDELT DOC 2.0 (news index; not an official traffic feed)',
          evidenceType: 'news_article',
          url: article.url,
          title: article.title,
          // Falls back to the raw value so the normalizer rejects malformed timestamps explicitly.
          publishedAt: gdeltSeenDateToIso(rawSeen) ?? rawSeen,
          publishedAtRaw: rawSeen,
          // GDELT ArtList has no location field: location comes from headline text only.
        });
      }
      return { reports, skippedMalformed };
    },
  };
}
