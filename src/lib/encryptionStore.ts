/**
 * Persisted encryption metadata in localStorage.
 */

import { workspaceStorageKey } from './workspace-profiles';

export const encryptionStorageKey = workspaceStorageKey('threatcaddy-encryption');
const STORAGE_KEY = encryptionStorageKey;
const SESSION_CACHE_KEY = workspaceStorageKey('threatcaddy-session-cache');

export type SessionDuration = 'every-load' | 'tab-close' | '1h' | '8h' | '24h';

import { createLabelProxy } from './i18n-labels';

export const SESSION_DURATION_LABELS: Record<SessionDuration, string> = createLabelProxy(
  'sessionDuration',
  ['every-load', 'tab-close', '1h', '8h', '24h'] as const,
);

const DURATION_MS: Partial<Record<SessionDuration, number>> = {
  '1h': 60 * 60 * 1000,
  '8h': 8 * 60 * 60 * 1000,
  '24h': 24 * 60 * 60 * 1000,
};

export interface EncryptionMetadata {
  version: 1;
  salt: string;               // base64, PBKDF2 salt for passphrase
  wrappedKey: string;          // base64, master key wrapped by passphrase-derived key
  recoverySalt: string;        // base64, PBKDF2 salt for recovery phrase
  recoveryWrappedKey: string;  // base64, master key wrapped by recovery-derived key
  enabledAt: number;
  sessionDuration?: SessionDuration;
  /** Content-field registry version durably converted in IndexedDB. */
  coverageVersion?: number;
  /** Retain wrapped keys until an interrupted conversion has finished. */
  transition?: 'encrypting' | 'decrypting';
}

export function getEncryptionMeta(): EncryptionMetadata | null {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (!raw) return null;
  try {
    const value = JSON.parse(raw) as Partial<EncryptionMetadata> | null;
    if (!value || value.version !== 1 || !Number.isFinite(value.enabledAt)
      || !['salt', 'wrappedKey', 'recoverySalt', 'recoveryWrappedKey'].every(key => typeof value[key as keyof EncryptionMetadata] === 'string')
      || (value.sessionDuration !== undefined && !['every-load', 'tab-close', '1h', '8h', '24h'].includes(value.sessionDuration))
      || (value.transition !== undefined && value.transition !== 'encrypting' && value.transition !== 'decrypting')) return null;
    return value as EncryptionMetadata;
  } catch {
    return null;
  }
}

/** Stable across duration/coverage/passphrase changes, changes with the master key. */
export function getEncryptionIdentity(meta = getEncryptionMeta()): string | null {
  return meta ? JSON.stringify([meta.enabledAt, meta.recoverySalt, meta.recoveryWrappedKey]) : null;
}

export function setEncryptionMeta(meta: EncryptionMetadata): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(meta));
}

export function clearEncryptionMeta(): void {
  localStorage.removeItem(STORAGE_KEY);
  clearSessionCache();
}

export function isEncryptionEnabled(): boolean {
  // Corrupt metadata must not silently unlock the workspace.
  return localStorage.getItem(STORAGE_KEY) !== null;
}

export function getSessionDuration(): SessionDuration {
  return getEncryptionMeta()?.sessionDuration ?? 'tab-close';
}

// ── Session key caching ─────────────────────────────────────────────

export interface SessionCache {
  encryptionId: string | null;
  unlockedAt: number;
  key: string;     // base64 raw key bytes
  expiresAt: number; // epoch ms (0 = no TTL / session-only)
}

export function sessionDeadline(duration: SessionDuration, unlockedAt: number): number {
  const ttl = DURATION_MS[duration];
  return ttl ? unlockedAt + ttl : 0;
}

export function cacheSessionKey(rawKeyBase64: string, duration: SessionDuration, unlockedAt = Date.now()): void {
  if (duration === 'every-load') {
    clearSessionCache();
    return;
  }

  const cache: SessionCache = {
    encryptionId: getEncryptionIdentity(),
    key: rawKeyBase64,
    unlockedAt,
    expiresAt: sessionDeadline(duration, unlockedAt),
  };
  const payload = JSON.stringify(cache);

  // Always use sessionStorage so raw key bytes never persist beyond the browser session
  sessionStorage.setItem(SESSION_CACHE_KEY, payload);
}

export function getCachedSession(): SessionCache | null {
  const raw = sessionStorage.getItem(SESSION_CACHE_KEY);
  if (!raw) return null;

  try {
    const duration = getSessionDuration();
    if (duration === 'every-load') { clearSessionCache(); return null; }
    const cache = JSON.parse(raw) as SessionCache;
    const identity = getEncryptionIdentity();
    // Do not let an old master key adopt metadata from a workspace reset in a
    // tab whose storage event was missed. Legacy encrypted caches reauthenticate.
    if (isEncryptionEnabled() && (!identity || cache.encryptionId !== identity)) {
      clearSessionCache(); return null;
    }
    // Older caches have no start timestamp. Keep their original deadline;
    // never extend it by restoring the key or reloading the page.
    if (typeof cache.key !== 'string' || !cache.key || !Number.isFinite(cache.expiresAt)
      || cache.expiresAt < 0 || (cache.expiresAt > 0 && Date.now() >= cache.expiresAt)) {
      clearSessionCache();
      return null;
    }
    if (!Number.isFinite(cache.unlockedAt)) {
      const ttl = DURATION_MS[duration];
      // A legacy non-expiring cache has no trustworthy unlock time with which
      // to enforce a newly selected timed policy. Require the passphrase.
      if (!cache.expiresAt && ttl) { clearSessionCache(); return null; }
      cache.unlockedAt = cache.expiresAt ? cache.expiresAt - (ttl ?? 24 * 60 * 60 * 1000) : Date.now();
    }
    // A sleeping/duplicated tab may have missed the metadata storage event.
    // Apply the current policy without extending an earlier cached deadline.
    const policyDeadline = sessionDeadline(duration, cache.unlockedAt);
    if (policyDeadline) cache.expiresAt = cache.expiresAt ? Math.min(cache.expiresAt, policyDeadline) : policyDeadline;
    if (cache.expiresAt && Date.now() >= cache.expiresAt) { clearSessionCache(); return null; }
    return cache;
  } catch {
    clearSessionCache();
    return null;
  }
}

export function getCachedSessionKey(): string | null { return getCachedSession()?.key ?? null; }

export function clearSessionCache(): void {
  sessionStorage.removeItem(SESSION_CACHE_KEY);
  // Clean up any legacy localStorage cache from older versions
  localStorage.removeItem(SESSION_CACHE_KEY);
}
