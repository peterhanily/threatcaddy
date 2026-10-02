import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Hono } from 'hono';
import { removeCommittedBlobs } from '../services/storage-policy.js';
vi.mock('../services/storage-policy.js', () => ({ lockStorage: vi.fn(), removeCommittedBlobs: vi.fn().mockResolvedValue(0) }));

// HTTP handlers mock current identity lookup; real PostgreSQL account invalidation is covered by integration tests.
vi.mock('../services/admin-session-service.js', () => ({
  adminSessionVersion: () => '',
  revokeAdminSessions: vi.fn(),
  getActiveAdmin: vi.fn(async (id: string) => ({ id, username: 'testadmin', passwordHash: 'fixture-admin-hash' })),
}));


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
    for (const method of ['from', 'leftJoin', 'innerJoin', 'where', 'orderBy', 'limit', 'offset', 'groupBy', 'set', 'values', 'returning', 'onConflictDoNothing']) {
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
      transaction: async (fn: (tx: unknown) => Promise<unknown>) => {
        const txDb = {
          select: () => makeThenableChain(selectQueue),
          insert: () => makeThenableChain(insertQueue),
          update: () => makeThenableChain(updateQueue),
          delete: () => makeThenableChain(deleteQueue),
        };
        return fn(txDb);
      },
    },
    folders: { id: 'id', name: 'name', status: 'status', color: 'color', description: 'description', createdAt: 'created_at', updatedAt: 'updated_at', createdBy: 'created_by' },
    users: { id: 'id', email: 'email', displayName: 'display_name' },
    investigationMembers: { id: 'id', folderId: 'folder_id', userId: 'user_id', role: 'role', joinedAt: 'joined_at' },
    notes: { id: 'id', folderId: 'folder_id' },
    tasks: { id: 'id', folderId: 'folder_id' },
    timelineEvents: { id: 'id', folderId: 'folder_id' },
    whiteboards: { id: 'id', folderId: 'folder_id' },
    standaloneIOCs: { id: 'id', folderId: 'folder_id' },
    chatThreads: { id: 'id', folderId: 'folder_id' },
    evidenceItems: { id: 'id', folderId: 'folder_id' },
    posts: { id: 'id', folderId: 'folder_id' },
    files: { id: 'id', folderId: 'folder_id', storagePath: 'storage_path', thumbnailPath: 'thumbnail_path' },
    notifications: { id: 'id', folderId: 'folder_id' },
    requireAdminAuth: _requireAdminAuth,
    logAdminAction: () => Promise.resolve(undefined),
    getAdminId: () => 'admin-1',
    logger: { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} },
    FILE_STORAGE_PATH: '/data/files',
  };
});

vi.mock('node:fs/promises', () => ({
  unlink: () => Promise.resolve(undefined),
}));

vi.mock('../services/audit-service.js', () => ({
  logActivity: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../lib/logger.js', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

// ─── Import under test ─────────────────────────────────────────

import investigationsApp from '../routes/admin/investigations.js';
import { signAdminToken } from '../middleware/admin-auth.js';

// ─── Helpers ────────────────────────────────────────────────────

function buildApp() {
  const app = new Hono();
  app.route('/admin', investigationsApp);
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
  return signAdminToken(id, username, 'fixture-admin-hash');
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
  it('GET /admin/api/investigations returns 401 without auth', async () => {
    const res = await app.request('/admin/api/investigations');
    expect(res.status).toBe(401);
  });

  it('GET /admin/api/investigations/:id/detail returns 401 without auth', async () => {
    const res = await app.request('/admin/api/investigations/inv-1/detail');
    expect(res.status).toBe(401);
  });

  it('PATCH /admin/api/investigations/:id returns 401 without auth', async () => {
    const res = await app.request(jsonReq('PATCH', '/admin/api/investigations/inv-1', { status: 'closed' }));
    expect(res.status).toBe(401);
  });

  it('DELETE /admin/api/investigations/:id/content returns 401 without auth', async () => {
    const res = await app.request(jsonReq('DELETE', '/admin/api/investigations/inv-1/content', { confirmName: 'test' }));
    expect(res.status).toBe(401);
  });

  it('returns 401 for invalid admin token', async () => {
    const res = await app.request('/admin/api/investigations', {
      headers: authHeader('bad.token.value'),
    });
    expect(res.status).toBe(401);
  });
});

// ═══════════════════════════════════════════════════════════════
// 2. List investigations (GET /admin/api/investigations)
// ═══════════════════════════════════════════════════════════════

describe('GET /admin/api/investigations', () => {
  it('returns list of investigations with member counts', async () => {
    const token = await getAdminToken();
    selectQueue.push([
      { id: 'inv-1', name: 'Case Alpha', status: 'active', color: '#ff0000', createdAt: new Date(), creatorName: 'Admin', creatorEmail: 'admin@test.com', memberCount: 3 },
      { id: 'inv-2', name: 'Case Beta', status: 'closed', color: '#00ff00', createdAt: new Date(), creatorName: 'Admin', creatorEmail: 'admin@test.com', memberCount: 1 },
    ]);

    const res = await app.request('/admin/api/investigations', {
      headers: authHeader(token),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.investigations).toHaveLength(2);
    expect(body.investigations[0].name).toBe('Case Alpha');
    expect(body.investigations[0].memberCount).toBe(3);
  });

  it('returns empty list when no investigations exist', async () => {
    const token = await getAdminToken();
    selectQueue.push([]);

    const res = await app.request('/admin/api/investigations', {
      headers: authHeader(token),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.investigations).toHaveLength(0);
  });
});

// ═══════════════════════════════════════════════════════════════
// 3. Get investigation detail (GET /admin/api/investigations/:id/detail)
// ═══════════════════════════════════════════════════════════════

describe('GET /admin/api/investigations/:id/detail', () => {
  it('returns investigation with members and entity counts', async () => {
    const token = await getAdminToken();
    // 1) Folder lookup
    selectQueue.push([{
      id: 'inv-1', name: 'Case Alpha', status: 'active', color: '#ff0000',
      description: 'Test investigation', createdAt: new Date(), updatedAt: new Date(),
      creatorName: 'Admin', creatorEmail: 'admin@test.com',
    }]);
    // 2) Members
    selectQueue.push([
      { id: 'm1', userId: 'u1', role: 'owner', joinedAt: new Date(), userEmail: 'owner@test.com', userDisplayName: 'Owner' },
    ]);
    // 3-9) Entity count queries (notes, tasks, events, whiteboards, iocs, chats, files)
    selectQueue.push([{ count: 5 }]);
    selectQueue.push([{ count: 3 }]);
    selectQueue.push([{ count: 10 }]);
    selectQueue.push([{ count: 2 }]);
    selectQueue.push([{ count: 8 }]);
    selectQueue.push([{ count: 1 }]);
    selectQueue.push([{ count: 4 }]);
    selectQueue.push([{ count: 6 }]);

    const res = await app.request('/admin/api/investigations/inv-1/detail', {
      headers: authHeader(token),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.investigation.name).toBe('Case Alpha');
    expect(body.members).toHaveLength(1);
    expect(body.entityCounts.notes).toBe(5);
    expect(body.entityCounts.tasks).toBe(3);
    expect(body.entityCounts.files).toBe(4);
    expect(body.entityCounts.evidenceItems).toBe(6);
  });

  it('returns 404 when investigation does not exist', async () => {
    const token = await getAdminToken();
    selectQueue.push([]);

    const res = await app.request('/admin/api/investigations/nonexistent/detail', {
      headers: authHeader(token),
    });
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.error).toMatch(/not found/i);
  });
});

// ═══════════════════════════════════════════════════════════════
// 4. Update investigation status (PATCH /admin/api/investigations/:id)
// ═══════════════════════════════════════════════════════════════

describe('PATCH /admin/api/investigations/:id', () => {
  it('updates investigation status to closed', async () => {
    const token = await getAdminToken();
    selectQueue.push([{ name: 'Case Alpha' }]);
    updateQueue.push(undefined);

    const res = await app.request(jsonReq('PATCH', '/admin/api/investigations/inv-1', { status: 'closed' }, authHeader(token)));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
  });

  it('returns 400 for invalid status', async () => {
    const token = await getAdminToken();

    const res = await app.request(jsonReq('PATCH', '/admin/api/investigations/inv-1', { status: 'invalid' }, authHeader(token)));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/invalid status/i);
  });

  it('returns 404 when investigation does not exist', async () => {
    const token = await getAdminToken();
    selectQueue.push([]);

    const res = await app.request(jsonReq('PATCH', '/admin/api/investigations/nonexistent', { status: 'active' }, authHeader(token)));
    expect(res.status).toBe(404);
  });

  it('accepts active status', async () => {
    const token = await getAdminToken();
    selectQueue.push([{ name: 'Case Beta' }]);
    updateQueue.push(undefined);

    const res = await app.request(jsonReq('PATCH', '/admin/api/investigations/inv-2', { status: 'active' }, authHeader(token)));
    expect(res.status).toBe(200);
  });

  it('accepts archived status', async () => {
    const token = await getAdminToken();
    selectQueue.push([{ name: 'Case Gamma' }]);
    updateQueue.push(undefined);

    const res = await app.request(jsonReq('PATCH', '/admin/api/investigations/inv-3', { status: 'archived' }, authHeader(token)));
    expect(res.status).toBe(200);
  });
});

// ═══════════════════════════════════════════════════════════════
// 5. Add member (POST /admin/api/investigations/:id/members)
// ═══════════════════════════════════════════════════════════════

describe('POST /admin/api/investigations/:id/members', () => {
  it('adds a member to an investigation', async () => {
    const token = await getAdminToken();
    selectQueue.push([{ id: 'inv-1' }]); // Folder check
    selectQueue.push([{ id: 'user-5', email: 'user5@test.com' }]); // User check
    insertQueue.push(undefined);

    const res = await app.request(jsonReq('POST', '/admin/api/investigations/inv-1/members',
      { userId: 'user-5', role: 'editor' }, authHeader(token)));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
  });

  it('returns 400 when userId is missing', async () => {
    const token = await getAdminToken();

    const res = await app.request(jsonReq('POST', '/admin/api/investigations/inv-1/members',
      { role: 'editor' }, authHeader(token)));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/userId required/i);
  });

  it('returns 404 when investigation does not exist', async () => {
    const token = await getAdminToken();
    selectQueue.push([]); // Folder not found

    const res = await app.request(jsonReq('POST', '/admin/api/investigations/nonexistent/members',
      { userId: 'user-5' }, authHeader(token)));
    expect(res.status).toBe(404);
  });

  it('returns 404 when user does not exist', async () => {
    const token = await getAdminToken();
    selectQueue.push([{ id: 'inv-1' }]); // Folder found
    selectQueue.push([]); // User not found

    const res = await app.request(jsonReq('POST', '/admin/api/investigations/inv-1/members',
      { userId: 'nonexistent-user' }, authHeader(token)));
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.error).toMatch(/user not found/i);
  });

  it('defaults to editor role when no role specified', async () => {
    const token = await getAdminToken();
    selectQueue.push([{ id: 'inv-1' }]);
    selectQueue.push([{ id: 'user-5', email: 'user5@test.com' }]);
    insertQueue.push(undefined);

    const res = await app.request(jsonReq('POST', '/admin/api/investigations/inv-1/members',
      { userId: 'user-5' }, authHeader(token)));
    expect(res.status).toBe(200);
  });
});

// ═══════════════════════════════════════════════════════════════
// 6. Update member role (PATCH /admin/api/investigations/:id/members/:userId)
// ═══════════════════════════════════════════════════════════════

describe('PATCH /admin/api/investigations/:id/members/:userId', () => {
  it('updates member role successfully', async () => {
    const token = await getAdminToken();
    updateQueue.push([{ id: 'm1' }]);

    const res = await app.request(jsonReq('PATCH', '/admin/api/investigations/inv-1/members/user-5',
      { role: 'owner' }, authHeader(token)));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
  });

  it('returns 400 for invalid role', async () => {
    const token = await getAdminToken();

    const res = await app.request(jsonReq('PATCH', '/admin/api/investigations/inv-1/members/user-5',
      { role: 'superadmin' }, authHeader(token)));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/invalid role/i);
  });

  it('returns 404 when member not found', async () => {
    const token = await getAdminToken();
    updateQueue.push([]);

    const res = await app.request(jsonReq('PATCH', '/admin/api/investigations/inv-1/members/nonexistent',
      { role: 'viewer' }, authHeader(token)));
    expect(res.status).toBe(404);
  });
});

// ═══════════════════════════════════════════════════════════════
// 7. Remove member (DELETE /admin/api/investigations/:id/members/:userId)
// ═══════════════════════════════════════════════════════════════

describe('DELETE /admin/api/investigations/:id/members/:userId', () => {
  it('removes a member successfully', async () => {
    const token = await getAdminToken();
    deleteQueue.push([{ id: 'm1' }]);

    const res = await app.request(new Request('http://localhost/admin/api/investigations/inv-1/members/user-5', {
      method: 'DELETE',
      headers: authHeader(token),
    }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
  });

  it('returns 404 when member not found', async () => {
    const token = await getAdminToken();
    deleteQueue.push([]);

    const res = await app.request(new Request('http://localhost/admin/api/investigations/inv-1/members/nonexistent', {
      method: 'DELETE',
      headers: authHeader(token),
    }));
    expect(res.status).toBe(404);
  });
});

// ═══════════════════════════════════════════════════════════════
// 8. Purge investigation content (DELETE /admin/api/investigations/:id/content)
// ═══════════════════════════════════════════════════════════════

describe('DELETE /admin/api/investigations/:id/content', () => {
  it('purges all content when confirmation name matches', async () => {
    const token = await getAdminToken();
    // 1) Folder lookup
    selectQueue.push([{ name: 'Case Alpha' }]);
    // 2) File list for disk cleanup
    selectQueue.push([
      { storagePath: 'file1.pdf', thumbnailPath: 'file1_thumb.webp' },
    ]);
    // Delete operations (notes, tasks, events, whiteboards, iocs, chats, posts, files, notifications, members)
    for (let i = 0; i < 10; i++) deleteQueue.push([]);
    deleteQueue.push([{ id: 'evidence-fixture' }]);
    // Delete folder itself
    deleteQueue.push(undefined);

    const res = await app.request(jsonReq('DELETE', '/admin/api/investigations/inv-1/content',
      { confirmName: 'Case Alpha' }, authHeader(token)));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.deleted).toBeDefined();
    expect(body.deleted.evidenceItems).toBe(1);
    expect(removeCommittedBlobs).toHaveBeenCalledWith('/data/files', [{ storagePath: 'file1.pdf', thumbnailPath: 'file1_thumb.webp' }]);
  });

  it('retains all managed blobs when the purge transaction fails', async () => {
    const token = await getAdminToken();
    selectQueue.push([{ name: 'Case Alpha' }], [{ storagePath: 'retained.pdf', thumbnailPath: null }]);
    deleteQueue.push(new Error('Ordinary database transaction failure'));
    const res = await app.request(jsonReq('DELETE', '/admin/api/investigations/inv-1/content', { confirmName: 'Case Alpha' }, authHeader(token)));
    expect(res.status).toBe(500);
    expect(removeCommittedBlobs).not.toHaveBeenCalled();
  });

  it('returns 400 when confirmation name does not match', async () => {
    const token = await getAdminToken();
    selectQueue.push([{ name: 'Case Alpha' }]);

    const res = await app.request(jsonReq('DELETE', '/admin/api/investigations/inv-1/content',
      { confirmName: 'Wrong Name' }, authHeader(token)));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/confirmation name does not match/i);
  });

  it('returns 404 when investigation does not exist', async () => {
    const token = await getAdminToken();
    selectQueue.push([]);

    const res = await app.request(jsonReq('DELETE', '/admin/api/investigations/nonexistent/content',
      { confirmName: 'whatever' }, authHeader(token)));
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.error).toMatch(/not found/i);
  });
});
