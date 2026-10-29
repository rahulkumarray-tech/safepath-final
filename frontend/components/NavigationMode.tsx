import { useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  ArrowRight,
  Compass,
  CornerDownRight,
  CornerUpLeft,
  CornerUpRight,
  Flag,
  MapPin,
  Navigation,
  Pause,
  Play,
  SkipBack,
  SkipForward,
  X,
} from 'lucide-react';
import type { Route } from '../types/route';
import type { RouteRiskResult } from '../riskEngine/types';
import { formatDistance, formatDuration } from '../utils/format';

interface NavigationModeProps {
  route: Route;
  riskResult: RouteRiskResult | null;
  originName: string;
  destinationName: string;
  onClose: () => void;
}

interface NavStep {
  id: number;
  instruction: string;
  subtext: string;
  distanceMeters: number;
  durationSeconds: number;
  icon: 'start' | 'left' | 'right' | 'straight' | 'destination';
  warning?: string;
}

export function NavigationMode({
  route,
  riskResult,
  originName,
  destinationName,
  onClose,
}: NavigationModeProps) {
  const [currentStepIndex, setCurrentStepIndex] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);

  // Generate realistic navigation steps based on route distance and hazards
  const steps = useMemo<NavStep[]>(() => {
    const totalDist = route.distanceMeters;
    const totalDur = route.durationSeconds;

    const nearby = riskResult?.nearbyHazards ?? [];
    const firstHazard = nearby[0];
    const secondHazard = nearby[1];

    const generatedSteps: NavStep[] = [
      {
        id: 1,
        instruction: `Start from ${originName.split(',')[0]}`,
        subtext: 'Head toward the main exit road',
        distanceMeters: Math.round(totalDist * 0.1),
        durationSeconds: Math.round(totalDur * 0.1),
        icon: 'start',
      },
      {
        id: 2,
        instruction: 'Turn right onto the main arterial corridor',
        subtext: 'Merge with traffic flow and maintain speed',
        distanceMeters: Math.round(totalDist * 0.25),
        durationSeconds: Math.round(totalDur * 0.25),
        icon: 'right',
        warning: firstHazard ? `Caution: ${firstHazard.type.replace(/_/g, ' ')} reported within ${Math.round(firstHazard.distanceToRouteM)} m of this leg` : undefined,
      },
      {
        id: 3,
        instruction: 'Continue straight through central transit junction',
        subtext: 'Follow signs toward downtown avenue',
        distanceMeters: Math.round(totalDist * 0.35),
        durationSeconds: Math.round(totalDur * 0.35),
        icon: 'straight',
        warning: secondHazard ? `Hazard alert: ${secondHazard.type.replace(/_/g, ' ')} (${secondHazard.verification})` : undefined,
      },
      {
        id: 4,
        instruction: 'Turn left onto the destination access avenue',
        subtext: 'Prepare to slow down for campus gates',
        distanceMeters: Math.round(totalDist * 0.2),
        durationSeconds: Math.round(totalDur * 0.2),
        icon: 'left',
      },
      {
        id: 5,
        instruction: `Arrive at ${destinationName.split(',')[0]}`,
        subtext: 'Destination is on your left',
        distanceMeters: Math.round(totalDist * 0.1),
        durationSeconds: Math.round(totalDur * 0.1),
        icon: 'destination',
      },
    ];

    return generatedSteps;
  }, [route, riskResult, originName, destinationName]);

  // Auto-play simulation timer
  useEffect(() => {
    if (!isPlaying) return;

    const interval = setInterval(() => {
      setCurrentStepIndex((prev) => {
        if (prev < steps.length - 1) {
          return prev + 1;
        } else {
          setIsPlaying(false);
          return prev;
        }
      });
    }, 2800);

    return () => clearInterval(interval);
  }, [isPlaying, steps.length]);

  const currentStep = steps[currentStepIndex] ?? steps[0];
  const progressPct = Math.round(((currentStepIndex + 1) / steps.length) * 100);

  const remainingDist = steps
    .slice(currentStepIndex)
    .reduce((acc, step) => acc + step.distanceMeters, 0);

  const remainingDur = steps
    .slice(currentStepIndex)
    .reduce((acc, step) => acc + step.durationSeconds, 0);

  const getStepIcon = (icon: NavStep['icon']) => {
    switch (icon) {
      case 'left':
        return <CornerUpLeft size={16} />;
      case 'right':
        return <CornerDownRight size={16} />;
      case 'straight':
        return <ArrowRight size={16} />;
      case 'start':
        return <Navigation size={16} />;
      case 'destination':
        return <Flag size={16} />;
    }
  };

  return (
    <div className="navigation-overlay" role="dialog" aria-modal="true" aria-label="Demo turn navigation mode">
      <div className="navigation-card">
        <div className="nav-preview-map">
          <div className="nav-map-grid" />
          <div className="nav-route-line" />
          <div className="nav-pulse" style={{ left: `${20 + currentStepIndex * 15}%` }} />
          <div className="nav-compass">
            <Compass size={18} />
          </div>
          <div className="nav-location-label">
            <MapPin size={12} style={{ display: 'inline', marginRight: '4px', verticalAlign: '-1px' }} />
            {currentStep.instruction}
          </div>
          <button
            type="button"
            className="icon-button"
            onClick={onClose}
            aria-label="Exit navigation"
            style={{ position: 'absolute', top: '14px', left: '14px', background: 'rgba(255,255,255,0.92)' }}
          >
            <X size={16} />
          </button>
        </div>

        <div className="navigation-content">
          <div className="nav-progress-label">
            <span>Step {currentStepIndex + 1} of {steps.length} · Demo guidance</span>
            <strong>{progressPct}% completed</strong>
          </div>
          <div className="progress-track" role="progressbar" aria-valuenow={progressPct} aria-valuemin={0} aria-valuemax={100}>
            <span style={{ width: `${progressPct}%` }} />
          </div>

          <div className="nav-callout">
            <div style={{ color: 'var(--green-deep)', paddingTop: '2px' }}>
              {getStepIcon(currentStep.icon)}
            </div>
            <div style={{ flex: 1 }}>
              <strong>{currentStep.instruction}</strong>
              <p>{currentStep.subtext}</p>
              {currentStep.warning && (
                <div style={{ display: 'flex', alignItems: 'center', gap: '5px', marginTop: '6px', color: 'var(--amber)', fontSize: '10px', fontWeight: 600 }}>
                  <AlertTriangle size={13} />
                  <span>{currentStep.warning}</span>
                </div>
              )}
            </div>
            <div style={{ textAlign: 'right', minWidth: '60px' }}>
              <span className="metric-label">Leg</span>
              <strong style={{ fontSize: '13px' }}>{formatDistance(currentStep.distanceMeters)}</strong>
            </div>
          </div>

          <div className="nav-info-grid">
            <div className="nav-info-cell">
              <span>Remaining Distance</span>
              <strong>{formatDistance(remainingDist)}</strong>
            </div>
            <div className="nav-info-cell">
              <span>Estimated Time</span>
              <strong>{formatDuration(remainingDur)}</strong>
            </div>
            <div className="nav-info-cell">
              <span>Mode</span>
              <strong style={{ color: 'var(--green)' }}>Simulated Drive</strong>
            </div>
          </div>

          <div className="nav-turn-list">
            {steps.map((step, idx) => {
              const isCurrent = idx === currentStepIndex;
              const isPast = idx < currentStepIndex;
              return (
                <div
                  key={step.id}
                  className={`nav-turn ${isCurrent ? 'active' : ''} ${isPast ? 'completed' : ''}`}
                  onClick={() => {
                    setCurrentStepIndex(idx);
                    setIsPlaying(false);
                  }}
                  style={{ cursor: 'pointer' }}
                >
                  <div className="nav-turn-number">
                    {isPast ? '✓' : idx + 1}
                  </div>
                  <div className="nav-turn-text">
                    <strong>{step.instruction}</strong>
                    <small>{step.subtext}</small>
                  </div>
                  <div className="nav-turn-dist">
                    {formatDistance(step.distanceMeters)}
                  </div>
                </div>
              );
            })}
          </div>

          <div className="nav-actions">
            <div>
              <button
                type="button"
                className="nav-step-button"
                onClick={() => {
                  setCurrentStepIndex((prev) => Math.max(0, prev - 1));
                  setIsPlaying(false);
                }}
                disabled={currentStepIndex === 0}
                aria-label="Previous step"
              >
                <SkipBack size={14} /> Back
              </button>
              <button
                type="button"
                className={`nav-step-button ${isPlaying ? '' : 'primary'}`}
                onClick={() => setIsPlaying((p) => !p)}
                aria-label={isPlaying ? 'Pause simulation' : 'Play simulation'}
              >
                {isPlaying ? <><Pause size={14} /> Pause</> : <><Play size={14} /> Auto-play</>}
              </button>
              <button
                type="button"
                className="nav-step-button"
                onClick={() => {
                  setCurrentStepIndex((prev) => Math.min(steps.length - 1, prev + 1));
                  setIsPlaying(false);
                }}
                disabled={currentStepIndex === steps.length - 1}
                aria-label="Next step"
              >
                Next <SkipForward size={14} />
              </button>
            </div>

            <button type="button" className="secondary-button" onClick={onClose}>
              End guidance
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

