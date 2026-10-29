export type ExternalIncident = {
  id: string;
  description: string;
  category: string;
  publishedAt: string;
  sourceUrl: string;
  sourceName: string;
  locationText: string | null;
  locationConfidence: string;
  isStale: boolean;
  qualityFlags: string[];
};

export type IncidentSourceStatus = {
  sourceId: string;
  status: 'ok' | 'failed';
  errorMessage?: string;
};

export type IngestionResult = {
  retrievedAt: string;
  incidents: ExternalIncident[];
  sources: IncidentSourceStatus[];
};

export async function fetchExternalIncidents(signal: AbortSignal): Promise<IngestionResult> {
  let response: Response;
  try {
    response = await fetch('/api/incidents', { headers: { Accept: 'application/json' }, signal });
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') throw error;
    throw new Error('Unable to reach the hazard ingestion API. Start the local API server and try again.');
  }

  const body: unknown = await response.json().catch(() => null);
  if (
    !body
    || typeof body !== 'object'
    || !('incidents' in body)
    || !Array.isArray(body.incidents)
    || !('sources' in body)
    || !Array.isArray(body.sources)
  ) {
    const detail = body && typeof body === 'object' && 'error' in body && typeof body.error === 'string'
      ? body.error
      : response.status === 502 || response.status === 504 || response.status === 404
        ? 'The live data API is not reachable. Start it with "npm run dev:api".'
        : `The API returned an invalid response (HTTP ${response.status}).`;
    throw new Error(detail);
  }

  return body as IngestionResult;
}