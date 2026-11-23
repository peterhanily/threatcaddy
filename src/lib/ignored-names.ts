import { foundKey, ignoredHash } from './identity-model';
import { workspaceStorageKey } from './workspace-profiles';
import { isEncryptionEnabled } from './encryptionStore';
import { getSessionKey } from './encryptionMiddleware';
import { decryptField, encryptField } from './crypto';

/**
 * Names the analyst chose to ignore under "Not yet in Identities": a per-device UI preference,
 * kept per workspace and per investigation. Only a hash of each name is stored, and when the
 * workspace is encrypted the whole list is stored encrypted, so it cannot be checked against
 * guessed names while the workspace is locked. Deleting an investigation forgets its entries,
 * and "Delete all data" forgets them all. One store, so the Identities view and the timeline agree.
 */
const storageKey = () => workspaceStorageKey('threatcaddy-identities-ignored-v3');
/** Hashes of ignored names, per investigation. */
export type Ignored = ReadonlyMap<string, ReadonlySet<string>>;
const EMPTY: Ignored = new Map();
const listeners = new Set<() => void>();
const notify = () => listeners.forEach(listener => listener());
/** The decoded list for the stored text it came from (an encrypted list decodes asynchronously). */
let cache: { key: string; raw: string | null; ignored: Ignored } | null = null;
/** Used when storage is unavailable: the choice lasts for this session. */
let memory: { key: string; ignored: Ignored } | null = null;
let decoding: string | null = null;

const toMap = (value: unknown): Ignored => {
  const folders = value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
  return new Map(Object.entries(folders).filter(([, hashes]) => Array.isArray(hashes))
    .map(([folderId, hashes]) => [folderId, new Set((hashes as unknown[]).filter((hash): hash is string => typeof hash === 'string'))]));
};
const toObject = (ignored: Ignored) => Object.fromEntries([...ignored].filter(([, hashes]) => hashes.size).map(([folderId, hashes]) => [folderId, [...hashes]]));

function readRaw(key: string): string | null {
  try { return localStorage.getItem(key); } catch { return null; }
}

/** The current list (stable until it changes), for useSyncExternalStore. */
export function ignoredSnapshot(): Ignored {
  const key = storageKey();
  if (memory?.key === key) return memory.ignored;
  const raw = readRaw(key);
  if (cache?.key === key && cache.raw === raw) return cache.ignored;
  let stored: { folders?: unknown; enc?: unknown } = {};
  try { stored = JSON.parse(raw ?? '{}') ?? {}; } catch { /* Unreadable: nothing is ignored. */ }
  if (stored.enc === undefined) {
    cache = { key, raw, ignored: toMap(stored.folders) };
    // Encryption was turned on after the list was written: store it encrypted from now on.
    if (raw && isEncryptionEnabled() && getSessionKey()) void write(key, cache.ignored);
    return cache.ignored;
  }
  // Encrypted: decoded once the workspace is unlocked; until then nothing is ignored.
  const sessionKey = getSessionKey();
  if (sessionKey && decoding !== raw) {
    decoding = raw;
    void decryptField(stored.enc, sessionKey).then(value => {
      if (readRaw(key) !== raw) return;
      cache = { key, raw, ignored: toMap(value) };
      notify();
    }).catch(() => { /* A different key (encryption turned off and on): the old list is unreadable. */ });
  }
  return cache?.key === key ? cache.ignored : EMPTY;
}

async function write(key: string, ignored: Ignored): Promise<void> {
  const folders = toObject(ignored);
  const sessionKey = isEncryptionEnabled() ? getSessionKey() : null;
  const text = JSON.stringify(sessionKey ? { v: 3, enc: await encryptField(folders, sessionKey) } : { v: 3, folders });
  try {
    if (Object.keys(folders).length) localStorage.setItem(key, text); else localStorage.removeItem(key);
    localStorage.removeItem(workspaceStorageKey('threatcaddy-identities-ignored-v2'));
    cache = { key, raw: readRaw(key), ignored };
    memory = null;
  } catch { memory = { key, ignored }; }
  notify();
}

function update(change: (current: Map<string, ReadonlySet<string>>) => void): Promise<void> {
  const key = storageKey();
  const next = new Map(ignoredSnapshot());
  change(next);
  // Shown at once; stored once encrypted (when the workspace is).
  cache = { key, raw: readRaw(key), ignored: next };
  notify();
  return write(key, next);
}

/** Calls `listener` when the list changes (in this tab or another). */
export function subscribeIgnored(listener: () => void) {
  listeners.add(listener);
  const onStorage = (event: StorageEvent) => { if (event.key === null || event.key === storageKey()) listener(); };
  window.addEventListener('storage', onStorage);
  return () => { listeners.delete(listener); window.removeEventListener('storage', onStorage); };
}

/** Forgets the names ignored in these investigations (they were deleted). */
export function forgetIgnoredNames(folderIds: readonly string[]): Promise<void> {
  if (!folderIds.some(folderId => ignoredSnapshot().has(folderId))) return Promise.resolve();
  return update(next => { for (const folderId of folderIds) next.delete(folderId); });
}

/** Forgets every ignored name of this workspace ("Delete all data"). */
export function clearIgnoredNames(): void {
  const key = storageKey();
  try { localStorage.removeItem(key); localStorage.removeItem(workspaceStorageKey('threatcaddy-identities-ignored-v2')); } catch { /* Unavailable. */ }
  cache = null; memory = null; decoding = null;
  notify();
}

/** Whether a name is ignored in an investigation. */
export const isIgnoredIn = (ignored: Ignored, folderId: string, text: string) => ignored.get(folderId)?.has(ignoredHash(foundKey(folderId, text))) ?? false;

/** Ignores a name in an investigation on this device. */
export function ignoreName(folderId: string, text: string): Promise<void> {
  return update(next => { next.set(folderId, new Set(next.get(folderId) ?? []).add(ignoredHash(foundKey(folderId, text)))); });
}
