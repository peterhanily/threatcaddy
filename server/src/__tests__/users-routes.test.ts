import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Hono } from 'hono';

// ─── Hoisted mock state ────────────────────────────────────────

const { selectQueue, insertQueue, updateQueue, deleteQueue, makeThenableChain } = vi.hoisted(() => {
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
    for (const method of ['from', 'leftJoin', 'innerJoin', 'where', 'orderBy', 'limit', 'offset', 'groupBy', 'set', 'values', 'returning']) {
      chain[method] = () => chain;
    }
    chain.then = (onFulfilled?: (v: unknown) => unknown, onRejected?: (e: unknown) => unknown) => {
      return resolve().then(onFulfilled, onRejected);
    };
    chain.catch = (onRejected?: (e: unknown) => unknown) => {
      return resolve().catch(onRejected);
    };
    return chain;
  }

  return { selectQueue, insertQueue, updateQueue, deleteQueue, makeThenableChain };
});

// ─── Mock the shared module ────────────────────────────────────

vi.mock('../routes/admin/shared.js', async () => {
  const { initAdminKey: _initAdminKey, requireAdminAuth: _requireAdminAuth } = await import('../middleware/admin-auth.js');
  _initAdminKey();

  return {
    db: {
      select: () => makeThenableChain(selectQueue),
      insert: () => makeThenableChain(insertQueue),
      update: () => makeThenableChain(updateQueue),
      delete: () => makeThenableChain(deleteQueue),
    },
    users: {
      id: 'id', email: 'email', displayName: 'display_name', role: 'role',
      active: 'active', lastLoginAt: 'last_login_at', createdAt: 'created_at',
      updatedAt: 'updated_at', passwordHash: 'password_hash', avatarUrl: 'avatar_url',
    },
    sessions: {
      id: 'id', userId: 'user_id', createdAt: 'created_at', expiresAt: 'expires_at',
    },
    activityLog: {
      id: 'id', userId: 'user_id', category: 'category', action: 'action',
      detail: 'detail', itemId: 'item_id', itemTitle: 'item_title',
      folderId: 'folder_id', timestamp: 'timestamp',
    },
    investigationMembers: {
      id: 'id', folderId: 'folder_id', userId: 'user_id', role: 'role',
    },
    folders: { id: 'id', name: 'name' },
    allowedEmails: { email: 'email' },
    adminUsers: { id: 'id', username: 'username', displayName: 'display_name' },
    requireAdminAuth: _requireAdminAuth,
    logAdminAction: () => Promise.resolve(undefined),
    getAdminId: () => 'admin-1',
    logger: { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} },
  };
});

vi.mock('../../services/admin-secret.js', () => ({
  ADMIN_SYSTEM_USER_ID: '__system_admin__',
  changeAdminSecret: vi.fn().mockResolvedValue(true),
}));

vi.mock('../services/audit-service.js', () => ({
  logActivity: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../lib/logger.js', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

vi.mock('argon2', () => ({
  hash: vi.fn().mockResolvedValue('$argon2id$hashed'),
  argon2id: 2,
}));

// ─── Import under test ─────────────────────────────────────────

import usersApp from '../routes/admin/users.js';
import { signAdminToken } from '../middleware/admin-auth.js';

// ─── Helpers ────────────────────────────────────────────────────

function buildApp() {
  const app = new Hono();
  app.route('/admin', usersApp);
  return app;
}

function authHeader(token: string): Record<string, string> {
  return { Authorization: `Bearer ${token}` };
}

function jsonReq(method: string, path: string, body?: unknown, headers?: Record<string, string>) {
  const opts: RequestInit = { method, headers: { 'Content-Type': 'application/json', ...headers } };
  if (body !== undefined) opts.body = JSON.stringify(body);
  return new Request(`http://localhost${path}`, opts);
}

async function getAdminToken(id = 'admin-1', username = 'testadmin'): Promise<string> {
  return signAdminToken(id, username);
}

// ─── Tests ──────────────────────────────────────────────────────

let app: Hono;

beforeEach(() => {
  vi.clearAllMocks();
  selectQueue.length = 0;
  insertQueue.length = 0;
  updateQueue.length = 0;
  deleteQueue.length = 0;
  app = buildApp();
});

// ═══════════════════════════════════════════════════════════════
// 1. Admin auth required
// ═══════════════════════════════════════════════════════════════

describe('Admin auth requirements', () => {
  it('GET /admin/api/users returns 401 without auth', async () => {
    const res = await app.request('/admin/api/users');
    expect(res.status).toBe(401);
  });

  it('PATCH /admin/api/users/:id returns 401 without auth', async () => {
    const res = await app.request(jsonReq('PATCH', '/admin/api/users/u1', { role: 'viewer' }));
    expect(res.status).toBe(401);
  });

  it('POST /admin/api/users returns 401 without auth', async () => {
    const res = await app.request(jsonReq('POST', '/admin/api/users', { email: 'x@y.com' }));
    expect(res.status).toBe(401);
  });

  it('POST /admin/api/users/:id/reset-password returns 401 without auth', async () => {
    const res = await app.request(jsonReq('POST', '/admin/api/users/u1/reset-password'));
    expect(res.status).toBe(401);
  });

  it('GET /admin/api/users/export returns 401 without auth', async () => {
    const res = await app.request('/admin/api/users/export');
    expect(res.status).toBe(401);
  });

  it('GET /admin/api/users/:id/detail returns 401 without auth', async () => {
    const res = await app.request('/admin/api/users/u1/detail');
    expect(res.status).toBe(401);
  });
});

// ═══════════════════════════════════════════════════════════════
// 2. List users (GET /admin/api/users)
// ═══════════════════════════════════════════════════════════════

describe('GET /admin/api/users', () => {
  it('returns list of users', async () => {
    const token = await getAdminToken();
    selectQueue.push([
      { id: 'u1', email: 'alice@test.com', displayName: 'Alice', role: 'admin', active: true, lastLoginAt: null, createdAt: new Date() },
      { id: 'u2', email: 'bob@test.com', displayName: 'Bob', role: 'analyst', active: true, lastLoginAt: new Date(), createdAt: new Date() },
    ]);

    const res = await app.request('/admin/api/users', {
      headers: authHeader(token),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.users).toHaveLength(2);
    expect(body.users[0].email).toBe('alice@test.com');
  });

  it('returns empty list when no users exist', async () => {
    const token = await getAdminToken();
    selectQueue.push([]);

    const res = await app.request('/admin/api/users', {
      headers: authHeader(token),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.users).toHaveLength(0);
  });
});

// ═══════════════════════════════════════════════════════════════
// 3. Update user (PATCH /admin/api/users/:id)
// ═══════════════════════════════════════════════════════════════

describe('PATCH /admin/api/users/:id', () => {
  it('updates user role successfully', async () => {
    const token = await getAdminToken();
    selectQueue.push([{ email: 'alice@test.com' }]);
    updateQueue.push(undefined);

    const res = await app.request(jsonReq('PATCH', '/admin/api/users/u1',
      { role: 'viewer' }, authHeader(token)));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
  });

  it('updates user active status to false', async () => {
    const token = await getAdminToken();
    selectQueue.push([{ email: 'bob@test.com' }]);
    updateQueue.push(undefined);

    const res = await app.request(jsonReq('PATCH', '/admin/api/users/u2',
      { active: false }, authHeader(token)));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
  });

  it('returns 404 when user does not exist', async () => {
    const token = await getAdminToken();
    selectQueue.push([]);

    const res = await app.request(jsonReq('PATCH', '/admin/api/users/nonexistent',
      { role: 'viewer' }, authHeader(token)));
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.error).toMatch(/not found/i);
  });

  it('returns 400 for invalid role', async () => {
    const token = await getAdminToken();
    selectQueue.push([{ email: 'alice@test.com' }]);

    const res = await app.request(jsonReq('PATCH', '/admin/api/users/u1',
      { role: 'superadmin' }, authHeader(token)));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/invalid role/i);
  });

  it('returns 400 for invalid active value (not boolean)', async () => {
    const token = await getAdminToken();
    selectQueue.push([{ email: 'alice@test.com' }]);

    const res = await app.request(jsonReq('PATCH', '/admin/api/users/u1',
      { active: 'yes' }, authHeader(token)));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/invalid active/i);
  });
});

// ═══════════════════════════════════════════════════════════════
// 4. Create user (POST /admin/api/users)
// ═══════════════════════════════════════════════════════════════

describe('POST /admin/api/users', () => {
  it('creates a new user and returns 201', async () => {
    const token = await getAdminToken();
    selectQueue.push([]); // Check existing
    insertQueue.push(undefined); // Insert

    const res = await app.request(jsonReq('POST', '/admin/api/users', {
      email: 'newuser@test.com',
      displayName: 'New User',
      password: 'password123!',
      role: 'analyst',
    }, authHeader(token)));
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.user.email).toBe('newuser@test.com');
    expect(body.user.role).toBe('analyst');
  });

  it('returns 400 for invalid email', async () => {
    const token = await getAdminToken();

    const res = await app.request(jsonReq('POST', '/admin/api/users', {
      email: 'not-an-email',
      displayName: 'User',
      password: 'password123!',
    }, authHeader(token)));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/invalid email/i);
  });

  it('returns 400 for missing email', async () => {
    const token = await getAdminToken();

    const res = await app.request(jsonReq('POST', '/admin/api/users', {
      displayName: 'User',
      password: 'password123!',
    }, authHeader(token)));
    expect(res.status).toBe(400);
  });

  it('returns 400 for missing display name', async () => {
    const token = await getAdminToken();

    const res = await app.request(jsonReq('POST', '/admin/api/users', {
      email: 'test@test.com',
      displayName: '',
      password: 'password123!',
    }, authHeader(token)));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/display name/i);
  });

  it('returns 400 for password shorter than 8 characters', async () => {
    const token = await getAdminToken();

    const res = await app.request(jsonReq('POST', '/admin/api/users', {
      email: 'test@test.com',
      displayName: 'Test',
      password: 'short',
    }, authHeader(token)));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/at least 8/i);
  });

  it('returns 409 when email is already registered', async () => {
    const token = await getAdminToken();
    selectQueue.push([{ id: 'existing-user' }]);

    const res = await app.request(jsonReq('POST', '/admin/api/users', {
      email: 'existing@test.com',
      displayName: 'Existing User',
      password: 'password123!',
    }, authHeader(token)));
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.error).toMatch(/already registered/i);
  });

  it('defaults role to analyst when invalid role provided', async () => {
    const token = await getAdminToken();
    selectQueue.push([]);
    insertQueue.push(undefined);

    const res = await app.request(jsonReq('POST', '/admin/api/users', {
      email: 'default@test.com',
      displayName: 'Default Role',
      password: 'password123!',
      role: 'invalid-role',
    }, authHeader(token)));
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.user.role).toBe('analyst');
  });

  it('normalizes email to lowercase', async () => {
    const token = await getAdminToken();
    selectQueue.push([]);
    insertQueue.push(undefined);

    const res = await app.request(jsonReq('POST', '/admin/api/users', {
      email: 'UPPER@TEST.COM',
      displayName: 'Upper',
      password: 'password123!',
    }, authHeader(token)));
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.user.email).toBe('upper@test.com');
  });
});

// ═══════════════════════════════════════════════════════════════
// 5. Reset user password (POST /admin/api/users/:id/reset-password)
// ═══════════════════════════════════════════════════════════════

describe('POST /admin/api/users/:id/reset-password', () => {
  it('resets password and returns temporary password', async () => {
    const token = await getAdminToken();
    selectQueue.push([{ id: 'u1', email: 'alice@test.com' }]);
    updateQueue.push(undefined);

    const res = await app.request(jsonReq('POST', '/admin/api/users/u1/reset-password',
      undefined, authHeader(token)));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.temporaryPassword).toBeDefined();
    expect(typeof body.temporaryPassword).toBe('string');
  });

  it('returns 404 when user does not exist', async () => {
    const token = await getAdminToken();
    selectQueue.push([]);

    const res = await app.request(jsonReq('POST', '/admin/api/users/nonexistent/reset-password',
      undefined, authHeader(token)));
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.error).toMatch(/not found/i);
  });
});

// ═══════════════════════════════════════════════════════════════
// 6. Bulk user operations (POST /admin/api/users/bulk)
// ═══════════════════════════════════════════════════════════════

describe('POST /admin/api/users/bulk', () => {
  it('changes roles for multiple users', async () => {
    const token = await getAdminToken();
    updateQueue.push([{ id: 'u1' }, { id: 'u2' }]);

    const res = await app.request(jsonReq('POST', '/admin/api/users/bulk', {
      userIds: ['u1', 'u2'],
      action: 'changeRole',
      role: 'viewer',
    }, authHeader(token)));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.affected).toBe(2);
  });

  it('disables multiple users', async () => {
    const token = await getAdminToken();
    updateQueue.push([{ id: 'u1' }]);
    updateQueue.push([{ id: 'u2' }]);

    const res = await app.request(jsonReq('POST', '/admin/api/users/bulk', {
      userIds: ['u1', 'u2'],
      action: 'disable',
    }, authHeader(token)));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
  });

  it('enables multiple users', async () => {
    const token = await getAdminToken();
    updateQueue.push([{ id: 'u1' }]);

    const res = await app.request(jsonReq('POST', '/admin/api/users/bulk', {
      userIds: ['u1'],
      action: 'enable',
    }, authHeader(token)));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
  });

  it('returns 400 when userIds is empty', async () => {
    const token = await getAdminToken();

    const res = await app.request(jsonReq('POST', '/admin/api/users/bulk', {
      userIds: [],
      action: 'disable',
    }, authHeader(token)));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/userIds/i);
  });

  it('returns 400 when action is invalid', async () => {
    const token = await getAdminToken();

    const res = await app.request(jsonReq('POST', '/admin/api/users/bulk', {
      userIds: ['u1'],
      action: 'invalidAction',
    }, authHeader(token)));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/invalid action/i);
  });

  it('returns 400 when changeRole is used without valid role', async () => {
    const token = await getAdminToken();

    const res = await app.request(jsonReq('POST', '/admin/api/users/bulk', {
      userIds: ['u1'],
      action: 'changeRole',
      role: 'superadmin',
    }, authHeader(token)));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/invalid role/i);
  });
});

// ═══════════════════════════════════════════════════════════════
// 7. Export users CSV (GET /admin/api/users/export)
// ═══════════════════════════════════════════════════════════════

describe('GET /admin/api/users/export', () => {
  it('returns CSV with user data', async () => {
    const token = await getAdminToken();
    selectQueue.push([
      { id: 'u1', email: 'alice@test.com', displayName: 'Alice', role: 'admin', active: true, lastLoginAt: new Date('2025-01-15'), createdAt: new Date('2024-06-01') },
    ]);

    const res = await app.request('/admin/api/users/export', {
      headers: authHeader(token),
    });
    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Disposition')).toContain('users.csv');

    const csv = await res.text();
    expect(csv).toContain('id,email,displayName,role,active,lastLoginAt,createdAt');
    expect(csv).toContain('alice@test.com');
  });

  it('returns CSV with only header when no users', async () => {
    const token = await getAdminToken();
    selectQueue.push([]);

    const res = await app.request('/admin/api/users/export', {
      headers: authHeader(token),
    });
    expect(res.status).toBe(200);
    const csv = await res.text();
    const lines = csv.trim().split('\n');
    expect(lines).toHaveLength(1);
  });
});

// ═══════════════════════════════════════════════════════════════
// 8. Get user detail (GET /admin/api/users/:id/detail)
// ═══════════════════════════════════════════════════════════════

describe('GET /admin/api/users/:id/detail', () => {
  it('returns user detail with sessions, memberships, and activity', async () => {
    const token = await getAdminToken();
    // 1) User lookup
    selectQueue.push([{
      id: 'u1', email: 'alice@test.com', displayName: 'Alice',
      role: 'admin', active: true, lastLoginAt: new Date(), createdAt: new Date(),
    }]);
    // 2) Active sessions
    selectQueue.push([
      { id: 's1', createdAt: new Date(), expiresAt: new Date() },
    ]);
    // 3) Memberships
    selectQueue.push([
      { folderId: 'f1', role: 'owner', folderName: 'Case Alpha' },
    ]);
    // 4) Recent activity
    selectQueue.push([
      { id: 'a1', category: 'entity', action: 'create', detail: 'Created note', timestamp: new Date() },
    ]);

    const res = await app.request('/admin/api/users/u1/detail', {
      headers: authHeader(token),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.user.email).toBe('alice@test.com');
    expect(body.sessions).toHaveLength(1);
    expect(body.memberships).toHaveLength(1);
    expect(body.recentActivity).toHaveLength(1);
  });

  it('returns 404 when user does not exist', async () => {
    const token = await getAdminToken();
    selectQueue.push([]);

    const res = await app.request('/admin/api/users/nonexistent/detail', {
      headers: authHeader(token),
    });
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.error).toMatch(/not found/i);
  });
});

// ═══════════════════════════════════════════════════════════════
// 9. Change admin secret (POST /admin/api/change-secret)
// ═══════════════════════════════════════════════════════════════

describe('POST /admin/api/change-secret', () => {
  it('returns 400 when current secret is missing', async () => {
    const token = await getAdminToken();

    const res = await app.request(jsonReq('POST', '/admin/api/change-secret', {
      newSecret: 'newSecretValue12',
    }, authHeader(token)));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/current secret/i);
  });

  it('returns 400 when new secret is too short', async () => {
    const token = await getAdminToken();

    const res = await app.request(jsonReq('POST', '/admin/api/change-secret', {
      currentSecret: 'oldSecret12345',
      newSecret: 'short',
    }, authHeader(token)));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/at least 12/i);
  });
});

// ═══════════════════════════════════════════════════════════════
// 10. Sessions management
// ═══════════════════════════════════════════════════════════════

describe('GET /admin/api/sessions', () => {
  it('returns active sessions', async () => {
    const token = await getAdminToken();
    selectQueue.push([
      { id: 's1', userId: 'u1', userEmail: 'alice@test.com', userDisplayName: 'Alice', createdAt: new Date(), expiresAt: new Date() },
    ]);

    const res = await app.request('/admin/api/sessions', {
      headers: authHeader(token),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.sessions).toHaveLength(1);
  });

  it('returns 401 without auth', async () => {
    const res = await app.request('/admin/api/sessions');
    expect(res.status).toBe(401);
  });
});

describe('DELETE /admin/api/sessions/user/:userId', () => {
  it('force-logs out a user', async () => {
    const token = await getAdminToken();
    deleteQueue.push([{ id: 's1' }, { id: 's2' }]);

    const res = await app.request(new Request('http://localhost/admin/api/sessions/user/u1', {
      method: 'DELETE',
      headers: authHeader(token),
    }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.deletedCount).toBe(2);
  });
});

describe('DELETE /admin/api/sessions/all', () => {
  it('force-logs out all users', async () => {
    const token = await getAdminToken();
    deleteQueue.push([{ id: 's1' }, { id: 's2' }, { id: 's3' }]);

    const res = await app.request(new Request('http://localhost/admin/api/sessions/all', {
      method: 'DELETE',
      headers: authHeader(token),
    }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.deletedCount).toBe(3);
  });
});
