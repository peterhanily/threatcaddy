import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Hono } from 'hono';

const { victim, passwordVerify, verifyAdminUser } = vi.hoisted(() => ({
  victim: { id: 'user-1', email: 'victim@example.com', displayName: 'Victim', avatarUrl: null, passwordHash: 'fixture-hash', role: 'analyst', active: true },
  passwordVerify: vi.fn(async (_hash: string, password: string) => password === 'correct-password'),
  verifyAdminUser: vi.fn(async (): Promise<null | Record<string, string>> => null),
}));

vi.mock('../db/index.js', () => {
  const chain = () => {
    const query: Record<string, unknown> = {};
    for (const method of ['from', 'where', 'limit', 'set']) query[method] = () => query;
    query.then = (resolve: (rows: unknown[]) => unknown, reject: (error: unknown) => unknown) => Promise.resolve([victim]).then(resolve, reject);
    return query;
  };
  return { db: { select: chain, update: chain } };
});
vi.mock('argon2', () => ({ verify: passwordVerify, hash: vi.fn(), argon2id: 2 }));
vi.mock('../services/session-service.js', () => ({
  createTokenPair: vi.fn(async () => ({ accessToken: 'access', refreshToken: 'refresh' })),
  rotateRefreshToken: vi.fn(), revokeSessionFamily: vi.fn(), revokeSessionByRefreshToken: vi.fn(),
  updateUsersAndRevokeSessions: vi.fn(), SessionAuthorizationError: class extends Error {},
}));
vi.mock('../services/audit-service.js', () => ({ logActivity: vi.fn(async () => undefined) }));
vi.mock('../services/admin-secret.js', async (importOriginal) => ({
  ...await importOriginal<typeof import('../services/admin-secret.js')>(),
  verifyAdminUser,
}));
vi.mock('../middleware/admin-auth.js', async (importOriginal) => ({
  ...await importOriginal<typeof import('../middleware/admin-auth.js')>(),
  signAdminToken: vi.fn(async () => 'admin-token'),
}));
vi.mock('../lib/logger.js', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

// Production login routes over the real limiter.
import authRoutes from '../routes/auth.js';
import adminRoutes from '../routes/admin/index.js';
import { _clearAll, stopCleanupTimer, MAX_ATTEMPTS, ACCOUNT_MAX_ATTEMPTS, ACCOUNT_CHECK_INTERVAL_MS } from '../services/login-limiter.js';

const app = new Hono();
app.route('/api/auth', authRoutes);
app.route('/admin', adminRoutes);

const ATTACKER = '198.51.100.66';
const VICTIM_IP = '203.0.113.7';

function post(path: string, body: unknown, ip: string) {
  return app.request(path, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  }, { incoming: { socket: { remoteAddress: ip } } });
}
const userLogin = (password: string, ip: string) => post('/api/auth/login', { email: victim.email, password }, ip);
const adminLogin = (username: string, password: string, ip: string) => post('/admin/api/login', { username, password }, ip);

beforeEach(() => {
  _clearAll();
  vi.clearAllMocks();
});
afterAll(() => stopCleanupTimer());

describe('login lockout keyed by scope, account and client address', () => {
  it('a stranger cannot lock a user out from a different address', async () => {
    const statuses = [];
    for (let i = 0; i < MAX_ATTEMPTS; i++) statuses.push((await userLogin('wrong-password', ATTACKER)).status);
    expect(statuses).toEqual([401, 401, 401, 401, 429]);
    expect((await userLogin('correct-password', VICTIM_IP)).status).toBe(200);
  });

  it('brute force from one address still locks that address, even for the correct password', async () => {
    for (let i = 0; i < MAX_ATTEMPTS; i++) await userLogin('wrong-password', ATTACKER);
    const response = await userLogin('correct-password', ATTACKER);
    expect(response.status).toBe(429);
    expect(await response.json()).toMatchObject({ code: 'ACCOUNT_LOCKED' });
    expect(passwordVerify).toHaveBeenCalledTimes(MAX_ATTEMPTS);
  });

  it('admin-listener failures for an email do not lock the API login', async () => {
    for (let i = 0; i < MAX_ATTEMPTS + 1; i++) expect((await adminLogin(victim.email, 'wrong-password', ATTACKER)).status).toBe(401);
    expect(verifyAdminUser).not.toHaveBeenCalled();
    expect((await userLogin('correct-password', ATTACKER)).status).toBe(200);
  });

  it('admin brute force locks only the failing address', async () => {
    const statuses = [];
    for (let i = 0; i < MAX_ATTEMPTS; i++) statuses.push((await adminLogin('root', 'wrong-password', ATTACKER)).status);
    expect(statuses).toEqual([401, 401, 401, 401, 429]);
    expect((await adminLogin('root', 'wrong-password', ATTACKER)).status).toBe(429);
    expect(verifyAdminUser).toHaveBeenCalledTimes(MAX_ATTEMPTS);

    verifyAdminUser.mockResolvedValueOnce({ id: 'admin-1', username: 'root', displayName: 'Root', passwordHash: 'fixture-admin-hash' });
    expect((await adminLogin('root', 'correct-password', VICTIM_IP)).status).toBe(200);
  });
});

describe('account-wide brake against address rotation', () => {
  afterEach(() => vi.useRealTimers());

  it('rotating addresses get one password check per interval once the account threshold is passed', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    const statuses = [];
    for (let i = 0; i < 50; i++) statuses.push((await userLogin('wrong-password', `198.18.0.${i}`)).status);
    expect(passwordVerify).toHaveBeenCalledTimes(ACCOUNT_MAX_ATTEMPTS + 1);
    expect(statuses.filter(status => status === 401)).toHaveLength(ACCOUNT_MAX_ATTEMPTS);
    expect(statuses.slice(ACCOUNT_MAX_ATTEMPTS)).toEqual(Array(50 - ACCOUNT_MAX_ATTEMPTS).fill(429));

    // A sustained attack from a fresh address every 10 seconds for 15 minutes.
    for (let i = 1; i <= 90; i++) {
      vi.setSystemTime(Date.now() + 10_000);
      await userLogin('wrong-password', `198.19.0.${i}`);
    }
    expect(passwordVerify).toHaveBeenCalledTimes(ACCOUNT_MAX_ATTEMPTS + 1 + (90 * 10_000) / ACCOUNT_CHECK_INTERVAL_MS);
  });

  it('concurrent attempts from many addresses cannot overshoot the account threshold', async () => {
    const responses = await Promise.all(Array.from({ length: 50 }, (_, i) => userLogin('wrong-password', `198.18.1.${i}`)));
    expect(passwordVerify).toHaveBeenCalledTimes(ACCOUNT_MAX_ATTEMPTS + 1);
    expect(responses.every(response => response.status === 401 || response.status === 429)).toBe(true);
  });

  it('counts every address in one IPv6 /64 as one source', async () => {
    const statuses = [];
    for (let i = 1; i <= 50; i++) statuses.push((await userLogin('wrong-password', `2001:db8:5:6::${i.toString(16)}`)).status);
    expect(passwordVerify).toHaveBeenCalledTimes(MAX_ATTEMPTS);
    expect(statuses.slice(0, MAX_ATTEMPTS)).toEqual([401, 401, 401, 401, 429]);
    expect((await userLogin('correct-password', '2001:db8:5:7::1')).status).toBe(200);
  });

  it('checks a correct password from a fresh address within one interval', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    for (let i = 0; i <= ACCOUNT_MAX_ATTEMPTS; i++) await userLogin('wrong-password', `198.18.2.${i}`);
    const refused = await userLogin('correct-password', VICTIM_IP);
    expect(refused.status).toBe(429);
    expect(await refused.json()).toMatchObject({ code: 'ACCOUNT_LOCKED' });
    const wait = Number(refused.headers.get('Retry-After'));
    expect(wait).toBeGreaterThan(0);
    expect(wait).toBeLessThanOrEqual(ACCOUNT_CHECK_INTERVAL_MS / 1000);

    vi.setSystemTime(Date.now() + wait * 1000);
    expect((await userLogin('correct-password', VICTIM_IP)).status).toBe(200);
  });

  it('brakes the admin login too', async () => {
    for (let i = 0; i < 30; i++) await adminLogin('root', 'wrong-password', `198.18.3.${i}`);
    expect(verifyAdminUser).toHaveBeenCalledTimes(ACCOUNT_MAX_ATTEMPTS + 1);
  });

  it('a rotating address pool cannot keep the user out of an address they signed in from before', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    expect((await userLogin('correct-password', VICTIM_IP)).status).toBe(200);

    // 19 /64s from one /56: four cross the account threshold, fifteen take every check slot in rotation.
    const pool = Array.from({ length: 19 }, (_, i) => `2001:db8:0:${i.toString(16)}::1`);
    for (const address of pool.slice(0, 4)) for (let i = 0; i < MAX_ATTEMPTS; i++) await userLogin('wrong-password', address);
    const rotation = pool.slice(4);
    const victimStatuses = [];
    for (let minute = 0; minute < 120; minute++) {
      await userLogin('wrong-password', rotation[minute % rotation.length]);
      victimStatuses.push((await userLogin('correct-password', VICTIM_IP)).status);
      vi.setSystemTime(Date.now() + ACCOUNT_CHECK_INTERVAL_MS);
    }
    expect(victimStatuses).toEqual(Array(120).fill(200));
    // The attackers still got one check per interval and no more.
    expect(passwordVerify.mock.calls.filter(([, password]) => password !== 'correct-password')).toHaveLength(ACCOUNT_MAX_ATTEMPTS + 120);
  });

  it('a known address keeps the per-address limit while the account is braked', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    expect((await userLogin('correct-password', VICTIM_IP)).status).toBe(200);
    for (let i = 0; i <= ACCOUNT_MAX_ATTEMPTS; i++) await userLogin('wrong-password', `198.18.4.${i}`);

    const statuses = [];
    for (let i = 0; i < MAX_ATTEMPTS + 1; i++) statuses.push((await userLogin('wrong-password', VICTIM_IP)).status);
    expect(statuses).toEqual([401, 401, 401, 401, 429, 429]);
    expect((await userLogin('correct-password', VICTIM_IP)).status).toBe(429);
  });
});
