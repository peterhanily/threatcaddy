import { describe, it, expect, beforeEach, afterAll, vi } from 'vitest';
import {
  isLocked,
  recordFailedAttempt,
  resetAttempts,
  cleanupExpiredEntries,
  stopCleanupTimer,
  _clearAll,
  _trackedCount,
  MAX_ATTEMPTS,
  ACCOUNT_MAX_ATTEMPTS,
  MAX_TRACKED,
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
      expect(recordFailedAttempt('user', 'testuser', `192.0.2.${i}`).locked).toBe(false);
    }
    expect(recordFailedAttempt('user', 'testuser', '198.51.100.200').locked).toBe(true);
    expect(isLocked('user', 'testuser', '198.51.100.200').locked).toBe(true);
    // A source with no failures can still present the correct password.
    expect(isLocked('user', 'testuser', OTHER_IP).locked).toBe(false);
    // Other accounts are unaffected.
    expect(recordFailedAttempt('user', 'other', '198.51.100.201').locked).toBe(false);
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
  });
});
