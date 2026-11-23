import { useCallback, useSyncExternalStore } from 'react';
import { ignoreName, ignoredSnapshot, isIgnoredIn, subscribeIgnored } from '../lib/ignored-names';

/** Names ignored under "Not yet in Identities" on this device (the store is lib/ignored-names). */
export function useIgnoredNames() {
  const ignored = useSyncExternalStore(subscribeIgnored, ignoredSnapshot, ignoredSnapshot);
  const isIgnored = useCallback((folderId: string, text: string) => isIgnoredIn(ignored, folderId, text), [ignored]);
  const ignore = useCallback((folderId: string, text: string) => { void ignoreName(folderId, text); }, []);
  return { isIgnored, ignore };
}
