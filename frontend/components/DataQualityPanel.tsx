import { useState } from 'react';
import { ChevronDown, ChevronRight, Database } from 'lucide-react';
import type { DataQuality } from '../riskEngine/types';

interface DataQualityPanelProps {
  dataQuality: DataQuality;
  defaultOpen?: boolean;
}

export function DataQualityPanel({ dataQuality, defaultOpen = false }: DataQualityPanelProps) {
  const [isOpen, setIsOpen] = useState(defaultOpen);

  return (
    <div className="data-quality-section">
      <button
        type="button"
        className="quality-toggle"
        onClick={() => setIsOpen((open) => !open)}
        aria-expanded={isOpen}
      >
        <span className="eyebrow">
          <Database size={12} /> Data quality & pipeline audit
        </span>
        {isOpen ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
      </button>

      {isOpen && (
        <>
          <div className="quality-stat-grid">
            <div className="quality-stat">
              <span>Hazards Used</span>
              <strong>{dataQuality.hazardsUsed} / {dataQuality.hazardsReceived}</strong>
            </div>
            <div className="quality-stat">
              <span>Near-Dupes Merged</span>
              <strong>{dataQuality.nearDuplicatesMerged}</strong>
            </div>
            <div className="quality-stat">
              <span>Demo Records</span>
              <strong>{dataQuality.demoHazardsCounted}</strong>
            </div>
            <div className={`quality-stat ${dataQuality.missingSeverity > 0 ? 'warn' : ''}`}>
              <span>Assumed Severity</span>
              <strong>{dataQuality.missingSeverity}</strong>
            </div>
            <div className={`quality-stat ${dataQuality.unknownTimestamps > 0 ? 'warn' : ''}`}>
              <span>Missing Timestamps</span>
              <strong>{dataQuality.unknownTimestamps}</strong>
            </div>
            <div className="quality-stat">
              <span>Route Waypoints</span>
              <strong>{dataQuality.routePointsReceived - dataQuality.routePointsDropped}</strong>
            </div>
          </div>

          {dataQuality.rejected.length > 0 && (
            <div className="rejected-list">
              <span className="eyebrow">Excluded / Ignored Records ({dataQuality.rejected.length})</span>
              {dataQuality.rejected.map((item, idx) => (
                <div key={`${item.id ?? 'item'}-${idx}`} className="rejected-item">
                  <strong>{item.id ? `#${item.id}` : 'Unidentified'}:</strong> {item.reason}
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}

