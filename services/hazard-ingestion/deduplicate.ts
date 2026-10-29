import type { NormalizedIncident } from './types.ts';

export interface DuplicateRecord {
  incident: NormalizedIncident;
  duplicateOfId: string | null;
  reason: 'same_canonical_url' | 'same_domain_and_headline' | 'already_stored';
}

export interface DedupeResult {
  unique: NormalizedIncident[];
  duplicates: DuplicateRecord[];
}

function headlineKey(incident: NormalizedIncident): string {
  const host = new URL(incident.sourceUrl).hostname;
  const text = incident.description.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
  return `${host}|${text}`;
}

/**
 * First occurrence in input order wins. Duplicates are detected by (1) identical stable id
 * (= same source + canonical URL) and (2) same domain + identical normalized headline.
 * Different domains reporting the same event are NOT merged and are NOT corroboration.
 */
export function deduplicateIncidents(incidents: NormalizedIncident[], existingIds: ReadonlySet<string> = new Set()): DedupeResult {
  const byId = new Map<string, NormalizedIncident>();
  const byHeadline = new Map<string, NormalizedIncident>();
  const unique: NormalizedIncident[] = [];
  const duplicates: DuplicateRecord[] = [];

  for (const incident of incidents) {
    if (existingIds.has(incident.id)) {
      duplicates.push({ incident, duplicateOfId: incident.id, reason: 'already_stored' });
      continue;
    }
    const sameUrl = byId.get(incident.id);
    if (sameUrl) {
      duplicates.push({ incident, duplicateOfId: sameUrl.id, reason: 'same_canonical_url' });
      continue;
    }
    const key = headlineKey(incident);
    const sameHeadline = byHeadline.get(key);
    if (sameHeadline) {
      duplicates.push({ incident, duplicateOfId: sameHeadline.id, reason: 'same_domain_and_headline' });
      continue;
    }
    byId.set(incident.id, incident);
    byHeadline.set(key, incident);
    unique.push(incident);
  }
  return { unique, duplicates };
}
