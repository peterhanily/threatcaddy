import { useState, useCallback, useEffect, useRef } from 'react';
import { tourSteps } from '../components/Tour/tourSteps';
import type { ViewMode } from '../types';

export interface UseTourOptions {
  onComplete?: () => void;
  /** Called when a tour step requires navigating to a different view. */
  onNavigate?: (view: ViewMode) => void;
  /** Called when a tour step requires the settings panel to be shown/hidden. */
  onShowSettings?: (show: boolean) => void; // kept for settings close on tour start/end
}

export interface TourState {
  isActive: boolean;
  currentStepIndex: number;
  targetRect: DOMRect | null;
}

export function useTour(options?: UseTourOptions) {
  const [isActive, setIsActive] = useState(false);
  const [currentStepIndex, setCurrentStepIndex] = useState(0);
  const [targetRect, setTargetRect] = useState<DOMRect | null>(null);
  const rafRef = useRef<number | undefined>(undefined);
  const stepRef = useRef(0);
  /** The view that was active before the tour started — restored on finish/skip. */
  const preTourViewRef = useRef<ViewMode | null>(null);
  const optionsRef = useRef(options);
  useEffect(() => { optionsRef.current = options; });

  const currentStep = tourSteps[currentStepIndex] ?? null;

  const updateRect = useCallback(() => {
    if (!isActive || !currentStep) {
      setTargetRect(null);
      return;
    }
    const el = document.querySelector(currentStep.target);
    if (el) {
      setTargetRect(el.getBoundingClientRect());
    } else {
      setTargetRect(null);
    }
  }, [isActive, currentStep]);

  // Update rect on step change, scroll, resize — reads external DOM state
  useEffect(() => {
    if (!isActive) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    updateRect();

    const onUpdate = () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      rafRef.current = requestAnimationFrame(updateRect);
    };

    window.addEventListener('scroll', onUpdate, true);
    window.addEventListener('resize', onUpdate);
    return () => {
      window.removeEventListener('scroll', onUpdate, true);
      window.removeEventListener('resize', onUpdate);
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
  }, [isActive, updateRect]);

  /** Navigate to the view required by a step, if specified. */
  const navigateToStepView = useCallback((stepIndex: number) => {
    const step = tourSteps[stepIndex];
    if (step?.view && optionsRef.current?.onNavigate) {
      optionsRef.current.onNavigate(step.view);
    }
    optionsRef.current?.onShowSettings?.(false);
  }, []);

  /** Restore the view that was active before the tour started. */
  const restorePreTourView = useCallback(() => {
    if (preTourViewRef.current && optionsRef.current?.onNavigate) {
      optionsRef.current.onNavigate(preTourViewRef.current);
    }
    preTourViewRef.current = null;
    optionsRef.current?.onShowSettings?.(false);
  }, []);

  const start = useCallback((currentView?: ViewMode) => {
    preTourViewRef.current = currentView ?? null;
    const firstStep = tourSteps[0];
    if (firstStep?.view && optionsRef.current?.onNavigate) {
      optionsRef.current.onNavigate(firstStep.view);
    }
    optionsRef.current?.onShowSettings?.(false);
    stepRef.current = 0;
    setCurrentStepIndex(0);
    setIsActive(true);
  }, []);

  const stop = useCallback(() => {
    setIsActive(false);
    stepRef.current = 0;
    setCurrentStepIndex(0);
    setTargetRect(null);
    restorePreTourView();
  }, [restorePreTourView]);

  const next = useCallback(() => {
    const current = stepRef.current;
    if (current < tourSteps.length - 1) {
      const nextIndex = current + 1;
      stepRef.current = nextIndex;
      navigateToStepView(nextIndex);
      // Small delay to allow view to render before measuring target
      setTimeout(() => setCurrentStepIndex(nextIndex), 50);
    } else {
      setIsActive(false);
      stepRef.current = 0;
      setCurrentStepIndex(0);
      setTargetRect(null);
      restorePreTourView();
      optionsRef.current?.onComplete?.();
    }
  }, [navigateToStepView, restorePreTourView]);

  const prev = useCallback(() => {
    const current = stepRef.current;
    if (current > 0) {
      const prevIndex = current - 1;
      stepRef.current = prevIndex;
      navigateToStepView(prevIndex);
      setTimeout(() => setCurrentStepIndex(prevIndex), 50);
    }
  }, [navigateToStepView]);

  const skip = useCallback(() => {
    setIsActive(false);
    stepRef.current = 0;
    setCurrentStepIndex(0);
    setTargetRect(null);
    restorePreTourView();
    optionsRef.current?.onComplete?.();
  }, [restorePreTourView]);

  // Keyboard navigation
  useEffect(() => {
    if (!isActive) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'ArrowRight') { e.preventDefault(); next(); }
      else if (e.key === 'ArrowLeft') { e.preventDefault(); prev(); }
      else if (e.key === 'Escape') { e.preventDefault(); skip(); }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isActive, next, prev, skip]);

  return {
    isActive,
    currentStepIndex,
    currentStep,
    targetRect,
    totalSteps: tourSteps.length,
    start,
    stop,
    next,
    prev,
    skip,
  };
}
