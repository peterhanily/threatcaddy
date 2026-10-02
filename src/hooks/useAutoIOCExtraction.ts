import { useEffect, useRef, useState } from 'react';
import type { IOCAnalysis, IOCType } from '../types';
import { extractIOCs, mergeIOCAnalysis } from '../lib/ioc-extractor';

interface UseAutoIOCExtractionOptions {
  entityId: string | undefined;
  content: string;
  existingAnalysis: IOCAnalysis | undefined;
  onUpdate: (id: string, updates: { iocAnalysis: IOCAnalysis; iocTypes: IOCType[] }) => void | Promise<void>;
  enabled?: boolean;
  enabledTypes?: string[];
  defaultConfidence?: string;
  debounceMs?: number;  // default 2000
}

/**
 * Debounced auto-extraction of IOCs from content changes.
 * Skips the initial mount to avoid re-extracting when opening an entity.
 */
export function useAutoIOCExtraction({
  entityId,
  content,
  existingAnalysis,
  onUpdate,
  enabled = true,
  enabledTypes,
  defaultConfidence,
  debounceMs,
}: UseAutoIOCExtractionOptions) {
  const prevContentRef = useRef(content);
  const [error, setError] = useState<string | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout>>(undefined);
  const entityIdRef = useRef(entityId);
  const onUpdateRef = useRef(onUpdate);
  const existingAnalysisRef = useRef(existingAnalysis);
  const enabledTypesRef = useRef(enabledTypes);
  const defaultConfidenceRef = useRef(defaultConfidence);
  const debounceMsRef = useRef(debounceMs);

  // Keep refs in sync
  useEffect(() => {
    entityIdRef.current = entityId;
    onUpdateRef.current = onUpdate;
    existingAnalysisRef.current = existingAnalysis;
    enabledTypesRef.current = enabledTypes;
    defaultConfidenceRef.current = defaultConfidence;
    debounceMsRef.current = debounceMs;
  });

  // Reset prev content when entity changes
  useEffect(() => {
    prevContentRef.current = content;
    clearTimeout(timerRef.current);
  }, [entityId]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!enabled || !entityId) return;

    // Skip if content hasn't actually changed (e.g. iocAnalysis update re-rendered parent, or initial mount)
    if (content === prevContentRef.current) return;

    prevContentRef.current = content;

    clearTimeout(timerRef.current);
    // Capture entityId at schedule time so we can detect stale firings
    const scheduledForId = entityId;
    timerRef.current = setTimeout(async () => {
      const currentId = entityIdRef.current;
      // Discard if entity changed since this extraction was scheduled
      if (!currentId || currentId !== scheduledForId) return;
      const fresh = extractIOCs(content, { enabledTypes: enabledTypesRef.current, defaultConfidence: defaultConfidenceRef.current });
      if (fresh.length === 0 && !existingAnalysisRef.current) return;
      const merged = mergeIOCAnalysis(existingAnalysisRef.current, fresh);
      // Background extraction must not undo an analyst's explicit dismissal.
      const dismissed = new Set(existingAnalysisRef.current?.iocs.filter(ioc => ioc.dismissed).map(ioc => `${ioc.type}:${ioc.value.toLowerCase()}`));
      for (const ioc of merged.iocs) if (dismissed.has(`${ioc.type}:${ioc.value.toLowerCase()}`)) ioc.dismissed = true;
      const iocTypes = [...new Set(merged.iocs.filter((i) => !i.dismissed).map((i) => i.type))];
      try {
        await onUpdateRef.current(currentId, { iocAnalysis: merged, iocTypes });
        if (entityIdRef.current === currentId) setError(null);
      } catch (failure) {
        if (entityIdRef.current === currentId) setError(failure instanceof Error ? failure.message : 'IOC extraction could not be saved.');
      }
    }, debounceMsRef.current ?? 2000);

    return () => clearTimeout(timerRef.current);
  }, [content, entityId, enabled]);

  useEffect(() => {
    return () => clearTimeout(timerRef.current);
  }, []);
  return { error };
}
