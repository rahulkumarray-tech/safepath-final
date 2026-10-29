import { createHash } from 'node:crypto';

const TRACKING_PARAMS = /^(utm_.+|fbclid|gclid|mc_cid|mc_eid|igshid|ref|ref_src|ocid|cmpid)$/i;

/** Canonical form for dedupe: http(s) only, lowercase host (no leading www.), no fragment/tracking, sorted query. */
export function canonicalizeUrl(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  let url: URL;
  try {
    url = new URL(value.trim());
  } catch {
    return null;
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
  if (!url.hostname) return null;
  url.hostname = url.hostname.toLowerCase().replace(/^www\./, '');
  url.hash = '';
  url.protocol = 'https:';
  const kept = [...url.searchParams.entries()].filter(([k]) => !TRACKING_PARAMS.test(k));
  kept.sort(([a], [b]) => a.localeCompare(b));
  url.search = '';
  for (const [k, v] of kept) url.searchParams.append(k, v);
  if (url.pathname.length > 1) url.pathname = url.pathname.replace(/\/+$/, '');
  return url.toString();
}

export function stableIncidentId(sourceId: string, canonicalUrl: string): string {
  const hash = createHash('sha256').update(`${sourceId}|${canonicalUrl}`).digest('hex').slice(0, 16);
  return `ext-${sourceId}-${hash}`;
}
