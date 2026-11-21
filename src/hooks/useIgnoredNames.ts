import { useCallback, useSyncExternalStore } from 'react';
import { foundKey, ignoredHash } from '../lib/identity-model';
import { workspaceStorageKey } from '../lib/workspace-profiles';

/**
 * Names the analyst chose to ignore under "Not yet in Identities": a per-device UI preference,
 * kept per workspace like other view settings. Only a hash of each name is stored: the names
 * come from encrypted fields, so readable text must not sit in browser storage. One store, so
 * the Identities view and the timeline agree.
 */
const storageKey = () => workspaceStorageKey('threatcaddy-identities-ignored-v2');
const listeners = new Set<() => void>();
let cache: { key: string; raw: string | null; hashes: ReadonlySet<string> } | null = null;
/** Used when storage is unavailable: the choice lasts for this session. */
let memory: { key: string; hashes: ReadonlySet<string> } | null = null;

function parse(raw: string | null): ReadonlySet<string> {
  try {
    const parsed: unknown = JSON.parse(raw ?? '[]');
    return new Set(Array.isArray(parsed) ? parsed.filter((hash): hash is string => typeof hash === 'string') : []);
  } catch { return new Set(); }
}

function snapshot(): ReadonlySet<string> {
  const key = storageKey();
  if (memory?.key === key) return memory.hashes;
  let raw: string | null = null;
  try { raw = localStorage.getItem(key); } catch { /* Unavailable: nothing is ignored yet. */ }
  if (!cache || cache.key !== key || cache.raw !== raw) cache = { key, raw, hashes: parse(raw) };
  return cache.hashes;
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  const onStorage = (event: StorageEvent) => { if (event.key === null || event.key === storageKey()) listener(); };
  window.addEventListener('storage', onStorage);
  return () => { listeners.delete(listener); window.removeEventListener('storage', onStorage); };
}

export function useIgnoredNames() {
  const hashes = useSyncExternalStore(subscribe, snapshot, snapshot);
  const isIgnored = useCallback((folderId: string, text: string) => hashes.has(ignoredHash(foundKey(folderId, text))), [hashes]);
  const ignore = useCallback((folderId: string, text: string) => {
    const key = storageKey();
    const next = new Set(snapshot()).add(ignoredHash(foundKey(folderId, text)));
    try { localStorage.setItem(key, JSON.stringify([...next])); memory = null; }
    catch { memory = { key, hashes: next }; }
    listeners.forEach(listener => listener());
  }, []);
  return { isIgnored, ignore };
}
