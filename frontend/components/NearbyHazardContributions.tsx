import { useState } from 'react';
import { AlertTriangle, ChevronDown, ChevronRight, ShieldAlert } from 'lucide-react';
import type { HazardContribution } from '../riskEngine/types';

interface NearbyHazardContributionsProps {
  nearbyHazards: HazardContribution[];
  onSelectHazard?: (hazardId: string) => void;
}

export function NearbyHazardContributions({ nearbyHazards, onSelectHazard }: NearbyHazardContributionsProps) {
  const [isOpen, setIsOpen] = useState(true);

  if (nearbyHazards.length === 0) {
    return null;
  }

  return (
    <div className="hazard-contributions">
      <button
        type="button"
        className="contribution-toggle"
        onClick={() => setIsOpen((open) => !open)}
        aria-expanded={isOpen}
      >
        <span className="eyebrow">
          <ShieldAlert size={12} /> Route corridor hazards ({nearbyHazards.length})
        </span>
        {isOpen ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
      </button>

      {isOpen && (
        <div className="contribution-list">
          {nearbyHazards.map((hazard) => {
            const severityClass = hazard.severityLevel >= 4 ? 'high' : hazard.severityLevel >= 3 ? 'medium' : 'low';
            const formattedType = hazard.type.replace(/_/g, ' ');

            return (
              <div
                key={hazard.hazardId}
                className={`contribution-item ${hazard.isCritical ? 'critical' : ''}`}
                onClick={() => onSelectHazard?.(hazard.hazardId)}
                style={{ cursor: onSelectHazard ? 'pointer' : 'default' }}
              >
                <div className={`contribution-icon ${severityClass}`}>
                  <AlertTriangle size={15} />
                </div>

                <div className="contribution-main">
                  <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap' }}>
                    <h4 className="contribution-type">{formattedType}</h4>
                    {hazard.isCritical && <span className="risk-chip danger" style={{ fontSize: '8px', padding: '1px 4px' }}>Critical</span>}
                    {hazard.hasReliableBlockingEvidence && <span className="risk-chip danger" style={{ fontSize: '8px', padding: '1px 4px' }}>Closure</span>}
                  </div>
                  <div className="contribution-meta">
                    <span>{Math.round(hazard.distanceToRouteM)} m from route</span>
                    <span>Sev {hazard.severityLevel}/5{hazard.severityAssumed ? ' (est)' : ''}</span>
                    <span>{hazard.verification}</span>
                    {hazard.ageDays !== null && <span>{hazard.ageDays < 1 ? 'today' : `${Math.round(hazard.ageDays)}d ago`}</span>}
                    {hazard.corroboratingReports > 0 && <span>+{hazard.corroboratingReports} corroborated</span>}
                  </div>

                  <div className="contribution-factors">
                    <div className="contribution-factor">
                      <span>Sev</span>
                      <strong>{Math.round(hazard.factors.severity * 100)}%</strong>
                    </div>
                    <div className="contribution-factor">
                      <span>Rec</span>
                      <strong>{Math.round(hazard.factors.recency * 100)}%</strong>
                    </div>
                    <div className="contribution-factor">
                      <span>Prox</span>
                      <strong>{Math.round(hazard.factors.proximity * 100)}%</strong>
                    </div>
                    <div className="contribution-factor">
                      <span>Evid</span>
                      <strong>{Math.round(hazard.factors.evidence * 100)}%</strong>
                    </div>
                  </div>
                </div>

                <div className="contribution-score">
                  +{hazard.standalonePoints}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

