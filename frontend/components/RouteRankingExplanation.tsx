import { useState } from 'react';
import { ChevronDown, ChevronRight, HelpCircle } from 'lucide-react';

interface RouteRankingExplanationProps {
  explanations: string[];
  rank: number;
}

export function RouteRankingExplanation({ explanations, rank }: RouteRankingExplanationProps) {
  const [isOpen, setIsOpen] = useState(false);

  if (!explanations || explanations.length === 0) {
    return null;
  }

  return (
    <div className="ranking-explanation" onClick={(e) => e.stopPropagation()}>
      <button
        type="button"
        className="text-button"
        style={{ fontSize: '9px', display: 'inline-flex', alignItems: 'center', gap: '4px', padding: '2px 0' }}
        onClick={() => setIsOpen((open) => !open)}
        aria-expanded={isOpen}
      >
        <HelpCircle size={11} />
        <span>{isOpen ? 'Hide ranking explanation' : `Why is this ranked #${rank}?`}</span>
        {isOpen ? <ChevronDown size={11} /> : <ChevronRight size={11} />}
      </button>

      {isOpen && (
        <div className="ranking-explanation-list">
          {explanations.map((item, index) => (
            <div key={index} style={{ display: 'flex', alignItems: 'flex-start', gap: '4px' }}>
              <span style={{ color: 'var(--green)', fontWeight: 'bold' }}>•</span>
              <span>{item}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

