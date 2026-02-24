import { useRef, useLayoutEffect, useState } from 'react';
import { useFocusTrap } from '../../hooks/useFocusTrap';
import type { TourStep } from './tourSteps';

interface TourTooltipProps {
  step: TourStep;
  targetRect: DOMRect | null;
  currentIndex: number;
  totalSteps: number;
  onNext: () => void;
  onPrev: () => void;
  onSkip: () => void;
}

export function TourTooltip({
  step,
  targetRect,
  currentIndex,
  totalSteps,
  onNext,
  onPrev,
  onSkip,
}: TourTooltipProps) {
  const tooltipRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ top: number; left: number }>({ top: 0, left: 0 });
  const [actualPlacement, setActualPlacement] = useState(step.placement);

  useFocusTrap(tooltipRef, true);

  useLayoutEffect(() => {
    if (!targetRect || !tooltipRef.current) return;
    const tooltip = tooltipRef.current;
    const tt = tooltip.getBoundingClientRect();
    const gap = 16;
    const vw = window.innerWidth;
    const vh = window.innerHeight;

    let top = 0;
    let left = 0;
    let placement = step.placement;

    // Calculate position based on placement, fall back if off-screen
    const calc = (p: string) => {
      switch (p) {
        case 'bottom':
          top = targetRect.bottom + gap;
          left = targetRect.left + targetRect.width / 2 - tt.width / 2;
          break;
        case 'top':
          top = targetRect.top - tt.height - gap;
          left = targetRect.left + targetRect.width / 2 - tt.width / 2;
          break;
        case 'right':
          top = targetRect.top + targetRect.height / 2 - tt.height / 2;
          left = targetRect.right + gap;
          break;
        case 'left':
          top = targetRect.top + targetRect.height / 2 - tt.height / 2;
          left = targetRect.left - tt.width - gap;
          break;
      }
    };

    calc(placement);

    // Fallback: if off-screen, try opposite
    if (top < 8 || top + tt.height > vh - 8 || left < 8 || left + tt.width > vw - 8) {
      const opposite: Record<string, string> = { top: 'bottom', bottom: 'top', left: 'right', right: 'left' };
      placement = (opposite[placement] || 'bottom') as TourStep['placement'];
      calc(placement);
    }

    // Clamp within viewport
    left = Math.max(8, Math.min(left, vw - tt.width - 8));
    top = Math.max(8, Math.min(top, vh - tt.height - 8));

    setPos({ top, left });
    setActualPlacement(placement);
  }, [targetRect, step.placement]);

  const isFirst = currentIndex === 0;
  const isLast = currentIndex === totalSteps - 1;

  // Arrow position relative to tooltip
  const arrowStyle: React.CSSProperties = {};
  if (targetRect) {
    switch (actualPlacement) {
      case 'bottom':
        arrowStyle.top = -6;
        arrowStyle.left = '50%';
        arrowStyle.transform = 'translateX(-50%) rotate(45deg)';
        break;
      case 'top':
        arrowStyle.bottom = -6;
        arrowStyle.left = '50%';
        arrowStyle.transform = 'translateX(-50%) rotate(45deg)';
        break;
      case 'right':
        arrowStyle.top = '50%';
        arrowStyle.left = -6;
        arrowStyle.transform = 'translateY(-50%) rotate(45deg)';
        break;
      case 'left':
        arrowStyle.top = '50%';
        arrowStyle.right = -6;
        arrowStyle.transform = 'translateY(-50%) rotate(45deg)';
        break;
    }
  }

  return (
    <div
      ref={tooltipRef}
      className="tour-tooltip"
      style={{ top: pos.top, left: pos.left }}
      role="dialog"
      aria-label={step.title}
    >
      <div className="tour-tooltip-arrow" style={arrowStyle} />
      <div className="flex items-center justify-between mb-2">
        <span className="text-xs text-gray-400 tabular-nums">
          {currentIndex + 1} / {totalSteps}
        </span>
        <button
          onClick={onSkip}
          className="text-xs text-gray-500 hover:text-gray-300 transition-colors"
        >
          Skip tour
        </button>
      </div>
      <h3 className="text-sm font-semibold text-gray-100 mb-1">{step.title}</h3>
      <p className="text-xs text-gray-400 leading-relaxed mb-4">{step.description}</p>

      {/* Progress dots */}
      <div className="flex items-center gap-1 mb-3">
        {Array.from({ length: totalSteps }, (_, i) => (
          <div
            key={i}
            className={`w-1.5 h-1.5 rounded-full transition-colors ${
              i === currentIndex ? 'bg-accent' : i < currentIndex ? 'bg-accent/40' : 'bg-gray-600'
            }`}
          />
        ))}
      </div>

      <div className="flex items-center gap-2">
        {!isFirst && (
          <button
            onClick={onPrev}
            className="px-3 py-1.5 text-xs rounded-lg bg-gray-700 hover:bg-gray-600 text-gray-300 transition-colors"
          >
            Back
          </button>
        )}
        <button
          onClick={onNext}
          className="px-3 py-1.5 text-xs rounded-lg bg-accent hover:bg-accent-hover text-white transition-colors ml-auto"
        >
          {isLast ? 'Finish' : 'Next'}
        </button>
      </div>
    </div>
  );
}
