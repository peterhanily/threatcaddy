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
 * and "Delete all data" forgets them all. Plain module state (no React), so sync and deletion
 * code can use it; the hook is hooks/useIgnoredNames.
 */
const storageKey = () => workspaceStorageKey('threatcaddy-identities-ignored-v3');
const legacyKey = () => workspaceStorageKey('threatcaddy-identities-ignored-v2');
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
/** The workspace whose old v2 list (plain hashes, not carried over) was already removed. */
let legacyRemoved: string | null = null;
/** Changes run one after another, each on the list as the previous one left it. */
let queue: Promise<void> = Promise.resolve();
/** The plain-text list being stored encrypted, so it is scheduled once. */
let reencrypting: string | null = null;

const toMap = (value: unknown): Ignored => {
  const folders = value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
  return new Map(Object.entries(folders).filter(([, hashes]) => Array.isArray(hashes))
    .map(([folderId, hashes]) => [folderId, new Set((hashes as unknown[]).filter((hash): hash is string => typeof hash === 'string'))]));
};
const toObject = (ignored: Ignored) => Object.fromEntries([...ignored].filter(([, hashes]) => hashes.size).map(([folderId, hashes]) => [folderId, [...hashes]]));
const readRaw = (key: string): string | null => { try { return localStorage.getItem(key); } catch { return null; } };
const parse = (raw: string | null): { folders?: unknown; enc?: unknown } => { try { return JSON.parse(raw ?? '{}') ?? {}; } catch { return {}; } };

/** The stored list, decoded. Null when it is encrypted and the workspace is locked (it cannot be
 * read or changed then). An encrypted list another key wrote reads as empty: it is unreadable. */
async function load(): Promise<Ignored | null> {
  const key = storageKey();
  if (memory?.key === key) return memory.ignored;
  const raw = readRaw(key);
  if (cache?.key === key && cache.raw === raw) return cache.ignored;
  const stored = parse(raw);
  if (stored.enc === undefined) return toMap(stored.folders);
  const sessionKey = getSessionKey();
  if (!sessionKey) return null;
  try { return toMap(await decryptField(stored.enc, sessionKey)); } catch { return EMPTY; }
}

/** The current list (stable until it changes), for useSyncExternalStore. */
export function ignoredSnapshot(): Ignored {
  const key = storageKey();
  if (legacyRemoved !== key) {
    legacyRemoved = key;
    try { localStorage.removeItem(legacyKey()); } catch { /* Unavailable. */ }
  }
  if (memory?.key === key) return memory.ignored;
  const raw = readRaw(key);
  if (cache?.key === key && cache.raw === raw) return cache.ignored;
  const stored = parse(raw);
  if (stored.enc === undefined) {
    cache = { key, raw, ignored: toMap(stored.folders) };
    // Encryption was turned on after the list was written: store it encrypted from now on. After this
    // render (getSnapshot must not notify other components while React renders), once per stored list.
    if (raw && isEncryptionEnabled() && getSessionKey() && reencrypting !== raw) {
      reencrypting = raw;
      queueMicrotask(() => void update(() => {}).finally(() => { if (reencrypting === raw) reencrypting = null; }));
    }
    return cache.ignored;
  }
  // Encrypted: decoded once the workspace is unlocked; until then nothing is shown as ignored.
  if (getSessionKey() && decoding !== raw) {
    decoding = raw;
    void load().then(ignored => {
      if (ignored === null || readRaw(key) !== raw) return;
      cache = { key, raw, ignored };
      notify();
    }).finally(() => { if (decoding === raw) decoding = null; });
  }
  return cache?.key === key ? cache.ignored : EMPTY;
}

async function write(key: string, ignored: Ignored, encrypted: boolean): Promise<void> {
  const folders = toObject(ignored);
  const sessionKey = encrypted ? getSessionKey() : null;
  const text = JSON.stringify(sessionKey ? { v: 3, enc: await encryptField(folders, sessionKey) } : { v: 3, folders });
  try {
    if (Object.keys(folders).length) localStorage.setItem(key, text); else localStorage.removeItem(key);
    cache = { key, raw: readRaw(key), ignored };
    memory = null;
  } catch { memory = { key, ignored }; }
  notify();
}

/** Applies a change to the stored list, after any change before it. Skipped when the list is
 * encrypted and the workspace is locked (then nothing can be ignored or forgotten anyway). */
function update(change: (current: Map<string, ReadonlySet<string>>) => void): Promise<void> {
  // Shown at once when the list is already decoded (focus can move on from an ignored chip). The
  // stored change below still runs in order, on the list as loaded; adding or removing a hash
  // twice changes nothing.
  const key = storageKey();
  const shownMemory = memory?.key === key ? memory : null;
  const shownCache = !shownMemory && cache?.key === key && cache.raw === readRaw(key) ? cache : null;
  const known = shownMemory ?? shownCache;
  if (known) {
    const shown = new Map(known.ignored);
    change(shown);
    if (shownMemory) memory = { key, ignored: shown };
    else if (shownCache) cache = { ...shownCache, ignored: shown };
    notify();
  }
  const run = queue.then(async () => {
    const key = storageKey();
    const current = await load();
    if (current === null) return;
    const next = new Map(current);
    change(next);
    // Shown at once; stored once encrypted (when the workspace is).
    cache = { key, raw: readRaw(key), ignored: next };
    notify();
    await write(key, next, isEncryptionEnabled());
  });
  queue = run.catch(() => undefined);
  return run;
}

/** Subscribes to changes of the list (in this tab or another). */
export function subscribeIgnored(listener: () => void) {
  listeners.add(listener);
  const onStorage = (event: StorageEvent) => { if (event.key === null || event.key === storageKey()) listener(); };
  window.addEventListener('storage', onStorage);
  return () => { listeners.delete(listener); window.removeEventListener('storage', onStorage); };
}

/** Whether a name is ignored in an investigation. */
export const isIgnoredIn = (ignored: Ignored, folderId: string, text: string) => ignored.get(folderId)?.has(ignoredHash(foundKey(folderId, text))) ?? false;

/** Ignores a name in an investigation on this device. */
export function ignoreName(folderId: string, text: string): Promise<void> {
  return update(next => { next.set(folderId, new Set(next.get(folderId) ?? []).add(ignoredHash(foundKey(folderId, text)))); });
}

/** Forgets the names ignored in these investigations (they were deleted). */
export function forgetIgnoredNames(folderIds: readonly string[]): Promise<void> {
  return update(next => { for (const folderId of folderIds) next.delete(folderId); });
}

/** Forgets every ignored name of this workspace ("Delete all data"). */
export function clearIgnoredNames(): void {
  try { localStorage.removeItem(storageKey()); localStorage.removeItem(legacyKey()); } catch { /* Unavailable. */ }
  cache = null; memory = null; decoding = null;
  notify();
}

/** Turning encryption on: stores the list again, encrypted (it was written in plain hashes). */
export function rewriteIgnoredNames(): Promise<void> {
  return update(() => {});
}

/** Turning encryption off: reads the list while the key is still there, runs `decrypt`, then
 * stores the list as plain hashes, so it is not lost with the key. */
export async function keepIgnoredNamesThroughDecryption(decrypt: () => Promise<void>): Promise<void> {
  const ignored = await load();
  await decrypt();
  if (!ignored) return;
  const run = queue.then(() => write(storageKey(), ignored, false));
  queue = run.catch(() => undefined);
  await run;
}
