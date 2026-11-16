import { describe, it, expect, beforeEach, afterAll, vi } from 'vitest';

vi.mock('../lib/logger.js', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

import {
  isLocked,
  claimPasswordCheck,
  recordFailedAttempt,
  resetAttempts,
  cleanupExpiredEntries,
  stopCleanupTimer,
  _clearAll,
  _trackedCount,
  MAX_ATTEMPTS,
  ACCOUNT_MAX_ATTEMPTS,
  ACCOUNT_CHECK_INTERVAL_MS,
  MAX_TRACKED,
  MAX_KNOWN_SOURCES,
  KNOWN_SOURCE_MS,
  WINDOW_MS,
  LOCKOUT_MS,
} from '../services/login-limiter.js';

afterAll(() => {
  stopCleanupTimer();
});

const IP = '198.51.100.1';
const OTHER_IP = '203.0.113.7';

describe('login-limiter', () => {
  beforeEach(() => {
    _clearAll();
    vi.restoreAllMocks();
  });

  it('allows login when under the attempt limit', () => {
    for (let i = 0; i < MAX_ATTEMPTS - 1; i++) {
      const result = recordFailedAttempt('user', 'testuser', IP);
      expect(result.locked).toBe(false);
    }
    expect(isLocked('user', 'testuser', IP).locked).toBe(false);
  });

  it('locks the failing source after MAX_ATTEMPTS failures', () => {
    for (let i = 0; i < MAX_ATTEMPTS; i++) {
      recordFailedAttempt('user', 'testuser', IP);
    }
    const status = isLocked('user', 'testuser', IP);
    expect(status.locked).toBe(true);
    expect(status.retryAfterMinutes).toBeGreaterThan(0);
    expect(status.retryAfterMinutes).toBeLessThanOrEqual(15);
  });

  it('does not lock the same account for a source that has not failed', () => {
    for (let i = 0; i < MAX_ATTEMPTS + 3; i++) {
      recordFailedAttempt('user', 'testuser', IP);
    }
    expect(isLocked('user', 'testuser', IP).locked).toBe(true);
    expect(isLocked('user', 'testuser', OTHER_IP).locked).toBe(false);
  });

  it('keeps user and admin scopes separate', () => {
    for (let i = 0; i < MAX_ATTEMPTS; i++) {
      recordFailedAttempt('admin', 'alice@example.com', IP);
    }
    expect(isLocked('admin', 'alice@example.com', IP).locked).toBe(true);
    expect(isLocked('user', 'alice@example.com', IP).locked).toBe(false);
  });

  it('returns locked status on the attempt that triggers lockout', () => {
    let result: { locked: boolean; retryAfterMinutes?: number } = { locked: false };
    for (let i = 0; i < MAX_ATTEMPTS; i++) {
      result = recordFailedAttempt('user', 'testuser', IP);
    }
    expect(result.locked).toBe(true);
    expect(result.retryAfterMinutes).toBe(15);
  });

  it('returns correct retry-after time', () => {
    // Lock the source
    for (let i = 0; i < MAX_ATTEMPTS; i++) {
      recordFailedAttempt('user', 'testuser', IP);
    }

    const status = isLocked('user', 'testuser', IP);
    expect(status.locked).toBe(true);
    // Should be approximately 15 minutes
    expect(status.retryAfterMinutes).toBeGreaterThanOrEqual(14);
    expect(status.retryAfterMinutes).toBeLessThanOrEqual(15);
  });

  it('resets counter on successful login', () => {
    // Record some failed attempts
    for (let i = 0; i < MAX_ATTEMPTS - 1; i++) {
      recordFailedAttempt('user', 'testuser', IP);
    }
    expect(isLocked('user', 'testuser', IP).locked).toBe(false);

    // Simulate successful login
    resetAttempts('user', 'testuser', IP);

    // Should be able to fail again without lockout
    for (let i = 0; i < MAX_ATTEMPTS - 1; i++) {
      recordFailedAttempt('user', 'testuser', IP);
    }
    expect(isLocked('user', 'testuser', IP).locked).toBe(false);
  });

  it('a successful login resets only its own source', () => {
    for (let i = 0; i < MAX_ATTEMPTS - 1; i++) {
      recordFailedAttempt('user', 'testuser', IP);
      recordFailedAttempt('user', 'testuser', OTHER_IP);
    }
    resetAttempts('user', 'testuser', IP);
    expect(recordFailedAttempt('user', 'testuser', OTHER_IP).locked).toBe(true);
    expect(recordFailedAttempt('user', 'testuser', IP).locked).toBe(false);
  });

  it('normalizes username to lowercase', () => {
    for (let i = 0; i < MAX_ATTEMPTS; i++) {
      recordFailedAttempt('user', 'TestUser', IP);
    }
    expect(isLocked('user', 'testuser', IP).locked).toBe(true);
    expect(isLocked('user', 'TESTUSER', IP).locked).toBe(true);
  });

  it('tracks attempts per username independently', () => {
    for (let i = 0; i < MAX_ATTEMPTS; i++) {
      recordFailedAttempt('user', 'user1', IP);
    }
    expect(isLocked('user', 'user1', IP).locked).toBe(true);
    expect(isLocked('user', 'user2', IP).locked).toBe(false);
  });

  it('locks each further failing source at once after ACCOUNT_MAX_ATTEMPTS failures across sources', () => {
    for (let i = 0; i < ACCOUNT_MAX_ATTEMPTS; i++) {
      expect(claimPasswordCheck('user', 'testuser', `192.0.2.${i}`).allowed).toBe(true);
      expect(recordFailedAttempt('user', 'testuser', `192.0.2.${i}`).locked).toBe(false);
    }
    expect(claimPasswordCheck('user', 'testuser', '198.51.100.200').allowed).toBe(true);
    expect(recordFailedAttempt('user', 'testuser', '198.51.100.200').locked).toBe(true);
    expect(isLocked('user', 'testuser', '198.51.100.200').locked).toBe(true);
    // A source with no failures is not locked out.
    expect(isLocked('user', 'testuser', OTHER_IP).locked).toBe(false);
    // Other accounts are unaffected.
    expect(claimPasswordCheck('user', 'other', '198.51.100.201').allowed).toBe(true);
    expect(recordFailedAttempt('user', 'other', '198.51.100.201').locked).toBe(false);
  });

  describe('account brake', () => {
    function failFromFreshSources(count: number, scope: 'user' | 'admin' = 'user') {
      for (let i = 0; i < count; i++) {
        expect(claimPasswordCheck(scope, 'testuser', `192.0.2.${i}`).allowed).toBe(true);
        recordFailedAttempt(scope, 'testuser', `192.0.2.${i}`);
      }
    }

    it('allows one password check per interval past ACCOUNT_MAX_ATTEMPTS', () => {
      const now = Date.now();
      vi.spyOn(Date, 'now').mockReturnValue(now);
      failFromFreshSources(ACCOUNT_MAX_ATTEMPTS);
      expect(claimPasswordCheck('user', 'testuser', OTHER_IP).allowed).toBe(true);
      expect(claimPasswordCheck('user', 'testuser', OTHER_IP)).toEqual({ allowed: false, retryAfterSeconds: ACCOUNT_CHECK_INTERVAL_MS / 1000 });

      vi.spyOn(Date, 'now').mockReturnValue(now + ACCOUNT_CHECK_INTERVAL_MS - 1);
      expect(claimPasswordCheck('user', 'testuser', OTHER_IP)).toEqual({ allowed: false, retryAfterSeconds: 1 });
      vi.spyOn(Date, 'now').mockReturnValue(now + ACCOUNT_CHECK_INTERVAL_MS);
      expect(claimPasswordCheck('user', 'testuser', OTHER_IP).allowed).toBe(true);
      expect(claimPasswordCheck('user', 'testuser', OTHER_IP).allowed).toBe(false);
      // Other accounts and the other scope are unaffected.
      expect(claimPasswordCheck('user', 'other', OTHER_IP).allowed).toBe(true);
      expect(claimPasswordCheck('admin', 'testuser', OTHER_IP).allowed).toBe(true);
    });

    it('counts checks when they start, so concurrent checks cannot overshoot', () => {
      for (let i = 0; i < ACCOUNT_MAX_ATTEMPTS + 1; i++) expect(claimPasswordCheck('user', 'testuser', OTHER_IP).allowed).toBe(true);
      expect(claimPasswordCheck('user', 'testuser', OTHER_IP).allowed).toBe(false);
    });

    it('does not count successful checks', () => {
      for (let i = 0; i < ACCOUNT_MAX_ATTEMPTS * 2; i++) {
        expect(claimPasswordCheck('user', 'testuser', IP).allowed).toBe(true);
        resetAttempts('user', 'testuser', IP);
      }
      failFromFreshSources(ACCOUNT_MAX_ATTEMPTS);
    });

    it('exempts a source that signed in to the account before', () => {
      expect(claimPasswordCheck('user', 'testuser', IP).allowed).toBe(true);
      resetAttempts('user', 'testuser', IP);
      failFromFreshSources(ACCOUNT_MAX_ATTEMPTS);
      expect(claimPasswordCheck('user', 'testuser', '198.51.100.250').allowed).toBe(true);
      expect(claimPasswordCheck('user', 'testuser', '198.51.100.251').allowed).toBe(false);
      for (let i = 0; i < 3; i++) expect(claimPasswordCheck('user', 'testuser', IP).allowed).toBe(true);
      // Only for that account and scope.
      failFromFreshSources(ACCOUNT_MAX_ATTEMPTS + 1, 'admin');
      expect(claimPasswordCheck('admin', 'testuser', IP).allowed).toBe(false);
    });

    it('remembers a known IPv6 source by its /64', () => {
      resetAttempts('user', 'testuser', '2001:db8:1:2::1');
      failFromFreshSources(ACCOUNT_MAX_ATTEMPTS + 1);
      expect(claimPasswordCheck('user', 'testuser', '2001:db8:1:2:aaaa::9').allowed).toBe(true);
      expect(claimPasswordCheck('user', 'testuser', '2001:db8:1:3::1').allowed).toBe(false);
    });

    it('never remembers an unknown client address', () => {
      resetAttempts('user', 'testuser', 'unknown');
      failFromFreshSources(ACCOUNT_MAX_ATTEMPTS + 1);
      expect(claimPasswordCheck('user', 'testuser', 'unknown').allowed).toBe(false);
    });

    it(`keeps the ${MAX_KNOWN_SOURCES} most recent known sources per account`, () => {
      for (let i = 0; i <= MAX_KNOWN_SOURCES; i++) resetAttempts('user', 'testuser', `198.51.100.${i}`);
      failFromFreshSources(ACCOUNT_MAX_ATTEMPTS + 1);
      expect(claimPasswordCheck('user', 'testuser', '198.51.100.0').allowed).toBe(false);
      expect(claimPasswordCheck('user', 'testuser', '198.51.100.1').allowed).toBe(true);
      expect(claimPasswordCheck('user', 'testuser', `198.51.100.${MAX_KNOWN_SOURCES}`).allowed).toBe(true);
    });

    it('forgets a known source KNOWN_SOURCE_MS after its last sign-in', () => {
      const now = Date.now();
      vi.spyOn(Date, 'now').mockReturnValue(now);
      resetAttempts('user', 'testuser', IP);
      vi.spyOn(Date, 'now').mockReturnValue(now + KNOWN_SOURCE_MS);
      failFromFreshSources(ACCOUNT_MAX_ATTEMPTS + 1);
      expect(claimPasswordCheck('user', 'testuser', IP).allowed).toBe(true);
      vi.spyOn(Date, 'now').mockReturnValue(now + KNOWN_SOURCE_MS + 1);
      expect(claimPasswordCheck('user', 'testuser', IP).allowed).toBe(false);
    });

    it('locks a known source only after its own MAX_ATTEMPTS failures', () => {
      resetAttempts('user', 'testuser', IP);
      failFromFreshSources(ACCOUNT_MAX_ATTEMPTS + 1);
      for (let i = 1; i < MAX_ATTEMPTS; i++) {
        expect(claimPasswordCheck('user', 'testuser', IP).allowed).toBe(true);
        expect(recordFailedAttempt('user', 'testuser', IP).locked).toBe(false);
      }
      expect(claimPasswordCheck('user', 'testuser', IP).allowed).toBe(true);
      expect(recordFailedAttempt('user', 'testuser', IP).locked).toBe(true);
      expect(isLocked('user', 'testuser', IP).locked).toBe(true);
    });

    it('keeps braking until WINDOW_MS passes without a check', () => {
      const now = Date.now();
      vi.spyOn(Date, 'now').mockReturnValue(now);
      failFromFreshSources(ACCOUNT_MAX_ATTEMPTS);
      // One check per interval keeps the count alive beyond the first window.
      for (let t = ACCOUNT_CHECK_INTERVAL_MS; t <= WINDOW_MS + ACCOUNT_CHECK_INTERVAL_MS; t += ACCOUNT_CHECK_INTERVAL_MS) {
        vi.spyOn(Date, 'now').mockReturnValue(now + t);
        expect(claimPasswordCheck('user', 'testuser', OTHER_IP).allowed).toBe(true);
        expect(claimPasswordCheck('user', 'testuser', OTHER_IP).allowed).toBe(false);
      }
      vi.spyOn(Date, 'now').mockReturnValue(now + 2 * WINDOW_MS + ACCOUNT_CHECK_INTERVAL_MS + 1);
      cleanupExpiredEntries();
      expect(_trackedCount()).toBe(0);
      failFromFreshSources(ACCOUNT_MAX_ATTEMPTS);
    });
  });

  it('counts every address in one IPv6 /64 as one source', () => {
    const addresses = ['2001:db8:a:b::1', '2001:0DB8:000a:000b:ffff:1:2:3', '2001:db8:a:b:0:0:0:7', '2001:db8:a:b::5%eth0', '2001:db8:a:b::198.51.100.1'];
    for (const address of addresses) recordFailedAttempt('user', 'testuser', address.toLowerCase());
    expect(isLocked('user', 'testuser', '2001:db8:a:b::abcd').locked).toBe(true);
    expect(isLocked('user', 'testuser', '2001:db8:a:c::1').locked).toBe(false);
    expect(isLocked('user', 'testuser', '2001:db8::1').locked).toBe(false);
  });

  it('keeps distinct IPv4 addresses and short IPv6 prefixes apart', () => {
    for (let i = 0; i < MAX_ATTEMPTS; i++) recordFailedAttempt('user', 'testuser', '::1');
    expect(isLocked('user', 'testuser', '::2').locked).toBe(true);
    expect(isLocked('user', 'testuser', '0:0:0:1::1').locked).toBe(false);
    for (let i = 0; i < MAX_ATTEMPTS; i++) recordFailedAttempt('user', 'testuser', '198.51.100.1');
    expect(isLocked('user', 'testuser', '198.51.100.2').locked).toBe(false);
  });

  it('bounds the number of tracked records', () => {
    for (let i = 0; i < MAX_TRACKED + 10; i++) {
      recordFailedAttempt('user', `user${i}@example.com`, IP);
    }
    expect(_trackedCount()).toBeLessThanOrEqual(2 * MAX_TRACKED);
    // The newest records survive.
    for (let i = 0; i < MAX_ATTEMPTS - 1; i++) recordFailedAttempt('user', `user${MAX_TRACKED + 9}@example.com`, IP);
    expect(isLocked('user', `user${MAX_TRACKED + 9}@example.com`, IP).locked).toBe(true);
  });

  it('never drops a locked source or a braked account to make room', () => {
    for (let i = 0; i < MAX_ATTEMPTS; i++) recordFailedAttempt('user', 'victim@example.com', IP);
    for (let i = 0; i <= ACCOUNT_MAX_ATTEMPTS; i++) claimPasswordCheck('user', 'victim@example.com', `192.0.2.${i}`);
    for (let i = 0; i < MAX_TRACKED; i++) {
      claimPasswordCheck('user', `user${i}@example.com`, IP);
      recordFailedAttempt('user', `user${i}@example.com`, IP);
    }
    expect(_trackedCount()).toBeLessThanOrEqual(2 * MAX_TRACKED);
    expect(isLocked('user', 'victim@example.com', IP).locked).toBe(true);
    expect(claimPasswordCheck('user', 'victim@example.com', OTHER_IP).allowed).toBe(false);
  });

  it('stops tracking new sources while every tracked source is locked', () => {
    for (let i = 0; i < MAX_TRACKED; i++) {
      for (let j = 0; j < MAX_ATTEMPTS; j++) recordFailedAttempt('user', `user${i}@example.com`, IP);
    }
    for (let j = 0; j < MAX_ATTEMPTS; j++) recordFailedAttempt('user', 'late@example.com', IP);
    expect(_trackedCount()).toBe(MAX_TRACKED);
    expect(isLocked('user', 'user0@example.com', IP).locked).toBe(true);
    expect(isLocked('user', 'late@example.com', IP).locked).toBe(false);
  });

  it('unlocks after lockout period expires', () => {
    const now = Date.now();
    vi.spyOn(Date, 'now').mockReturnValue(now);

    for (let i = 0; i < MAX_ATTEMPTS; i++) {
      recordFailedAttempt('user', 'testuser', IP);
    }
    expect(isLocked('user', 'testuser', IP).locked).toBe(true);

    // Advance time past lockout
    vi.spyOn(Date, 'now').mockReturnValue(now + LOCKOUT_MS + 1);
    expect(isLocked('user', 'testuser', IP).locked).toBe(false);
  });

  it('resets attempt window after WINDOW_MS', () => {
    const now = Date.now();
    vi.spyOn(Date, 'now').mockReturnValue(now);

    // Record some attempts (not enough to lock)
    for (let i = 0; i < MAX_ATTEMPTS - 1; i++) {
      recordFailedAttempt('user', 'testuser', IP);
    }

    // Advance time past the window
    vi.spyOn(Date, 'now').mockReturnValue(now + WINDOW_MS + 1);

    // Should reset the counter — can fail MAX_ATTEMPTS - 1 times again without lockout
    for (let i = 0; i < MAX_ATTEMPTS - 1; i++) {
      const result = recordFailedAttempt('user', 'testuser', IP);
      expect(result.locked).toBe(false);
    }
  });

  it('continues to return locked for subsequent failed attempts while locked', () => {
    for (let i = 0; i < MAX_ATTEMPTS; i++) {
      recordFailedAttempt('user', 'testuser', IP);
    }
    // Additional attempt while locked
    const result = recordFailedAttempt('user', 'testuser', IP);
    expect(result.locked).toBe(true);
  });

  describe('cleanupExpiredEntries', () => {
    it('removes entries with expired lockout', () => {
      const now = Date.now();
      vi.spyOn(Date, 'now').mockReturnValue(now);

      for (let i = 0; i < MAX_ATTEMPTS; i++) {
        recordFailedAttempt('user', 'testuser', IP);
      }
      expect(isLocked('user', 'testuser', IP).locked).toBe(true);

      // Advance time past lockout
      vi.spyOn(Date, 'now').mockReturnValue(now + LOCKOUT_MS + 1);
      cleanupExpiredEntries();

      // isLocked should return false and the entry should be cleaned up
      expect(isLocked('user', 'testuser', IP).locked).toBe(false);
      expect(_trackedCount()).toBe(0);
    });

    it('removes entries with expired attempt windows', () => {
      const now = Date.now();
      vi.spyOn(Date, 'now').mockReturnValue(now);

      // Record a single failed attempt (not enough to lock)
      recordFailedAttempt('user', 'testuser', IP);

      // Advance time past the window
      vi.spyOn(Date, 'now').mockReturnValue(now + WINDOW_MS + 1);
      cleanupExpiredEntries();
      expect(_trackedCount()).toBe(0);

      // Should be fully cleaned — next attempts start fresh
      // If we fail MAX_ATTEMPTS times, it should lock (fresh counter)
      for (let i = 0; i < MAX_ATTEMPTS; i++) {
        recordFailedAttempt('user', 'testuser', IP);
      }
      expect(isLocked('user', 'testuser', IP).locked).toBe(true);
    });

    it('removes known sources older than KNOWN_SOURCE_MS', () => {
      const now = Date.now();
      vi.spyOn(Date, 'now').mockReturnValue(now);
      resetAttempts('user', 'testuser', IP);
      vi.spyOn(Date, 'now').mockReturnValue(now + KNOWN_SOURCE_MS);
      resetAttempts('user', 'testuser', OTHER_IP);
      expect(_trackedCount()).toBe(2);

      vi.spyOn(Date, 'now').mockReturnValue(now + KNOWN_SOURCE_MS + 1);
      cleanupExpiredEntries();
      expect(_trackedCount()).toBe(1);
      vi.spyOn(Date, 'now').mockReturnValue(now + 2 * KNOWN_SOURCE_MS + 1);
      cleanupExpiredEntries();
      expect(_trackedCount()).toBe(0);
    });
  });
});
