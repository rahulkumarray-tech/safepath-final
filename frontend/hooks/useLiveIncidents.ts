import { useCallback, useEffect, useRef, useState } from 'react';
import { fetchExternalIncidents } from '../services/incidents';
import type { IngestionResult } from '../services/incidents';

export interface LiveIncidentsState {
  data: IngestionResult | null;
  error: string;
  loading: boolean;
  /** Local timestamp of the last successful fetch. */
  updatedAt: number | null;
  refresh: () => void;
}

/**
 * Polls the ingestion API so the UI shows current news without a manual refresh.
 * Refetches when the tab becomes visible again, and aborts stale requests.
 */
export function useLiveIncidents(refreshMs = 60_000): LiveIncidentsState {
  const [data, setData] = useState<IngestionResult | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [updatedAt, setUpdatedAt] = useState<number | null>(null);
  const [requestNumber, setRequestNumber] = useState(0);
  const controllerRef = useRef<AbortController | null>(null);

  useEffect(() => {
    let cancelled = false;

    const load = async (showSpinner: boolean) => {
      controllerRef.current?.abort();
      const controller = new AbortController();
      controllerRef.current = controller;
      if (showSpinner) setLoading(true);

      try {
        const result = await fetchExternalIncidents(controller.signal);
        if (cancelled) return;
        setData(result);
        setError('');
        setUpdatedAt(Date.now());
      } catch (loadError) {
        if (cancelled || (loadError instanceof Error && loadError.name === 'AbortError')) return;
        setError(loadError instanceof Error ? loadError.message : 'Unable to load live reports.');
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    void load(true);
    const timer = window.setInterval(() => { void load(false); }, refreshMs);
    const onVisibilityChange = () => {
      if (document.visibilityState === 'visible') void load(false);
    };
    document.addEventListener('visibilitychange', onVisibilityChange);

    return () => {
      cancelled = true;
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisibilityChange);
      controllerRef.current?.abort();
    };
  }, [refreshMs, requestNumber]);

  const refresh = useCallback(() => setRequestNumber((value) => value + 1), []);

  return { data, error, loading, updatedAt, refresh };
}
