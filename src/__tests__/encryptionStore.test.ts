/* eslint-disable @typescript-eslint/no-non-null-assertion */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  getEncryptionMeta,
  setEncryptionMeta,
  clearEncryptionMeta,
  isEncryptionEnabled,
  getSessionDuration,
  cacheSessionKey,
  getCachedSessionKey,
  clearSessionCache,
  SESSION_DURATION_LABELS,
  type EncryptionMetadata,
  type SessionDuration,
} from '../lib/encryptionStore';

// ── Helpers ─────────────────────────────────────────────────────────

function makeMeta(overrides?: Partial<EncryptionMetadata>): EncryptionMetadata {
  return {
    version: 1,
    salt: 'dGVzdC1zYWx0',
    wrappedKey: 'dGVzdC13cmFwcGVk',
    recoverySalt: 'cmVjb3Zlcnktc2FsdA==',
    recoveryWrappedKey: 'cmVjb3Zlcnktd3JhcHBlZA==',
    enabledAt: Date.now(),
    ...overrides,
  };
}

// ── Setup ───────────────────────────────────────────────────────────

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
});

// ── SESSION_DURATION_LABELS ─────────────────────────────────────────

describe('SESSION_DURATION_LABELS', () => {
  it('has labels for all duration options', () => {
    const durations: SessionDuration[] = ['every-load', 'tab-close', '1h', '8h', '24h'];
    for (const d of durations) {
      expect(SESSION_DURATION_LABELS[d]).toBeDefined();
      expect(typeof SESSION_DURATION_LABELS[d]).toBe('string');
    }
  });
});

// ── Encryption metadata CRUD ────────────────────────────────────────

describe('getEncryptionMeta', () => {
  it('returns null when no metadata stored', () => {
    expect(getEncryptionMeta()).toBeNull();
  });

  it('returns parsed metadata when stored', () => {
    const meta = makeMeta();
    localStorage.setItem('threatcaddy-encryption', JSON.stringify(meta));
    expect(getEncryptionMeta()).toEqual(meta);
  });

  it('returns null for corrupted JSON', () => {
    localStorage.setItem('threatcaddy-encryption', '{invalid json');
    expect(getEncryptionMeta()).toBeNull();
  });
});

describe('setEncryptionMeta', () => {
  it('stores metadata in localStorage', () => {
    const meta = makeMeta();
    setEncryptionMeta(meta);

    const raw = localStorage.getItem('threatcaddy-encryption');
    expect(raw).not.toBeNull();
    expect(JSON.parse(raw!)).toEqual(meta);
  });

  it('overwrites existing metadata', () => {
    setEncryptionMeta(makeMeta({ enabledAt: 100 }));
    setEncryptionMeta(makeMeta({ enabledAt: 200 }));

    const meta = getEncryptionMeta();
    expect(meta!.enabledAt).toBe(200);
  });
});

describe('clearEncryptionMeta', () => {
  it('removes metadata from localStorage', () => {
    setEncryptionMeta(makeMeta());
    clearEncryptionMeta();
    expect(getEncryptionMeta()).toBeNull();
  });

  it('also clears session cache', () => {
    setEncryptionMeta(makeMeta());
    cacheSessionKey('key123', 'tab-close');
    clearEncryptionMeta();

    expect(getEncryptionMeta()).toBeNull();
    expect(getCachedSessionKey()).toBeNull();
  });
});

describe('isEncryptionEnabled', () => {
  it('returns false when no metadata', () => {
    expect(isEncryptionEnabled()).toBe(false);
  });

  it('returns true when metadata exists', () => {
    setEncryptionMeta(makeMeta());
    expect(isEncryptionEnabled()).toBe(true);
  });

  it('returns false after clearing metadata', () => {
    setEncryptionMeta(makeMeta());
    clearEncryptionMeta();
    expect(isEncryptionEnabled()).toBe(false);
  });
});

describe('getSessionDuration', () => {
  it('returns "every-load" when no metadata', () => {
    expect(getSessionDuration()).toBe('every-load');
  });

  it('returns "every-load" when metadata has no sessionDuration', () => {
    setEncryptionMeta(makeMeta());
    expect(getSessionDuration()).toBe('every-load');
  });

  it('returns stored sessionDuration', () => {
    setEncryptionMeta(makeMeta({ sessionDuration: '8h' }));
    expect(getSessionDuration()).toBe('8h');
  });
});

// ── Session key caching ─────────────────────────────────────────────

describe('cacheSessionKey', () => {
  it('"every-load" clears cache instead of storing', () => {
    // Pre-populate cache
    sessionStorage.setItem('threatcaddy-session-cache', JSON.stringify({ key: 'old', expiresAt: 0 }));

    cacheSessionKey('newkey', 'every-load');
    expect(getCachedSessionKey()).toBeNull();
  });

  it('"tab-close" stores with expiresAt = 0 (no TTL)', () => {
    cacheSessionKey('mykey', 'tab-close');

    const raw = sessionStorage.getItem('threatcaddy-session-cache');
    const cache = JSON.parse(raw!);
    expect(cache.key).toBe('mykey');
    expect(cache.expiresAt).toBe(0);
  });

  it('"1h" stores with ~1 hour TTL', () => {
    const before = Date.now();
    cacheSessionKey('mykey', '1h');

    const raw = sessionStorage.getItem('threatcaddy-session-cache');
    const cache = JSON.parse(raw!);
    expect(cache.key).toBe('mykey');
    // expiresAt should be roughly now + 1h
    const oneHour = 60 * 60 * 1000;
    expect(cache.expiresAt).toBeGreaterThanOrEqual(before + oneHour);
    expect(cache.expiresAt).toBeLessThanOrEqual(Date.now() + oneHour);
  });

  it('"8h" stores with ~8 hour TTL', () => {
    cacheSessionKey('mykey', '8h');

    const cache = JSON.parse(sessionStorage.getItem('threatcaddy-session-cache')!);
    const eightHours = 8 * 60 * 60 * 1000;
    expect(cache.expiresAt).toBeGreaterThan(Date.now() + eightHours - 1000);
  });

  it('"24h" stores with ~24 hour TTL', () => {
    cacheSessionKey('mykey', '24h');

    const cache = JSON.parse(sessionStorage.getItem('threatcaddy-session-cache')!);
    const twentyFourHours = 24 * 60 * 60 * 1000;
    expect(cache.expiresAt).toBeGreaterThan(Date.now() + twentyFourHours - 1000);
  });

  it('uses sessionStorage, not localStorage', () => {
    cacheSessionKey('mykey', 'tab-close');
    expect(sessionStorage.getItem('threatcaddy-session-cache')).not.toBeNull();
    expect(localStorage.getItem('threatcaddy-session-cache')).toBeNull();
  });
});

describe('getCachedSessionKey', () => {
  it('returns null when no cache', () => {
    expect(getCachedSessionKey()).toBeNull();
  });

  it('returns key for non-expired cache', () => {
    cacheSessionKey('valid-key', '1h');
    expect(getCachedSessionKey()).toBe('valid-key');
  });

  it('returns key for session-only cache (expiresAt = 0)', () => {
    cacheSessionKey('session-key', 'tab-close');
    expect(getCachedSessionKey()).toBe('session-key');
  });

  it('returns null and clears for expired cache', () => {
    // Manually set an expired cache
    const expired = JSON.stringify({ key: 'old-key', expiresAt: Date.now() - 1000 });
    sessionStorage.setItem('threatcaddy-session-cache', expired);

    expect(getCachedSessionKey()).toBeNull();
    expect(sessionStorage.getItem('threatcaddy-session-cache')).toBeNull();
  });

  it('returns null and clears for corrupted cache', () => {
    sessionStorage.setItem('threatcaddy-session-cache', 'not-json');
    expect(getCachedSessionKey()).toBeNull();
    expect(sessionStorage.getItem('threatcaddy-session-cache')).toBeNull();
  });

  it('respects TTL boundary (mock time)', () => {
    cacheSessionKey('timed-key', '1h');

    // Still valid
    expect(getCachedSessionKey()).toBe('timed-key');

    // Fast-forward past expiry
    vi.spyOn(Date, 'now').mockReturnValue(Date.now() + 2 * 60 * 60 * 1000);
    expect(getCachedSessionKey()).toBeNull();

    vi.restoreAllMocks();
  });
});

describe('clearSessionCache', () => {
  it('removes from sessionStorage', () => {
    cacheSessionKey('mykey', 'tab-close');
    clearSessionCache();
    expect(sessionStorage.getItem('threatcaddy-session-cache')).toBeNull();
  });

  it('also removes legacy localStorage cache', () => {
    localStorage.setItem('threatcaddy-session-cache', 'legacy');
    clearSessionCache();
    expect(localStorage.getItem('threatcaddy-session-cache')).toBeNull();
  });

  it('is safe to call when no cache exists', () => {
    expect(() => clearSessionCache()).not.toThrow();
  });
});
