import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Hono } from 'hono';

// ─── Mock db ───────────────────────────────────────────────────

// Each db.select() / db.insert() / db.update() / db.delete() returns a fresh
// thenable chain. Every method on the chain returns itself AND the chain is
// thenable (has .then/.catch). When awaited, it dequeues the next result.
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
  // Every chainable method returns the chain itself
  for (const method of ['from', 'leftJoin', 'innerJoin', 'where', 'orderBy', 'limit', 'groupBy', 'set', 'values', 'returning', 'onConflictDoNothing']) {
    chain[method] = vi.fn(() => chain);
  }
  // Make the chain thenable so awaiting it dequeues the next result
  chain.then = (onFulfilled?: (v: unknown) => unknown, onRejected?: (e: unknown) => unknown) => {
    return resolve().then(onFulfilled, onRejected);
  };
  chain.catch = (onRejected?: (e: unknown) => unknown) => {
    return resolve().catch(onRejected);
  };
  return chain;
}

vi.mock('../db/index.js', () => ({
  db: {
    select: vi.fn(() => makeThenableChain(selectQueue)),
    insert: vi.fn(() => makeThenableChain(insertQueue)),
    update: vi.fn(() => makeThenableChain(updateQueue)),
    delete: vi.fn(() => makeThenableChain(deleteQueue)),
  },
}));

vi.mock('../db/schema.js', () => ({
  posts: {
    id: 'id', authorId: 'author_id', content: 'content',
    attachments: 'attachments', folderId: 'folder_id',
    parentId: 'parent_id', replyToId: 'reply_to_id',
    mentions: 'mentions', pinned: 'pinned', deleted: 'deleted',
    createdAt: 'created_at', updatedAt: 'updated_at',
    $inferSelect: {},
  },
  reactions: {
    id: 'id', postId: 'post_id', userId: 'user_id',
    emoji: 'emoji', createdAt: 'created_at',
  },
  users: {
    id: 'id', displayName: 'display_name', avatarUrl: 'avatar_url',
  },
}));

const mockCheckAccess = vi.fn();
// These cases exercise HTTP validation/response contracts. The real transaction
// middleware and concurrent authorization are tested with PostgreSQL separately.
vi.mock('../middleware/feed-access.js', async () => {
  const { db } = await import('../db/index.js');
  const { createMiddleware } = await import('hono/factory');
  return { withCurrentFeedAccess: createMiddleware(async (c, next) => {
    const effects: Array<() => unknown> = [];
    c.set('feedDb', db);
    c.set('afterFeedCommit', (effect: () => unknown) => effects.push(effect));
    await next();
    if (!c.error) for (const effect of effects) await effect();
  }) };
});
vi.mock('../middleware/access.js', () => ({
  checkInvestigationAccess: (...args: unknown[]) => mockCheckAccess(...args),
}));

const mockNotifyMentions = vi.fn().mockResolvedValue(undefined);
const mockCreateNotification = vi.fn().mockResolvedValue(undefined);
vi.mock('../services/notification-service.js', () => ({
  notifyMentions: (...args: unknown[]) => mockNotifyMentions(...args),
  createNotification: (...args: unknown[]) => mockCreateNotification(...args),
}));

const mockBroadcastToFolder = vi.fn();
const mockBroadcastGlobal = vi.fn();
vi.mock('../ws/handler.js', () => ({
  broadcastToFolder: (...args: unknown[]) => mockBroadcastToFolder(...args),
  broadcastGlobal: (...args: unknown[]) => mockBroadcastGlobal(...args),
}));

vi.mock('../lib/logger.js', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

// ─── Mock auth middleware ──────────────────────────────────────

const mockUser = { id: 'user-1', email: 'test@example.com', role: 'analyst', displayName: 'Test User', avatarUrl: null };

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
      const role = header === 'Bearer admin-token' ? 'admin' : 'analyst';
      c.set('user', { ...mockUser, role });
      await next();
    }),
  };
});

// ─── Import under test ─────────────────────────────────────────

import caddyshackApp from '../routes/caddyshack.js';

// ─── Helpers ────────────────────────────────────────────────────

function buildApp() {
  const app = new Hono();
  app.route('/api/caddyshack', caddyshackApp);
  return app;
}

function authHeader(token = 'valid-token'): Record<string, string> {
  return { Authorization: `Bearer ${token}` };
}

function jsonReq(method: string, path: string, body?: unknown, headers?: Record<string, string>) {
  const opts: RequestInit = { method, headers: { 'Content-Type': 'application/json', ...headers } };
  if (body !== undefined) opts.body = JSON.stringify(body);
  return new Request(`http://localhost${path}`, opts);
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
// 1. Auth required
// ═══════════════════════════════════════════════════════════════

describe('Auth requirements', () => {
  it('GET /api/caddyshack returns 401 without auth', async () => {
    const res = await app.request('/api/caddyshack');
    expect(res.status).toBe(401);
  });

  it('POST /api/caddyshack/posts returns 401 without auth', async () => {
    const res = await app.request(jsonReq('POST', '/api/caddyshack/posts', { content: 'test' }));
    expect(res.status).toBe(401);
  });

  it('PATCH /api/caddyshack/posts/:id returns 401 without auth', async () => {
    const res = await app.request(jsonReq('PATCH', '/api/caddyshack/posts/p1', { content: 'edited' }));
    expect(res.status).toBe(401);
  });

  it('DELETE /api/caddyshack/posts/:id returns 401 without auth', async () => {
    const res = await app.request(new Request('http://localhost/api/caddyshack/posts/p1', { method: 'DELETE' }));
    expect(res.status).toBe(401);
  });

  it('POST /api/caddyshack/posts/:id/reactions returns 401 without auth', async () => {
    const res = await app.request(jsonReq('POST', '/api/caddyshack/posts/p1/reactions', { emoji: 'x' }));
    expect(res.status).toBe(401);
  });
});

// ═══════════════════════════════════════════════════════════════
// 2. List posts (GET /api/caddyshack)
// ═══════════════════════════════════════════════════════════════

describe('GET /api/caddyshack', () => {
  it('returns empty array when no posts exist', async () => {
    // Feed query returns empty
    selectQueue.push([]);

    const res = await app.request('/api/caddyshack', { headers: authHeader() });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual([]);
  });

  it('returns posts with reactions and reply counts', async () => {
    const feedPosts = [
      { id: 'p1', authorId: 'user-1', content: 'Hello world', folderId: null, parentId: null, createdAt: new Date(), authorDisplayName: 'Test User', attachments: [], mentions: [], pinned: false, deleted: false, updatedAt: new Date(), replyToId: null, authorAvatarUrl: null },
    ];
    // 1) Feed query
    selectQueue.push(feedPosts);
    // 2) Reactions for those posts
    selectQueue.push([{ postId: 'p1', emoji: 'thumbs_up', userId: 'user-2' }]);
    // 3) Reply counts
    selectQueue.push([{ parentId: 'p1', cnt: 3 }]);

    const res = await app.request('/api/caddyshack', { headers: authHeader() });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toHaveLength(1);
    expect(body[0].id).toBe('p1');
    expect(body[0].replyCount).toBe(3);
  });

  it('treats every reaction label as data, including object property names', async () => {
    selectQueue.push([{ id: 'p1', authorId: 'user-1', content: 'Fictional post', folderId: null, parentId: null }]);
    selectQueue.push([{ postId: 'p1', emoji: 'constructor', userId: 'user-2' }]);
    selectQueue.push([]);
    const response = await app.request('/api/caddyshack', { headers: authHeader() });
    expect(response.status).toBe(200);
    expect((await response.json())[0].reactions.constructor).toEqual({ count: 1, userIds: ['user-2'] });
  });

  it('returns 403 when user has no access to folder', async () => {
    mockCheckAccess.mockResolvedValueOnce(false);

    const res = await app.request('/api/caddyshack?folderId=folder-1', {
      headers: authHeader(),
    });
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error).toMatch(/no access/i);
  });

  it('allows access to folder-scoped posts when user has access', async () => {
    mockCheckAccess.mockResolvedValueOnce(true);
    selectQueue.push([]); // empty feed

    const res = await app.request('/api/caddyshack?folderId=folder-1', {
      headers: authHeader(),
    });
    expect(res.status).toBe(200);
  });
});

// ═══════════════════════════════════════════════════════════════
// 3. Create post (POST /api/caddyshack/posts)
// ═══════════════════════════════════════════════════════════════

describe('POST /api/caddyshack/posts', () => {
  it('creates a new post and returns 201', async () => {
    // insert
    insertQueue.push(undefined);

    const res = await app.request(jsonReq('POST', '/api/caddyshack/posts', {
      content: 'This is a test post',
    }, authHeader()));
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.content).toBe('This is a test post');
    expect(body.authorId).toBe('user-1');
    expect(body.id).toBeDefined();
    expect(body.reactions).toEqual({});
    expect(body.replyCount).toBe(0);
  });

  it('returns 400 when content is empty', async () => {
    const res = await app.request(jsonReq('POST', '/api/caddyshack/posts', {
      content: '',
    }, authHeader()));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/content/i);
  });

  it('returns 400 when content is missing', async () => {
    const res = await app.request(jsonReq('POST', '/api/caddyshack/posts', {}, authHeader()));
    expect(res.status).toBe(400);
  });

  it('returns 400 when content exceeds 50,000 characters', async () => {
    const longContent = 'x'.repeat(50001);
    const res = await app.request(jsonReq('POST', '/api/caddyshack/posts', {
      content: longContent,
    }, authHeader()));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/50,000/);
  });

  it('returns 400 when attachments exceed 10', async () => {
    const attachments = Array.from({ length: 11 }, (_, i) => ({
      id: `att-${i}`, url: `/api/files/f${i}`, type: 'image', mimeType: 'image/png', filename: `img${i}.png`,
    }));
    const res = await app.request(jsonReq('POST', '/api/caddyshack/posts', {
      content: 'Post with too many attachments',
      attachments,
    }, authHeader()));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/max 10/i);
  });

  it('returns 400 for invalid attachment type', async () => {
    const res = await app.request(jsonReq('POST', '/api/caddyshack/posts', {
      content: 'Post with bad attachment',
      attachments: [{ id: 'a1', url: '/api/files/f1', type: 'executable', mimeType: 'application/x-exe', filename: 'malware.exe' }],
    }, authHeader()));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/type must be/i);
  });

  it('returns 400 for javascript: URL in attachment (XSS prevention)', async () => {
    const res = await app.request(jsonReq('POST', '/api/caddyshack/posts', {
      content: 'XSS attempt',
      attachments: [{ id: 'a1', url: 'javascript:alert(1)', type: 'image', mimeType: 'image/png', filename: 'xss.png' }],
    }, authHeader()));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/invalid attachment url/i);
  });

  it('returns 400 for data: URI in attachment', async () => {
    const res = await app.request(jsonReq('POST', '/api/caddyshack/posts', {
      content: 'Data URI attempt',
      attachments: [{ id: 'a1', url: 'data:text/html,<script>alert(1)</script>', type: 'image', mimeType: 'image/png', filename: 'data.png' }],
    }, authHeader()));
    expect(res.status).toBe(400);
  });

  it('returns 400 when mentions exceed 50', async () => {
    const mentions = Array.from({ length: 51 }, (_, i) => `user-${i}`);
    const res = await app.request(jsonReq('POST', '/api/caddyshack/posts', {
      content: 'Too many mentions',
      mentions,
    }, authHeader()));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/mentions/i);
  });

  it('returns 403 when user has no editor access to folder', async () => {
    mockCheckAccess.mockResolvedValueOnce(false);

    const res = await app.request(jsonReq('POST', '/api/caddyshack/posts', {
      content: 'Post in private folder',
      folderId: 'restricted-folder',
    }, authHeader()));
    expect(res.status).toBe(403);
  });

  it('triggers notifyMentions when mentions are provided', async () => {
    insertQueue.push(undefined);

    const res = await app.request(jsonReq('POST', '/api/caddyshack/posts', {
      content: 'Hey @alice check this',
      mentions: ['user-alice'],
    }, authHeader()));
    expect(res.status).toBe(201);
    expect(mockNotifyMentions).toHaveBeenCalledWith(
      ['user-alice'], 'user-1', expect.any(String), null, 'Test User'
    );
  });

  it('broadcasts to global feed for non-folder posts', async () => {
    insertQueue.push(undefined);

    const res = await app.request(jsonReq('POST', '/api/caddyshack/posts', {
      content: 'Global post',
    }, authHeader()));
    expect(res.status).toBe(201);
    expect(mockBroadcastGlobal).toHaveBeenCalled();
    expect(mockBroadcastToFolder).not.toHaveBeenCalled();
  });

  it('broadcasts to folder for folder-scoped posts', async () => {
    mockCheckAccess.mockResolvedValueOnce(true);
    insertQueue.push(undefined);

    const res = await app.request(jsonReq('POST', '/api/caddyshack/posts', {
      content: 'Folder post',
      folderId: 'folder-1',
    }, authHeader()));
    expect(res.status).toBe(201);
    expect(mockBroadcastToFolder).toHaveBeenCalledWith('folder-1', expect.objectContaining({ type: 'new-post' }));
  });

  it('creates reply to existing top-level post', async () => {
    // 1) Parent post lookup
    selectQueue.push([{
      id: 'parent-1', authorId: 'user-2', content: 'Parent post',
      folderId: null, parentId: null, replyToId: null, deleted: false,
    }]);
    // 2) Insert
    insertQueue.push(undefined);
    // 3) Reply-to author lookup
    selectQueue.push([{ authorId: 'user-2', displayName: 'Author' }]);

    const res = await app.request(jsonReq('POST', '/api/caddyshack/posts', {
      content: 'This is a reply',
      parentId: 'parent-1',
    }, authHeader()));
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.parentId).toBe('parent-1');
  });

  it('returns 404 when parent post does not exist', async () => {
    // Parent post lookup returns empty
    selectQueue.push([]);

    const res = await app.request(jsonReq('POST', '/api/caddyshack/posts', {
      content: 'Reply to deleted',
      parentId: 'nonexistent',
    }, authHeader()));
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.error).toMatch(/parent post not found/i);
  });

  it('returns 400 for cross-folder replies', async () => {
    // Parent post in folder-A
    selectQueue.push([{
      id: 'parent-1', authorId: 'user-2', content: 'Parent',
      folderId: 'folder-A', parentId: null, replyToId: null, deleted: false,
    }]);
    // Access check for the different folder (folderId: 'folder-B')
    mockCheckAccess.mockResolvedValueOnce(true);

    const res = await app.request(jsonReq('POST', '/api/caddyshack/posts', {
      content: 'Cross-folder reply',
      parentId: 'parent-1',
      folderId: 'folder-B',
    }, authHeader()));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/same folder/i);
  });
});

// ═══════════════════════════════════════════════════════════════
// 4. Get post detail (GET /api/caddyshack/posts/:id)
// ═══════════════════════════════════════════════════════════════

describe('GET /api/caddyshack/posts/:id', () => {
  it('returns post with replies and reactions', async () => {
    // 1) Main post lookup
    selectQueue.push([{
      id: 'p1', authorId: 'user-1', content: 'Test post', folderId: null,
      parentId: null, replyToId: null, mentions: [], pinned: false, deleted: false,
      createdAt: new Date(), updatedAt: new Date(), authorDisplayName: 'Test User',
      attachments: [], authorAvatarUrl: null,
    }]);
    // 2) All replies
    selectQueue.push([]);
    // 3) Reactions
    selectQueue.push([]);

    const res = await app.request('/api/caddyshack/posts/p1', { headers: authHeader() });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.id).toBe('p1');
    expect(body.replies).toEqual([]);
    expect(body.reactions).toEqual({});
  });

  it('returns 404 when post does not exist', async () => {
    selectQueue.push([]);

    const res = await app.request('/api/caddyshack/posts/nonexistent', { headers: authHeader() });
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.error).toMatch(/not found/i);
  });

  it('returns 403 when user has no access to folder-scoped post', async () => {
    selectQueue.push([{
      id: 'p2', authorId: 'user-2', content: 'Private post', folderId: 'folder-1',
      parentId: null, replyToId: null, mentions: [], pinned: false, deleted: false,
      createdAt: new Date(), updatedAt: new Date(), authorDisplayName: 'Other User',
      attachments: [], authorAvatarUrl: null,
    }]);
    mockCheckAccess.mockResolvedValueOnce(false);

    const res = await app.request('/api/caddyshack/posts/p2', { headers: authHeader() });
    expect(res.status).toBe(403);
  });
});

// ═══════════════════════════════════════════════════════════════
// 5. Edit post (PATCH /api/caddyshack/posts/:id)
// ═══════════════════════════════════════════════════════════════

describe('PATCH /api/caddyshack/posts/:id', () => {
  it('edits post content when user is author', async () => {
    selectQueue.push([{ id: 'p1', authorId: 'user-1', content: 'Original' }]);
    updateQueue.push(undefined);

    const res = await app.request(jsonReq('PATCH', '/api/caddyshack/posts/p1', {
      content: 'Edited content',
    }, authHeader()));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
  });

  it('returns 404 when post does not exist', async () => {
    selectQueue.push([]);

    const res = await app.request(jsonReq('PATCH', '/api/caddyshack/posts/nonexistent', {
      content: 'Whatever',
    }, authHeader()));
    expect(res.status).toBe(404);
  });

  it('returns 403 when user is not author and not admin', async () => {
    selectQueue.push([{ id: 'p2', authorId: 'user-2', content: 'Other user post' }]);

    const res = await app.request(jsonReq('PATCH', '/api/caddyshack/posts/p2', {
      content: 'Trying to edit',
    }, authHeader()));
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error).toMatch(/not authorized/i);
  });

  it('allows admin to edit any post', async () => {
    selectQueue.push([{ id: 'p2', authorId: 'user-2', content: 'Other user post' }]);
    updateQueue.push(undefined);

    const res = await app.request(jsonReq('PATCH', '/api/caddyshack/posts/p2', {
      content: 'Admin edit',
    }, authHeader('admin-token')));
    expect(res.status).toBe(200);
  });

  it('returns 400 for empty content', async () => {
    selectQueue.push([{ id: 'p1', authorId: 'user-1', content: 'Original' }]);

    const res = await app.request(jsonReq('PATCH', '/api/caddyshack/posts/p1', {
      content: '',
    }, authHeader()));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/non-empty/i);
  });

  it('returns 400 for content exceeding 50,000 characters', async () => {
    selectQueue.push([{ id: 'p1', authorId: 'user-1', content: 'Original' }]);

    const res = await app.request(jsonReq('PATCH', '/api/caddyshack/posts/p1', {
      content: 'x'.repeat(50001),
    }, authHeader()));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/50,000/);
  });

  it('allows updating pinned status', async () => {
    selectQueue.push([{ id: 'p1', authorId: 'user-1', content: 'Original' }]);
    updateQueue.push(undefined);

    const res = await app.request(jsonReq('PATCH', '/api/caddyshack/posts/p1', {
      pinned: true,
    }, authHeader()));
    expect(res.status).toBe(200);
  });

  it('returns 400 for invalid pinned value (not boolean)', async () => {
    selectQueue.push([{ id: 'p1', authorId: 'user-1', content: 'Original' }]);

    const res = await app.request(jsonReq('PATCH', '/api/caddyshack/posts/p1', {
      pinned: 'yes',
    }, authHeader()));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/boolean/i);
  });
});

// ═══════════════════════════════════════════════════════════════
// 6. Delete post (DELETE /api/caddyshack/posts/:id)
// ═══════════════════════════════════════════════════════════════

describe('DELETE /api/caddyshack/posts/:id', () => {
  it('soft deletes post when user is author', async () => {
    selectQueue.push([{ id: 'p1', authorId: 'user-1' }]);
    updateQueue.push(undefined);

    const res = await app.request(new Request('http://localhost/api/caddyshack/posts/p1', {
      method: 'DELETE',
      headers: authHeader(),
    }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
  });

  it('returns 404 when post does not exist', async () => {
    selectQueue.push([]);

    const res = await app.request(new Request('http://localhost/api/caddyshack/posts/nonexistent', {
      method: 'DELETE',
      headers: authHeader(),
    }));
    expect(res.status).toBe(404);
  });

  it('returns 403 when non-admin non-author tries to delete', async () => {
    selectQueue.push([{ id: 'p2', authorId: 'user-2' }]);

    const res = await app.request(new Request('http://localhost/api/caddyshack/posts/p2', {
      method: 'DELETE',
      headers: authHeader(),
    }));
    expect(res.status).toBe(403);
  });

  it('allows admin to delete any post', async () => {
    selectQueue.push([{ id: 'p2', authorId: 'user-2' }]);
    updateQueue.push(undefined);

    const res = await app.request(new Request('http://localhost/api/caddyshack/posts/p2', {
      method: 'DELETE',
      headers: { ...authHeader('admin-token') },
    }));
    expect(res.status).toBe(200);
  });
});

// ═══════════════════════════════════════════════════════════════
// 7. Add reaction (POST /api/caddyshack/posts/:id/reactions)
// ═══════════════════════════════════════════════════════════════

describe('POST /api/caddyshack/posts/:id/reactions', () => {
  it('adds a reaction and returns 201', async () => {
    insertQueue.push([{ id: 'reaction-1' }]);
    // Post lookup for notification
    selectQueue.push([{ authorId: 'user-2' }]);

    const res = await app.request(jsonReq('POST', '/api/caddyshack/posts/p1/reactions', {
      emoji: 'fire',
    }, authHeader()));
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.ok).toBe(true);
  });

  it('returns 400 when emoji is missing', async () => {
    const res = await app.request(jsonReq('POST', '/api/caddyshack/posts/p1/reactions', {}, authHeader()));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/emoji/i);
  });

  it('returns 400 when emoji exceeds 32 characters', async () => {
    const res = await app.request(jsonReq('POST', '/api/caddyshack/posts/p1/reactions', {
      emoji: 'x'.repeat(33),
    }, authHeader()));
    expect(res.status).toBe(400);
  });

  it('returns 409 when user already reacted with the same emoji', async () => {
    selectQueue.push([{ id: 'p1', authorId: 'user-2' }]);
    insertQueue.push([]);

    const res = await app.request(jsonReq('POST', '/api/caddyshack/posts/p1/reactions', {
      emoji: 'fire',
    }, authHeader()));
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.error).toMatch(/already reacted/i);
  });

  it('notifies post author when someone else reacts', async () => {
    insertQueue.push([{ id: 'reaction-1' }]);
    selectQueue.push([{ authorId: 'user-2' }]);

    await app.request(jsonReq('POST', '/api/caddyshack/posts/p1/reactions', {
      emoji: 'fire',
    }, authHeader()));
    expect(mockCreateNotification).toHaveBeenCalledWith(expect.objectContaining({
      userId: 'user-2',
      type: 'reaction',
      sourceUserId: 'user-1',
    }));
  });

  it('does not notify author when they react to their own post', async () => {
    insertQueue.push([{ id: 'reaction-1' }]);
    selectQueue.push([{ authorId: 'user-1' }]);

    await app.request(jsonReq('POST', '/api/caddyshack/posts/p1/reactions', {
      emoji: 'fire',
    }, authHeader()));
    expect(mockCreateNotification).not.toHaveBeenCalled();
  });
});

// ═══════════════════════════════════════════════════════════════
// 8. Remove reaction (DELETE /api/caddyshack/posts/:id/reactions/:emoji)
// ═══════════════════════════════════════════════════════════════

describe('DELETE /api/caddyshack/posts/:id/reactions/:emoji', () => {
  it('removes a reaction and returns ok', async () => {
    selectQueue.push([{ id: 'p1', authorId: 'user-1' }]);
    deleteQueue.push(undefined);

    const res = await app.request(new Request('http://localhost/api/caddyshack/posts/p1/reactions/fire', {
      method: 'DELETE',
      headers: authHeader(),
    }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
  });
});
