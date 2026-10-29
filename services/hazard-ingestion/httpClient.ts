import { SourceError } from './sourceAdapter.ts';
import type { FetchLike } from './sourceAdapter.ts';

function parseRetryAfter(header: string | null, nowMs: number): number | undefined {
  if (!header) return undefined;
  const seconds = Number(header);
  if (Number.isFinite(seconds) && seconds >= 0) return Math.round(seconds * 1000);
  const date = Date.parse(header);
  return Number.isNaN(date) ? undefined : Math.max(0, date - nowMs);
}

const RATE_LIMIT_TEXT = /limit requests|too many requests|rate limit/i;

export interface FetchTextOptions {
  sourceId: string;
  fetchFn: FetchLike;
  timeoutMs: number;
  nowMs?: number;
  /** Accept header sent with the request. Defaults to a generic text/XML accept. */
  accept?: string;
}

/** GET + text with a hard timeout. Throws SourceError with a specific code on every failure path. */
export async function fetchText(url: string, options: FetchTextOptions): Promise<string> {
  const { sourceId, fetchFn, timeoutMs } = options;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    let response: Response;
    try {
      response = await fetchFn(url, {
        headers: { Accept: options.accept ?? 'application/xml, text/xml;q=0.9, */*;q=0.8' },
        signal: controller.signal,
      });
      if (response.status === 429) {
        throw new SourceError('rate_limited', sourceId, 'Source returned HTTP 429.', {
          status: 429,
          retryAfterMs: parseRetryAfter(response.headers.get('retry-after'), options.nowMs ?? Date.now()),
        });
      }
      if (!response.ok) {
        throw new SourceError('http_error', sourceId, `Source returned HTTP ${response.status}.`, { status: response.status });
      }
      return await response.text();
    } catch (error) {
      if (error instanceof SourceError) throw error;
      if (controller.signal.aborted) throw new SourceError('timeout', sourceId, `Request timed out after ${timeoutMs} ms.`);
      throw new SourceError('network', sourceId, 'Unable to reach the source.');
    }
  } finally {
    clearTimeout(timer);
  }
}

export interface FetchJsonOptions {
  sourceId: string;
  fetchFn: FetchLike;
  timeoutMs: number;
  nowMs?: number;
  /** Treat a blank 200 body as "no results" instead of malformed. */
  allowEmptyBody?: boolean;
}

/** GET + JSON with a hard timeout. Throws SourceError with a specific code on every failure path. */
export async function fetchJson(url: string, options: FetchJsonOptions): Promise<unknown> {
  const { sourceId, allowEmptyBody } = options;
  const text = await fetchText(url, {
    sourceId,
    fetchFn: options.fetchFn,
    timeoutMs: options.timeoutMs,
    nowMs: options.nowMs,
    accept: 'application/json',
  });

  if (text.trim() === '') {
    if (allowEmptyBody) return undefined;
    throw new SourceError('malformed_response', sourceId, 'Source returned an empty body.');
  }
  try {
    return JSON.parse(text) as unknown;
  } catch {
    // Some public APIs answer throttling with a plain-text 200.
    if (RATE_LIMIT_TEXT.test(text.slice(0, 300))) {
      throw new SourceError('rate_limited', sourceId, 'Source signalled rate limiting in a non-JSON body.');
    }
    throw new SourceError('malformed_response', sourceId, 'Source returned a body that is not valid JSON.');
  }
}
