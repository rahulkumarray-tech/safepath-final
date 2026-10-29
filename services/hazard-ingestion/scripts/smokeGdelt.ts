/**
 * OPT-IN live smoke test: ONE bounded request to the real GDELT DOC 2.0 API (max 5 records).
 * Run:  node services/hazard-ingestion/scripts/smokeGdelt.ts
 * Prints a summary only; nothing is stored. Not part of the unit-test run.
 */
import { createGdeltAdapter } from '../adapters/gdeltAdapter.ts';
import { loadConfig } from '../config.ts';
import { ingestIncidents } from '../ingestIncidents.ts';

const config = loadConfig(process.env);
const result = await ingestIncidents([createGdeltAdapter({ maxRecords: 5, timespan: '3d' })], { config });
console.log(JSON.stringify({
  retrievedAt: result.retrievedAt,
  sources: result.sources,
  normalized: result.incidents.length,
  rejected: result.rejected.map((r) => r.reason),
  sample: result.incidents.slice(0, 3).map((i) => ({ id: i.id, category: i.category, publishedAt: i.publishedAt, locationConfidence: i.locationConfidence, isStale: i.isStale, url: i.sourceUrl })),
}, null, 2));
process.exit(result.sources.every((s) => s.status === 'ok') ? 0 : 1);
