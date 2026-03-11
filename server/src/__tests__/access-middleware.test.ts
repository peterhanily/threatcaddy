import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Hono } from 'hono';

// ── vi.hoisted mocks ──────────────────────────────────────────────────────────

const {
  selectQueue,
  mockDb,
} = vi.hoisted(() => {
  const selectQueue: unknown[] = [];

  function makeThenableChain(queue: unknown[]) {
    const chain: Record<string, unknown> = {};
    const resolve = () => {
      const val = queue.shift();
      return val instanceof Error ? Promise.reject(val) : Promise.resolve(val ?? []);
    };
    for (const method of ['from', 'where', 'limit', 'orderBy', 'set', 'values', 'returning']) {
      chain[method] = vi.fn(() => chain);
    }
    chain.then = (onFulfilled?: (v: unknown) => unknown, onRejected?: (e: unknown) => unknown) =>
      resolve().then(onFulfilled, onRejected);
    chain.catch = (onRejected?: (e: unknown) => unknown) => resolve().catch(onRejected);
    return chain;
  }

  return {
    selectQueue,
    mockDb: {
      select: vi.fn(() => makeThenableChain(selectQueue)),
      insert: vi.fn(() => makeThenableChain([])),
      delete: vi.fn(() => makeThenableChain([])),
    },
  };
});

vi.mock('../db/index.js', () => ({ db: mockDb }));

vi.mock('../db/schema.js', () => ({
  investigationMembers: {
    id: 'id',
    folderId: 'folderId',
    userId: 'userId',
    role: 'role',
  },
}));

import { checkInvestigationAccess, requireInvestigationAccess } from '../middleware/access.js';
import type { AuthUser } from '../types.js';

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('checkInvestigationAccess()', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    selectQueue.length = 0;
  });

  it('returns true for owner when minRole is editor', async () => {
    selectQueue.push([{ role: 'owner' }]);
    const result = await checkInvestigationAccess('user-1', 'folder-1', 'editor');
    expect(result).toBe(true);
  });

  it('returns true for editor when minRole is editor', async () => {
    selectQueue.push([{ role: 'editor' }]);
    const result = await checkInvestigationAccess('user-1', 'folder-1', 'editor');
    expect(result).toBe(true);
  });

  it('returns true for owner when minRole is viewer', async () => {
    selectQueue.push([{ role: 'owner' }]);
    const result = await checkInvestigationAccess('user-1', 'folder-1', 'viewer');
    expect(result).toBe(true);
  });

  it('returns false for viewer on write operations (minRole=editor)', async () => {
    selectQueue.push([{ role: 'viewer' }]);
    const result = await checkInvestigationAccess('user-1', 'folder-1', 'editor');
    expect(result).toBe(false);
  });

  it('returns false for non-members', async () => {
    selectQueue.push([]);  // empty array — no membership found
    const result = await checkInvestigationAccess('user-1', 'folder-1', 'viewer');
    expect(result).toBe(false);
  });

  it('returns false for invalid folderIds (empty result)', async () => {
    selectQueue.push([]);
    const result = await checkInvestigationAccess('user-1', 'nonexistent-folder', 'viewer');
    expect(result).toBe(false);
  });
});

describe('requireInvestigationAccess() middleware', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    selectQueue.length = 0;
  });

  it('returns 403 on failure', async () => {
    selectQueue.push([]);  // no membership

    const app = new Hono<{ Variables: { user: AuthUser } }>();
    app.use('*', async (c, next) => {
      c.set('user', {
        id: 'user-1',
        email: 'test@example.com',
        role: 'analyst',
        displayName: 'Test',
        avatarUrl: null,
      });
      await next();
    });
    app.get('/test/:folderId', requireInvestigationAccess('editor'), (c) => {
      return c.json({ ok: true });
    });

    const res = await app.request('/test/folder-1');
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error).toContain('No access');
  });

  it('passes through when user has access', async () => {
    selectQueue.push([{ role: 'owner' }]);

    const app = new Hono<{ Variables: { user: AuthUser } }>();
    app.use('*', async (c, next) => {
      c.set('user', {
        id: 'user-1',
        email: 'test@example.com',
        role: 'analyst',
        displayName: 'Test',
        avatarUrl: null,
      });
      await next();
    });
    app.get('/test/:folderId', requireInvestigationAccess('editor'), (c) => {
      return c.json({ ok: true });
    });

    const res = await app.request('/test/folder-1');
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
  });

  it('returns 400 when no folderId is provided', async () => {
    const app = new Hono<{ Variables: { user: AuthUser } }>();
    app.use('*', async (c, next) => {
      c.set('user', {
        id: 'user-1',
        email: 'test@example.com',
        role: 'analyst',
        displayName: 'Test',
        avatarUrl: null,
      });
      await next();
    });
    app.get('/test', requireInvestigationAccess('editor'), (c) => {
      return c.json({ ok: true });
    });

    const res = await app.request('/test');
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toContain('Missing folderId');
  });
});
