import { useLayoutEffect, useSyncExternalStore } from 'react';

// Regions outside every dialog that must stay usable while one is open (the
// workspace-lock warning, marked data-modal-focus-exempt). Screen readers that
// honour aria-modal treat everything outside a dialog as inert, so dialogs drop
// aria-modal while such a region is shown and rely on their own focus trap.
let shown = 0;
const listeners = new Set<() => void>();
const subscribe = (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; };
const change = (delta: number) => { shown += delta; listeners.forEach(listener => listener()); };

/** Registers a data-modal-focus-exempt region while `active`. */
export function useModalFocusExemptRegion(active: boolean): void {
  // Layout effect: dialogs update before the region is painted.
  useLayoutEffect(() => {
    if (!active) return;
    change(1);
    return () => change(-1);
  }, [active]);
}

/** Whether a data-modal-focus-exempt region is shown. */
export function useModalFocusExemptRegionShown(): boolean {
  return useSyncExternalStore(subscribe, () => shown > 0);
}
