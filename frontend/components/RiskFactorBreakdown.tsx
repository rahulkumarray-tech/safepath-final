import { useState } from 'react';
import { ChevronDown, ChevronRight, Sliders } from 'lucide-react';
import type { FactorSummary, ScoreComponents } from '../riskEngine/types';

interface RiskFactorBreakdownProps {
  factorSummary: FactorSummary;
  scoreComponents: ScoreComponents;
  totalScore: number;
}

export function RiskFactorBreakdown({ factorSummary, scoreComponents, totalScore }: RiskFactorBreakdownProps) {
  const [isOpen, setIsOpen] = useState(true);

  const factors = [
    {
      label: 'Severity',
      value: factorSummary.severity,
      display: factorSummary.severity !== null ? `${Math.round(factorSummary.severity * 100)}%` : 'N/A',
      pct: factorSummary.severity !== null ? Math.round(factorSummary.severity * 100) : 0,
      color: (factorSummary.severity ?? 0) >= 0.7 ? 'red' : (factorSummary.severity ?? 0) >= 0.4 ? 'amber' : 'green',
    },
    {
      label: 'Recency',
      value: factorSummary.recency,
      display: factorSummary.recency !== null ? `${Math.round(factorSummary.recency * 100)}%` : 'N/A',
      pct: factorSummary.recency !== null ? Math.round(factorSummary.recency * 100) : 0,
      color: (factorSummary.recency ?? 0) >= 0.7 ? 'red' : (factorSummary.recency ?? 0) >= 0.4 ? 'amber' : 'green',
    },
    {
      label: 'Proximity',
      value: factorSummary.proximity,
      display: factorSummary.proximity !== null ? `${Math.round(factorSummary.proximity * 100)}%` : 'N/A',
      pct: factorSummary.proximity !== null ? Math.round(factorSummary.proximity * 100) : 0,
      color: (factorSummary.proximity ?? 0) >= 0.7 ? 'red' : (factorSummary.proximity ?? 0) >= 0.4 ? 'amber' : 'green',
    },
    {
      label: 'Evidence',
      value: factorSummary.evidence,
      display: factorSummary.evidence !== null ? `${Math.round(factorSummary.evidence * 100)}%` : 'N/A',
      pct: factorSummary.evidence !== null ? Math.round(factorSummary.evidence * 100) : 0,
      color: (factorSummary.evidence ?? 0) >= 0.7 ? 'green' : (factorSummary.evidence ?? 0) >= 0.4 ? 'amber' : 'red',
    },
  ];

  return (
    <div className="factor-breakdown">
      <button
        type="button"
        className="factor-breakdown-heading"
        onClick={() => setIsOpen((open) => !open)}
        aria-expanded={isOpen}
      >
        <span className="eyebrow">
          <Sliders size={12} /> Model factor breakdown
        </span>
        {isOpen ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
      </button>

      {isOpen && (
        <>
          <div className="factor-bar-group">
            {factors.map((factor) => (
              <div className="factor-bar-row" key={factor.label}>
                <span className="factor-bar-label">{factor.label}</span>
                <div className="factor-bar-track" role="progressbar" aria-valuenow={factor.pct} aria-valuemin={0} aria-valuemax={100}>
                  <div
                    className={`factor-bar-fill ${factor.color}`}
                    style={{ width: `${factor.pct}%` }}
                  />
                </div>
                <span className="factor-bar-value">{factor.display}</span>
              </div>
            ))}
          </div>

          <div className="score-composition">
            <div className="composition-cell">
              <span>Primary Hazard</span>
              <strong>{scoreComponents.strongestHazardPoints} pts</strong>
              <small>From highest-impact incident</small>
            </div>
            <div className="composition-cell">
              <span>Accumulated Risk</span>
              <strong>{scoreComponents.accumulationPoints} pts</strong>
              <small>Compounded secondary risks</small>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

