import { logger } from '../lib/logger.js';

// ─── Constants ──────────────────────────────────────────────────

/** Failures from one source (scope + account + client IP) that lock that source. */
export const MAX_ATTEMPTS = 5;
/**
 * Failures for one account from all sources. Beyond it every further failure
 * locks its source at once, so distributed guessing needs a fresh address per
 * guess, while a source that has not failed can still present the password.
 */
export const ACCOUNT_MAX_ATTEMPTS = 20;
export const WINDOW_MS = 15 * 60 * 1000;   // 15 minutes
export const LOCKOUT_MS = 15 * 60 * 1000;  // 15 minutes
/** Accounts and addresses are attacker-chosen; past this many records the oldest is dropped. */
export const MAX_TRACKED = 100_000;
const CLEANUP_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes

// ─── Types ──────────────────────────────────────────────────────

export type LoginScope = 'user' | 'admin';

interface AttemptRecord {
  attempts: number;
  firstAttemptAt: number;
  lockedUntil: number | null;
}

// ─── State ──────────────────────────────────────────────────────

const sources = new Map<string, AttemptRecord>();
const accounts = new Map<string, AttemptRecord>();

// ─── Helpers ────────────────────────────────────────────────────

function accountKey(scope: LoginScope, account: string): string {
  return `${scope}\n${account.trim().toLowerCase()}`;
}

function sourceKey(scope: LoginScope, account: string, clientIp: string): string {
  return `${accountKey(scope, account)}\n${clientIp}`;
}

function isExpired(record: AttemptRecord, now: number): boolean {
  return record.lockedUntil ? now >= record.lockedUntil : now - record.firstAttemptAt > WINDOW_MS;
}

/** The current record for a key, starting a new window once the previous one or its lockout has expired. */
function currentRecord(map: Map<string, AttemptRecord>, key: string, now: number): AttemptRecord {
  let record = map.get(key);
  if (record && isExpired(record, now)) {
    map.delete(key);
    record = undefined;
  }
  if (!record) {
    if (map.size >= MAX_TRACKED) map.delete(map.keys().next().value as string);
    record = { attempts: 0, firstAttemptAt: now, lockedUntil: null };
    map.set(key, record);
  }
  return record;
}

// ─── Public API ─────────────────────────────────────────────────

export function isLocked(scope: LoginScope, account: string, clientIp: string): { locked: boolean; retryAfterMinutes?: number } {
  const key = sourceKey(scope, account, clientIp);
  const record = sources.get(key);
  if (!record || !record.lockedUntil) return { locked: false };

  const now = Date.now();
  if (now >= record.lockedUntil) {
    // Lockout expired — clean up
    sources.delete(key);
    return { locked: false };
  }

  const retryAfterMinutes = Math.ceil((record.lockedUntil - now) / 60_000);
  return { locked: true, retryAfterMinutes };
}

export function recordFailedAttempt(scope: LoginScope, account: string, clientIp: string): { locked: boolean; retryAfterMinutes?: number } {
  const now = Date.now();
  const record = currentRecord(sources, sourceKey(scope, account, clientIp), now);

  // If already locked, just return the lockout status
  if (record.lockedUntil) {
    const retryAfterMinutes = Math.ceil((record.lockedUntil - now) / 60_000);
    return { locked: true, retryAfterMinutes };
  }

  const total = currentRecord(accounts, accountKey(scope, account), now);
  record.attempts++;
  total.attempts++;

  if (record.attempts >= MAX_ATTEMPTS || total.attempts > ACCOUNT_MAX_ATTEMPTS) {
    record.lockedUntil = now + LOCKOUT_MS;
    const retryAfterMinutes = Math.ceil(LOCKOUT_MS / 60_000);
    logger.warn('Login source locked due to too many failed login attempts', {
      scope, username: account.trim().toLowerCase(), clientIp, sourceAttempts: record.attempts, accountAttempts: total.attempts,
    });
    return { locked: true, retryAfterMinutes };
  }

  return { locked: false };
}

/** After a successful login, forget only that source's failures; the account-wide count stays. */
export function resetAttempts(scope: LoginScope, account: string, clientIp: string): void {
  sources.delete(sourceKey(scope, account, clientIp));
}

// ─── Cleanup ────────────────────────────────────────────────────

export function cleanupExpiredEntries(): void {
  const now = Date.now();
  for (const map of [sources, accounts]) {
    for (const [key, record] of map) {
      if (isExpired(record, now)) map.delete(key);
    }
  }
}

let cleanupTimer: ReturnType<typeof setInterval> | null = null;

export function startCleanupTimer(): void {
  if (cleanupTimer) return;
  cleanupTimer = setInterval(cleanupExpiredEntries, CLEANUP_INTERVAL_MS);
  // Allow the process to exit even if the timer is running
  if (cleanupTimer && typeof cleanupTimer === 'object' && 'unref' in cleanupTimer) {
    cleanupTimer.unref();
  }
}

export function stopCleanupTimer(): void {
  if (cleanupTimer) {
    clearInterval(cleanupTimer);
    cleanupTimer = null;
  }
}

// ─── Test helpers ───────────────────────────────────────────────

/** Clear all tracked attempts (for testing only) */
export function _clearAll(): void {
  sources.clear();
  accounts.clear();
}

/** Number of tracked source and account records (for testing only) */
export function _trackedCount(): number {
  return sources.size + accounts.size;
}

// Start cleanup on module load
startCleanupTimer();
