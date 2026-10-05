import { useState, useEffect, useLayoutEffect, useCallback, useRef, useMemo } from 'react';
import type { InvestigationSummary } from '../types';
import { fetchInvestigations } from '../lib/server-api';

interface UseRemoteInvestigationsResult {
  remoteInvestigations: InvestigationSummary[];
  loading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
}

export function useRemoteInvestigations(
  serverConnected: boolean,
  serverUrl?: string,
): UseRemoteInvestigationsResult {
  const scope = useMemo(() => ({ serverConnected, serverUrl }), [serverConnected, serverUrl]);
  const [snapshot, setSnapshot] = useState<{
    scope: typeof scope;
    remoteInvestigations: InvestigationSummary[];
    loading: boolean;
    error: string | null;
  }>({ scope, remoteInvestigations: [], loading: serverConnected, error: null });
  const activeScope = useRef<typeof scope | null>(null);
  const activeRequest = useRef<{ scope: typeof scope } | null>(null);

  useLayoutEffect(() => {
    activeScope.current = scope;
    return () => {
      activeScope.current = null;
      activeRequest.current = null;
    };
  }, [scope]);

  const doFetch = useCallback(async () => {
    // Retained refresh callbacks and old promises cannot acquire a new server's
    // state, or keep its initial refresh blocked behind an old request.
    if (!serverConnected || activeScope.current !== scope || activeRequest.current?.scope === scope) return;
    const request = { scope };
    activeRequest.current = request;
    const current = () => activeScope.current === scope && activeRequest.current === request;
    setSnapshot(previous => ({
      scope,
      remoteInvestigations: previous.scope === scope ? previous.remoteInvestigations : [],
      loading: true,
      error: null,
    }));
    try {
      const response = await fetchInvestigations();
      const investigations = (response as { data: InvestigationSummary[] }).data ?? [];
      if (current()) setSnapshot({ scope, remoteInvestigations: investigations, loading: false, error: null });
    } catch (err) {
      if (current()) setSnapshot(previous => ({
        ...previous,
        loading: false,
        error: err instanceof Error ? err.message : 'Failed to fetch investigations',
      }));
    } finally {
      if (current()) activeRequest.current = null;
    }
  }, [scope, serverConnected]);

  // Fetch on mount when connected, and refetch when serverConnected transitions to true
  useEffect(() => {
    void doFetch();
  }, [doFetch]);

  // Periodic refresh every 60s
  useEffect(() => {
    if (!serverConnected) return;
    const interval = setInterval(() => {
      doFetch();
    }, 60_000);
    return () => clearInterval(interval);
  }, [serverConnected, doFetch]);

  return {
    remoteInvestigations: snapshot.scope === scope && serverConnected ? snapshot.remoteInvestigations : [],
    loading: serverConnected && (snapshot.scope !== scope || snapshot.loading),
    error: snapshot.scope === scope && serverConnected ? snapshot.error : null,
    refresh: doFetch,
  };
}
