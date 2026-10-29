import type { IngestionConfig, LocationConfidence } from './types.ts';

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function findMatches(text: string, names: string[]): string[] {
  const found: string[] = [];
  for (const name of names) {
    const m = new RegExp(`(?<![\\w])${escapeRegExp(name)}(?![\\w])`, 'i').exec(text);
    if (m) found.push(m[0]);
  }
  return found;
}

export interface LocationResolution {
  locationText: string | null;
  confidence: LocationConfidence;
}

/** Text-only place recognition. Produces wording, never coordinates. */
export function resolveLocationText(text: string, config: IngestionConfig): LocationResolution {
  const areas = findMatches(text, config.knownAreas);
  const distinct = new Map(areas.map((a) => [a.toLowerCase(), a]));
  if (distinct.size === 1) return { locationText: [...distinct.values()][0], confidence: 'area_text' };
  if (distinct.size > 1) return { locationText: [...distinct.values()].join('; '), confidence: 'ambiguous' };
  const regions = findMatches(text, config.regionTerms);
  if (regions.length > 0) return { locationText: regions.join('; '), confidence: 'region_level' };
  return { locationText: null, confidence: 'none' };
}
