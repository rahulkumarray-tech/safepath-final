import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { DEFAULT_CONFIG } from '../config.ts';
import { deduplicateIncidents } from '../deduplicate.ts';
import { normalizeIncident } from '../normalizeIncident.ts';
import { FIXED_NOW, syntheticReport } from './fixtures.ts';

function inc(overrides = {}) {
  const r = normalizeIncident(syntheticReport(overrides), FIXED_NOW, DEFAULT_CONFIG);
  assert.equal(r.ok, true);
  return (r as { ok: true; incident: import('../types.ts').NormalizedIncident }).incident;
}

describe('2. duplicate detection', () => {
  it('collapses the same canonical URL (tracking params, www, fragment, trailing slash)', () => {
    const a = inc();
    const b = inc({ url: 'https://www.news.example.test/story-1/?utm_campaign=z&fbclid=1#top' });
    const { unique, duplicates } = deduplicateIncidents([a, b]);
    assert.equal(unique.length, 1);
    assert.equal(duplicates[0].reason, 'same_canonical_url');
    assert.equal(duplicates[0].duplicateOfId, a.id);
  });
  it('collapses the same domain + identical headline under a different URL', () => {
    const a = inc();
    const b = inc({ url: 'https://news.example.test/story-1-amp', title: '[synthetic]  WATERLOGGING reported on GS Road!' });
    const { unique, duplicates } = deduplicateIncidents([a, b]);
    assert.equal(unique.length, 1);
    assert.equal(duplicates[0].reason, 'same_domain_and_headline');
  });
  it('keeps same headline from different domains as separate items', () => {
    const { unique } = deduplicateIncidents([inc(), inc({ url: 'https://other.example.test/story-1' })]);
    assert.equal(unique.length, 2);
  });
  it('treats distinct query parameters as different articles', () => {
    const { unique } = deduplicateIncidents([inc({ url: 'https://news.example.test/read?id=1', title: '[SYNTHETIC] Flood A' }), inc({ url: 'https://news.example.test/read?id=2', title: '[SYNTHETIC] Flood B' })]);
    assert.equal(unique.length, 2);
  });
  it('reports items already in storage', () => {
    const a = inc();
    const { unique, duplicates } = deduplicateIncidents([a], new Set([a.id]));
    assert.equal(unique.length, 0);
    assert.equal(duplicates[0].reason, 'already_stored');
  });
});
