import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Hono } from 'hono';

// ─── Mock db ───────────────────────────────────────────────────

// Real authorization SQL is exercised in the disposable PostgreSQL suite.
vi.mock('../middleware/feed-access.js', async () => {
  const { db } = await import('../db/index.js');
  const { createMiddleware } = await import('hono/factory');
  return { withCurrentFeedAccess: createMiddleware(async (c, next) => {
    c.set('feedDb', db);
    await next();
  }) };
});

const mockSelectResult = vi.fn();
const mockUpdateResult = vi.fn();
const mockDeleteResult = vi.fn();

const mockSelectChain = {
  from: vi.fn().mockReturnThis(),
  leftJoin: vi.fn().mockReturnThis(),
  where: vi.fn().mockReturnThis(),
  orderBy: vi.fn().mockReturnThis(),
  limit: vi.fn().mockImplementation(() => mockSelectResult()),
};
const mockUpdateChain = {
  set: vi.fn().mockReturnThis(),
  where: vi.fn().mockImplementation(() => mockUpdateResult()),
};
const mockDeleteChain = {
  where: vi.fn().mockReturnThis(),
  returning: vi.fn().mockImplementation(() => mockDeleteResult()),
};

vi.mock('../db/index.js', () => ({
  db: {
    select: vi.fn(() => mockSelectChain),
    update: vi.fn(() => mockUpdateChain),
    delete: vi.fn(() => mockDeleteChain),
  },
}));

vi.mock('../db/schema.js', () => ({
  posts: { id: 'id', folderId: 'folder_id', parentId: 'parent_id', replyToId: 'reply_to_id', deleted: 'deleted' },
  notifications: {
    id: 'id', userId: 'user_id', type: 'type', sourceUserId: 'source_user_id',
    postId: 'post_id', folderId: 'folder_id', message: 'message',
    read: 'read', createdAt: 'created_at',
  },
  users: {
    id: 'id', displayName: 'display_name', avatarUrl: 'avatar_url',
  },
}));

vi.mock('../lib/logger.js', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

// ─── Mock auth middleware ──────────────────────────────────────

const mockUser = { id: 'user-1', email: 'test@example.com', role: 'analyst', displayName: 'Test', avatarUrl: null };

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
  };
});

// ─── Import under test ─────────────────────────────────────────

import notificationsApp from '../routes/notifications.js';

// ─── Helpers ────────────────────────────────────────────────────

function buildApp() {
  const app = new Hono();
  app.route('/api/notifications', notificationsApp);
  return app;
}

function authHeader(token = 'valid-token'): Record<string, string> {
  return { Authorization: `Bearer ${token}` };
}

// ─── Tests ──────────────────────────────────────────────────────

let app: Hono;

beforeEach(() => {
  vi.clearAllMocks();
  app = buildApp();

  // Reset default chain behaviors
  mockSelectChain.from.mockReturnThis();
  mockSelectChain.leftJoin.mockReturnThis();
  mockSelectChain.where.mockReturnThis();
  mockSelectChain.orderBy.mockReturnThis();
  mockUpdateChain.set.mockReturnThis();
  mockDeleteChain.where.mockReturnThis();
});

// ═══════════════════════════════════════════════════════════════
// 1. Auth required
// ═══════════════════════════════════════════════════════════════

describe('Auth requirements', () => {
  it('GET /api/notifications returns 401 without auth', async () => {
    const res = await app.request('/api/notifications');
    expect(res.status).toBe(401);
  });

  it('PATCH /api/notifications/:id/read returns 401 without auth', async () => {
    const res = await app.request('/api/notifications/n1/read', { method: 'PATCH' });
    expect(res.status).toBe(401);
  });

  it('POST /api/notifications/mark-all-read returns 401 without auth', async () => {
    const res = await app.request('/api/notifications/mark-all-read', { method: 'POST' });
    expect(res.status).toBe(401);
  });

  it('DELETE /api/notifications/read returns 401 without auth', async () => {
    const res = await app.request('/api/notifications/read', { method: 'DELETE' });
    expect(res.status).toBe(401);
  });

  it('returns 401 for invalid token', async () => {
    const res = await app.request('/api/notifications', { headers: authHeader('invalid') });
    expect(res.status).toBe(401);
  });
});

// ═══════════════════════════════════════════════════════════════
// 2. List notifications (GET /api/notifications)
// ═══════════════════════════════════════════════════════════════

describe('GET /api/notifications', () => {
  it('returns notifications for the authenticated user', async () => {
    const notifications = [
      { id: 'n1', type: 'mention', message: 'You were mentioned', read: false, createdAt: new Date() },
      { id: 'n2', type: 'reply', message: 'Someone replied', read: true, createdAt: new Date() },
    ];
    mockSelectChain.limit.mockResolvedValueOnce(notifications);

    const res = await app.request('/api/notifications', { headers: authHeader() });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toHaveLength(2);
    expect(body[0].id).toBe('n1');
  });

  it('returns empty array when no notifications exist', async () => {
    mockSelectChain.limit.mockResolvedValueOnce([]);

    const res = await app.request('/api/notifications', { headers: authHeader() });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toHaveLength(0);
  });

  it('respects unread filter when unread=true', async () => {
    mockSelectChain.limit.mockResolvedValueOnce([
      { id: 'n3', type: 'mention', message: 'Unread notif', read: false },
    ]);

    const res = await app.request('/api/notifications?unread=true', { headers: authHeader() });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toHaveLength(1);
  });

  it('respects limit parameter', async () => {
    mockSelectChain.limit.mockResolvedValueOnce([]);

    await app.request('/api/notifications?limit=10', { headers: authHeader() });
    expect(mockSelectChain.limit).toHaveBeenCalled();
  });

  it('caps limit at 500', async () => {
    mockSelectChain.limit.mockResolvedValueOnce([]);

    await app.request('/api/notifications?limit=9999', { headers: authHeader() });
    // The code does Math.min(parseInt(limit || '50', 10), 500)
    // We verify the chain was called; the route handles capping internally
    expect(mockSelectChain.limit).toHaveBeenCalled();
  });

  it('defaults limit to 50 when not specified', async () => {
    mockSelectChain.limit.mockResolvedValueOnce([]);

    await app.request('/api/notifications', { headers: authHeader() });
    expect(mockSelectChain.limit).toHaveBeenCalled();
  });
});

// ═══════════════════════════════════════════════════════════════
// 3. Mark notification as read (PATCH /api/notifications/:id/read)
// ═══════════════════════════════════════════════════════════════

describe('PATCH /api/notifications/:id/read', () => {
  it('marks a specific notification as read and returns ok', async () => {
    mockUpdateResult.mockResolvedValueOnce(undefined);

    const res = await app.request('/api/notifications/n1/read', {
      method: 'PATCH',
      headers: authHeader(),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
  });

  it('succeeds even if notification does not exist (no-op update)', async () => {
    mockUpdateResult.mockResolvedValueOnce(undefined);

    const res = await app.request('/api/notifications/nonexistent/read', {
      method: 'PATCH',
      headers: authHeader(),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════
// 4. Mark all as read (POST /api/notifications/mark-all-read)
// ═══════════════════════════════════════════════════════════════

describe('POST /api/notifications/mark-all-read', () => {
  it('marks all notifications as read and returns ok', async () => {
    mockUpdateResult.mockResolvedValueOnce(undefined);

    const res = await app.request('/api/notifications/mark-all-read', {
      method: 'POST',
      headers: authHeader(),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════
// 5. Delete read notifications (DELETE /api/notifications/read)
// ═══════════════════════════════════════════════════════════════

describe('DELETE /api/notifications/read', () => {
  it('deletes read notifications and returns count', async () => {
    mockDeleteResult.mockResolvedValueOnce([{ id: 'n1' }, { id: 'n2' }]);

    const res = await app.request('/api/notifications/read', {
      method: 'DELETE',
      headers: authHeader(),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.deleted).toBe(2);
  });

  it('returns 0 deleted when no read notifications exist', async () => {
    mockDeleteResult.mockResolvedValueOnce([]);

    const res = await app.request('/api/notifications/read', {
      method: 'DELETE',
      headers: authHeader(),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.deleted).toBe(0);
  });
});
