import { isIP } from 'node:net';
import { logger } from '../lib/logger.js';

// ─── Constants ──────────────────────────────────────────────────

/** Failures from one source (scope + account + client address) that lock that source. */
export const MAX_ATTEMPTS = 5;
/**
 * Unsuccessful password checks for one account from all sources. Beyond it the
 * account gets one password check per ACCOUNT_CHECK_INTERVAL_MS whatever the
 * source, and every further failure locks its source at once. A source that
 * has not failed is never locked out; it waits at most one interval.
 */
export const ACCOUNT_MAX_ATTEMPTS = 20;
export const ACCOUNT_CHECK_INTERVAL_MS = 60 * 1000;
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

interface AccountRecord {
  /** Password checks started and not yet succeeded. */
  attempts: number;
  /** The count lasts until WINDOW_MS passes without a check, so a sustained attack stays braked. */
  lastAttemptAt: number;
  /** Past ACCOUNT_MAX_ATTEMPTS, no check starts before this time. */
  nextCheckAt: number;
}

// ─── State ──────────────────────────────────────────────────────

const sources = new Map<string, AttemptRecord>();
const accounts = new Map<string, AccountRecord>();

// ─── Helpers ────────────────────────────────────────────────────

function accountKey(scope: LoginScope, account: string): string {
  return `${scope}\n${account.trim().toLowerCase()}`;
}

/** An IPv6 client usually holds a whole /64, so every address in it is one source. */
function sourceAddress(clientIp: string): string {
  if (isIP(clientIp) !== 6) return clientIp;
  const address = clientIp.split('%')[0];
  const [head, tail] = address.split('::');
  const left = head ? head.split(':') : [];
  const right = tail ? tail.split(':') : [];
  // A trailing dotted IPv4 part fills two groups.
  const fill = 8 - left.length - right.length - (address.includes('.') ? 1 : 0);
  const groups = tail === undefined ? left : [...left, ...Array<string>(Math.max(fill, 0)).fill('0'), ...right];
  return `${groups.slice(0, 4).map(group => parseInt(group, 16).toString(16)).join(':')}::/64`;
}

function sourceKey(scope: LoginScope, account: string, clientIp: string): string {
  return `${accountKey(scope, account)}\n${sourceAddress(clientIp)}`;
}

function isExpired(record: AttemptRecord, now: number): boolean {
  return record.lockedUntil ? now >= record.lockedUntil : now - record.firstAttemptAt > WINDOW_MS;
}

function isAccountExpired(record: AccountRecord, now: number): boolean {
  return now - record.lastAttemptAt > WINDOW_MS;
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

function currentAccount(key: string, now: number): AccountRecord {
  let record = accounts.get(key);
  if (record && isAccountExpired(record, now)) {
    accounts.delete(key);
    record = undefined;
  }
  if (!record) {
    if (accounts.size >= MAX_TRACKED) accounts.delete(accounts.keys().next().value as string);
    record = { attempts: 0, lastAttemptAt: now, nextCheckAt: 0 };
    accounts.set(key, record);
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

/**
 * Call after isLocked and before looking up the account or checking a password.
 * Counts the check against the account when it starts, so concurrent requests
 * cannot overshoot. Past ACCOUNT_MAX_ATTEMPTS it lets one check through per
 * ACCOUNT_CHECK_INTERVAL_MS, so rotating addresses cannot raise the guessing rate.
 */
export function claimPasswordCheck(scope: LoginScope, account: string): { allowed: boolean; retryAfterSeconds?: number } {
  const now = Date.now();
  const record = currentAccount(accountKey(scope, account), now);
  if (record.attempts >= ACCOUNT_MAX_ATTEMPTS) {
    if (now < record.nextCheckAt) return { allowed: false, retryAfterSeconds: Math.ceil((record.nextCheckAt - now) / 1000) };
    record.nextCheckAt = now + ACCOUNT_CHECK_INTERVAL_MS;
  }
  record.attempts++;
  record.lastAttemptAt = now;
  return { allowed: true };
}

export function recordFailedAttempt(scope: LoginScope, account: string, clientIp: string): { locked: boolean; retryAfterMinutes?: number } {
  const now = Date.now();
  const record = currentRecord(sources, sourceKey(scope, account, clientIp), now);

  // If already locked, just return the lockout status
  if (record.lockedUntil) {
    const retryAfterMinutes = Math.ceil((record.lockedUntil - now) / 60_000);
    return { locked: true, retryAfterMinutes };
  }

  // The account count already includes this check (claimPasswordCheck).
  const accountAttempts = accounts.get(accountKey(scope, account))?.attempts ?? 0;
  record.attempts++;

  if (record.attempts >= MAX_ATTEMPTS || accountAttempts > ACCOUNT_MAX_ATTEMPTS) {
    record.lockedUntil = now + LOCKOUT_MS;
    const retryAfterMinutes = Math.ceil(LOCKOUT_MS / 60_000);
    logger.warn('Login source locked due to too many failed login attempts', {
      scope, username: account.trim().toLowerCase(), clientIp, sourceAttempts: record.attempts, accountAttempts,
    });
    return { locked: true, retryAfterMinutes };
  }

  return { locked: false };
}

/** After a successful login, forget that source's failures and stop counting this check; other failures stay. */
export function resetAttempts(scope: LoginScope, account: string, clientIp: string): void {
  sources.delete(sourceKey(scope, account, clientIp));
  const record = accounts.get(accountKey(scope, account));
  if (record && record.attempts > 0) record.attempts--;
}

// ─── Cleanup ────────────────────────────────────────────────────

export function cleanupExpiredEntries(): void {
  const now = Date.now();
  for (const [key, record] of sources) {
    if (isExpired(record, now)) sources.delete(key);
  }
  for (const [key, record] of accounts) {
    if (isAccountExpired(record, now)) accounts.delete(key);
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
