import { useEffect, useState } from 'react';
import { isSyncWorkspaceBound } from '../lib/sync-workspace';

/** True when a restore in this workspace pauses team sync for reconciliation. */
export function useSyncWorkspaceBound(): boolean {
  const [bound, setBound] = useState(false);
  useEffect(() => {
    let alive = true;
    void isSyncWorkspaceBound().then(value => { if (alive) setBound(value); }, () => {});
    return () => { alive = false; };
  }, []);
  return bound;
}
