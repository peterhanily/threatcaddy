import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Hono } from 'hono';

// ─── Hoisted mock state ────────────────────────────────────────

const {
  selectQueue, insertQueue, updateQueue, deleteQueue,
  makeThenableChain,
  mockLogAdminAction, mockGetAdminId,
  mockChangeAdminSecret,
  mockArgon2Hash,
  mockNanoid,
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
    for (const method of [
      'from', 'leftJoin', 'innerJoin', 'where', 'orderBy', 'limit', 'offset',
      'groupBy', 'set', 'values', 'returning', 'onConflictDoNothing',
    ]) {
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

  const mockLogAdminAction = () => Promise.resolve(undefined);
  const mockGetAdminId = () => 'admin-1';
  const mockChangeAdminSecret = vi.fn();
  const mockArgon2Hash = vi.fn().mockResolvedValue('hashed-password');
  const mockNanoid = vi.fn().mockReturnValue('generated-id');

  return {
    selectQueue, insertQueue, updateQueue, deleteQueue,
    makeThenableChain,
    mockLogAdminAction, mockGetAdminId,
    mockChangeAdminSecret,
    mockArgon2Hash, mockNanoid,
  };
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
      passwordHash: 'password_hash', updatedAt: 'updated_at',
    },
    folders: { id: 'id', name: 'name' },
    sessions: {
      id: 'id', userId: 'user_id', createdAt: 'created_at', expiresAt: 'expires_at',
    },
    activityLog: {
      id: 'id', userId: 'user_id', category: 'category', action: 'action',
      detail: 'detail', timestamp: 'timestamp', itemId: 'item_id',
      itemTitle: 'item_title', folderId: 'folder_id',
    },
    investigationMembers: {
      id: 'id', folderId: 'folder_id', userId: 'user_id', role: 'role',
    },
    requireAdminAuth: _requireAdminAuth,
    logAdminAction: mockLogAdminAction,
    getAdminId: mockGetAdminId,
    logger: { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} },
  };
});

vi.mock('../services/admin-secret.js', () => ({
  changeAdminSecret: (...args: unknown[]) => mockChangeAdminSecret(...args),
  ADMIN_SYSTEM_USER_ID: '__system_admin__',
}));

vi.mock('argon2', () => ({
  hash: (...args: unknown[]) => mockArgon2Hash(...args),
  argon2id: 2,
}));

vi.mock('nanoid', () => ({
  nanoid: (...args: unknown[]) => mockNanoid(...args),
}));

vi.mock('../services/audit-service.js', () => ({
  logActivity: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../lib/logger.js', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

// ─── Import under test ─────────────────────────────────────────

import usersApp from '../routes/admin/users.js';
import { signAdminToken } from '../middleware/admin-auth.js';

// ─── Helpers ───────────────────────────────────────────────────

function buildApp() {
  const app = new Hono();
  app.route('/admin', usersApp);
  return app;
}

function authHeader(token: string): Record<string, string> {
  return { Authorization: `Bearer ${token}` };
}

async function getAdminToken(id = 'admin-1', username = 'testadmin'): Promise<string> {
  return signAdminToken(id, username);
}

// ─── Tests ─────────────────────────────────────────────────────

let app: Hono;

beforeEach(() => {
  vi.clearAllMocks();
  selectQueue.length = 0;
  insertQueue.length = 0;
  updateQueue.length = 0;
  deleteQueue.length = 0;
  app = buildApp();

  mockChangeAdminSecret.mockResolvedValue(true);
  mockArgon2Hash.mockResolvedValue('hashed-password');
  mockNanoid.mockReturnValue('generated-id');
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
    const res = await app.request('/admin/api/users/user-1', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ role: 'viewer' }),
    });
    expect(res.status).toBe(401);
  });

  it('POST /admin/api/users/:id/reset-password returns 401 without auth', async () => {
    const res = await app.request('/admin/api/users/user-1/reset-password', {
      method: 'POST',
    });
    expect(res.status).toBe(401);
  });

  it('POST /admin/api/users returns 401 without auth', async () => {
    const res = await app.request('/admin/api/users', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'test@example.com', displayName: 'Test', password: 'password123' }),
    });
    expect(res.status).toBe(401);
  });

  it('POST /admin/api/users/bulk returns 401 without auth', async () => {
    const res = await app.request('/admin/api/users/bulk', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userIds: ['user-1'], action: 'enable' }),
    });
    expect(res.status).toBe(401);
  });

  it('GET /admin/api/users/export returns 401 without auth', async () => {
    const res = await app.request('/admin/api/users/export');
    expect(res.status).toBe(401);
  });

  it('GET /admin/api/users/:id/detail returns 401 without auth', async () => {
    const res = await app.request('/admin/api/users/user-1/detail');
    expect(res.status).toBe(401);
  });

  it('POST /admin/api/change-secret returns 401 without auth', async () => {
    const res = await app.request('/admin/api/change-secret', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ currentSecret: 'old', newSecret: 'new-secret-long-enough' }),
    });
    expect(res.status).toBe(401);
  });

  it('GET /admin/api/sessions returns 401 without auth', async () => {
    const res = await app.request('/admin/api/sessions');
    expect(res.status).toBe(401);
  });

  it('DELETE /admin/api/sessions/user/:userId returns 401 without auth', async () => {
    const res = await app.request('/admin/api/sessions/user/user-1', { method: 'DELETE' });
    expect(res.status).toBe(401);
  });

  it('DELETE /admin/api/sessions/all returns 401 without auth', async () => {
    const res = await app.request('/admin/api/sessions/all', { method: 'DELETE' });
    expect(res.status).toBe(401);
  });
});

// ═══════════════════════════════════════════════════════════════
// 2. GET /admin/api/users
// ═══════════════════════════════════════════════════════════════

describe('GET /admin/api/users', () => {
  it('returns list of users', async () => {
    const token = await getAdminToken();
    const now = new Date();
    selectQueue.push([
      { id: 'u1', email: 'alice@example.com', displayName: 'Alice', role: 'admin', active: true, lastLoginAt: now, createdAt: now },
      { id: 'u2', email: 'bob@example.com', displayName: 'Bob', role: 'analyst', active: true, lastLoginAt: null, createdAt: now },
    ]);

    const res = await app.request('/admin/api/users', {
      headers: authHeader(token),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.users).toHaveLength(2);
    expect(body.users[0].email).toBe('alice@example.com');
    expect(body.users[1].email).toBe('bob@example.com');
  });

  it('returns empty array when no users exist', async () => {
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
// 3. PATCH /admin/api/users/:id
// ═══════════════════════════════════════════════════════════════

describe('PATCH /admin/api/users/:id', () => {
  it('updates user role to viewer', async () => {
    const token = await getAdminToken();
    // First select: look up user for audit detail
    selectQueue.push([{ email: 'alice@example.com' }]);
    // update call returns from updateQueue
    updateQueue.push([]);

    const res = await app.request('/admin/api/users/user-1', {
      method: 'PATCH',
      headers: { ...authHeader(token), 'Content-Type': 'application/json' },
      body: JSON.stringify({ role: 'viewer' }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
  });

  it('updates user role to admin', async () => {
    const token = await getAdminToken();
    selectQueue.push([{ email: 'bob@example.com' }]);
    updateQueue.push([]);

    const res = await app.request('/admin/api/users/user-2', {
      method: 'PATCH',
      headers: { ...authHeader(token), 'Content-Type': 'application/json' },
      body: JSON.stringify({ role: 'admin' }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
  });

  it('updates user role to analyst', async () => {
    const token = await getAdminToken();
    selectQueue.push([{ email: 'carol@example.com' }]);
    updateQueue.push([]);

    const res = await app.request('/admin/api/users/user-3', {
      method: 'PATCH',
      headers: { ...authHeader(token), 'Content-Type': 'application/json' },
      body: JSON.stringify({ role: 'analyst' }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
  });

  it('rejects invalid role', async () => {
    const token = await getAdminToken();
    selectQueue.push([{ email: 'alice@example.com' }]);

    const res = await app.request('/admin/api/users/user-1', {
      method: 'PATCH',
      headers: { ...authHeader(token), 'Content-Type': 'application/json' },
      body: JSON.stringify({ role: 'superadmin' }),
    });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe('Invalid role');
  });

  it('updates active status to false (deactivate)', async () => {
    const token = await getAdminToken();
    selectQueue.push([{ email: 'alice@example.com' }]);
    updateQueue.push([]);

    const res = await app.request('/admin/api/users/user-1', {
      method: 'PATCH',
      headers: { ...authHeader(token), 'Content-Type': 'application/json' },
      body: JSON.stringify({ active: false }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
  });

  it('updates active status to true (activate)', async () => {
    const token = await getAdminToken();
    selectQueue.push([{ email: 'bob@example.com' }]);
    updateQueue.push([]);

    const res = await app.request('/admin/api/users/user-2', {
      method: 'PATCH',
      headers: { ...authHeader(token), 'Content-Type': 'application/json' },
      body: JSON.stringify({ active: true }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
  });

  it('rejects non-boolean active value', async () => {
    const token = await getAdminToken();
    selectQueue.push([{ email: 'alice@example.com' }]);

    const res = await app.request('/admin/api/users/user-1', {
      method: 'PATCH',
      headers: { ...authHeader(token), 'Content-Type': 'application/json' },
      body: JSON.stringify({ active: 'yes' }),
    });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe('Invalid active value');
  });

  it('returns 404 when user not found', async () => {
    const token = await getAdminToken();
    selectQueue.push([]);

    const res = await app.request('/admin/api/users/nonexistent', {
      method: 'PATCH',
      headers: { ...authHeader(token), 'Content-Type': 'application/json' },
      body: JSON.stringify({ role: 'viewer' }),
    });
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.error).toBe('User not found');
  });

  it('updates both role and active at the same time', async () => {
    const token = await getAdminToken();
    selectQueue.push([{ email: 'alice@example.com' }]);
    updateQueue.push([]);

    const res = await app.request('/admin/api/users/user-1', {
      method: 'PATCH',
      headers: { ...authHeader(token), 'Content-Type': 'application/json' },
      body: JSON.stringify({ role: 'viewer', active: false }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════
// 4. POST /admin/api/users/:id/reset-password
// ═══════════════════════════════════════════════════════════════

describe('POST /admin/api/users/:id/reset-password', () => {
  it('resets password and returns temporary password', async () => {
    const token = await getAdminToken();
    mockNanoid.mockReturnValueOnce('temp-password-1234');
    selectQueue.push([{ id: 'user-1', email: 'alice@example.com' }]);
    updateQueue.push([]);

    const res = await app.request('/admin/api/users/user-1/reset-password', {
      method: 'POST',
      headers: authHeader(token),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.temporaryPassword).toBe('temp-password-1234');
    expect(mockArgon2Hash).toHaveBeenCalled();
  });

  it('returns 404 when user not found', async () => {
    const token = await getAdminToken();
    selectQueue.push([]);

    const res = await app.request('/admin/api/users/nonexistent/reset-password', {
      method: 'POST',
      headers: authHeader(token),
    });
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.error).toBe('User not found');
  });
});

// ═══════════════════════════════════════════════════════════════
// 5. POST /admin/api/users — create user
// ═══════════════════════════════════════════════════════════════

describe('POST /admin/api/users', () => {
  it('creates a new user and returns 201', async () => {
    const token = await getAdminToken();
    mockNanoid.mockReturnValueOnce('new-user-id');
    // Check for existing email
    selectQueue.push([]);
    // Insert
    insertQueue.push([]);

    const res = await app.request('/admin/api/users', {
      method: 'POST',
      headers: { ...authHeader(token), 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: 'newuser@example.com',
        displayName: 'New User',
        password: 'password1234',
        role: 'analyst',
      }),
    });
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.user.id).toBe('new-user-id');
    expect(body.user.email).toBe('newuser@example.com');
    expect(body.user.displayName).toBe('New User');
    expect(body.user.role).toBe('analyst');
  });

  it('defaults role to analyst when invalid role is provided', async () => {
    const token = await getAdminToken();
    mockNanoid.mockReturnValueOnce('new-user-id-2');
    selectQueue.push([]);
    insertQueue.push([]);

    const res = await app.request('/admin/api/users', {
      method: 'POST',
      headers: { ...authHeader(token), 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: 'newuser2@example.com',
        displayName: 'New User 2',
        password: 'password1234',
        role: 'superadmin',
      }),
    });
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.user.role).toBe('analyst');
  });

  it('defaults role to analyst when no role is provided', async () => {
    const token = await getAdminToken();
    mockNanoid.mockReturnValueOnce('new-user-id-3');
    selectQueue.push([]);
    insertQueue.push([]);

    const res = await app.request('/admin/api/users', {
      method: 'POST',
      headers: { ...authHeader(token), 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: 'newuser3@example.com',
        displayName: 'New User 3',
        password: 'password1234',
      }),
    });
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.user.role).toBe('analyst');
  });

  it('rejects invalid email', async () => {
    const token = await getAdminToken();

    const res = await app.request('/admin/api/users', {
      method: 'POST',
      headers: { ...authHeader(token), 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: 'not-an-email',
        displayName: 'Test',
        password: 'password1234',
      }),
    });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe('Invalid email');
  });

  it('rejects missing email', async () => {
    const token = await getAdminToken();

    const res = await app.request('/admin/api/users', {
      method: 'POST',
      headers: { ...authHeader(token), 'Content-Type': 'application/json' },
      body: JSON.stringify({
        displayName: 'Test',
        password: 'password1234',
      }),
    });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe('Invalid email');
  });

  it('rejects empty display name', async () => {
    const token = await getAdminToken();

    const res = await app.request('/admin/api/users', {
      method: 'POST',
      headers: { ...authHeader(token), 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: 'test@example.com',
        displayName: '',
        password: 'password1234',
      }),
    });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe('Display name required');
  });

  it('rejects missing display name', async () => {
    const token = await getAdminToken();

    const res = await app.request('/admin/api/users', {
      method: 'POST',
      headers: { ...authHeader(token), 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: 'test@example.com',
        password: 'password1234',
      }),
    });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe('Display name required');
  });

  it('rejects short password (less than 8 chars)', async () => {
    const token = await getAdminToken();

    const res = await app.request('/admin/api/users', {
      method: 'POST',
      headers: { ...authHeader(token), 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: 'test@example.com',
        displayName: 'Test',
        password: 'short',
      }),
    });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe('Password must be at least 8 characters');
  });

  it('rejects missing password', async () => {
    const token = await getAdminToken();

    const res = await app.request('/admin/api/users', {
      method: 'POST',
      headers: { ...authHeader(token), 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: 'test@example.com',
        displayName: 'Test',
      }),
    });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe('Password must be at least 8 characters');
  });

  it('returns 409 when email already exists', async () => {
    const token = await getAdminToken();
    // Existing user found
    selectQueue.push([{ id: 'existing-id' }]);

    const res = await app.request('/admin/api/users', {
      method: 'POST',
      headers: { ...authHeader(token), 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: 'existing@example.com',
        displayName: 'Existing',
        password: 'password1234',
      }),
    });
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.error).toBe('Email already registered');
  });

  it('trims and lowercases email', async () => {
    const token = await getAdminToken();
    mockNanoid.mockReturnValueOnce('trimmed-id');
    selectQueue.push([]);
    insertQueue.push([]);

    const res = await app.request('/admin/api/users', {
      method: 'POST',
      headers: { ...authHeader(token), 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: '  Alice@Example.COM  ',
        displayName: 'Alice',
        password: 'password1234',
      }),
    });
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.user.email).toBe('alice@example.com');
  });

  it('accepts admin role', async () => {
    const token = await getAdminToken();
    mockNanoid.mockReturnValueOnce('admin-user-id');
    selectQueue.push([]);
    insertQueue.push([]);

    const res = await app.request('/admin/api/users', {
      method: 'POST',
      headers: { ...authHeader(token), 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: 'adminuser@example.com',
        displayName: 'Admin User',
        password: 'password1234',
        role: 'admin',
      }),
    });
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.user.role).toBe('admin');
  });

  it('accepts viewer role', async () => {
    const token = await getAdminToken();
    mockNanoid.mockReturnValueOnce('viewer-user-id');
    selectQueue.push([]);
    insertQueue.push([]);

    const res = await app.request('/admin/api/users', {
      method: 'POST',
      headers: { ...authHeader(token), 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: 'vieweruser@example.com',
        displayName: 'Viewer User',
        password: 'password1234',
        role: 'viewer',
      }),
    });
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.user.role).toBe('viewer');
  });
});

// ═══════════════════════════════════════════════════════════════
// 6. POST /admin/api/users/bulk
// ═══════════════════════════════════════════════════════════════

describe('POST /admin/api/users/bulk', () => {
  it('bulk enable users', async () => {
    const token = await getAdminToken();
    updateQueue.push([{ id: 'u1' }, { id: 'u2' }]);

    const res = await app.request('/admin/api/users/bulk', {
      method: 'POST',
      headers: { ...authHeader(token), 'Content-Type': 'application/json' },
      body: JSON.stringify({ userIds: ['u1', 'u2'], action: 'enable' }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.affected).toBe(2);
  });

  it('bulk disable users', async () => {
    const token = await getAdminToken();
    updateQueue.push([{ id: 'u1' }, { id: 'u2' }]);

    const res = await app.request('/admin/api/users/bulk', {
      method: 'POST',
      headers: { ...authHeader(token), 'Content-Type': 'application/json' },
      body: JSON.stringify({ userIds: ['u1', 'u2'], action: 'disable' }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.affected).toBe(2);
  });

  it('bulk change role', async () => {
    const token = await getAdminToken();
    updateQueue.push([{ id: 'u1' }, { id: 'u2' }]);

    const res = await app.request('/admin/api/users/bulk', {
      method: 'POST',
      headers: { ...authHeader(token), 'Content-Type': 'application/json' },
      body: JSON.stringify({ userIds: ['u1', 'u2'], action: 'changeRole', role: 'viewer' }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.affected).toBe(2);
  });

  it('returns 400 for missing userIds', async () => {
    const token = await getAdminToken();

    const res = await app.request('/admin/api/users/bulk', {
      method: 'POST',
      headers: { ...authHeader(token), 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'enable' }),
    });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe('userIds array required');
  });

  it('returns 400 for empty userIds array', async () => {
    const token = await getAdminToken();

    const res = await app.request('/admin/api/users/bulk', {
      method: 'POST',
      headers: { ...authHeader(token), 'Content-Type': 'application/json' },
      body: JSON.stringify({ userIds: [], action: 'enable' }),
    });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe('userIds array required');
  });

  it('returns 400 for invalid action', async () => {
    const token = await getAdminToken();

    const res = await app.request('/admin/api/users/bulk', {
      method: 'POST',
      headers: { ...authHeader(token), 'Content-Type': 'application/json' },
      body: JSON.stringify({ userIds: ['u1'], action: 'delete' }),
    });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe('Invalid action');
  });

  it('returns 400 for changeRole with invalid role', async () => {
    const token = await getAdminToken();

    const res = await app.request('/admin/api/users/bulk', {
      method: 'POST',
      headers: { ...authHeader(token), 'Content-Type': 'application/json' },
      body: JSON.stringify({ userIds: ['u1'], action: 'changeRole', role: 'superadmin' }),
    });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe('Invalid role');
  });

  it('skips non-string userIds', async () => {
    const token = await getAdminToken();
    updateQueue.push([{ id: 'u1' }]);

    const res = await app.request('/admin/api/users/bulk', {
      method: 'POST',
      headers: { ...authHeader(token), 'Content-Type': 'application/json' },
      body: JSON.stringify({ userIds: ['u1', 123, null], action: 'enable' }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.affected).toBe(1);
  });

  it('counts only users that were actually updated', async () => {
    const token = await getAdminToken();
    updateQueue.push([{ id: 'u1' }]);
    updateQueue.push([]); // u2 not found, returns empty

    const res = await app.request('/admin/api/users/bulk', {
      method: 'POST',
      headers: { ...authHeader(token), 'Content-Type': 'application/json' },
      body: JSON.stringify({ userIds: ['u1', 'u2'], action: 'enable' }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.affected).toBe(1);
  });
});

// ═══════════════════════════════════════════════════════════════
// 7. GET /admin/api/users/export
// ═══════════════════════════════════════════════════════════════

describe('GET /admin/api/users/export', () => {
  it('returns CSV with correct content', async () => {
    const token = await getAdminToken();
    const now = new Date();
    selectQueue.push([
      { id: 'u1', email: 'alice@example.com', displayName: 'Alice', role: 'admin', active: true, lastLoginAt: now, createdAt: now },
    ]);

    const res = await app.request('/admin/api/users/export', {
      headers: authHeader(token),
    });
    expect(res.status).toBe(200);

    const text = await res.text();
    const lines = text.split('\n');
    expect(lines[0]).toBe('id,email,displayName,role,active,lastLoginAt,createdAt');
    expect(lines[1]).toContain('u1');
    expect(lines[1]).toContain('alice@example.com');
  });

  it('returns CSV with only header when no users', async () => {
    const token = await getAdminToken();
    selectQueue.push([]);

    const res = await app.request('/admin/api/users/export', {
      headers: authHeader(token),
    });
    expect(res.status).toBe(200);
    const text = await res.text();
    const lines = text.split('\n');
    expect(lines).toHaveLength(1);
    expect(lines[0]).toBe('id,email,displayName,role,active,lastLoginAt,createdAt');
  });
});

// ═══════════════════════════════════════════════════════════════
// 8. GET /admin/api/users/:id/detail
// ═══════════════════════════════════════════════════════════════

describe('GET /admin/api/users/:id/detail', () => {
  it('returns user detail with sessions, memberships, and activity', async () => {
    const token = await getAdminToken();
    const now = new Date();

    // User select
    selectQueue.push([{ id: 'u1', email: 'alice@example.com', displayName: 'Alice', role: 'admin', active: true, lastLoginAt: now, createdAt: now }]);
    // Active sessions
    selectQueue.push([{ id: 'sess-1', createdAt: now, expiresAt: new Date(Date.now() + 3600000) }]);
    // Memberships
    selectQueue.push([{ folderId: 'f1', role: 'owner', folderName: 'Investigation 1' }]);
    // Recent activity
    selectQueue.push([{ id: 'act-1', category: 'entity', action: 'create', detail: 'Created note', itemId: 'n1', itemTitle: 'Note 1', folderId: 'f1', timestamp: now }]);

    const res = await app.request('/admin/api/users/u1/detail', {
      headers: authHeader(token),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.user.email).toBe('alice@example.com');
    expect(body.sessions).toHaveLength(1);
    expect(body.memberships).toHaveLength(1);
    expect(body.memberships[0].folderName).toBe('Investigation 1');
    expect(body.recentActivity).toHaveLength(1);
  });

  it('returns 404 when user not found', async () => {
    const token = await getAdminToken();
    selectQueue.push([]);

    const res = await app.request('/admin/api/users/nonexistent/detail', {
      headers: authHeader(token),
    });
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.error).toBe('User not found');
  });
});

// ═══════════════════════════════════════════════════════════════
// 9. POST /admin/api/change-secret
// ═══════════════════════════════════════════════════════════════

describe('POST /admin/api/change-secret', () => {
  it('changes admin secret successfully', async () => {
    const token = await getAdminToken();
    mockChangeAdminSecret.mockResolvedValueOnce(true);

    const res = await app.request('/admin/api/change-secret', {
      method: 'POST',
      headers: { ...authHeader(token), 'Content-Type': 'application/json' },
      body: JSON.stringify({ currentSecret: 'old-secret-1234', newSecret: 'new-secret-12345' }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(mockChangeAdminSecret).toHaveBeenCalledWith('old-secret-1234', 'new-secret-12345');
  });

  it('returns 400 when currentSecret is missing', async () => {
    const token = await getAdminToken();

    const res = await app.request('/admin/api/change-secret', {
      method: 'POST',
      headers: { ...authHeader(token), 'Content-Type': 'application/json' },
      body: JSON.stringify({ newSecret: 'new-secret-12345' }),
    });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe('Missing current secret');
  });

  it('returns 400 when newSecret is too short', async () => {
    const token = await getAdminToken();

    const res = await app.request('/admin/api/change-secret', {
      method: 'POST',
      headers: { ...authHeader(token), 'Content-Type': 'application/json' },
      body: JSON.stringify({ currentSecret: 'old-secret-1234', newSecret: 'short' }),
    });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe('New secret must be at least 12 characters');
  });

  it('returns 400 when newSecret is missing', async () => {
    const token = await getAdminToken();

    const res = await app.request('/admin/api/change-secret', {
      method: 'POST',
      headers: { ...authHeader(token), 'Content-Type': 'application/json' },
      body: JSON.stringify({ currentSecret: 'old-secret-1234' }),
    });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe('New secret must be at least 12 characters');
  });

  it('returns 401 when current secret is incorrect', async () => {
    const token = await getAdminToken();
    mockChangeAdminSecret.mockResolvedValueOnce(false);

    const res = await app.request('/admin/api/change-secret', {
      method: 'POST',
      headers: { ...authHeader(token), 'Content-Type': 'application/json' },
      body: JSON.stringify({ currentSecret: 'wrong-secret-123', newSecret: 'new-secret-12345' }),
    });
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.error).toBe('Current secret is incorrect');
  });
});

// ═══════════════════════════════════════════════════════════════
// 10. GET /admin/api/sessions
// ═══════════════════════════════════════════════════════════════

describe('GET /admin/api/sessions', () => {
  it('returns active sessions', async () => {
    const token = await getAdminToken();
    const now = new Date();
    selectQueue.push([
      { id: 'sess-1', userId: 'u1', userEmail: 'alice@example.com', userDisplayName: 'Alice', createdAt: now, expiresAt: new Date(Date.now() + 3600000) },
      { id: 'sess-2', userId: 'u2', userEmail: 'bob@example.com', userDisplayName: 'Bob', createdAt: now, expiresAt: new Date(Date.now() + 3600000) },
    ]);

    const res = await app.request('/admin/api/sessions', {
      headers: authHeader(token),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.sessions).toHaveLength(2);
    expect(body.sessions[0].userEmail).toBe('alice@example.com');
  });

  it('returns empty array when no active sessions', async () => {
    const token = await getAdminToken();
    selectQueue.push([]);

    const res = await app.request('/admin/api/sessions', {
      headers: authHeader(token),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.sessions).toHaveLength(0);
  });
});

// ═══════════════════════════════════════════════════════════════
// 11. DELETE /admin/api/sessions/user/:userId
// ═══════════════════════════════════════════════════════════════

describe('DELETE /admin/api/sessions/user/:userId', () => {
  it('force-logs out a user and returns deleted count', async () => {
    const token = await getAdminToken();
    deleteQueue.push([{ id: 'sess-1' }, { id: 'sess-2' }]);

    const res = await app.request('/admin/api/sessions/user/user-1', {
      method: 'DELETE',
      headers: authHeader(token),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.deletedCount).toBe(2);
  });

  it('returns deletedCount 0 when user has no sessions', async () => {
    const token = await getAdminToken();
    deleteQueue.push([]);

    const res = await app.request('/admin/api/sessions/user/user-1', {
      method: 'DELETE',
      headers: authHeader(token),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.deletedCount).toBe(0);
  });
});

// ═══════════════════════════════════════════════════════════════
// 12. DELETE /admin/api/sessions/all
// ═══════════════════════════════════════════════════════════════

describe('DELETE /admin/api/sessions/all', () => {
  it('force-logs out all users and returns deleted count', async () => {
    const token = await getAdminToken();
    deleteQueue.push([{ id: 'sess-1' }, { id: 'sess-2' }, { id: 'sess-3' }]);

    const res = await app.request('/admin/api/sessions/all', {
      method: 'DELETE',
      headers: authHeader(token),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.deletedCount).toBe(3);
  });

  it('returns deletedCount 0 when no sessions exist', async () => {
    const token = await getAdminToken();
    deleteQueue.push([]);

    const res = await app.request('/admin/api/sessions/all', {
      method: 'DELETE',
      headers: authHeader(token),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.deletedCount).toBe(0);
  });
});
