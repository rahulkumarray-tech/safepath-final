import type { RawExternalReport } from './types.ts';

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export type SourceErrorCode = 'timeout' | 'network' | 'rate_limited' | 'http_error' | 'malformed_response';

export class SourceError extends Error {
  readonly code: SourceErrorCode;
  readonly sourceId: string;
  readonly status: number | undefined;
  /** Server-suggested wait before retrying, when provided. */
  readonly retryAfterMs: number | undefined;

  constructor(code: SourceErrorCode, sourceId: string, message: string, extra: { status?: number; retryAfterMs?: number } = {}) {
    super(message);
    this.name = 'SourceError';
    this.code = code;
    this.sourceId = sourceId;
    this.status = extra.status;
    this.retryAfterMs = extra.retryAfterMs;
  }
}

export interface AdapterContext {
  fetchFn: FetchLike;
  now: () => Date;
  timeoutMs: number;
}

export interface AdapterFetchResult {
  reports: RawExternalReport[];
  /** Records the adapter could not even turn into a RawExternalReport. */
  skippedMalformed: number;
}

/** Implement this to add a source (RSS feed, official alert API, ...). Adapters never invent coordinates. */
export interface SourceAdapter {
  readonly id: string;
  readonly name: string;
  fetchReports(context: AdapterContext): Promise<AdapterFetchResult>;
}
