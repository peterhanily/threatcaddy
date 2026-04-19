import { useRef, useLayoutEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useFocusTrap } from '../../hooks/useFocusTrap';
import type { TourStep } from './tourSteps';

type Placement = 'top' | 'bottom' | 'left' | 'right';

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
  const { t } = useTranslation('tour');
  const tooltipRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ top: number; left: number }>({ top: 0, left: 0 });
  const [actualPlacement, setActualPlacement] = useState<Placement>(step.placement);

  useFocusTrap(tooltipRef, true);

  useLayoutEffect(() => {
    if (!targetRect || !tooltipRef.current) return;
    const tooltip = tooltipRef.current;
    const tt = tooltip.getBoundingClientRect();
    const gap = 16;
    const margin = 8;
    const vw = window.innerWidth;
    const vh = window.innerHeight;

    const placements: Placement[] = ['bottom', 'top', 'right', 'left'];

    const computePos = (p: Placement): { top: number; left: number } => {
      switch (p) {
        case 'bottom':
          return {
            top: targetRect.bottom + gap,
            left: targetRect.left + targetRect.width / 2 - tt.width / 2,
          };
        case 'top':
          return {
            top: targetRect.top - tt.height - gap,
            left: targetRect.left + targetRect.width / 2 - tt.width / 2,
          };
        case 'right':
          return {
            top: targetRect.top + targetRect.height / 2 - tt.height / 2,
            left: targetRect.right + gap,
          };
        case 'left':
          return {
            top: targetRect.top + targetRect.height / 2 - tt.height / 2,
            left: targetRect.left - tt.width - gap,
          };
      }
    };

    const rectsOverlap = (
      ax: number, ay: number, aw: number, ah: number,
      bx: number, by: number, bw: number, bh: number,
    ) => ax < bx + bw && ax + aw > bx && ay < by + bh && ay + ah > by;

    let bestPlacement: Placement = step.placement;
    let bestScore = -Infinity;
    let bestPos = { top: 0, left: 0 };

    for (const p of placements) {
      const raw = computePos(p);
      // Clamp to viewport
      const clamped = {
        top: Math.max(margin, Math.min(raw.top, vh - tt.height - margin)),
        left: Math.max(margin, Math.min(raw.left, vw - tt.width - margin)),
      };

      // Score: negative overflow
      const overflowTop = Math.max(0, margin - raw.top);
      const overflowBottom = Math.max(0, (raw.top + tt.height + margin) - vh);
      const overflowLeft = Math.max(0, margin - raw.left);
      const overflowRight = Math.max(0, (raw.left + tt.width + margin) - vw);
      let score = -(overflowTop + overflowBottom + overflowLeft + overflowRight);

      // Preference bonus for declared placement
      if (p === step.placement) score += 5;

      // Heavy penalty if tooltip overlaps target
      if (rectsOverlap(
        clamped.left, clamped.top, tt.width, tt.height,
        targetRect.left, targetRect.top, targetRect.width, targetRect.height,
      )) {
        score -= 1000;
      }

      if (score > bestScore) {
        bestScore = score;
        bestPlacement = p;
        bestPos = clamped;
      }
    }

    // Layout effects synchronize with the DOM — setState here is intentional
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setPos(bestPos);
    setActualPlacement(bestPlacement);
  }, [targetRect, step.placement]);

  const isFirst = currentIndex === 0;
  const isLast = currentIndex === totalSteps - 1;

  // Arrow position relative to tooltip
  const arrowStyle: React.CSSProperties = {};
  if (targetRect) {
    switch (actualPlacement) {
      case 'bottom':
        arrowStyle.top = -5;
        arrowStyle.left = '50%';
        arrowStyle.transform = 'translateX(-50%) rotate(45deg)';
        break;
      case 'top':
        arrowStyle.bottom = -5;
        arrowStyle.left = '50%';
        arrowStyle.transform = 'translateX(-50%) rotate(45deg)';
        break;
      case 'right':
        arrowStyle.top = '50%';
        arrowStyle.left = -5;
        arrowStyle.transform = 'translateY(-50%) rotate(45deg)';
        break;
      case 'left':
        arrowStyle.top = '50%';
        arrowStyle.right = -5;
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
          {t('stepCounter', { current: currentIndex + 1, total: totalSteps })}
        </span>
        <button
          onClick={onSkip}
          className="text-xs text-gray-500 hover:text-gray-300 transition-colors"
        >
          {t('skipTour')}
        </button>
      </div>
      <h3 className="text-sm font-semibold text-gray-100 mb-1">{step.title}</h3>
      <p className="text-xs text-gray-400 leading-relaxed mb-2.5">{step.description}</p>

      {/* Progress dots */}
      <div className="flex items-center gap-1 mb-2">
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
            {t('back')}
          </button>
        )}
        <button
          onClick={onNext}
          className="px-3 py-1.5 text-xs rounded-lg bg-accent hover:bg-accent-hover text-white transition-colors ms-auto"
        >
          {isLast ? t('finish') : t('next')}
        </button>
      </div>
    </div>
  );
}
