import { useCallback, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { EvidenceImportError } from '../lib/evidence-import-limits';

export type EvidenceImportBlockedReason = 'screenshareActive' | 'remoteInvestigation' | 'investigationArchived' | 'dataUnavailable' | 'notReady';

/** Owns in-flight evidence imports for one destination. The fence identity is
 * what an import writes into or exposes: folder, visible view, remote mode,
 * screenshare and archive state. Data readiness (hydration, screenshare
 * redaction) is checked when an import starts but is not part of the identity:
 * chat and evidence reloads clear it briefly, and AgentCaddy cycles or sync
 * pulls reload them while a batch is parsing. */
export function useEvidenceImportFence({ folderId, visible, remote, screenshare, archived, dataReady, dataFailed }: {
  folderId?: string;
  /** Evidence view showing, no settings/trash/archive overlay. */
  visible: boolean;
  /** The investigation is viewed from the team server and not stored locally. */
  remote: boolean;
  /** Screenshare mode is on, or it hides the selected investigation. */
  screenshare: boolean;
  archived: boolean;
  dataReady: boolean;
  /** A data load failed, so waiting will not make the data ready. */
  dataFailed: boolean;
}) {
  const scope = useMemo(() => ({ folderId, writable: visible && !remote && !screenshare && !archived }), [folderId, visible, remote, screenshare, archived]);
  const owner = useRef<typeof scope | null>(null);
  const controllers = useRef(new Set<AbortController>());
  useLayoutEffect(() => {
    owner.current = scope;
    const active = controllers.current;
    return () => {
      owner.current = null;
      // A typed reason, so the view explains the interruption instead of
      // showing the browser's DOMException text.
      for (const controller of active) controller.abort(new EvidenceImportError('interrupted'));
    };
  }, [scope]);

  // Loading disables the controls only until the first load completes. Later
  // reloads clear readiness for moments; begin() still refuses then, without
  // the controls and their status line flickering on every AgentCaddy cycle.
  const [loadedOnce, setLoadedOnce] = useState(dataReady);
  if (dataReady && !loadedOnce) setLoadedOnce(true);

  const blockedReason: EvidenceImportBlockedReason | undefined = screenshare ? 'screenshareActive'
    : remote ? 'remoteInvestigation'
    : archived ? 'investigationArchived'
      : dataFailed ? 'dataUnavailable'
        : loadedOnce ? undefined : 'notReady';

  /** Throws the reason an import cannot start; otherwise returns the fence for it. */
  const begin = useCallback(() => {
    if (blockedReason) throw new EvidenceImportError(blockedReason);
    if (!dataReady) throw new EvidenceImportError('notReady');
    if (owner.current !== scope || !scope.writable) throw new EvidenceImportError('contextChanged');
    return {
      assertCurrentScope: () => {
        if (owner.current !== scope) throw new EvidenceImportError('contextChanged');
      },
      /** Abort this request when the scope changes; call the result when it settles. */
      track: (controller: AbortController) => {
        controllers.current.add(controller);
        return () => { controllers.current.delete(controller); };
      },
    };
  }, [scope, blockedReason, dataReady]);

  return useMemo(() => ({ blockedReason, begin }), [blockedReason, begin]);
}
