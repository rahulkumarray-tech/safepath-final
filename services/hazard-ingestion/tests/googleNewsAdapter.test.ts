import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { buildGoogleNewsUrl, createGoogleNewsAdapter, parseRssItems } from '../adapters/googleNewsAdapter.ts';
import { SourceError } from '../sourceAdapter.ts';
import type { AdapterContext } from '../sourceAdapter.ts';
import { FIXED_NOW } from './fixtures.ts';

/**
 * SYNTHETIC FEED FIXTURE - NOT LIVE DATA.
 * All URLs use the reserved ".test" TLD and every headline is invented.
 */
const SYNTHETIC_RSS = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0"><channel>
  <title>"Guwahati" road incidents - Google News</title>
  <item>
    <title>Guwahati: waterlogging blocks service lane near Ganeshguri &amp; Zoo Road - Example Times</title>
    <link>https://news.example.test/a?utm_source=rss</link>
    <pubDate>Thu, 29 Oct 2026 04:30:00 GMT</pubDate>
    <source url="https://news.example.test">Example Times</source>
  </item>
  <item>
    <title>Faraway city accident injures two - Other Wire</title>
    <link>https://news.example.test/b</link>
    <pubDate>Thu, 29 Oct 2026 05:00:00 GMT</pubDate>
    <source url="https://other.example.test">Other Wire</source>
  </item>
  <item>
    <title><![CDATA[Guwahati bandh: road blocked near Dispur - Example Times]]></title>
    <link>https://news.example.test/c</link>
    <pubDate>not-a-real-date</pubDate>
    <source url="https://news.example.test">Example Times</source>
  </item>
</channel></rss>`;

function ctx(fetchFn: AdapterContext['fetchFn'], timeoutMs = 1000): AdapterContext {
  return { fetchFn, now: () => FIXED_NOW, timeoutMs };
}

function xmlResponse(body: string, init: ResponseInit = {}): Response {
  return new Response(body, { status: 200, headers: { 'Content-Type': 'application/rss+xml' }, ...init });
}

async function codeOf(promise: Promise<unknown>): Promise<string> {
  try {
    await promise;
  } catch (error) {
    assert.ok(error instanceof SourceError);
    return error.code;
  }
  throw new Error('expected failure');
}

describe('Google News RSS adapter (mocked network)', () => {
  it('builds a bounded, locale-specific search URL', () => {
    const url = new URL(buildGoogleNewsUrl({ query: 'Guwahati road', language: 'en-IN', region: 'IN' }));
    assert.equal(url.searchParams.get('q'), 'Guwahati road');
    assert.equal(url.searchParams.get('hl'), 'en-IN');
    assert.equal(url.searchParams.get('gl'), 'IN');
    assert.equal(url.searchParams.get('ceid'), 'IN:en');
  });

  it('parses RSS items with CDATA, entities and nested markup', () => {
    const items = parseRssItems(SYNTHETIC_RSS);
    assert.equal(items.length, 3);
    assert.equal(items[0]?.publisher, 'Example Times');
    assert.match(items[0]?.title ?? '', /Ganeshguri & Zoo Road/);
    assert.equal(items[2]?.title, 'Guwahati bandh: road blocked near Dispur - Example Times');
  });

  it('converts RFC-822 dates to ISO and keeps only local headlines', async () => {
    const { reports, skippedMalformed } = await createGoogleNewsAdapter()
      .fetchReports(ctx(async () => xmlResponse(SYNTHETIC_RSS)));

    assert.equal(reports.length, 2);
    assert.deepEqual(reports.map((report) => report.url), ['https://news.example.test/a?utm_source=rss', 'https://news.example.test/c']);
    assert.equal(reports[0]?.publishedAt, '2026-10-29T04:30:00.000Z');
    assert.equal(reports[0]?.sourceName, 'Example Times');
    assert.equal(reports[0]?.title, 'Guwahati: waterlogging blocks service lane near Ganeshguri & Zoo Road');
    // Malformed dates are passed through so the normalizer rejects them explicitly.
    assert.equal(reports[1]?.publishedAt, 'not-a-real-date');
    assert.equal(skippedMalformed, 1);
    assert.equal(reports[0]?.latitude, undefined);
  });

  it('keeps every item when the local filter is disabled', async () => {
    const { reports } = await createGoogleNewsAdapter({ requiredTerms: [] })
      .fetchReports(ctx(async () => xmlResponse(SYNTHETIC_RSS)));
    assert.equal(reports.length, 3);
  });

  it('treats a blank body as no results and a non-RSS body as malformed', async () => {
    const adapter = createGoogleNewsAdapter();
    assert.equal((await adapter.fetchReports(ctx(async () => xmlResponse('')))).reports.length, 0);
    assert.equal(await codeOf(adapter.fetchReports(ctx(async () => xmlResponse('<html>nope</html>')))), 'malformed_response');
    assert.equal(await codeOf(adapter.fetchReports(ctx(async () => new Response('slow down', { status: 429 })))), 'rate_limited');
    assert.equal(await codeOf(adapter.fetchReports(ctx(async () => new Response('x', { status: 500 })))), 'http_error');
    assert.equal(await codeOf(adapter.fetchReports(ctx(async () => { throw new TypeError('fetch failed'); }))), 'network');
  });
});
