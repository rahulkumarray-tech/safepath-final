import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { buildGdeltUrl, createGdeltAdapter } from '../adapters/gdeltAdapter.ts';
import { SourceError } from '../sourceAdapter.ts';
import type { AdapterContext } from '../sourceAdapter.ts';
import { gdeltSeenDateToIso } from '../validation.ts';
import { FIXED_NOW, jsonResponse, syntheticGdeltArticle, syntheticGdeltPayload } from './fixtures.ts';

function ctx(fetchFn: AdapterContext['fetchFn'], timeoutMs = 1000): AdapterContext {
  return { fetchFn, now: () => FIXED_NOW, timeoutMs };
}
const adapter = () => createGdeltAdapter({ minIntervalMs: 0 });

async function codeOf(promise: Promise<unknown>): Promise<string> {
  try {
    await promise;
  } catch (e) {
    assert.ok(e instanceof SourceError);
    return e.code;
  }
  throw new Error('expected failure');
}

describe('GDELT adapter request + parsing (mocked network)', () => {
  it('builds a bounded ArtList request', () => {
    const url = new URL(buildGdeltUrl({ maxRecords: 9999, timespan: '6h' }));
    assert.equal(url.searchParams.get('mode'), 'ArtList');
    assert.equal(url.searchParams.get('format'), 'json');
    assert.equal(url.searchParams.get('maxrecords'), '250');
    assert.equal(url.searchParams.get('timespan'), '6h');
  });
  it('converts seendate to ISO and keeps the raw value', async () => {
    const { reports } = await adapter().fetchReports(ctx(async () => jsonResponse(syntheticGdeltPayload([syntheticGdeltArticle()]))));
    assert.equal(reports.length, 1);
    assert.equal(reports[0].publishedAt, '2026-10-29T04:30:00Z');
    assert.equal(reports[0].publishedAtRaw, '20261029T043000Z');
    assert.equal(reports[0].latitude, undefined);
    assert.equal(gdeltSeenDateToIso('20261345T000000Z'), null);
  });
});

describe('7. source failures and rate limits', () => {
  it('maps HTTP 429 with Retry-After', async () => {
    try {
      await adapter().fetchReports(ctx(async () => new Response('slow down', { status: 429, headers: { 'Retry-After': '7' } })));
      assert.fail('expected rate limit');
    } catch (e) {
      assert.ok(e instanceof SourceError);
      assert.equal(e.code, 'rate_limited');
      assert.equal(e.retryAfterMs, 7000);
    }
  });
  it('detects a plain-text throttle message on HTTP 200', async () => {
    assert.equal(await codeOf(adapter().fetchReports(ctx(async () => new Response('Please limit requests to one every 5 seconds.')))), 'rate_limited');
  });
  it('maps 5xx to http_error and fetch rejection to network', async () => {
    assert.equal(await codeOf(adapter().fetchReports(ctx(async () => new Response('x', { status: 503 })))), 'http_error');
    assert.equal(await codeOf(adapter().fetchReports(ctx(async () => { throw new TypeError('fetch failed'); }))), 'network');
  });
  it('times out hung requests', async () => {
    const hang: AdapterContext['fetchFn'] = (_u, init) => new Promise((_r, reject) => {
      init?.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
    });
    assert.equal(await codeOf(adapter().fetchReports(ctx(hang, 20))), 'timeout');
  });
  it('throttles consecutive requests from one adapter instance', async () => {
    const waits: number[] = [];
    const a = createGdeltAdapter({ minIntervalMs: 5000, sleep: async (ms) => { waits.push(ms); } });
    const f = async () => jsonResponse(syntheticGdeltPayload([]));
    await a.fetchReports(ctx(f));
    await a.fetchReports(ctx(f));
    assert.deepEqual(waits, [5000]);
  });
});

describe('9. malformed API responses', () => {
  it('rejects non-JSON, wrong shape and empty bodies', async () => {
    assert.equal(await codeOf(adapter().fetchReports(ctx(async () => jsonResponse('<html>error</html>')))), 'malformed_response');
    assert.equal(await codeOf(adapter().fetchReports(ctx(async () => jsonResponse('[1,2,3]')))), 'malformed_response');
    assert.equal(await codeOf(adapter().fetchReports(ctx(async () => jsonResponse('{"articles":"nope"}')))), 'malformed_response');
  });
  it('treats blank body and {} as zero results (assumption, not live-confirmed)', async () => {
    assert.equal((await adapter().fetchReports(ctx(async () => jsonResponse('')))).reports.length, 0);
    assert.equal((await adapter().fetchReports(ctx(async () => jsonResponse('{}')))).reports.length, 0);
  });
  it('skips non-object articles and passes bad fields to the normalizer for rejection', async () => {
    const payload = syntheticGdeltPayload([null, 'str', 42, syntheticGdeltArticle({ seendate: 'garbage', url: 5 })]);
    const { reports, skippedMalformed } = await adapter().fetchReports(ctx(async () => jsonResponse(payload)));
    assert.equal(skippedMalformed, 3);
    assert.equal(reports.length, 1);
    assert.equal(reports[0].publishedAt, 'garbage');
  });
});
