import { useState, useCallback, useEffect, useRef } from 'react';
import { tourSteps } from '../components/Tour/tourSteps';

export interface UseTourOptions {
  onComplete?: () => void;
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

  // Update rect on step change, scroll, resize
  useEffect(() => {
    if (!isActive) return;
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

  const start = useCallback(() => {
    setCurrentStepIndex(0);
    setIsActive(true);
  }, []);

  const stop = useCallback(() => {
    setIsActive(false);
    setCurrentStepIndex(0);
    setTargetRect(null);
  }, []);

  const next = useCallback(() => {
    if (currentStepIndex < tourSteps.length - 1) {
      const nextIndex = currentStepIndex + 1;
      const nextStep = tourSteps[nextIndex];
      nextStep?.beforeShow?.();
      setCurrentStepIndex(nextIndex);
    } else {
      setIsActive(false);
      setCurrentStepIndex(0);
      setTargetRect(null);
      options?.onComplete?.();
    }
  }, [currentStepIndex, options]);

  const prev = useCallback(() => {
    if (currentStepIndex > 0) {
      const prevIndex = currentStepIndex - 1;
      const prevStep = tourSteps[prevIndex];
      prevStep?.beforeShow?.();
      setCurrentStepIndex(prevIndex);
    }
  }, [currentStepIndex]);

  const skip = useCallback(() => {
    setIsActive(false);
    setCurrentStepIndex(0);
    setTargetRect(null);
    options?.onComplete?.();
  }, [options]);

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
