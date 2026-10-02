import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Hono } from 'hono';

// HTTP handlers mock current identity lookup; real PostgreSQL account invalidation is covered by integration tests.
vi.mock('../services/admin-session-service.js', () => ({
  adminSessionVersion: () => '',
  revokeAdminSessions: vi.fn(),
  getActiveAdmin: vi.fn(async (id: string) => ({ id, username: 'testadmin', passwordHash: 'fixture-admin-hash' })),
}));


// ─── Hoisted mock state ────────────────────────────────────────

const { selectQueue, makeThenableChain, mockLogAdminAction, mockGetAdminId } = vi.hoisted(() => {
  const selectQueue: unknown[] = [];

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

  const mockLogAdminAction = () => Promise.resolve(undefined);
  const mockGetAdminId = () => 'admin-1';

  return { selectQueue, makeThenableChain, mockLogAdminAction, mockGetAdminId };
});

// ─── Mock the shared module ────────────────────────────────────

vi.mock('../routes/admin/shared.js', async () => {
  const { initAdminKey: _initAdminKey, requireAdminAuth: _requireAdminAuth } = await import('../middleware/admin-auth.js');

  // Initialize key once inside the mock factory
  _initAdminKey();

  return {
    db: {
      select: () => makeThenableChain(selectQueue),
      insert: () => makeThenableChain([]),
      update: () => makeThenableChain([]),
      delete: () => makeThenableChain([]),
    },
    activityLog: {
      id: 'id', userId: 'user_id', category: 'category', action: 'action',
      detail: 'detail', itemId: 'item_id', itemTitle: 'item_title',
      folderId: 'folder_id', timestamp: 'timestamp',
    },
    users: {
      id: 'id', email: 'email', displayName: 'display_name',
    },
    adminUsers: {
      id: 'id', username: 'username', displayName: 'display_name',
    },
    folders: {
      id: 'id', name: 'name',
    },
    requireAdminAuth: _requireAdminAuth,
    logAdminAction: mockLogAdminAction,
    getAdminId: mockGetAdminId,
    logger: { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} },
  };
});

vi.mock('../services/audit-service.js', () => ({
  logActivity: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../lib/logger.js', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

// ─── Import under test ─────────────────────────────────────────

import auditApp from '../routes/admin/audit.js';
import { signAdminToken } from '../middleware/admin-auth.js';

// ─── Helpers ────────────────────────────────────────────────────

function buildApp() {
  const app = new Hono();
  app.route('/admin', auditApp);
  return app;
}

function authHeader(token: string): Record<string, string> {
  return { Authorization: `Bearer ${token}` };
}

async function getAdminToken(id = 'admin-1', username = 'testadmin'): Promise<string> {
  return signAdminToken(id, username, 'fixture-admin-hash');
}

// ─── Tests ──────────────────────────────────────────────────────

let app: Hono;

beforeEach(() => {
  vi.clearAllMocks();
  selectQueue.length = 0;
  app = buildApp();
});

// ═══════════════════════════════════════════════════════════════
// 1. Admin auth required
// ═══════════════════════════════════════════════════════════════

describe('Admin auth requirements', () => {
  it('GET /admin/api/audit-log returns 401 without auth', async () => {
    const res = await app.request('/admin/api/audit-log');
    expect(res.status).toBe(401);
  });

  it('GET /admin/api/audit-log/export returns 401 without auth', async () => {
    const res = await app.request('/admin/api/audit-log/export');
    expect(res.status).toBe(401);
  });

  it('returns 401 with invalid Bearer token', async () => {
    const res = await app.request('/admin/api/audit-log', {
      headers: authHeader('bad.token.here'),
    });
    expect(res.status).toBe(401);
  });

  it('returns 401 with no Authorization header', async () => {
    const res = await app.request('/admin/api/audit-log');
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.error).toMatch(/authorization/i);
  });
});

// ═══════════════════════════════════════════════════════════════
// 2. List audit log entries (GET /admin/api/audit-log)
// ═══════════════════════════════════════════════════════════════

describe('GET /admin/api/audit-log', () => {
  it('returns paginated audit log entries', async () => {
    const token = await getAdminToken();
    // 1) Count query
    selectQueue.push([{ count: 42 }]);
    // 2) Entries query
    selectQueue.push([
      { id: 'log-1', userId: 'u1', category: 'admin', action: 'login', detail: 'Logged in', timestamp: new Date() },
      { id: 'log-2', userId: 'u2', category: 'entity', action: 'create', detail: 'Created note', timestamp: new Date() },
    ]);

    const res = await app.request('/admin/api/audit-log', {
      headers: authHeader(token),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.entries).toHaveLength(2);
    expect(body.total).toBe(42);
    expect(body.page).toBe(1);
    expect(body.pageSize).toBe(50);
  });

  it('accepts page and pageSize query parameters', async () => {
    const token = await getAdminToken();
    selectQueue.push([{ count: 100 }]);
    selectQueue.push([]);

    const res = await app.request('/admin/api/audit-log?page=3&pageSize=10', {
      headers: authHeader(token),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.page).toBe(3);
    expect(body.pageSize).toBe(10);
  });

  it('caps pageSize at 200', async () => {
    const token = await getAdminToken();
    selectQueue.push([{ count: 0 }]);
    selectQueue.push([]);

    const res = await app.request('/admin/api/audit-log?pageSize=999', {
      headers: authHeader(token),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.pageSize).toBe(200);
  });

  it('enforces minimum page of 1', async () => {
    const token = await getAdminToken();
    selectQueue.push([{ count: 0 }]);
    selectQueue.push([]);

    const res = await app.request('/admin/api/audit-log?page=0', {
      headers: authHeader(token),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.page).toBe(1);
  });

  it('filters by userId query parameter', async () => {
    const token = await getAdminToken();
    selectQueue.push([{ count: 5 }]);
    selectQueue.push([]);

    const res = await app.request('/admin/api/audit-log?userId=user-42', {
      headers: authHeader(token),
    });
    expect(res.status).toBe(200);
  });

  it('filters by category query parameter', async () => {
    const token = await getAdminToken();
    selectQueue.push([{ count: 3 }]);
    selectQueue.push([]);

    const res = await app.request('/admin/api/audit-log?category=admin', {
      headers: authHeader(token),
    });
    expect(res.status).toBe(200);
  });

  it('filters by date range (dateFrom and dateTo)', async () => {
    const token = await getAdminToken();
    selectQueue.push([{ count: 10 }]);
    selectQueue.push([]);

    const res = await app.request('/admin/api/audit-log?dateFrom=2025-01-01&dateTo=2025-12-31', {
      headers: authHeader(token),
    });
    expect(res.status).toBe(200);
  });

  it('supports search parameter filtering by detail and itemTitle', async () => {
    const token = await getAdminToken();
    selectQueue.push([{ count: 1 }]);
    selectQueue.push([]);

    const res = await app.request('/admin/api/audit-log?search=password', {
      headers: authHeader(token),
    });
    expect(res.status).toBe(200);
  });

  it('filters by action and folderId', async () => {
    const token = await getAdminToken();
    selectQueue.push([{ count: 2 }]);
    selectQueue.push([]);

    const res = await app.request('/admin/api/audit-log?action=create&folderId=folder-1', {
      headers: authHeader(token),
    });
    expect(res.status).toBe(200);
  });

  it('returns empty entries array when no results match', async () => {
    const token = await getAdminToken();
    selectQueue.push([{ count: 0 }]);
    selectQueue.push([]);

    const res = await app.request('/admin/api/audit-log?category=nonexistent', {
      headers: authHeader(token),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.entries).toHaveLength(0);
    expect(body.total).toBe(0);
  });
});

// ═══════════════════════════════════════════════════════════════
// 3. Export CSV (GET /admin/api/audit-log/export)
// ═══════════════════════════════════════════════════════════════

describe('GET /admin/api/audit-log/export', () => {
  it('returns CSV with correct headers', async () => {
    const token = await getAdminToken();
    selectQueue.push([
      {
        id: 'log-1', userId: 'u1', userEmail: 'admin@test.com',
        category: 'admin', action: 'login', detail: 'Logged in',
        itemId: null, itemTitle: null, folderId: null, folderName: null,
        timestamp: new Date('2025-06-15T10:00:00Z'),
      },
    ]);

    const res = await app.request('/admin/api/audit-log/export', {
      headers: authHeader(token),
    });
    expect(res.status).toBe(200);
    // Hono's c.text() may override Content-Type, so check Content-Disposition instead
    expect(res.headers.get('Content-Disposition')).toContain('audit-log.csv');

    const csv = await res.text();
    expect(csv).toContain('id,timestamp,userId,userEmail,category,action,detail,itemId,itemTitle,folderId,folderName');
    expect(csv).toContain('log-1');
    expect(csv).toContain('admin@test.com');
  });

  it('escapes CSV values containing commas and quotes', async () => {
    const token = await getAdminToken();
    selectQueue.push([
      {
        id: 'log-2', userId: 'u2', userEmail: 'user@test.com',
        category: 'entity', action: 'update', detail: 'Updated "note", with comma',
        itemId: 'item-1', itemTitle: 'Title with, comma', folderId: 'f1', folderName: 'Folder',
        timestamp: new Date('2025-06-15T10:00:00Z'),
      },
    ]);

    const res = await app.request('/admin/api/audit-log/export', {
      headers: authHeader(token),
    });
    expect(res.status).toBe(200);
    const csv = await res.text();
    expect(csv).toContain('""note""');
  });

  it('returns CSV with only header row when no entries', async () => {
    const token = await getAdminToken();
    selectQueue.push([]);

    const res = await app.request('/admin/api/audit-log/export', {
      headers: authHeader(token),
    });
    expect(res.status).toBe(200);
    const csv = await res.text();
    const lines = csv.trim().split('\n');
    expect(lines).toHaveLength(1);
  });

  it('supports same filter parameters as the list endpoint', async () => {
    const token = await getAdminToken();
    selectQueue.push([]);

    const res = await app.request('/admin/api/audit-log/export?category=admin&userId=u1&dateFrom=2025-01-01', {
      headers: authHeader(token),
    });
    expect(res.status).toBe(200);
  });

  it('requires admin auth for export', async () => {
    const res = await app.request('/admin/api/audit-log/export');
    expect(res.status).toBe(401);
  });
});
