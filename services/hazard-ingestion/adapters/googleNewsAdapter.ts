import { fetchText } from '../httpClient.ts';
import { SourceError } from '../sourceAdapter.ts';
import type { AdapterContext, AdapterFetchResult, SourceAdapter } from '../sourceAdapter.ts';
import type { RawExternalReport } from '../types.ts';

export const GOOGLE_NEWS_SOURCE_ID = 'google-news-rss';
const GOOGLE_NEWS_BASE_URL = 'https://news.google.com/rss/search';

/**
 * Public Google News RSS search. It is a news index, not an official traffic feed;
 * every imported item is unverified evidence and never carries coordinates.
 */
export const DEFAULT_GOOGLE_NEWS_QUERY =
  '"Guwahati" (traffic OR accident OR flood OR waterlogging OR landslide OR blockade OR "road blocked" OR "road closed") when:7d';

export interface GoogleNewsAdapterOptions {
  baseUrl?: string;
  query?: string;
  maxRecords?: number;
  language?: string;
  region?: string;
  /** A headline must mention one of these terms to be treated as local evidence. */
  requiredTerms?: string[];
}

export function buildGoogleNewsUrl(options: GoogleNewsAdapterOptions = {}): string {
  const params = new URLSearchParams({
    q: options.query ?? DEFAULT_GOOGLE_NEWS_QUERY,
    hl: options.language ?? 'en-IN',
    gl: options.region ?? 'IN',
    ceid: `${options.region ?? 'IN'}:en`,
  });
  return `${options.baseUrl ?? GOOGLE_NEWS_BASE_URL}?${params}`;
}

export interface RssItem {
  title: string;
  link: string;
  pubDate: string | null;
  /** Publisher name from the feed's <source> element, when present. */
  publisher: string | null;
}

function decodeEntities(value: string): string {
  return value
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#0?39;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&');
}

function cleanValue(raw: string): string {
  let value = raw.trim();
  const cdata = /^<!\[CDATA\[([\s\S]*?)\]\]>$/.exec(value);
  if (cdata && cdata[1] !== undefined) value = cdata[1];
  return decodeEntities(value.replace(/<[^>]*>/g, ' ')).replace(/\s+/g, ' ').trim();
}

function tagValue(block: string, tag: string): string | null {
  const match = new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)</${tag}>`, 'i').exec(block);
  if (!match || match[1] === undefined) return null;
  const value = cleanValue(match[1]);
  return value === '' ? null : value;
}

/** Minimal RSS reader for the Google News feed; tolerant of CDATA and HTML in titles. */
export function parseRssItems(xml: string): RssItem[] {
  const items: RssItem[] = [];
  const itemPattern = /<item\b[^>]*>([\s\S]*?)<\/item>/gi;
  let match: RegExpExecArray | null;
  while ((match = itemPattern.exec(xml)) !== null) {
    const block = match[1] ?? '';
    const title = tagValue(block, 'title');
    const link = tagValue(block, 'link');
    if (!title || !link) continue;
    items.push({ title, link, pubDate: tagValue(block, 'pubDate'), publisher: tagValue(block, 'source') });
  }
  return items;
}

/** RSS uses RFC-822 dates; the normalizer only accepts strict ISO-8601. */
function rssDateToIso(value: string | null): string | null {
  if (!value) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

export function createGoogleNewsAdapter(options: GoogleNewsAdapterOptions = {}): SourceAdapter {
  const maxRecords = Math.min(Math.max(1, Math.trunc(options.maxRecords ?? 25)), 100);
  // Google News matches the query loosely and returns Assam-wide or national stories;
  // the Guwahati pilot only keeps headlines that name the city or district.
  const requiredTerms = (options.requiredTerms ?? ['Guwahati', 'Gauhati', 'Kamrup']).map((term) => term.toLowerCase());

  return {
    id: GOOGLE_NEWS_SOURCE_ID,
    name: 'Google News RSS (news index; not an official traffic feed)',
    async fetchReports(context: AdapterContext): Promise<AdapterFetchResult> {
      const xml = await fetchText(buildGoogleNewsUrl(options), {
        sourceId: GOOGLE_NEWS_SOURCE_ID,
        fetchFn: context.fetchFn,
        timeoutMs: context.timeoutMs,
        nowMs: context.now().getTime(),
      });

      if (xml.trim() === '') return { reports: [], skippedMalformed: 0 };
      if (!/<rss\b/i.test(xml)) {
        throw new SourceError('malformed_response', GOOGLE_NEWS_SOURCE_ID, 'Feed response is not an RSS document.');
      }

      const reports: RawExternalReport[] = [];
      let skippedMalformed = 0;
      for (const item of parseRssItems(xml).slice(0, maxRecords)) {
        if (requiredTerms.length > 0) {
          const text = item.title.toLowerCase();
          if (!requiredTerms.some((term) => text.includes(term))) continue;
        }
        const iso = rssDateToIso(item.pubDate);
        // Pass malformed dates through so the normalizer rejects them explicitly.
        if (!iso) skippedMalformed += 1;
        // Google News appends " - Publisher" to every headline; the publisher is shown separately.
        const suffix = item.publisher ? ` - ${item.publisher}` : null;
        const title = suffix && item.title.endsWith(suffix) ? item.title.slice(0, -suffix.length).trim() : item.title;
        reports.push({
          sourceId: GOOGLE_NEWS_SOURCE_ID,
          sourceName: item.publisher ?? 'Google News RSS (news index; not an official traffic feed)',
          evidenceType: 'news_article',
          url: item.link,
          title,
          publishedAt: iso ?? item.pubDate ?? '',
          publishedAtRaw: item.pubDate,
          // Google News RSS has no location field: location comes from headline text only.
        });
      }
      return { reports, skippedMalformed };
    },
  };
}
