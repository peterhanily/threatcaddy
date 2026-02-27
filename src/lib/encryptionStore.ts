/**
 * Persisted encryption metadata in localStorage.
 */

const STORAGE_KEY = 'threatcaddy-encryption';
const SESSION_CACHE_KEY = 'threatcaddy-session-cache';

export type SessionDuration = 'every-load' | 'tab-close' | '1h' | '8h' | '24h';

export const SESSION_DURATION_LABELS: Record<SessionDuration, string> = {
  'every-load': 'Every page load',
  'tab-close': 'Until tab is closed',
  '1h': '1 hour',
  '8h': '8 hours',
  '24h': '24 hours',
};

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
}

export function getEncryptionMeta(): EncryptionMetadata | null {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as EncryptionMetadata;
  } catch {
    return null;
  }
}

export function setEncryptionMeta(meta: EncryptionMetadata): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(meta));
}

export function clearEncryptionMeta(): void {
  localStorage.removeItem(STORAGE_KEY);
  clearSessionCache();
}

export function isEncryptionEnabled(): boolean {
  return getEncryptionMeta() !== null;
}

export function getSessionDuration(): SessionDuration {
  return getEncryptionMeta()?.sessionDuration ?? 'every-load';
}

// ── Session key caching ─────────────────────────────────────────────

interface SessionCache {
  key: string;     // base64 raw key bytes
  expiresAt: number; // epoch ms (0 = no TTL / session-only)
}

export function cacheSessionKey(rawKeyBase64: string, duration: SessionDuration): void {
  if (duration === 'every-load') {
    clearSessionCache();
    return;
  }

  const ttlMs = DURATION_MS[duration];
  const cache: SessionCache = {
    key: rawKeyBase64,
    expiresAt: ttlMs ? Date.now() + ttlMs : 0,
  };
  const payload = JSON.stringify(cache);

  // Always use sessionStorage so raw key bytes never persist beyond the browser session
  sessionStorage.setItem(SESSION_CACHE_KEY, payload);
}

export function getCachedSessionKey(): string | null {
  const raw = sessionStorage.getItem(SESSION_CACHE_KEY);
  if (!raw) return null;

  try {
    const cache = JSON.parse(raw) as SessionCache;
    // Check TTL (expiresAt === 0 means session-only, no expiry)
    if (cache.expiresAt > 0 && Date.now() > cache.expiresAt) {
      clearSessionCache();
      return null;
    }
    return cache.key;
  } catch {
    clearSessionCache();
    return null;
  }
}

export function clearSessionCache(): void {
  sessionStorage.removeItem(SESSION_CACHE_KEY);
  // Clean up any legacy localStorage cache from older versions
  localStorage.removeItem(SESSION_CACHE_KEY);
}
