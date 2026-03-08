import { useEffect, useRef } from 'react';
import type { IOCAnalysis, IOCType } from '../types';
import { extractIOCs, mergeIOCAnalysis } from '../lib/ioc-extractor';

interface UseAutoIOCExtractionOptions {
  entityId: string | undefined;
  content: string;
  existingAnalysis: IOCAnalysis | undefined;
  onUpdate: (id: string, updates: { iocAnalysis: IOCAnalysis; iocTypes: IOCType[] }) => void;
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
  const timerRef = useRef<ReturnType<typeof setTimeout>>(undefined);
  const entityIdRef = useRef(entityId);
  const onUpdateRef = useRef(onUpdate);
  const existingAnalysisRef = useRef(existingAnalysis);

  // Keep refs in sync
  useEffect(() => {
    entityIdRef.current = entityId;
    onUpdateRef.current = onUpdate;
    existingAnalysisRef.current = existingAnalysis;
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
    timerRef.current = setTimeout(() => {
      const currentId = entityIdRef.current;
      if (!currentId) return;
      const fresh = extractIOCs(content, { enabledTypes, defaultConfidence });
      if (fresh.length === 0 && !existingAnalysisRef.current) return;
      const merged = mergeIOCAnalysis(existingAnalysisRef.current, fresh);
      const iocTypes = [...new Set(merged.iocs.filter((i) => !i.dismissed).map((i) => i.type))];
      onUpdateRef.current(currentId, { iocAnalysis: merged, iocTypes });
    }, debounceMs ?? 2000);

    return () => clearTimeout(timerRef.current);
  }, [content, entityId, enabled]);

  useEffect(() => {
    return () => clearTimeout(timerRef.current);
  }, []);
}
