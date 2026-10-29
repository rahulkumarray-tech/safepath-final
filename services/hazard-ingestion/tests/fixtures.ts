/**
 * SYNTHETIC TEST FIXTURES - NOT LIVE DATA.
 * Every URL uses the reserved ".test" TLD and every headline is invented.
 * None of these represent real incidents in Guwahati or anywhere else.
 */
import type { RawExternalReport } from '../types.ts';

export const FIXED_NOW = new Date('2026-10-29T06:00:00Z');

export function syntheticReport(overrides: Partial<RawExternalReport> = {}): RawExternalReport {
  return {
    sourceId: 'synthetic-source',
    sourceName: 'Synthetic Test Source',
    url: 'https://news.example.test/story-1',
    title: '[SYNTHETIC] Waterlogging reported on GS Road',
    publishedAt: '2026-10-29T04:00:00Z',
    publishedAtRaw: '2026-10-29T04:00:00Z',
    ...overrides,
  };
}

/** Shape mimics a GDELT ArtList payload. Values are invented. */
export function syntheticGdeltPayload(articles: unknown[]): string {
  return JSON.stringify({ articles });
}

export function syntheticGdeltArticle(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    url: 'https://news.example.test/gdelt-1?utm_source=feed',
    title: '[SYNTHETIC] Truck accident blocks road near Ganeshguri',
    seendate: '20261029T043000Z',
    domain: 'news.example.test',
    language: 'English',
    sourcecountry: 'India',
    ...overrides,
  };
}

export function jsonResponse(body: string, init: ResponseInit = {}): Response {
  return new Response(body, { status: 200, ...init });
}
