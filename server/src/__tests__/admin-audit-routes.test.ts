import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Hono } from 'hono';

// HTTP handlers mock current identity lookup; real PostgreSQL account invalidation is covered by integration tests.
vi.mock('../services/admin-session-service.js', () => ({
  adminSessionVersion: () => '',
  revokeAdminSessions: vi.fn(),
  getActiveAdmin: vi.fn(async (id: string) => ({ id, username: 'testadmin', passwordHash: 'fixture-admin-hash' })),
}));


// ─── Hoisted mock state ────────────────────────────────────────

const {
  selectQueue,
  makeThenableChain,
  mockLogAdminAction, mockGetAdminId,
} = vi.hoisted(() => {
  const selectQueue: unknown[] = [];

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

  return {
    selectQueue,
    makeThenableChain,
    mockLogAdminAction, mockGetAdminId,
  };
});

// ─── Mock the shared module ────────────────────────────────────

vi.mock('../routes/admin/shared.js', async () => {
  const { initAdminKey: _initAdminKey, requireAdminAuth: _requireAdminAuth } = await import('../middleware/admin-auth.js');
  _initAdminKey();

  return {
    db: {
      select: () => makeThenableChain(selectQueue),
      insert: () => makeThenableChain([]),
      update: () => makeThenableChain([]),
      delete: () => makeThenableChain([]),
    },
    users: {
      id: 'id', email: 'email', displayName: 'display_name', role: 'role',
      active: 'active', lastLoginAt: 'last_login_at', createdAt: 'created_at',
    },
    folders: { id: 'id', name: 'name' },
    activityLog: {
      id: 'id', userId: 'user_id', category: 'category', action: 'action',
      detail: 'detail', timestamp: 'timestamp', itemId: 'item_id',
      itemTitle: 'item_title', folderId: 'folder_id',
    },
    adminUsers: {
      id: 'id', username: 'username', displayName: 'display_name',
    },
    requireAdminAuth: _requireAdminAuth,
    logAdminAction: mockLogAdminAction,
    getAdminId: mockGetAdminId,
    logger: { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} },
  };
});

vi.mock('../services/admin-secret.js', () => ({
  ADMIN_SYSTEM_USER_ID: '__system_admin__',
}));

vi.mock('../services/audit-service.js', () => ({
  logActivity: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../lib/logger.js', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

// ─── Import under test ─────────────────────────────────────────

import auditApp from '../routes/admin/audit.js';
import { signAdminToken } from '../middleware/admin-auth.js';

// ─── Helpers ───────────────────────────────────────────────────

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

// ─── Tests ─────────────────────────────────────────────────────

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

  it('GET /admin/api/audit-log rejects invalid token', async () => {
    const res = await app.request('/admin/api/audit-log', {
      headers: { Authorization: 'Bearer invalid.token.here' },
    });
    expect(res.status).toBe(401);
  });
});

// ═══════════════════════════════════════════════════════════════
// 2. GET /admin/api/audit-log
// ═══════════════════════════════════════════════════════════════

describe('GET /admin/api/audit-log', () => {
  it('returns paginated audit log entries with defaults', async () => {
    const token = await getAdminToken();
    const now = new Date();

    // First select: count
    selectQueue.push([{ count: 2 }]);
    // Second select: entries
    selectQueue.push([
      {
        id: 'a1', userId: 'u1', userDisplayName: 'Alice', userEmail: 'alice@example.com',
        category: 'admin', action: 'user.create', detail: 'Created user bob@example.com',
        itemId: 'u2', itemTitle: null, folderId: null, folderName: null, timestamp: now,
      },
      {
        id: 'a2', userId: 'u1', userDisplayName: 'Alice', userEmail: 'alice@example.com',
        category: 'entity', action: 'note.create', detail: 'Created note',
        itemId: 'n1', itemTitle: 'My Note', folderId: 'f1', folderName: 'Investigation 1', timestamp: now,
      },
    ]);

    const res = await app.request('/admin/api/audit-log', {
      headers: authHeader(token),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.entries).toHaveLength(2);
    expect(body.total).toBe(2);
    expect(body.page).toBe(1);
    expect(body.pageSize).toBe(50);
    expect(body.entries[0].id).toBe('a1');
    expect(body.entries[0].action).toBe('user.create');
  });

  it('uses custom page and pageSize params', async () => {
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
    expect(body.total).toBe(100);
  });

  it('clamps page to minimum of 1', async () => {
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

  it('clamps page to minimum of 1 for negative values', async () => {
    const token = await getAdminToken();
    selectQueue.push([{ count: 0 }]);
    selectQueue.push([]);

    const res = await app.request('/admin/api/audit-log?page=-5', {
      headers: authHeader(token),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.page).toBe(1);
  });

  it('clamps pageSize to maximum of 200', async () => {
    const token = await getAdminToken();
    selectQueue.push([{ count: 0 }]);
    selectQueue.push([]);

    const res = await app.request('/admin/api/audit-log?pageSize=500', {
      headers: authHeader(token),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.pageSize).toBe(200);
  });

  it('clamps pageSize to minimum of 1', async () => {
    const token = await getAdminToken();
    selectQueue.push([{ count: 0 }]);
    selectQueue.push([]);

    const res = await app.request('/admin/api/audit-log?pageSize=0', {
      headers: authHeader(token),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.pageSize).toBe(1);
  });

  it('returns empty entries when no audit logs exist', async () => {
    const token = await getAdminToken();
    selectQueue.push([{ count: 0 }]);
    selectQueue.push([]);

    const res = await app.request('/admin/api/audit-log', {
      headers: authHeader(token),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.entries).toHaveLength(0);
    expect(body.total).toBe(0);
  });

  it('filters by userId', async () => {
    const token = await getAdminToken();
    selectQueue.push([{ count: 1 }]);
    selectQueue.push([{
      id: 'a1', userId: 'u1', userDisplayName: 'Alice', userEmail: 'alice@example.com',
      category: 'admin', action: 'user.create', detail: 'Created user',
      itemId: null, itemTitle: null, folderId: null, folderName: null, timestamp: new Date(),
    }]);

    const res = await app.request('/admin/api/audit-log?userId=u1', {
      headers: authHeader(token),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.entries).toHaveLength(1);
    expect(body.total).toBe(1);
  });

  it('filters by category', async () => {
    const token = await getAdminToken();
    selectQueue.push([{ count: 1 }]);
    selectQueue.push([{
      id: 'a1', userId: 'u1', userDisplayName: 'Alice', userEmail: 'alice@example.com',
      category: 'admin', action: 'user.create', detail: 'Created user',
      itemId: null, itemTitle: null, folderId: null, folderName: null, timestamp: new Date(),
    }]);

    const res = await app.request('/admin/api/audit-log?category=admin', {
      headers: authHeader(token),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.entries).toHaveLength(1);
  });

  it('filters by action', async () => {
    const token = await getAdminToken();
    selectQueue.push([{ count: 1 }]);
    selectQueue.push([{
      id: 'a1', userId: 'u1', userDisplayName: 'Alice', userEmail: 'alice@example.com',
      category: 'entity', action: 'note.create', detail: 'Created note',
      itemId: 'n1', itemTitle: 'Note', folderId: null, folderName: null, timestamp: new Date(),
    }]);

    const res = await app.request('/admin/api/audit-log?action=note.create', {
      headers: authHeader(token),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.entries).toHaveLength(1);
  });

  it('filters by folderId', async () => {
    const token = await getAdminToken();
    selectQueue.push([{ count: 1 }]);
    selectQueue.push([{
      id: 'a1', userId: 'u1', userDisplayName: 'Alice', userEmail: 'alice@example.com',
      category: 'entity', action: 'note.create', detail: 'Created note in folder',
      itemId: 'n1', itemTitle: 'Note', folderId: 'f1', folderName: 'Investigation 1', timestamp: new Date(),
    }]);

    const res = await app.request('/admin/api/audit-log?folderId=f1', {
      headers: authHeader(token),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.entries).toHaveLength(1);
    expect(body.entries[0].folderId).toBe('f1');
  });

  it('filters by dateFrom', async () => {
    const token = await getAdminToken();
    selectQueue.push([{ count: 1 }]);
    selectQueue.push([{
      id: 'a1', userId: 'u1', userDisplayName: 'Alice', userEmail: 'alice@example.com',
      category: 'admin', action: 'user.create', detail: 'Created user',
      itemId: null, itemTitle: null, folderId: null, folderName: null, timestamp: new Date(),
    }]);

    const res = await app.request('/admin/api/audit-log?dateFrom=2025-01-01T00:00:00Z', {
      headers: authHeader(token),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.entries).toHaveLength(1);
  });

  it('filters by dateTo', async () => {
    const token = await getAdminToken();
    selectQueue.push([{ count: 1 }]);
    selectQueue.push([{
      id: 'a1', userId: 'u1', userDisplayName: 'Alice', userEmail: 'alice@example.com',
      category: 'admin', action: 'user.create', detail: 'Created user',
      itemId: null, itemTitle: null, folderId: null, folderName: null, timestamp: new Date(),
    }]);

    const res = await app.request('/admin/api/audit-log?dateTo=2026-12-31T23:59:59Z', {
      headers: authHeader(token),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.entries).toHaveLength(1);
  });

  it('filters by date range (dateFrom and dateTo)', async () => {
    const token = await getAdminToken();
    selectQueue.push([{ count: 1 }]);
    selectQueue.push([{
      id: 'a1', userId: 'u1', userDisplayName: 'Alice', userEmail: 'alice@example.com',
      category: 'admin', action: 'user.create', detail: 'Created user',
      itemId: null, itemTitle: null, folderId: null, folderName: null, timestamp: new Date(),
    }]);

    const res = await app.request('/admin/api/audit-log?dateFrom=2025-01-01T00:00:00Z&dateTo=2026-12-31T23:59:59Z', {
      headers: authHeader(token),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.entries).toHaveLength(1);
  });

  it('filters by search (text search in detail and itemTitle)', async () => {
    const token = await getAdminToken();
    selectQueue.push([{ count: 1 }]);
    selectQueue.push([{
      id: 'a1', userId: 'u1', userDisplayName: 'Alice', userEmail: 'alice@example.com',
      category: 'entity', action: 'note.create', detail: 'Created malware analysis note',
      itemId: 'n1', itemTitle: 'Malware Analysis', folderId: 'f1', folderName: 'Investigation', timestamp: new Date(),
    }]);

    const res = await app.request('/admin/api/audit-log?search=malware', {
      headers: authHeader(token),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.entries).toHaveLength(1);
  });

  it('supports multiple filters at once', async () => {
    const token = await getAdminToken();
    selectQueue.push([{ count: 1 }]);
    selectQueue.push([{
      id: 'a1', userId: 'u1', userDisplayName: 'Alice', userEmail: 'alice@example.com',
      category: 'admin', action: 'user.create', detail: 'Created user',
      itemId: null, itemTitle: null, folderId: null, folderName: null, timestamp: new Date(),
    }]);

    const res = await app.request('/admin/api/audit-log?userId=u1&category=admin&action=user.create', {
      headers: authHeader(token),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.entries).toHaveLength(1);
    expect(body.total).toBe(1);
  });
});

// ═══════════════════════════════════════════════════════════════
// 3. GET /admin/api/audit-log/export
// ═══════════════════════════════════════════════════════════════

describe('GET /admin/api/audit-log/export', () => {
  it('returns CSV with correct content', async () => {
    const token = await getAdminToken();
    const now = new Date();

    selectQueue.push([
      {
        id: 'a1', userId: 'u1', userEmail: 'alice@example.com',
        category: 'admin', action: 'user.create', detail: 'Created user bob@example.com',
        itemId: 'u2', itemTitle: null, folderId: null, folderName: null, timestamp: now,
      },
    ]);

    const res = await app.request('/admin/api/audit-log/export', {
      headers: authHeader(token),
    });
    expect(res.status).toBe(200);

    const text = await res.text();
    const lines = text.split('\n');
    expect(lines[0]).toBe('id,timestamp,userId,userEmail,category,action,detail,itemId,itemTitle,folderId,folderName');
    expect(lines[1]).toContain('a1');
    expect(lines[1]).toContain('alice@example.com');
    expect(lines[1]).toContain('user.create');
  });

  it('returns CSV with only header when no entries exist', async () => {
    const token = await getAdminToken();
    selectQueue.push([]);

    const res = await app.request('/admin/api/audit-log/export', {
      headers: authHeader(token),
    });
    expect(res.status).toBe(200);
    const text = await res.text();
    const lines = text.split('\n');
    expect(lines).toHaveLength(1);
    expect(lines[0]).toBe('id,timestamp,userId,userEmail,category,action,detail,itemId,itemTitle,folderId,folderName');
  });

  it('applies filters to export', async () => {
    const token = await getAdminToken();
    const now = new Date();

    selectQueue.push([
      {
        id: 'a1', userId: 'u1', userEmail: 'alice@example.com',
        category: 'admin', action: 'user.create', detail: 'Created user',
        itemId: null, itemTitle: null, folderId: null, folderName: null, timestamp: now,
      },
    ]);

    const res = await app.request('/admin/api/audit-log/export?category=admin&userId=u1', {
      headers: authHeader(token),
    });
    expect(res.status).toBe(200);
    const text = await res.text();
    const lines = text.split('\n');
    expect(lines).toHaveLength(2); // header + 1 row
  });

  it('applies search filter to export', async () => {
    const token = await getAdminToken();
    selectQueue.push([]);

    const res = await app.request('/admin/api/audit-log/export?search=malware', {
      headers: authHeader(token),
    });
    expect(res.status).toBe(200);
    const text = await res.text();
    const lines = text.split('\n');
    expect(lines).toHaveLength(1); // header only
  });

  it('applies folderId filter to export', async () => {
    const token = await getAdminToken();
    selectQueue.push([]);

    const res = await app.request('/admin/api/audit-log/export?folderId=f1', {
      headers: authHeader(token),
    });
    expect(res.status).toBe(200);
    const text = await res.text();
    expect(text).toContain('id,timestamp,userId');
  });

  it('applies date range filters to export', async () => {
    const token = await getAdminToken();
    selectQueue.push([]);

    const res = await app.request('/admin/api/audit-log/export?dateFrom=2025-01-01T00:00:00Z&dateTo=2026-12-31T23:59:59Z', {
      headers: authHeader(token),
    });
    expect(res.status).toBe(200);
    const text = await res.text();
    expect(text).toContain('id,timestamp,userId');
  });

  it('applies action filter to export', async () => {
    const token = await getAdminToken();
    selectQueue.push([]);

    const res = await app.request('/admin/api/audit-log/export?action=note.create', {
      headers: authHeader(token),
    });
    expect(res.status).toBe(200);
    const text = await res.text();
    expect(text).toContain('id,timestamp,userId');
  });

  it('handles CSV escaping of special characters', async () => {
    const token = await getAdminToken();
    const now = new Date();

    selectQueue.push([
      {
        id: 'a1', userId: 'u1', userEmail: 'alice@example.com',
        category: 'admin', action: 'user.create', detail: 'Created user "Bob, the admin"',
        itemId: null, itemTitle: 'Title with, comma', folderId: null, folderName: null, timestamp: now,
      },
    ]);

    const res = await app.request('/admin/api/audit-log/export', {
      headers: authHeader(token),
    });
    expect(res.status).toBe(200);
    const text = await res.text();
    // The CSV should properly escape values containing commas and quotes
    expect(text).toContain('"Created user ""Bob');
    expect(text).toContain('"Title with, comma"');
  });

  it('exports multiple entries', async () => {
    const token = await getAdminToken();
    const now = new Date();

    selectQueue.push([
      {
        id: 'a1', userId: 'u1', userEmail: 'alice@example.com',
        category: 'admin', action: 'user.create', detail: 'Created user 1',
        itemId: null, itemTitle: null, folderId: null, folderName: null, timestamp: now,
      },
      {
        id: 'a2', userId: 'u1', userEmail: 'alice@example.com',
        category: 'admin', action: 'user.create', detail: 'Created user 2',
        itemId: null, itemTitle: null, folderId: null, folderName: null, timestamp: now,
      },
      {
        id: 'a3', userId: 'u2', userEmail: 'bob@example.com',
        category: 'entity', action: 'note.create', detail: 'Created note',
        itemId: 'n1', itemTitle: 'Note 1', folderId: 'f1', folderName: 'Inv 1', timestamp: now,
      },
    ]);

    const res = await app.request('/admin/api/audit-log/export', {
      headers: authHeader(token),
    });
    expect(res.status).toBe(200);
    const text = await res.text();
    const lines = text.split('\n');
    expect(lines).toHaveLength(4); // header + 3 rows
  });

  it('handles null values in export', async () => {
    const token = await getAdminToken();
    const now = new Date();

    selectQueue.push([
      {
        id: 'a1', userId: 'u1', userEmail: null,
        category: 'admin', action: 'system.startup', detail: 'Server started',
        itemId: null, itemTitle: null, folderId: null, folderName: null, timestamp: now,
      },
    ]);

    const res = await app.request('/admin/api/audit-log/export', {
      headers: authHeader(token),
    });
    expect(res.status).toBe(200);
    const text = await res.text();
    // Should not throw on null values
    expect(text).toContain('a1');
  });
});
