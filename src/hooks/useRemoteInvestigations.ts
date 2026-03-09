import { useState, useEffect, useCallback, useRef } from 'react';
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
  serverUrl?: string, // reserved for future direct-URL fetches
): UseRemoteInvestigationsResult {
  void serverUrl;
  const [remoteInvestigations, setRemoteInvestigations] = useState<InvestigationSummary[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fetchingRef = useRef(false);
  const prevConnectedRef = useRef(false);

  const doFetch = useCallback(async () => {
    if (fetchingRef.current) return;
    fetchingRef.current = true;
    setLoading(true);
    setError(null);
    try {
      const data = await fetchInvestigations();
      setRemoteInvestigations(data as InvestigationSummary[]);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch investigations');
    } finally {
      setLoading(false);
      fetchingRef.current = false;
    }
  }, []);

  // Fetch on mount when connected, and refetch when serverConnected transitions to true
  useEffect(() => {
    if (serverConnected) {
      doFetch();
    } else {
      setRemoteInvestigations([]);
      setError(null);
    }
    prevConnectedRef.current = serverConnected;
  }, [serverConnected, doFetch]);

  const refresh = useCallback(async () => {
    if (!serverConnected) return;
    await doFetch();
  }, [serverConnected, doFetch]);

  return { remoteInvestigations, loading, error, refresh };
}
