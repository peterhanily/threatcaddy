import { useEffect, useRef, useCallback } from 'react';
import type { ViewMode } from '../types';

export interface NavState {
  view: ViewMode;
  selectedNoteId?: string;
  selectedTimelineId?: string;
  selectedWhiteboardId?: string;
}

interface UseNavigationHistoryOptions {
  onViewChange: (state: NavState) => void;
}

/**
 * Manages browser history so back/forward buttons navigate between app views
 * instead of leaving the page.
 */
export function useNavigationHistory({ onViewChange }: UseNavigationHistoryOptions) {
  const isPoppingRef = useRef(false);
  const onViewChangeRef = useRef(onViewChange);
  useEffect(() => {
    onViewChangeRef.current = onViewChange;
  }, [onViewChange]);

  // Replace initial state on mount so first back doesn't leave the page
  useEffect(() => {
    if (!window.history.state?.__bn) {
      const initial: NavState = { view: 'notes' };
      window.history.replaceState({ __bn: true, ...initial }, '');
    }

    const handlePopState = (e: PopStateEvent) => {
      if (!e.state?.__bn) return;
      isPoppingRef.current = true;
      const state: NavState = {
        view: e.state.view ?? 'notes',
        selectedNoteId: e.state.selectedNoteId,
        selectedTimelineId: e.state.selectedTimelineId,
        selectedWhiteboardId: e.state.selectedWhiteboardId,
      };
      onViewChangeRef.current(state);
      // Reset popping flag after microtask so navigate() called from the
      // callback won't push a duplicate entry
      queueMicrotask(() => { isPoppingRef.current = false; });
    };

    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
  }, []);

  const navigate = useCallback((state: NavState) => {
    if (isPoppingRef.current) return;
    window.history.pushState({ __bn: true, ...state }, '');
  }, []);

  return { navigate };
}
