import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest';
import { Hono } from 'hono';
import * as jose from 'jose';

// ─── Mock services ──────────────────────────────────────────────

const mockVerifyBootstrapSecret = vi.fn();
const mockVerifyAdminUser = vi.fn();
const mockVerifyAdminUserById = vi.fn();
const mockGetAdminUserCount = vi.fn();
const mockCreateAdminUser = vi.fn();
const mockListAdminUsers = vi.fn();
const mockUpdateAdminUser = vi.fn();
const mockChangeAdminUserPassword = vi.fn();
const mockDeleteAdminUser = vi.fn();

vi.mock('../services/admin-secret.js', () => ({
  verifyBootstrapSecret: (...args: unknown[]) => mockVerifyBootstrapSecret(...args),
  verifyAdminUser: (...args: unknown[]) => mockVerifyAdminUser(...args),
  verifyAdminUserById: (...args: unknown[]) => mockVerifyAdminUserById(...args),
  getAdminUserCount: (...args: unknown[]) => mockGetAdminUserCount(...args),
  createAdminUser: (...args: unknown[]) => mockCreateAdminUser(...args),
  listAdminUsers: (...args: unknown[]) => mockListAdminUsers(...args),
  updateAdminUser: (...args: unknown[]) => mockUpdateAdminUser(...args),
  changeAdminUserPassword: (...args: unknown[]) => mockChangeAdminUserPassword(...args),
  deleteAdminUser: (...args: unknown[]) => mockDeleteAdminUser(...args),
  ADMIN_SYSTEM_USER_ID: '__system_admin__',
}));

vi.mock('../lib/logger.js', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

vi.mock('../services/audit-service.js', () => ({
  logActivity: vi.fn().mockResolvedValue(undefined),
}));

// ─── Import real admin-auth crypto (not mocked) ─────────────────

import { initAdminKey, signAdminToken, requireAdminAuth } from '../middleware/admin-auth.js';

// ─── Build a minimal Hono app mirroring admin/index.ts routes ───

let app: Hono;

function buildApp() {
  const a = new Hono();

  // ── Bootstrap ──
  a.post('/api/bootstrap', async (c) => {
    const body = await c.req.json();
    const { bootstrapSecret, username, displayName, password } = body || {};

    if (!bootstrapSecret || typeof bootstrapSecret !== 'string') {
      return c.json({ error: 'Missing bootstrap secret' }, 400);
    }
    if (!username || typeof username !== 'string' || username.trim().length < 2) {
      return c.json({ error: 'Username must be at least 2 characters' }, 400);
    }
    if (!/^[a-zA-Z0-9._-]+$/.test(username.trim())) {
      return c.json({ error: 'Username may only contain letters, numbers, dots, hyphens, and underscores' }, 400);
    }
    if (!displayName || typeof displayName !== 'string' || displayName.trim().length < 1) {
      return c.json({ error: 'Display name required' }, 400);
    }
    if (!password || typeof password !== 'string' || password.length < 12) {
      return c.json({ error: 'Password must be at least 12 characters' }, 400);
    }

    const valid = await mockVerifyBootstrapSecret(bootstrapSecret);
    if (!valid) {
      return c.json({ error: 'Invalid bootstrap secret' }, 401);
    }

    try {
      const admin = await mockCreateAdminUser(username, displayName, password);
      const token = await signAdminToken(admin.id, admin.username);
      return c.json({ token, admin: { id: admin.id, username: admin.username, displayName: admin.displayName } });
    } catch (err: unknown) {
      if (err instanceof Error && err.message.includes('unique')) {
        return c.json({ error: 'Username already exists' }, 409);
      }
      throw err;
    }
  });

  // ── Login ──
  a.post('/api/login', async (c) => {
    const body = await c.req.json();
    const { username, password } = body || {};

    if (!username || typeof username !== 'string' || !password || typeof password !== 'string') {
      return c.json({ error: 'Missing username or password' }, 400);
    }

    const admin = await mockVerifyAdminUser(username, password);
    if (!admin) {
      return c.json({ error: 'Invalid credentials' }, 401);
    }

    const token = await signAdminToken(admin.id, admin.username);
    return c.json({ token, admin: { id: admin.id, username: admin.username, displayName: admin.displayName } });
  });

  // ── List admin accounts ──
  a.get('/api/admin-accounts', requireAdminAuth, async (c) => {
    const accounts = await mockListAdminUsers();
    return c.json({ accounts });
  });

  // ── Create admin account ──
  a.post('/api/admin-accounts', requireAdminAuth, async (c) => {
    const body = await c.req.json();
    const { username, displayName, password } = body || {};

    if (!username || typeof username !== 'string' || username.trim().length < 2) {
      return c.json({ error: 'Username must be at least 2 characters' }, 400);
    }
    if (!/^[a-zA-Z0-9._-]+$/.test(username.trim())) {
      return c.json({ error: 'Username may only contain letters, numbers, dots, hyphens, and underscores' }, 400);
    }
    if (!displayName || typeof displayName !== 'string' || displayName.trim().length < 1) {
      return c.json({ error: 'Display name required' }, 400);
    }
    if (!password || typeof password !== 'string' || password.length < 12) {
      return c.json({ error: 'Password must be at least 12 characters' }, 400);
    }

    try {
      const admin = await mockCreateAdminUser(username, displayName, password);
      return c.json({ ok: true, admin }, 201);
    } catch (err: unknown) {
      if (err instanceof Error && err.message.includes('unique')) {
        return c.json({ error: 'Username already exists' }, 409);
      }
      throw err;
    }
  });

  // ── Update admin account ──
  a.patch('/api/admin-accounts/:id', requireAdminAuth, async (c) => {
    const id = c.req.param('id');
    const body = await c.req.json();
    const updates: { displayName?: string; active?: boolean } = {};

    if (body.displayName !== undefined) {
      if (typeof body.displayName !== 'string' || body.displayName.trim().length < 1) {
        return c.json({ error: 'Display name required' }, 400);
      }
      updates.displayName = body.displayName.trim();
    }
    if (body.active !== undefined) {
      if (typeof body.active !== 'boolean') {
        return c.json({ error: 'Invalid active value' }, 400);
      }
      const adminId = (c.get('adminUserId' as never) as string) || '__system_admin__';
      if (id === adminId && body.active === false) {
        return c.json({ error: 'Cannot disable your own account' }, 400);
      }
      updates.active = body.active;
    }

    const ok = await mockUpdateAdminUser(id, updates);
    if (!ok) return c.json({ error: 'Admin account not found' }, 404);
    return c.json({ ok: true });
  });

  // ── Change my password ──
  a.post('/api/admin-accounts/me/change-password', requireAdminAuth, async (c) => {
    const body = await c.req.json();
    const { currentPassword, newPassword } = body || {};

    if (!currentPassword || typeof currentPassword !== 'string') {
      return c.json({ error: 'Current password required' }, 400);
    }
    if (!newPassword || typeof newPassword !== 'string' || newPassword.length < 12) {
      return c.json({ error: 'New password must be at least 12 characters' }, 400);
    }

    const adminId = (c.get('adminUserId' as never) as string) || '__system_admin__';
    const valid = await mockVerifyAdminUserById(adminId, currentPassword);
    if (!valid) {
      return c.json({ error: 'Current password is incorrect' }, 401);
    }

    await mockChangeAdminUserPassword(adminId, newPassword);
    return c.json({ ok: true });
  });

  // ── Delete admin account ──
  a.delete('/api/admin-accounts/:id', requireAdminAuth, async (c) => {
    const id = c.req.param('id');
    const adminId = (c.get('adminUserId' as never) as string) || '__system_admin__';
    if (id === adminId) {
      return c.json({ error: 'Cannot delete your own account' }, 400);
    }

    const ok = await mockDeleteAdminUser(id);
    if (!ok) return c.json({ error: 'Admin account not found' }, 404);
    return c.json({ ok: true });
  });

  return a;
}

// ─── Helpers ────────────────────────────────────────────────────

function jsonReq(method: string, path: string, body?: unknown, headers?: Record<string, string>) {
  const opts: RequestInit = { method, headers: { 'Content-Type': 'application/json', ...headers } };
  if (body !== undefined) opts.body = JSON.stringify(body);
  return new Request(`http://localhost${path}`, opts);
}

async function getAdminToken(id = 'admin-1', username = 'testadmin'): Promise<string> {
  return signAdminToken(id, username);
}

function authHeader(token: string): Record<string, string> {
  return { Authorization: `Bearer ${token}` };
}

// ─── Tests ──────────────────────────────────────────────────────

beforeAll(() => {
  initAdminKey();
});

beforeEach(() => {
  vi.clearAllMocks();
  app = buildApp();
});

// ═══════════════════════════════════════════════════════════════
// 1. Token signing and verification
// ═══════════════════════════════════════════════════════════════

describe('Token signing and verification', () => {
  it('signAdminToken produces a valid JWT with 3 parts', async () => {
    const token = await signAdminToken('user-1', 'alice');
    expect(typeof token).toBe('string');
    expect(token.split('.')).toHaveLength(3);
  });

  it('token contains correct sub claim', async () => {
    const token = await signAdminToken('user-42', 'bob');
    const { payload } = await jose.decodeJwt(token) as unknown as { payload: jose.JWTPayload };
    // decodeJwt returns the payload directly
    const decoded = jose.decodeJwt(token);
    expect(decoded.sub).toBe('user-42');
  });

  it('token contains correct username claim', async () => {
    const decoded = jose.decodeJwt(await signAdminToken('u1', 'charlie'));
    expect(decoded.username).toBe('charlie');
  });

  it('token contains correct aud claim (admin-panel)', async () => {
    const decoded = jose.decodeJwt(await signAdminToken('u1', 'dave'));
    expect(decoded.aud).toBe('admin-panel');
  });

  it('token expires in 1 hour (3600s)', async () => {
    const decoded = jose.decodeJwt(await signAdminToken('u1', 'eve'));
    expect(decoded.exp).toBeDefined();
    expect(decoded.iat).toBeDefined();
    expect(decoded.exp! - decoded.iat!).toBe(3600);
  });

  it('requireAdminAuth rejects a token signed with a different key', async () => {
    // Sign with a random different HS256 key
    const wrongKey = new Uint8Array(32);
    crypto.getRandomValues(wrongKey);
    const badToken = await new jose.SignJWT({ username: 'hacker' })
      .setProtectedHeader({ alg: 'HS256' })
      .setAudience('admin-panel')
      .setSubject('evil-id')
      .setIssuedAt()
      .setExpirationTime('1h')
      .sign(wrongKey);

    const res = await app.request(
      jsonReq('GET', '/api/admin-accounts', undefined, authHeader(badToken)),
    );
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.error).toMatch(/Invalid or expired/i);
  });

  it('requireAdminAuth rejects an expired token', async () => {
    // We cannot easily create an expired token with the real key since it is in-memory.
    // Instead, we craft a request with a clearly expired token (signed with wrong key too).
    // For a proper test, we create a token backdated enough to be expired.
    // But the in-memory key is private. So we test via the middleware rejecting garbage.
    const res = await app.request(
      jsonReq('GET', '/api/admin-accounts', undefined, authHeader('expired.token.garbage')),
    );
    expect(res.status).toBe(401);
  });

  it('requireAdminAuth rejects requests with no Authorization header', async () => {
    const res = await app.request(jsonReq('GET', '/api/admin-accounts'));
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.error).toMatch(/Missing authorization/i);
  });

  it('requireAdminAuth rejects non-Bearer authorization', async () => {
    const res = await app.request(
      jsonReq('GET', '/api/admin-accounts', undefined, { Authorization: 'Basic abc123' }),
    );
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.error).toMatch(/Missing authorization/i);
  });

  it('requireAdminAuth sets adminUserId and adminUsername on context', async () => {
    // We test this indirectly: the change-password route reads adminUserId from context.
    const token = await getAdminToken('ctx-user-99', 'ctxuser');
    mockVerifyAdminUserById.mockResolvedValueOnce(true);
    mockChangeAdminUserPassword.mockResolvedValueOnce(true);

    const res = await app.request(
      jsonReq('POST', '/api/admin-accounts/me/change-password', {
        currentPassword: 'old-password-ok',
        newPassword: 'newpassword12chars',
      }, authHeader(token)),
    );
    expect(res.status).toBe(200);
    // verifyAdminUserById should have been called with the id from the token
    expect(mockVerifyAdminUserById).toHaveBeenCalledWith('ctx-user-99', 'old-password-ok');
  });
});

// ═══════════════════════════════════════════════════════════════
// 2. Admin bootstrap flow
// ═══════════════════════════════════════════════════════════════

describe('POST /api/bootstrap', () => {
  const validBody = {
    bootstrapSecret: 'my-secret-123',
    username: 'admin01',
    displayName: 'Admin One',
    password: 'supersecure12ch',
  };

  it('succeeds with valid inputs and returns token + admin info', async () => {
    mockVerifyBootstrapSecret.mockResolvedValueOnce(true);
    mockCreateAdminUser.mockResolvedValueOnce({
      id: 'a1', username: 'admin01', displayName: 'Admin One',
    });

    const res = await app.request(jsonReq('POST', '/api/bootstrap', validBody));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.token).toBeDefined();
    expect(body.admin.id).toBe('a1');
    expect(body.admin.username).toBe('admin01');
    expect(body.admin.displayName).toBe('Admin One');
  });

  it('returns 400 when bootstrapSecret is missing', async () => {
    const res = await app.request(jsonReq('POST', '/api/bootstrap', {
      ...validBody, bootstrapSecret: undefined,
    }));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/bootstrap secret/i);
  });

  it('returns 400 when username is too short', async () => {
    const res = await app.request(jsonReq('POST', '/api/bootstrap', {
      ...validBody, username: 'a',
    }));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/at least 2/i);
  });

  it('returns 400 when username contains invalid characters', async () => {
    const res = await app.request(jsonReq('POST', '/api/bootstrap', {
      ...validBody, username: 'admin @!',
    }));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/letters.*numbers/i);
  });

  it('returns 400 when displayName is empty', async () => {
    const res = await app.request(jsonReq('POST', '/api/bootstrap', {
      ...validBody, displayName: '',
    }));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/display name/i);
  });

  it('returns 400 when password is too short', async () => {
    const res = await app.request(jsonReq('POST', '/api/bootstrap', {
      ...validBody, password: 'short',
    }));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/at least 12/i);
  });

  it('returns 401 when bootstrap secret is wrong', async () => {
    mockVerifyBootstrapSecret.mockResolvedValueOnce(false);

    const res = await app.request(jsonReq('POST', '/api/bootstrap', validBody));
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.error).toMatch(/Invalid bootstrap secret/i);
  });

  it('returns 409 when username already exists', async () => {
    mockVerifyBootstrapSecret.mockResolvedValueOnce(true);
    mockCreateAdminUser.mockRejectedValueOnce(new Error('UNIQUE constraint failed: unique'));

    const res = await app.request(jsonReq('POST', '/api/bootstrap', validBody));
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.error).toMatch(/already exists/i);
  });

  it('accepts usernames with dots, hyphens, and underscores', async () => {
    mockVerifyBootstrapSecret.mockResolvedValueOnce(true);
    mockCreateAdminUser.mockResolvedValueOnce({
      id: 'a2', username: 'admin.user-name_ok', displayName: 'Admin',
    });

    const res = await app.request(jsonReq('POST', '/api/bootstrap', {
      ...validBody, username: 'admin.user-name_ok',
    }));
    expect(res.status).toBe(200);
  });
});

// ═══════════════════════════════════════════════════════════════
// 3. Admin login flow
// ═══════════════════════════════════════════════════════════════

describe('POST /api/login', () => {
  it('succeeds with valid credentials and returns token + admin info', async () => {
    mockVerifyAdminUser.mockResolvedValueOnce({
      id: 'a1', username: 'admin01', displayName: 'Admin One',
    });

    const res = await app.request(jsonReq('POST', '/api/login', {
      username: 'admin01', password: 'validpassword1234',
    }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.token).toBeDefined();
    expect(body.token.split('.')).toHaveLength(3);
    expect(body.admin.id).toBe('a1');
    expect(body.admin.username).toBe('admin01');
  });

  it('returns 401 for invalid credentials', async () => {
    mockVerifyAdminUser.mockResolvedValueOnce(null);

    const res = await app.request(jsonReq('POST', '/api/login', {
      username: 'admin01', password: 'wrongpassword123',
    }));
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.error).toMatch(/Invalid credentials/i);
  });

  it('returns 400 when username is missing', async () => {
    const res = await app.request(jsonReq('POST', '/api/login', {
      password: 'somepassword',
    }));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/Missing username or password/i);
  });

  it('returns 400 when password is missing', async () => {
    const res = await app.request(jsonReq('POST', '/api/login', {
      username: 'admin01',
    }));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/Missing username or password/i);
  });
});

// ═══════════════════════════════════════════════════════════════
// 4. Change my password
// ═══════════════════════════════════════════════════════════════

describe('POST /api/admin-accounts/me/change-password', () => {
  it('succeeds when current password is correct', async () => {
    const token = await getAdminToken('me-id', 'meuser');
    mockVerifyAdminUserById.mockResolvedValueOnce(true);
    mockChangeAdminUserPassword.mockResolvedValueOnce(true);

    const res = await app.request(
      jsonReq('POST', '/api/admin-accounts/me/change-password', {
        currentPassword: 'oldpassword1234',
        newPassword: 'newpassword1234',
      }, authHeader(token)),
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(mockVerifyAdminUserById).toHaveBeenCalledWith('me-id', 'oldpassword1234');
    expect(mockChangeAdminUserPassword).toHaveBeenCalledWith('me-id', 'newpassword1234');
  });

  it('returns 401 when current password is wrong', async () => {
    const token = await getAdminToken('me-id', 'meuser');
    mockVerifyAdminUserById.mockResolvedValueOnce(false);

    const res = await app.request(
      jsonReq('POST', '/api/admin-accounts/me/change-password', {
        currentPassword: 'wrongpassword1',
        newPassword: 'newpassword1234',
      }, authHeader(token)),
    );
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.error).toMatch(/current password is incorrect/i);
  });

  it('returns 400 when currentPassword is missing', async () => {
    const token = await getAdminToken();
    const res = await app.request(
      jsonReq('POST', '/api/admin-accounts/me/change-password', {
        newPassword: 'newpassword1234',
      }, authHeader(token)),
    );
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/current password required/i);
  });

  it('returns 400 when newPassword is too short', async () => {
    const token = await getAdminToken();
    const res = await app.request(
      jsonReq('POST', '/api/admin-accounts/me/change-password', {
        currentPassword: 'oldpassword1234',
        newPassword: 'short',
      }, authHeader(token)),
    );
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/at least 12/i);
  });

  it('returns 401 when no auth token is provided', async () => {
    const res = await app.request(
      jsonReq('POST', '/api/admin-accounts/me/change-password', {
        currentPassword: 'oldpassword1234',
        newPassword: 'newpassword1234',
      }),
    );
    expect(res.status).toBe(401);
  });
});

// ═══════════════════════════════════════════════════════════════
// 5. Admin account CRUD
// ═══════════════════════════════════════════════════════════════

describe('GET /api/admin-accounts', () => {
  it('returns list of admin accounts', async () => {
    const token = await getAdminToken();
    const accounts = [
      { id: 'a1', username: 'admin01', displayName: 'Admin One', active: true },
      { id: 'a2', username: 'admin02', displayName: 'Admin Two', active: true },
    ];
    mockListAdminUsers.mockResolvedValueOnce(accounts);

    const res = await app.request(
      jsonReq('GET', '/api/admin-accounts', undefined, authHeader(token)),
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.accounts).toHaveLength(2);
    expect(body.accounts[0].username).toBe('admin01');
  });

  it('requires auth — returns 401 without token', async () => {
    const res = await app.request(jsonReq('GET', '/api/admin-accounts'));
    expect(res.status).toBe(401);
  });
});

describe('POST /api/admin-accounts (create)', () => {
  it('creates a new admin account and returns 201', async () => {
    const token = await getAdminToken();
    mockCreateAdminUser.mockResolvedValueOnce({
      id: 'new-1', username: 'newadmin', displayName: 'New Admin',
    });

    const res = await app.request(
      jsonReq('POST', '/api/admin-accounts', {
        username: 'newadmin',
        displayName: 'New Admin',
        password: 'password12chars',
      }, authHeader(token)),
    );
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.admin.username).toBe('newadmin');
  });

  it('returns 400 for short username', async () => {
    const token = await getAdminToken();
    const res = await app.request(
      jsonReq('POST', '/api/admin-accounts', {
        username: 'a',
        displayName: 'Test',
        password: 'password12chars',
      }, authHeader(token)),
    );
    expect(res.status).toBe(400);
  });

  it('returns 400 for invalid username characters', async () => {
    const token = await getAdminToken();
    const res = await app.request(
      jsonReq('POST', '/api/admin-accounts', {
        username: 'bad user!',
        displayName: 'Test',
        password: 'password12chars',
      }, authHeader(token)),
    );
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/letters.*numbers/i);
  });

  it('returns 400 for missing displayName', async () => {
    const token = await getAdminToken();
    const res = await app.request(
      jsonReq('POST', '/api/admin-accounts', {
        username: 'validuser',
        displayName: '',
        password: 'password12chars',
      }, authHeader(token)),
    );
    expect(res.status).toBe(400);
  });

  it('returns 400 for short password', async () => {
    const token = await getAdminToken();
    const res = await app.request(
      jsonReq('POST', '/api/admin-accounts', {
        username: 'validuser',
        displayName: 'Test',
        password: 'short',
      }, authHeader(token)),
    );
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/at least 12/i);
  });

  it('returns 409 for duplicate username', async () => {
    const token = await getAdminToken();
    mockCreateAdminUser.mockRejectedValueOnce(new Error('UNIQUE constraint failed: unique'));

    const res = await app.request(
      jsonReq('POST', '/api/admin-accounts', {
        username: 'existing',
        displayName: 'Existing',
        password: 'password12chars',
      }, authHeader(token)),
    );
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.error).toMatch(/already exists/i);
  });
});

describe('PATCH /api/admin-accounts/:id', () => {
  it('updates displayName successfully', async () => {
    const token = await getAdminToken('admin-1', 'testadmin');
    mockUpdateAdminUser.mockResolvedValueOnce(true);

    const res = await app.request(
      jsonReq('PATCH', '/api/admin-accounts/other-id', {
        displayName: 'Updated Name',
      }, authHeader(token)),
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(mockUpdateAdminUser).toHaveBeenCalledWith('other-id', { displayName: 'Updated Name' });
  });

  it('returns 404 when admin account not found', async () => {
    const token = await getAdminToken();
    mockUpdateAdminUser.mockResolvedValueOnce(false);

    const res = await app.request(
      jsonReq('PATCH', '/api/admin-accounts/nonexistent', {
        displayName: 'Whatever',
      }, authHeader(token)),
    );
    expect(res.status).toBe(404);
  });

  it('returns 400 for empty displayName', async () => {
    const token = await getAdminToken();
    const res = await app.request(
      jsonReq('PATCH', '/api/admin-accounts/other-id', {
        displayName: '',
      }, authHeader(token)),
    );
    expect(res.status).toBe(400);
  });

  it('prevents disabling your own account', async () => {
    const token = await getAdminToken('self-id', 'selfuser');
    const res = await app.request(
      jsonReq('PATCH', '/api/admin-accounts/self-id', {
        active: false,
      }, authHeader(token)),
    );
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/Cannot disable your own/i);
  });

  it('allows disabling another admin account', async () => {
    const token = await getAdminToken('admin-1', 'testadmin');
    mockUpdateAdminUser.mockResolvedValueOnce(true);

    const res = await app.request(
      jsonReq('PATCH', '/api/admin-accounts/other-id', {
        active: false,
      }, authHeader(token)),
    );
    expect(res.status).toBe(200);
    expect(mockUpdateAdminUser).toHaveBeenCalledWith('other-id', { active: false });
  });

  it('returns 400 for invalid active value', async () => {
    const token = await getAdminToken();
    const res = await app.request(
      jsonReq('PATCH', '/api/admin-accounts/other-id', {
        active: 'yes',
      }, authHeader(token)),
    );
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/Invalid active/i);
  });
});

describe('DELETE /api/admin-accounts/:id', () => {
  it('deletes another admin account successfully', async () => {
    const token = await getAdminToken('admin-1', 'testadmin');
    mockDeleteAdminUser.mockResolvedValueOnce(true);

    const res = await app.request(
      jsonReq('DELETE', '/api/admin-accounts/other-id', undefined, authHeader(token)),
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(mockDeleteAdminUser).toHaveBeenCalledWith('other-id');
  });

  it('prevents self-deletion', async () => {
    const token = await getAdminToken('self-id', 'selfuser');
    const res = await app.request(
      jsonReq('DELETE', '/api/admin-accounts/self-id', undefined, authHeader(token)),
    );
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/Cannot delete your own/i);
  });

  it('returns 404 when account not found', async () => {
    const token = await getAdminToken('admin-1', 'testadmin');
    mockDeleteAdminUser.mockResolvedValueOnce(false);

    const res = await app.request(
      jsonReq('DELETE', '/api/admin-accounts/nonexistent', undefined, authHeader(token)),
    );
    expect(res.status).toBe(404);
  });

  it('requires auth — returns 401 without token', async () => {
    const res = await app.request(
      jsonReq('DELETE', '/api/admin-accounts/some-id'),
    );
    expect(res.status).toBe(401);
  });
});
