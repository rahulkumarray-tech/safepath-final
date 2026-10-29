import { useMemo } from 'react';
import { ArrowUpRight, Globe, RefreshCw } from 'lucide-react';
import { useLiveIncidents } from '../hooks/useLiveIncidents';
import { formatClockTime, formatRelativeTime } from '../utils/format';

const REFRESH_INTERVAL_MS = 60_000;

export function LiveReportsPanel() {
  const { data, error, loading, updatedAt, refresh } = useLiveIncidents(REFRESH_INTERVAL_MS);

  const incidents = useMemo(() => {
    const list = data?.incidents ?? [];
    return [...list]
      .sort((a, b) => Date.parse(b.publishedAt) - Date.parse(a.publishedAt))
      .slice(0, 3);
  }, [data]);

  const failedSources = data?.sources.filter((source) => source.status === 'failed') ?? [];
  const statusLabel = error ? 'Offline' : loading && !data ? 'Syncing' : 'Live';
  const statusClass = error ? 'neutral' : loading && !data ? 'warn' : 'good';

  return (
    <section className="panel-card live-reports-card" aria-label="Live external reports">
      <div className="live-reports-head">
        <div>
          <div className="eyebrow"><Globe size={11} /> Live internet news</div>
          <h2>Latest Guwahati road reports</h2>
        </div>
        <div className="live-reports-actions">
          <span className={`status-label ${statusClass}`}>{statusLabel}</span>
          <button
            type="button"
            className="icon-button"
            onClick={refresh}
            title="Refresh live news"
            aria-label="Refresh live news"
            disabled={loading}
          >
            <RefreshCw size={14} className={loading ? 'spin-icon' : undefined} />
          </button>
        </div>
      </div>

      <p className="live-reports-note">
        Unverified headlines from Google News RSS. They carry no coordinates, so they never change route scores.
      </p>

      {error && <div className="routing-message error-message" role="alert">{error}</div>}

      {!error && incidents.length === 0 && (
        <div className="routing-message">
          {loading ? 'Fetching live news…' : 'No Guwahati road reports in the current news window.'}
        </div>
      )}

      {incidents.length > 0 && (
        <ul className="live-report-list">
          {incidents.map((incident) => (
            <li key={incident.id} className="live-report-item">
              <a href={incident.sourceUrl} target="_blank" rel="noreferrer">
                <strong>{incident.description}</strong>
                <span className="live-report-meta">
                  {incident.sourceName} · {formatClockTime(incident.publishedAt)} · {incident.isStale ? 'older report' : 'recent'}
                  <ArrowUpRight size={11} />
                </span>
              </a>
            </li>
          ))}
        </ul>
      )}

      <div className="live-reports-foot">
        <span>{updatedAt ? `Updated ${formatRelativeTime(updatedAt)}` : 'Waiting for first sync'} · auto-refresh every 60 s</span>
        {failedSources.length > 0 && <span className="live-reports-warn">{failedSources.map((source) => source.sourceId).join(', ')} unavailable</span>}
      </div>
    </section>
  );
}
