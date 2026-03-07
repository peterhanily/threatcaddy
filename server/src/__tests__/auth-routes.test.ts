import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Hono } from 'hono';

// ─── Hoisted mock state ────────────────────────────────────────

const {
  selectQueue, insertQueue, updateQueue, deleteQueue,
  makeThenableChain,
  mockSignAccessToken, mockLogActivity,
  mockIsLocked, mockRecordFailedAttempt, mockResetAttempts,
  mockArgon2Hash, mockArgon2Verify,
  mockGetRegistrationMode, mockGetSessionSettings,
} = vi.hoisted(() => {
  const selectQueue: unknown[] = [];
  const insertQueue: unknown[] = [];
  const updateQueue: unknown[] = [];
  const deleteQueue: unknown[] = [];

  function makeThenableChain(queue: unknown[]) {
    const chain: Record<string, unknown> = {};
    const resolve = () => {
      const val = queue.shift();
      return val instanceof Error ? Promise.reject(val) : Promise.resolve(val ?? []);
    };
    for (const method of ['from', 'leftJoin', 'innerJoin', 'where', 'orderBy', 'limit', 'groupBy', 'set', 'values', 'returning', 'onConflictDoNothing']) {
      chain[method] = vi.fn(() => chain);
    }
    chain.then = (onFulfilled?: (v: unknown) => unknown, onRejected?: (e: unknown) => unknown) => {
      return resolve().then(onFulfilled, onRejected);
    };
    chain.catch = (onRejected?: (e: unknown) => unknown) => {
      return resolve().catch(onRejected);
    };
    return chain;
  }

  return {
    selectQueue, insertQueue, updateQueue, deleteQueue,
    makeThenableChain,
    mockSignAccessToken: vi.fn().mockResolvedValue('mock-access-token'),
    mockLogActivity: vi.fn().mockResolvedValue(undefined),
    mockIsLocked: vi.fn().mockReturnValue({ locked: false }),
    mockRecordFailedAttempt: vi.fn().mockReturnValue({ locked: false }),
    mockResetAttempts: vi.fn(),
    mockArgon2Hash: vi.fn().mockResolvedValue('$argon2-hashed'),
    mockArgon2Verify: vi.fn().mockResolvedValue(true),
    mockGetRegistrationMode: vi.fn().mockResolvedValue('open'),
    mockGetSessionSettings: vi.fn().mockResolvedValue({ ttlHours: 168, maxPerUser: 5 }),
  };
});

// ─── Mocks ─────────────────────────────────────────────────────

const mockUser = { id: 'user-1', email: 'test@example.com', role: 'analyst', displayName: 'Test', avatarUrl: null };

vi.mock('../db/index.js', () => ({
  db: {
    select: vi.fn(() => makeThenableChain(selectQueue)),
    insert: vi.fn(() => makeThenableChain(insertQueue)),
    update: vi.fn(() => makeThenableChain(updateQueue)),
    delete: vi.fn(() => makeThenableChain(deleteQueue)),
  },
}));

vi.mock('../db/schema.js', () => ({
  users: { id: 'id', email: 'email', displayName: 'display_name', avatarUrl: 'avatar_url', passwordHash: 'password_hash', role: 'role', active: 'active', lastLoginAt: 'last_login_at', createdAt: 'created_at', updatedAt: 'updated_at' },
  sessions: { id: 'id', userId: 'user_id', expiresAt: 'expires_at', createdAt: 'created_at' },
  allowedEmails: { email: 'email', createdAt: 'created_at' },
}));

vi.mock('../middleware/auth.js', async () => {
  const { createMiddleware } = await import('hono/factory');
  return {
    requireAuth: createMiddleware(async (c: { set: (k: string, v: unknown) => void; req: { header: (k: string) => string | undefined }; json: (body: unknown, status: number) => Response }, next: () => Promise<void>) => {
      const header = c.req.header('Authorization');
      if (!header?.startsWith('Bearer ')) {
        return c.json({ error: 'Missing authorization header' }, 401);
      }
      if (header === 'Bearer invalid') {
        return c.json({ error: 'Invalid or expired token' }, 401);
      }
      c.set('user', mockUser);
      await next();
    }),
    signAccessToken: (...args: unknown[]) => mockSignAccessToken(...args),
  };
});

vi.mock('../services/admin-secret.js', () => ({
  getRegistrationMode: (...args: unknown[]) => mockGetRegistrationMode(...args),
  getSessionSettings: (...args: unknown[]) => mockGetSessionSettings(...args),
  ADMIN_SYSTEM_USER_ID: 'system',
}));

vi.mock('../services/audit-service.js', () => ({
  logActivity: (...args: unknown[]) => mockLogActivity(...args),
}));

vi.mock('../services/login-limiter.js', () => ({
  isLocked: (...args: unknown[]) => mockIsLocked(...args),
  recordFailedAttempt: (...args: unknown[]) => mockRecordFailedAttempt(...args),
  resetAttempts: (...args: unknown[]) => mockResetAttempts(...args),
}));

vi.mock('argon2', () => ({
  default: {
    hash: (...args: unknown[]) => mockArgon2Hash(...args),
    verify: (...args: unknown[]) => mockArgon2Verify(...args),
    argon2id: 2,
  },
  hash: (...args: unknown[]) => mockArgon2Hash(...args),
  verify: (...args: unknown[]) => mockArgon2Verify(...args),
  argon2id: 2,
}));

vi.mock('nanoid', () => ({
  nanoid: vi.fn(() => 'nano-id-1234'),
}));

vi.mock('../lib/logger.js', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

// ─── Import under test ─────────────────────────────────────────

import authRoutes from '../routes/auth.js';

// ─── Helpers ────────────────────────────────────────────────────

function buildApp() {
  const app = new Hono();
  app.route('/api/auth', authRoutes);
  return app;
}

function authHeader(token = 'valid-token'): Record<string, string> {
  return { Authorization: `Bearer ${token}` };
}

function postJson(app: Hono, path: string, body: Record<string, unknown>, headers?: Record<string, string>) {
  return app.request(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify(body),
  });
}

function patchJson(app: Hono, path: string, body: Record<string, unknown>, headers?: Record<string, string>) {
  return app.request(path, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify(body),
  });
}

// ─── Fixtures ───────────────────────────────────────────────────

const VALID_USER_ROW = {
  id: 'user-1',
  email: 'alice@example.com',
  displayName: 'Alice',
  avatarUrl: null,
  passwordHash: '$argon2-hashed',
  role: 'analyst',
  active: true,
  lastLoginAt: new Date(),
  createdAt: new Date(),
  updatedAt: new Date(),
};

// ─── Tests ──────────────────────────────────────────────────────

let app: Hono;

beforeEach(() => {
  vi.clearAllMocks();
  selectQueue.length = 0;
  insertQueue.length = 0;
  updateQueue.length = 0;
  deleteQueue.length = 0;
  mockIsLocked.mockReturnValue({ locked: false });
  mockRecordFailedAttempt.mockReturnValue({ locked: false });
  mockArgon2Verify.mockResolvedValue(true);
  mockArgon2Hash.mockResolvedValue('$argon2-hashed');
  mockGetRegistrationMode.mockResolvedValue('open');
  mockGetSessionSettings.mockResolvedValue({ ttlHours: 168, maxPerUser: 5 });
  app = buildApp();
});

// ═══════════════════════════════════════════════════════════════
// 1. Auth requirements on protected routes
// ═══════════════════════════════════════════════════════════════

describe('Auth requirements', () => {
  it('GET /api/auth/me returns 401 without token', async () => {
    const res = await app.request('/api/auth/me');
    expect(res.status).toBe(401);
  });

  it('POST /api/auth/logout returns 401 without token', async () => {
    const res = await postJson(app, '/api/auth/logout', {});
    expect(res.status).toBe(401);
  });

  it('PATCH /api/auth/me returns 401 without token', async () => {
    const res = await patchJson(app, '/api/auth/me', { displayName: 'New' });
    expect(res.status).toBe(401);
  });

  it('POST /api/auth/change-password returns 401 without token', async () => {
    const res = await postJson(app, '/api/auth/change-password', { oldPassword: 'a', newPassword: 'b'.repeat(8) });
    expect(res.status).toBe(401);
  });

  it('returns 401 with invalid Bearer token', async () => {
    const res = await app.request('/api/auth/me', { headers: authHeader('invalid') });
    expect(res.status).toBe(401);
  });
});

// ═══════════════════════════════════════════════════════════════
// 2. Registration
// ═══════════════════════════════════════════════════════════════

describe('POST /api/auth/register', () => {
  it('registers successfully in open mode', async () => {
    // Check existing user — none
    selectQueue.push([]);
    // getSessionSettings for createTokenPair — existing sessions query
    selectQueue.push([]);
    // insert user
    insertQueue.push([]);
    // insert session
    insertQueue.push([]);

    const res = await postJson(app, '/api/auth/register', {
      email: 'bob@example.com', password: 'SecureP@ss1', displayName: 'Bob',
    });

    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body).toHaveProperty('accessToken');
    expect(body).toHaveProperty('refreshToken');
    expect(body.user.email).toBe('bob@example.com');
  });

  it('returns 400 for missing email', async () => {
    const res = await postJson(app, '/api/auth/register', { password: 'SecureP@ss1', displayName: 'Bob' });
    expect(res.status).toBe(400);
  });

  it('returns 400 for missing password', async () => {
    const res = await postJson(app, '/api/auth/register', { email: 'bob@example.com', displayName: 'Bob' });
    expect(res.status).toBe(400);
  });

  it('returns 400 for invalid email format', async () => {
    const res = await postJson(app, '/api/auth/register', { email: 'not-email', password: 'SecureP@ss1', displayName: 'Bob' });
    expect(res.status).toBe(400);
  });

  it('returns 400 for short password (< 8 chars)', async () => {
    const res = await postJson(app, '/api/auth/register', { email: 'bob@example.com', password: 'short', displayName: 'Bob' });
    expect(res.status).toBe(400);
  });

  it('returns 409 for duplicate email', async () => {
    selectQueue.push([VALID_USER_ROW]);

    const res = await postJson(app, '/api/auth/register', {
      email: 'alice@example.com', password: 'SecureP@ss1', displayName: 'Alice2',
    });
    expect(res.status).toBe(409);
  });

  it('blocks @threatcaddy.internal domain', async () => {
    const res = await postJson(app, '/api/auth/register', {
      email: 'bot@threatcaddy.internal', password: 'SecureP@ss1', displayName: 'Bot',
    });
    expect(res.status).toBe(400);
  });

  it('rejects registration in invite mode when email not in allowlist', async () => {
    mockGetRegistrationMode.mockResolvedValue('invite');
    // Check existing user — none
    selectQueue.push([]);
    // Check allowedEmails — none
    selectQueue.push([]);

    const res = await postJson(app, '/api/auth/register', {
      email: 'outsider@example.com', password: 'SecureP@ss1', displayName: 'Out',
    });
    expect(res.status).toBe(403);
  });

  it('allows registration in invite mode when email is in allowlist', async () => {
    mockGetRegistrationMode.mockResolvedValue('invite');
    // Check existing user — none
    selectQueue.push([]);
    // Check allowedEmails — found
    selectQueue.push([{ email: 'invited@example.com' }]);
    // existing sessions
    selectQueue.push([]);
    // insert user
    insertQueue.push([]);
    // insert session
    insertQueue.push([]);
    // delete used invite
    deleteQueue.push([]);

    const res = await postJson(app, '/api/auth/register', {
      email: 'invited@example.com', password: 'SecureP@ss1', displayName: 'Inv',
    });
    expect(res.status).toBe(201);
  });
});

// ═══════════════════════════════════════════════════════════════
// 3. Login
// ═══════════════════════════════════════════════════════════════

describe('POST /api/auth/login', () => {
  it('logs in successfully', async () => {
    // User lookup
    selectQueue.push([VALID_USER_ROW]);
    // Update lastLoginAt
    updateQueue.push([]);
    // existing sessions for createTokenPair
    selectQueue.push([]);
    // insert session
    insertQueue.push([]);

    const res = await postJson(app, '/api/auth/login', {
      email: 'alice@example.com', password: 'SecureP@ss1',
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toHaveProperty('accessToken');
    expect(body).toHaveProperty('refreshToken');
    expect(body.user.email).toBe('alice@example.com');
    expect(mockResetAttempts).toHaveBeenCalledWith('alice@example.com');
  });

  it('returns 401 for unknown email', async () => {
    selectQueue.push([]);

    const res = await postJson(app, '/api/auth/login', {
      email: 'nobody@example.com', password: 'SecureP@ss1',
    });
    expect(res.status).toBe(401);
    expect(mockRecordFailedAttempt).toHaveBeenCalled();
  });

  it('returns 401 for wrong password', async () => {
    mockArgon2Verify.mockResolvedValueOnce(false);
    selectQueue.push([VALID_USER_ROW]);

    const res = await postJson(app, '/api/auth/login', {
      email: 'alice@example.com', password: 'WrongPass!',
    });
    expect(res.status).toBe(401);
    expect(mockRecordFailedAttempt).toHaveBeenCalledWith('alice@example.com');
  });

  it('returns 429 when account is locked', async () => {
    mockIsLocked.mockReturnValue({ locked: true, retryAfterMinutes: 15 });

    const res = await postJson(app, '/api/auth/login', {
      email: 'alice@example.com', password: 'SecureP@ss1',
    });
    expect(res.status).toBe(429);
    expect(res.headers.get('Retry-After')).toBe('900');
  });

  it('returns 429 when failed attempt triggers lockout', async () => {
    mockRecordFailedAttempt.mockReturnValue({ locked: true, retryAfterMinutes: 15 });
    selectQueue.push([]);

    const res = await postJson(app, '/api/auth/login', {
      email: 'nobody@example.com', password: 'bad',
    });
    expect(res.status).toBe(429);
  });

  it('returns 403 for inactive account', async () => {
    selectQueue.push([{ ...VALID_USER_ROW, active: false }]);

    const res = await postJson(app, '/api/auth/login', {
      email: 'alice@example.com', password: 'SecureP@ss1',
    });
    expect(res.status).toBe(403);
  });

  it('returns 403 for bot account (@threatcaddy.internal)', async () => {
    selectQueue.push([{ ...VALID_USER_ROW, email: 'bot@threatcaddy.internal' }]);

    const res = await postJson(app, '/api/auth/login', {
      email: 'bot@threatcaddy.internal', password: 'SecureP@ss1',
    });
    expect(res.status).toBe(403);
  });

  it('returns 400 for validation failure', async () => {
    const res = await postJson(app, '/api/auth/login', { email: 'not-email' });
    expect(res.status).toBe(400);
  });
});

// ═══════════════════════════════════════════════════════════════
// 4. Refresh
// ═══════════════════════════════════════════════════════════════

describe('POST /api/auth/refresh', () => {
  it('rotates refresh token successfully', async () => {
    // Find session
    selectQueue.push([{ id: 'old-refresh', userId: 'user-1', expiresAt: new Date(Date.now() + 86400000) }]);
    // Delete old session
    deleteQueue.push([]);
    // Find user
    selectQueue.push([VALID_USER_ROW]);
    // Existing sessions for createTokenPair
    selectQueue.push([]);
    // Insert new session
    insertQueue.push([]);

    const res = await postJson(app, '/api/auth/refresh', { refreshToken: 'old-refresh' });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toHaveProperty('accessToken');
    expect(body).toHaveProperty('refreshToken');
  });

  it('returns 401 for invalid refresh token', async () => {
    selectQueue.push([]);

    const res = await postJson(app, '/api/auth/refresh', { refreshToken: 'bad-token' });
    expect(res.status).toBe(401);
  });

  it('returns 401 for expired refresh token', async () => {
    selectQueue.push([{ id: 'expired', userId: 'user-1', expiresAt: new Date(Date.now() - 86400000) }]);
    // Delete expired session
    deleteQueue.push([]);

    const res = await postJson(app, '/api/auth/refresh', { refreshToken: 'expired' });
    expect(res.status).toBe(401);
  });

  it('returns 400 for missing refresh token', async () => {
    const res = await postJson(app, '/api/auth/refresh', {});
    expect(res.status).toBe(400);
  });

  it('returns 401 when user is disabled during refresh', async () => {
    selectQueue.push([{ id: 'sess-1', userId: 'user-1', expiresAt: new Date(Date.now() + 86400000) }]);
    deleteQueue.push([]);
    selectQueue.push([{ ...VALID_USER_ROW, active: false }]);

    const res = await postJson(app, '/api/auth/refresh', { refreshToken: 'sess-1' });
    expect(res.status).toBe(401);
  });
});

// ═══════════════════════════════════════════════════════════════
// 5. Logout
// ═══════════════════════════════════════════════════════════════

describe('POST /api/auth/logout', () => {
  it('logs out successfully', async () => {
    deleteQueue.push([]);

    const res = await postJson(app, '/api/auth/logout', { refreshToken: 'sess-1' }, authHeader());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
  });

  it('returns 401 without auth', async () => {
    const res = await postJson(app, '/api/auth/logout', {});
    expect(res.status).toBe(401);
  });
});

// ═══════════════════════════════════════════════════════════════
// 6. GET /me
// ═══════════════════════════════════════════════════════════════

describe('GET /api/auth/me', () => {
  it('returns user profile', async () => {
    selectQueue.push([VALID_USER_ROW]);

    const res = await app.request('/api/auth/me', { headers: authHeader() });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.email).toBe('alice@example.com');
    expect(body.displayName).toBe('Alice');
    expect(body.role).toBe('analyst');
  });

  it('returns 404 when user not found in DB', async () => {
    selectQueue.push([]);

    const res = await app.request('/api/auth/me', { headers: authHeader() });
    expect(res.status).toBe(404);
  });
});

// ═══════════════════════════════════════════════════════════════
// 7. PATCH /me
// ═══════════════════════════════════════════════════════════════

describe('PATCH /api/auth/me', () => {
  it('updates displayName', async () => {
    updateQueue.push([]);

    const res = await patchJson(app, '/api/auth/me', { displayName: 'NewName' }, authHeader());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
  });

  it('updates avatarUrl', async () => {
    updateQueue.push([]);

    const res = await patchJson(app, '/api/auth/me', { avatarUrl: 'https://example.com/avatar.png' }, authHeader());
    expect(res.status).toBe(200);
  });

  it('returns 401 without auth', async () => {
    const res = await patchJson(app, '/api/auth/me', { displayName: 'Nope' });
    expect(res.status).toBe(401);
  });

  it('rejects displayName longer than 15 chars', async () => {
    const res = await patchJson(app, '/api/auth/me', { displayName: 'A'.repeat(16) }, authHeader());
    expect(res.status).toBe(400);
  });
});

// ═══════════════════════════════════════════════════════════════
// 8. Change password
// ═══════════════════════════════════════════════════════════════

describe('POST /api/auth/change-password', () => {
  it('changes password successfully', async () => {
    selectQueue.push([VALID_USER_ROW]);
    updateQueue.push([]);
    deleteQueue.push([]);

    const res = await postJson(app, '/api/auth/change-password', {
      oldPassword: 'SecureP@ss1', newPassword: 'NewSecure456!',
    }, authHeader());

    expect(res.status).toBe(200);
    expect(mockArgon2Verify).toHaveBeenCalled();
    expect(mockArgon2Hash).toHaveBeenCalled();
  });

  it('rejects wrong old password', async () => {
    mockArgon2Verify.mockResolvedValueOnce(false);
    selectQueue.push([VALID_USER_ROW]);

    const res = await postJson(app, '/api/auth/change-password', {
      oldPassword: 'WrongOld!', newPassword: 'NewSecure456!',
    }, authHeader());
    expect(res.status).toBe(401);
  });

  it('returns 401 without auth', async () => {
    const res = await postJson(app, '/api/auth/change-password', {
      oldPassword: 'old', newPassword: 'newpass123',
    });
    expect(res.status).toBe(401);
  });

  it('returns 400 for missing fields', async () => {
    const res = await postJson(app, '/api/auth/change-password', { oldPassword: 'only' }, authHeader());
    expect(res.status).toBe(400);
  });

  it('returns 400 for short new password', async () => {
    const res = await postJson(app, '/api/auth/change-password', {
      oldPassword: 'SecureP@ss1', newPassword: 'short',
    }, authHeader());
    expect(res.status).toBe(400);
  });

  it('invalidates all sessions after password change', async () => {
    selectQueue.push([VALID_USER_ROW]);
    updateQueue.push([]);
    deleteQueue.push([]);

    const res = await postJson(app, '/api/auth/change-password', {
      oldPassword: 'SecureP@ss1', newPassword: 'NewSecure456!',
    }, authHeader());

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
  });
});
