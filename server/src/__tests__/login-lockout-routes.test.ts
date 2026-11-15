import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { Hono } from 'hono';

const { victim, passwordVerify, verifyAdminUser } = vi.hoisted(() => ({
  victim: { id: 'user-1', email: 'victim@example.com', displayName: 'Victim', avatarUrl: null, passwordHash: 'fixture-hash', role: 'analyst', active: true },
  passwordVerify: vi.fn(async (_hash: string, password: string) => password === 'correct-password'),
  verifyAdminUser: vi.fn(async (_username: string, _password: string) => null as null | Record<string, string>),
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
import { _clearAll, stopCleanupTimer, MAX_ATTEMPTS } from '../services/login-limiter.js';

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
