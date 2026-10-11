import { useCallback, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { IntegrationRun } from '../types/integration-types';

/** Results belong to the list scope, not to a row that virtualization may remove. */
export function useIntegrationResult(folderId?: string, viewScope?: string) {
  const scope = useMemo(() => ({ folderId, viewScope }), [folderId, viewScope]);
  const committedScope = useRef(scope);
  const active = useRef(true);
  const [result, setResult] = useState<{ scope: typeof scope; run: IntegrationRun } | null>(null);

  useLayoutEffect(() => { committedScope.current = scope; }, [scope]);
  useLayoutEffect(() => {
    active.current = true;
    const stop = () => { active.current = false; setResult(null); };
    window.addEventListener('workspace-will-switch', stop);
    return () => { active.current = false; window.removeEventListener('workspace-will-switch', stop); };
  }, []);

  const showResult = useCallback((run: IntegrationRun) => {
    if (active.current && committedScope.current === scope) setResult({ scope, run });
  }, [scope]);
  const closeResult = useCallback(() => setResult(null), []);

  return { resultRun: result?.scope === scope ? result.run : null, showResult, closeResult };
}
