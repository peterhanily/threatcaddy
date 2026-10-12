import { useEffect, useLayoutEffect, useRef } from 'react';
import { clipBuffer } from '../lib/clipBuffer';
import { importClipBatch } from '../lib/clip-import';
import { adaptLegacyClip, type ClipImportResult } from '../lib/clip-protocol';
import { getActiveWorkspaceId } from '../lib/workspace-profiles';
import { getCurrentUserName } from '../lib/utils';

interface Options {
  enabledIOCTypes?: string[];
  defaultConfidence?: string;
  defaultTimelineId?: string;
  onBusy: (busy: boolean) => void;
  onCommitted: (results: ClipImportResult[], signal: AbortSignal) => Promise<void>;
  onFailed: (count: number) => void;
  onRefreshFailed: () => void;
}

/** Own the channel for the mounted/unlocked App, not for each hook refresh. */
export function useClipDelivery(options: Options): void {
  const latest = useRef(options);
  useLayoutEffect(() => { latest.current = options; });
  useEffect(() => {
    const lifetime = new AbortController();
    const unsubscribe = clipBuffer.subscribe(async message => {
      const current = latest.current;
      current.onBusy(true);
      try {
        const modern = message.protocol === 2;
        if (modern && (!message.sourceId || !message.attemptId || !message.expectedWorkspaceId)) return;
        const workspaceId = modern ? message.expectedWorkspaceId : getActiveWorkspaceId();
        if (!workspaceId) return;
        const clips = modern ? message.clips : await Promise.all(message.clips.map(async value => {
          try { return await adaptLegacyClip(value); }
          catch { return value; } // The service rejects this row without losing valid siblings.
        }));
        const results: ClipImportResult[] = [];
        // Legacy messages predate the small v2 wire batches. They still use the
        // same transactional, idempotent service but never claim a v2 receipt.
        for (let offset = 0; offset < clips.length; offset += 20) {
          results.push(...await importClipBatch(clips.slice(offset, offset + 20), {
            sourceId: modern ? message.sourceId || '' : 'legacy-extension', workspaceId,
            enabledIOCTypes: current.enabledIOCTypes, defaultConfidence: current.defaultConfidence,
            defaultTimelineId: current.defaultTimelineId, createdBy: getCurrentUserName(), signal: lifetime.signal,
          }));
        }
        // A receipt describes the durable transaction, not whether the UI can
        // refresh. A display failure must not relabel committed clips as failed.
        if (modern) window.postMessage({ type: 'THREATCADDY_CLIP_IMPORT_RESULT', protocol: 2,
          sourceId: message.sourceId, attemptId: message.attemptId, workspaceId: getActiveWorkspaceId(), results },
        window.location.protocol === 'file:' ? '*' : window.location.origin);
        if (lifetime.signal.aborted) return;
        const failed = results.filter(result => result.status === 'failed').length;
        if (failed) latest.current.onFailed(failed);
        const committed = results.filter(result => result.status !== 'failed');
        if (committed.length) {
          try { await latest.current.onCommitted(committed, lifetime.signal); }
          catch { if (!lifetime.signal.aborted) latest.current.onRefreshFailed(); }
        }
      } catch (error) {
        if (!lifetime.signal.aborted) latest.current.onFailed(message.clips.length);
        throw error;
      } finally {
        if (!lifetime.signal.aborted) latest.current.onBusy(false);
      }
    });
    const stop = () => { lifetime.abort(); unsubscribe(); };
    window.addEventListener('workspace-will-switch', stop);
    return () => { stop(); window.removeEventListener('workspace-will-switch', stop); };
  }, []);
}
