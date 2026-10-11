import { useEffect, useLayoutEffect, useRef } from 'react';
import { fileOpenQueue, type FileOpenDetail, type FileOpenIssue } from '../lib/file-handler';

interface Options {
  consume: (detail: FileOpenDetail, signal: AbortSignal) => Promise<void>;
  report: (issues: FileOpenIssue[]) => void;
}

/** Subscribe for an unlocked App's lifetime, not every render or folder change. */
export function useOpenedFiles(options: Options): void {
  const latest = useRef(options);
  useLayoutEffect(() => { latest.current = options; });
  useEffect(() => {
    const unsubscribe = fileOpenQueue.subscribe((detail, signal) => latest.current.consume(detail, signal),
      issues => latest.current.report(issues));
    window.addEventListener('workspace-will-switch', unsubscribe);
    return () => { unsubscribe(); window.removeEventListener('workspace-will-switch', unsubscribe); };
  }, []);
}
