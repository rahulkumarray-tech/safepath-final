import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { DEFAULT_CONFIG } from '../config.ts';
import { normalizeIncident } from '../normalizeIncident.ts';
import type { NormalizedIncident } from '../types.ts';
import { FIXED_NOW, syntheticReport } from './fixtures.ts';

function ok(raw = syntheticReport(), config = DEFAULT_CONFIG): NormalizedIncident {
  const result = normalizeIncident(raw, FIXED_NOW, config);
  assert.equal(result.ok, true, JSON.stringify(result));
  return (result as { ok: true; incident: NormalizedIncident }).incident;
}
function rejected(raw: ReturnType<typeof syntheticReport>) {
  const result = normalizeIncident(raw, FIXED_NOW, DEFAULT_CONFIG);
  assert.equal(result.ok, false);
  return result as { ok: false; reason: string; detail: string };
}

describe('1. valid incident normalization', () => {
  it('produces the full contract', () => {
    const i = ok();
    assert.equal(i.schemaVersion, 1);
    assert.match(i.id, /^ext-synthetic-source-[0-9a-f]{16}$/);
    assert.equal(i.category, 'flooding');
    assert.equal(i.publishedAt, '2026-10-29T04:00:00.000Z');
    assert.equal(i.publishedAtRaw, '2026-10-29T04:00:00Z');
    assert.equal(i.retrievedAt, FIXED_NOW.toISOString());
    assert.equal(i.locationText, 'GS Road');
    assert.equal(i.locationConfidence, 'area_text');
    assert.equal(i.latitude, null);
    assert.equal(i.longitude, null);
    assert.equal(i.isStale, false);
  });
  it('is stable for the same source + canonical URL', () => {
    const a = ok(syntheticReport({ url: 'https://www.News.example.test/story-1/?utm_source=x#frag' }));
    const b = ok(syntheticReport());
    assert.equal(a.id, b.id);
    assert.equal(a.originalUrl, 'https://www.News.example.test/story-1/?utm_source=x#frag');
    assert.equal(a.sourceUrl, 'https://news.example.test/story-1');
  });
  it('rejects non-incident text and bad URLs', () => {
    assert.equal(rejected(syntheticReport({ title: '[SYNTHETIC] Festival lights up the city' })).reason, 'not_road_incident');
    assert.equal(rejected(syntheticReport({ url: 'javascript:alert(1)' })).reason, 'invalid_url');
    assert.equal(rejected(syntheticReport({ url: undefined })).reason, 'invalid_url');
  });
});

describe('3. missing and invalid coordinates', () => {
  it('never invents coordinates when absent', () => {
    const i = ok(syntheticReport());
    assert.deepEqual([i.latitude, i.longitude], [null, null]);
  });
  it('nulls out invalid values and flags them', () => {
    for (const [lat, lon] of [[95, 91.7], [26.1, 200], ['abc', 91.7], [0, 0], [26.1, undefined]] as const) {
      const i = ok(syntheticReport({ latitude: lat, longitude: lon }));
      assert.deepEqual([i.latitude, i.longitude], [null, null], `${lat},${lon}`);
      assert.ok(i.qualityFlags.includes('invalid_coordinates'));
    }
  });
  it('rejects coordinates outside the region plausibility box', () => {
    const i = ok(syntheticReport({ latitude: 51.5, longitude: -0.12 }));
    assert.equal(i.latitude, null);
    assert.ok(i.qualityFlags.includes('coordinates_outside_region'));
  });
  it('accepts valid in-region source coordinates (incl. numeric strings)', () => {
    const i = ok(syntheticReport({ latitude: '26.1445', longitude: 91.7362 }));
    assert.deepEqual([i.latitude, i.longitude], [26.1445, 91.7362]);
    assert.equal(i.locationConfidence, 'source_coordinates');
  });
});

describe('4. missing and malformed timestamps', () => {
  it('rejects missing, malformed, impossible and zone-less timestamps', () => {
    for (const publishedAt of [undefined, null, '', 'yesterday', '2026-02-31T10:00:00Z', '2026-13-01T10:00:00Z', '2026-10-29T25:00:00Z', '2026-10-29T10:00:00', 12345]) {
      assert.equal(rejected(syntheticReport({ publishedAt })).reason, 'invalid_timestamp', String(publishedAt));
    }
  });
  it('rejects timestamps in the future beyond tolerance', () => {
    assert.equal(rejected(syntheticReport({ publishedAt: '2026-10-29T07:00:00Z' })).reason, 'future_timestamp');
  });
  it('accepts offsets and normalizes to UTC while preserving the raw string', () => {
    const i = ok(syntheticReport({ publishedAt: '2026-10-29T09:30:00+05:30', publishedAtRaw: 'Thu, 29 Oct 2026 09:30 IST' }));
    assert.equal(i.publishedAt, '2026-10-29T04:00:00.000Z');
    assert.equal(i.publishedAtRaw, 'Thu, 29 Oct 2026 09:30 IST');
  });
});

describe('5. stale incidents', () => {
  it('flags items older than the threshold and respects a custom threshold', () => {
    const old = syntheticReport({ publishedAt: '2026-10-26T06:00:00Z' });
    assert.equal(ok(old).isStale, true);
    assert.equal(ok(old, { ...DEFAULT_CONFIG, staleAfterHours: 24 * 7 }).isStale, false);
    assert.equal(ok(syntheticReport({ publishedAt: '2026-10-27T06:00:00Z' })).isStale, false); // exactly 48h is not stale
    assert.equal(ok(syntheticReport({ publishedAt: '2026-10-27T05:59:59Z' })).isStale, true);
  });
});

describe('6. ambiguous locations', () => {
  it('flags no location', () => {
    const i = ok(syntheticReport({ title: '[SYNTHETIC] Truck accident on a highway' }));
    assert.equal(i.locationConfidence, 'none');
    assert.equal(i.locationText, null);
    assert.ok(i.qualityFlags.includes('missing_location'));
  });
  it('flags multiple distinct places as ambiguous', () => {
    const i = ok(syntheticReport({ title: '[SYNTHETIC] Accident between Khanapara and Beltola' }));
    assert.equal(i.locationConfidence, 'ambiguous');
    assert.ok(i.qualityFlags.includes('ambiguous_location'));
  });
  it('treats city/state-only text as region level, not a point', () => {
    const i = ok(syntheticReport({ title: '[SYNTHETIC] Flooding in Guwahati' }));
    assert.equal(i.locationConfidence, 'region_level');
    assert.equal(i.latitude, null);
  });
  it('treats unrecognised source-provided text as ambiguous but preserves it', () => {
    const i = ok(syntheticReport({ locationText: 'Near the old mill' }));
    assert.equal(i.locationText, 'Near the old mill');
    assert.equal(i.locationConfidence, 'ambiguous');
  });
});

describe('8. attribution and verification', () => {
  it('always unverified, with source attribution and original URL preserved', () => {
    const i = ok(syntheticReport({ evidenceType: 'official_alert' }));
    assert.equal(i.verificationStatus, 'unverified'); // even for official_alert: no verification process exists
    assert.equal(i.sourceId, 'synthetic-source');
    assert.equal(i.sourceName, 'Synthetic Test Source');
    assert.equal(i.evidenceType, 'official_alert');
    assert.equal(ok().evidenceType, 'news_article');
    assert.ok(ok().qualityFlags.includes('headline_only'));
  });
});
