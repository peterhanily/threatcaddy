import { isIP } from 'node:net';
import { logger } from '../lib/logger.js';

// ─── Constants ──────────────────────────────────────────────────

/** Failures from one source (scope + account + client address) that lock that source. */
export const MAX_ATTEMPTS = 5;
/**
 * Unsuccessful password checks for one account from all sources. Beyond it the
 * account gets one password check per ACCOUNT_CHECK_INTERVAL_MS from sources
 * it has not signed in from, and every further failure from such a source locks
 * it at once. A source that has not failed is not locked out, but shares that
 * one check per interval. Known sources are exempt and keep the per-source limit.
 * Five, then one per three minutes, holds many addresses to the five checks per
 * 15 minutes that one account allowed in 2.0.0. At MAX_ATTEMPTS, a single
 * address is locked before it can take an interval's check.
 */
export const ACCOUNT_MAX_ATTEMPTS = 5;
export const ACCOUNT_CHECK_INTERVAL_MS = 3 * 60 * 1000;
export const WINDOW_MS = 15 * 60 * 1000;   // 15 minutes
export const LOCKOUT_MS = 15 * 60 * 1000;  // 15 minutes
/** A source that signed in to an account stays known to it this long after its last sign-in. */
export const KNOWN_SOURCE_MS = 30 * 24 * 60 * 60 * 1000;
/** Known sources kept per account; the least recently used is dropped. */
export const MAX_KNOWN_SOURCES = 10;
/**
 * Accounts and addresses are attacker-chosen, so each map holds at most this many
 * records. A full map drops its oldest record that restricts nothing; while every
 * record locks a source or brakes an account, new keys are not tracked.
 */
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
/** Per account: source address -> time of its last successful sign-in, least recent first. */
const knownSources = new Map<string, Map<string, number>>();

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

function isKnownSource(scope: LoginScope, account: string, clientIp: string, now: number): boolean {
  const signedInAt = knownSources.get(accountKey(scope, account))?.get(sourceAddress(clientIp));
  return signedInAt !== undefined && now - signedInAt <= KNOWN_SOURCE_MS;
}

/** Room for one more record: drops the oldest record that restricts nothing. False when every record still restricts. */
function makeRoom<T>(map: Map<string, T>, restricts: (record: T) => boolean): boolean {
  if (map.size < MAX_TRACKED) return true;
  for (const [key, record] of map) {
    if (!restricts(record)) {
      map.delete(key);
      return true;
    }
  }
  return false;
}

/** The current record for a key, starting a new window once the previous one or its lockout has expired. */
function currentRecord(map: Map<string, AttemptRecord>, key: string, now: number): AttemptRecord {
  let record = map.get(key);
  if (record && isExpired(record, now)) {
    map.delete(key);
    record = undefined;
  }
  if (!record) {
    record = { attempts: 0, firstAttemptAt: now, lockedUntil: null };
    if (makeRoom(map, tracked => tracked.lockedUntil !== null && !isExpired(tracked, now))) map.set(key, record);
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
    record = { attempts: 0, lastAttemptAt: now, nextCheckAt: 0 };
    if (makeRoom(accounts, tracked => tracked.attempts >= ACCOUNT_MAX_ATTEMPTS && !isAccountExpired(tracked, now))) accounts.set(key, record);
  }
  return record;
}

function rememberSource(key: string, address: string, now: number): void {
  const known = knownSources.get(key) ?? new Map<string, number>();
  // Most recent last in both maps, so the first entry is the least recently used.
  knownSources.delete(key);
  if (knownSources.size >= MAX_TRACKED) knownSources.delete(knownSources.keys().next().value as string);
  knownSources.set(key, known);
  known.delete(address);
  known.set(address, now);
  if (known.size > MAX_KNOWN_SOURCES) known.delete(known.keys().next().value as string);
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
 * A source that signed in to the account before is not held to that interval.
 */
export function claimPasswordCheck(scope: LoginScope, account: string, clientIp: string): { allowed: boolean; retryAfterSeconds?: number } {
  const now = Date.now();
  const record = currentAccount(accountKey(scope, account), now);
  if (record.attempts >= ACCOUNT_MAX_ATTEMPTS && !isKnownSource(scope, account, clientIp, now)) {
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

  if (record.attempts >= MAX_ATTEMPTS || (accountAttempts > ACCOUNT_MAX_ATTEMPTS && !isKnownSource(scope, account, clientIp, now))) {
    record.lockedUntil = now + LOCKOUT_MS;
    const retryAfterMinutes = Math.ceil(LOCKOUT_MS / 60_000);
    logger.warn('Login source locked due to too many failed login attempts', {
      scope, username: account.trim().toLowerCase(), clientIp, sourceAttempts: record.attempts, accountAttempts,
    });
    return { locked: true, retryAfterMinutes };
  }

  return { locked: false };
}

/**
 * After a successful login, forget that source's failures, stop counting this
 * check and remember the source as known to the account; other failures stay.
 */
export function resetAttempts(scope: LoginScope, account: string, clientIp: string): void {
  sources.delete(sourceKey(scope, account, clientIp));
  const record = accounts.get(accountKey(scope, account));
  if (record && record.attempts > 0) record.attempts--;
  if (isIP(clientIp)) rememberSource(accountKey(scope, account), sourceAddress(clientIp), Date.now());
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
  for (const [key, known] of knownSources) {
    for (const [address, signedInAt] of known) {
      if (now - signedInAt > KNOWN_SOURCE_MS) known.delete(address);
    }
    if (known.size === 0) knownSources.delete(key);
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
  knownSources.clear();
}

/** Number of tracked source, account and known-source records (for testing only) */
export function _trackedCount(): number {
  let known = 0;
  for (const addresses of knownSources.values()) known += addresses.size;
  return sources.size + accounts.size + known;
}

// Start cleanup on module load
startCleanupTimer();
