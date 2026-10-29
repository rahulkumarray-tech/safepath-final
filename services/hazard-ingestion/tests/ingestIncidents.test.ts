import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createGdeltAdapter } from '../adapters/gdeltAdapter.ts';
import { ingestIncidents } from '../ingestIncidents.ts';
import type { SourceAdapter } from '../sourceAdapter.ts';
import { SourceError } from '../sourceAdapter.ts';
import { FIXED_NOW, jsonResponse, syntheticGdeltArticle, syntheticGdeltPayload, syntheticReport } from './fixtures.ts';

const now = () => FIXED_NOW;

describe('ingestIncidents (end-to-end with mocked network)', () => {
  it('normalizes, rejects, dedupes and attributes GDELT items', async () => {
    const payload = syntheticGdeltPayload([
      syntheticGdeltArticle(),
      syntheticGdeltArticle({ url: 'https://news.example.test/gdelt-1?utm_medium=dup' }), // duplicate
      syntheticGdeltArticle({ url: 'https://news.example.test/old', title: '[SYNTHETIC] Flood reported in Guwahati', seendate: '20261020T000000Z' }), // stale
      syntheticGdeltArticle({ url: 'https://news.example.test/bad-time', seendate: 'nope' }),
      syntheticGdeltArticle({ url: 'https://news.example.test/off-topic', title: '[SYNTHETIC] Tea festival opens' }),
    ]);
    const result = await ingestIncidents([createGdeltAdapter({ minIntervalMs: 0 })], { now, fetchFn: async () => jsonResponse(payload) });
    assert.equal(result.incidents.length, 2);
    assert.equal(result.duplicates.length, 1);
    assert.deepEqual(result.rejected.map((r) => r.reason).sort(), ['invalid_timestamp', 'not_road_incident']);
    for (const i of result.incidents) {
      assert.equal(i.verificationStatus, 'unverified');
      assert.equal(i.sourceId, 'gdelt-doc-2');
      assert.match(i.sourceName, /not an official traffic feed/);
      assert.equal(i.latitude, null);
    }
    assert.equal(result.incidents.filter((i) => i.isStale).length, 1);
    assert.equal(result.sources[0].status, 'ok');
  });
  it('dropStale removes stale items and counts them', async () => {
    const payload = syntheticGdeltPayload([syntheticGdeltArticle({ seendate: '20261001T000000Z' })]);
    const result = await ingestIncidents([createGdeltAdapter({ minIntervalMs: 0 })], { now, dropStale: true, fetchFn: async () => jsonResponse(payload) });
    assert.equal(result.incidents.length, 0);
    assert.equal(result.droppedStale, 1);
  });
  it('isolates a failing source and reports rate limits without losing other sources', async () => {
    const failing: SourceAdapter = { id: 'failing', name: 'Failing', fetchReports: async () => { throw new SourceError('rate_limited', 'failing', 'HTTP 429', { retryAfterMs: 5000 }); } };
    const working: SourceAdapter = { id: 'synthetic-source', name: 'Synthetic Test Source', fetchReports: async () => ({ reports: [syntheticReport()], skippedMalformed: 0 }) };
    const crashing: SourceAdapter = { id: 'crashing', name: 'Crashing', fetchReports: async () => { throw new Error('boom'); } };
    const result = await ingestIncidents([failing, working, crashing], { now });
    assert.equal(result.incidents.length, 1);
    assert.deepEqual(result.sources.map((s) => [s.sourceId, s.status, s.errorCode]), [['failing', 'failed', 'rate_limited'], ['synthetic-source', 'ok', undefined], ['crashing', 'failed', 'network']]);
    assert.equal(result.sources[0].retryAfterMs, 5000);
  });
});
