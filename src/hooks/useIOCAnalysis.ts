import { useState, useCallback, useMemo } from 'react';
import type { IOCTarget, IOCEntry, IOCAnalysis, IOCType } from '../types';
import { extractIOCs, mergeIOCAnalysis } from '../lib/ioc-extractor';

interface UseIOCAnalysisOptions {
  item: IOCTarget;
  onUpdate: (id: string, updates: { iocAnalysis?: IOCAnalysis; iocTypes?: IOCType[] }) => void;
}

/** Runs IOC extraction on an entity's content and manages the resulting IOC entries (update, dismiss, push to standalone). */
export function useIOCAnalysis({ item, onUpdate }: UseIOCAnalysisOptions) {
  const [analyzing, setAnalyzing] = useState(false);

  const analysis = item.iocAnalysis;

  const analyze = useCallback(() => {
    setAnalyzing(true);
    try {
      const fresh = extractIOCs(item.content);
      const merged = mergeIOCAnalysis(item.iocAnalysis, fresh);
      const iocTypes = [...new Set(merged.iocs.filter((i) => !i.dismissed).map((i) => i.type))];
      onUpdate(item.id, { iocAnalysis: merged, iocTypes });
    } finally {
      setAnalyzing(false);
    }
  }, [item.id, item.content, item.iocAnalysis, onUpdate]);

  const updateIOC = useCallback((iocId: string, updates: Partial<IOCEntry>) => {
    if (!analysis) return;
    const updatedIOCs = analysis.iocs.map((ioc) =>
      ioc.id === iocId ? { ...ioc, ...updates } : ioc
    );
    const updated: IOCAnalysis = { ...analysis, iocs: updatedIOCs };
    const iocTypes = [...new Set(updatedIOCs.filter((i) => !i.dismissed).map((i) => i.type))];
    onUpdate(item.id, { iocAnalysis: updated, iocTypes });
  }, [item.id, analysis, onUpdate]);

  const updateSummary = useCallback((text: string) => {
    if (!analysis) return;
    onUpdate(item.id, { iocAnalysis: { ...analysis, analysisSummary: text } });
  }, [item.id, analysis, onUpdate]);

  const dismissIOC = useCallback((iocId: string) => {
    updateIOC(iocId, { dismissed: true });
  }, [updateIOC]);

  const restoreIOC = useCallback((iocId: string) => {
    updateIOC(iocId, { dismissed: false });
  }, [updateIOC]);

  const dismissByType = useCallback((type: IOCType) => {
    if (!analysis) return;
    const updatedIOCs = analysis.iocs.map((ioc) =>
      ioc.type === type && !ioc.dismissed ? { ...ioc, dismissed: true } : ioc
    );
    const updated: IOCAnalysis = { ...analysis, iocs: updatedIOCs };
    const iocTypes = [...new Set(updatedIOCs.filter((i) => !i.dismissed).map((i) => i.type))];
    onUpdate(item.id, { iocAnalysis: updated, iocTypes });
  }, [item.id, analysis, onUpdate]);

  const restoreByType = useCallback((type: IOCType) => {
    if (!analysis) return;
    const updatedIOCs = analysis.iocs.map((ioc) =>
      ioc.type === type && ioc.dismissed ? { ...ioc, dismissed: false } : ioc
    );
    const updated: IOCAnalysis = { ...analysis, iocs: updatedIOCs };
    const iocTypes = [...new Set(updatedIOCs.filter((i) => !i.dismissed).map((i) => i.type))];
    onUpdate(item.id, { iocAnalysis: updated, iocTypes });
  }, [item.id, analysis, onUpdate]);

  const updateByType = useCallback((type: IOCType, updates: Partial<IOCEntry>) => {
    if (!analysis) return;
    const updatedIOCs = analysis.iocs.map((ioc) =>
      ioc.type === type && !ioc.dismissed ? { ...ioc, ...updates } : ioc
    );
    const updated: IOCAnalysis = { ...analysis, iocs: updatedIOCs };
    const iocTypes = [...new Set(updatedIOCs.filter((i) => !i.dismissed).map((i) => i.type))];
    onUpdate(item.id, { iocAnalysis: updated, iocTypes });
  }, [item.id, analysis, onUpdate]);

  const iocCount = analysis?.iocs.filter((i) => !i.dismissed).length ?? 0;

  const activeIOCs = useMemo(
    () => analysis?.iocs.filter((i) => !i.dismissed) ?? [],
    [analysis]
  );

  const dismissedIOCs = useMemo(
    () => analysis?.iocs.filter((i) => i.dismissed) ?? [],
    [analysis]
  );

  return {
    analysis,
    analyzing,
    analyze,
    updateIOC,
    updateSummary,
    dismissIOC,
    restoreIOC,
    dismissByType,
    restoreByType,
    updateByType,
    iocCount,
    activeIOCs,
    dismissedIOCs,
  };
}
