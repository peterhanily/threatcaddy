import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Hono } from 'hono';

// ── vi.hoisted so mock fns are available in vi.mock factories ─────────────────

const {
  selectQueue,
  insertQueue,
  deleteQueue,
  mockDb,
  mockCheckAccess,
  mockProcessPush,
  mockPullChanges,
  mockGetSnapshot,
  mockLookupEntityFolderId,
  mockBulkLookupEntityFolderIds,
  mockLogActivity,
  mockBroadcastToFolder,
  mockLogger,
} = vi.hoisted(() => {
  const selectQueue: unknown[] = [];
  const insertQueue: unknown[] = [];
  const deleteQueue: unknown[] = [];

  function makeThenableChain(queue: unknown[]) {
    const chain: Record<string, unknown> = {};
    const resolve = () => {
      const val = queue.shift();
      return val instanceof Error ? Promise.reject(val) : Promise.resolve(val ?? []);
    };
    for (const method of [
      'from',
      'leftJoin',
      'innerJoin',
      'where',
      'orderBy',
      'limit',
      'groupBy',
      'set',
      'values',
      'returning',
      'onConflictDoNothing',
    ]) {
      chain[method] = vi.fn(() => chain);
    }
    chain.then = (
      onFulfilled?: (v: unknown) => unknown,
      onRejected?: (e: unknown) => unknown,
    ) => {
      return resolve().then(onFulfilled, onRejected);
    };
    chain.catch = (onRejected?: (e: unknown) => unknown) => {
      return resolve().catch(onRejected);
    };
    return chain;
  }

  return {
    selectQueue,
    insertQueue,
    deleteQueue,
    makeThenableChain,
    mockDb: {
      select: vi.fn(() => makeThenableChain(selectQueue)),
      insert: vi.fn(() => makeThenableChain(insertQueue)),
      delete: vi.fn(() => makeThenableChain(deleteQueue)),
    },
    mockCheckAccess: vi.fn(),
    mockProcessPush: vi.fn(),
    mockPullChanges: vi.fn(),
    mockGetSnapshot: vi.fn(),
    mockLookupEntityFolderId: vi.fn(),
    mockBulkLookupEntityFolderIds: vi.fn(),
    mockLogActivity: vi.fn(),
    mockBroadcastToFolder: vi.fn(),
    mockLogger: {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      debug: vi.fn(),
    },
  };
});

// ── Mock: db ──────────────────────────────────────────────────────────────────

vi.mock('../db/index.js', () => ({
  db: mockDb,
}));

// ── Mock: db/schema ───────────────────────────────────────────────────────────

vi.mock('../db/schema.js', () => ({
  folders: { id: 'id', name: 'name' },
  investigationMembers: {
    id: 'id',
    folderId: 'folderId',
    userId: 'userId',
    role: 'role',
  },
}));

// ── Mock: drizzle-orm ─────────────────────────────────────────────────────────

vi.mock('drizzle-orm', () => ({
  eq: vi.fn((_col: unknown, _val: unknown) => ({ _col, _val })),
}));

// ── Mock: requireAuth middleware ───────────────────────────────────────────────

vi.mock('../middleware/auth.js', () => ({
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  requireAuth: vi.fn(async (c: any, next: () => Promise<void>) => {
    const authHeader = c.req.header('Authorization');
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return c.json({ error: 'Unauthorized' }, 401);
    }
    const token = authHeader.replace('Bearer ', '');
    if (token === 'valid-token') {
      c.set('user', {
        id: 'user-1',
        email: 'test@example.com',
        role: 'analyst',
        displayName: 'Test User',
        avatarUrl: null,
      });
    } else if (token === 'user2-token') {
      c.set('user', {
        id: 'user-2',
        email: 'user2@example.com',
        role: 'analyst',
        displayName: 'User Two',
        avatarUrl: null,
      });
    } else {
      return c.json({ error: 'Unauthorized' }, 401);
    }
    await next();
  }),
}));

// ── Mock: checkInvestigationAccess ────────────────────────────────────────────

vi.mock('../middleware/access.js', () => ({
  checkInvestigationAccess: mockCheckAccess,
}));

// ── Mock: sync-service ────────────────────────────────────────────────────────

vi.mock('../services/sync-service.js', () => ({
  processPush: mockProcessPush,
  pullChanges: mockPullChanges,
  getSnapshot: mockGetSnapshot,
  lookupEntityFolderId: mockLookupEntityFolderId,
  bulkLookupEntityFolderIds: mockBulkLookupEntityFolderIds,
}));

// ── Mock: audit-service ───────────────────────────────────────────────────────

vi.mock('../services/audit-service.js', () => ({
  logActivity: mockLogActivity,
}));

// ── Mock: ws/handler ──────────────────────────────────────────────────────────

vi.mock('../ws/handler.js', () => ({
  broadcastToFolder: mockBroadcastToFolder,
}));

// ── Mock: logger ──────────────────────────────────────────────────────────────

vi.mock('../lib/logger.js', () => ({
  logger: mockLogger,
}));

// ── Mock: nanoid ──────────────────────────────────────────────────────────────

vi.mock('nanoid', () => ({
  nanoid: vi.fn(() => 'mock-nanoid-id'),
}));

// ── Import route module (after mocks) ─────────────────────────────────────────

import syncRoutes from '../routes/sync.js';

// ── Helpers ───────────────────────────────────────────────────────────────────

function buildApp() {
  const app = new Hono();
  app.route('/api/sync', syncRoutes);
  return app;
}

function jsonReq(
  method: string,
  path: string,
  body?: unknown,
  token?: string,
) {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };
  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }
  const init: RequestInit = { method, headers };
  if (body !== undefined) {
    init.body = JSON.stringify(body);
  }
  return new Request(`http://localhost${path}`, init);
}

function getReq(path: string, token?: string) {
  const headers: Record<string, string> = {};
  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }
  return new Request(`http://localhost${path}`, { method: 'GET', headers });
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('sync routes', () => {
  let app: Hono;

  beforeEach(() => {
    vi.clearAllMocks();
    selectQueue.length = 0;
    insertQueue.length = 0;
    deleteQueue.length = 0;
    app = buildApp();

    // Sensible defaults
    mockProcessPush.mockResolvedValue([]);
    mockPullChanges.mockResolvedValue({ changes: [], serverNow: Date.now() });
    mockGetSnapshot.mockResolvedValue({ changes: [] });
    mockCheckAccess.mockResolvedValue(true);
    mockLookupEntityFolderId.mockResolvedValue(null);
    // Bulk lookup delegates to the per-entity mock by default
    mockBulkLookupEntityFolderIds.mockImplementation(
      async (items: Array<{ table: string; entityId: string }>) => {
        const map = new Map<string, string>();
        for (const item of items) {
          const folderId = await mockLookupEntityFolderId(item.table, item.entityId);
          if (folderId) map.set(`${item.table}:${item.entityId}`, folderId);
        }
        return map;
      },
    );
    mockLogActivity.mockResolvedValue(undefined);
    mockBroadcastToFolder.mockReturnValue(undefined);
  });

  // ────────────────────────────────────────────────────────────────────────────
  // Authentication on all endpoints
  // ────────────────────────────────────────────────────────────────────────────

  describe('authentication', () => {
    it('POST /push returns 401 without auth header', async () => {
      const res = await app.request(
        jsonReq('POST', '/api/sync/push', { changes: [] }),
      );
      expect(res.status).toBe(401);
    });

    it('POST /push returns 401 with invalid token', async () => {
      const res = await app.request(
        jsonReq('POST', '/api/sync/push', { changes: [] }, 'bad-token'),
      );
      expect(res.status).toBe(401);
    });

    it('GET /pull returns 401 without auth header', async () => {
      const res = await app.request(getReq('/api/sync/pull?since=0'));
      expect(res.status).toBe(401);
    });

    it('GET /snapshot/:folderId returns 401 without auth header', async () => {
      const res = await app.request(
        getReq('/api/sync/snapshot/folder-123'),
      );
      expect(res.status).toBe(401);
    });
  });

  // ────────────────────────────────────────────────────────────────────────────
  // POST /push
  // ────────────────────────────────────────────────────────────────────────────

  describe('POST /push', () => {
    it('returns { results: [] } for empty changes array', async () => {
      const res = await app.request(
        jsonReq('POST', '/api/sync/push', { changes: [] }, 'valid-token'),
      );
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.results).toEqual([]);
    });

    it('accepts authorized changes for folder-scoped tables', async () => {
      const changes = [
        {
          table: 'threats',
          op: 'put',
          entityId: 'threat-1',
          data: { name: 'test threat', folderId: 'folder-1' },
        },
      ];

      mockLookupEntityFolderId.mockResolvedValue('folder-1');
      mockCheckAccess.mockResolvedValue(true);
      mockProcessPush.mockResolvedValue([
        { table: 'threats', entityId: 'threat-1', status: 'accepted', serverVersion: 2 },
      ]);

      const res = await app.request(
        jsonReq('POST', '/api/sync/push', { changes }, 'valid-token'),
      );
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.results).toHaveLength(1);
      expect(body.results[0].status).toBe('accepted');
    });

    it('rejects unauthorized changes with status rejected', async () => {
      const changes = [
        {
          table: 'threats',
          op: 'put',
          entityId: 'threat-1',
          data: { name: 'modified', folderId: 'folder-1' },
        },
      ];

      mockLookupEntityFolderId.mockResolvedValue('folder-1');
      mockCheckAccess.mockResolvedValue(false);

      const res = await app.request(
        jsonReq('POST', '/api/sync/push', { changes }, 'valid-token'),
      );
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.results).toHaveLength(1);
      expect(body.results[0].status).toBe('rejected');
    });

    it('uses entityId as folderId for folders table (no lookupEntityFolderId call)', async () => {
      const changes = [
        {
          table: 'folders',
          op: 'put',
          entityId: 'folder-99',
          data: { name: 'renamed folder' },
        },
      ];

      // existing folder found in DB
      selectQueue.push([{ id: 'folder-99' }]);
      mockCheckAccess.mockResolvedValue(true);
      mockProcessPush.mockResolvedValue([
        { table: 'folders', entityId: 'folder-99', status: 'accepted', serverVersion: 2 },
      ]);

      const res = await app.request(
        jsonReq('POST', '/api/sync/push', { changes }, 'valid-token'),
      );
      expect(res.status).toBe(200);
      expect(mockCheckAccess).toHaveBeenCalledWith('user-1', 'folder-99', 'editor');
      expect(mockLookupEntityFolderId).not.toHaveBeenCalled();
    });

    it('tags table is always authorized without access check', async () => {
      const changes = [
        {
          table: 'tags',
          op: 'put',
          entityId: 'tag-1',
          data: { name: 'new tag' },
        },
      ];

      mockProcessPush.mockResolvedValue([
        { table: 'tags', entityId: 'tag-1', status: 'accepted', serverVersion: 1 },
      ]);

      const res = await app.request(
        jsonReq('POST', '/api/sync/push', { changes }, 'valid-token'),
      );
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.results[0].status).toBe('accepted');
      expect(mockCheckAccess).not.toHaveBeenCalled();
      expect(mockLookupEntityFolderId).not.toHaveBeenCalled();
    });

    it('timelines table is always authorized without access check', async () => {
      const changes = [
        {
          table: 'timelines',
          op: 'put',
          entityId: 'tl-1',
          data: { name: 'timeline' },
        },
      ];

      mockProcessPush.mockResolvedValue([
        { table: 'timelines', entityId: 'tl-1', status: 'accepted', serverVersion: 1 },
      ]);

      const res = await app.request(
        jsonReq('POST', '/api/sync/push', { changes }, 'valid-token'),
      );
      expect(res.status).toBe(200);
      expect(mockCheckAccess).not.toHaveBeenCalled();
    });

    it('allows creating a NEW folder even without prior access', async () => {
      const changes = [
        {
          table: 'folders',
          op: 'put' as const,
          entityId: 'new-folder-1',
          data: { id: 'new-folder-1', name: 'My new investigation' },
        },
      ];

      mockCheckAccess.mockResolvedValue(false);
      // No existing folder record
      selectQueue.push([]);
      mockProcessPush.mockResolvedValue([
        { table: 'folders', entityId: 'new-folder-1', status: 'accepted', serverVersion: 1 },
      ]);
      // insert for owner membership
      insertQueue.push([]);

      const res = await app.request(
        jsonReq('POST', '/api/sync/push', { changes }, 'valid-token'),
      );
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.results[0].status).toBe('accepted');
    });

    it('auto-creates owner membership when a new folder is created (serverVersion=1)', async () => {
      const changes = [
        {
          table: 'folders',
          op: 'put' as const,
          entityId: 'brand-new-folder',
          data: { id: 'brand-new-folder', name: 'brand new' },
        },
      ];

      mockCheckAccess.mockResolvedValue(false);
      selectQueue.push([]);
      mockProcessPush.mockResolvedValue([
        { table: 'folders', entityId: 'brand-new-folder', status: 'accepted', serverVersion: 1 },
      ]);
      insertQueue.push([]);

      const res = await app.request(
        jsonReq('POST', '/api/sync/push', { changes }, 'valid-token'),
      );
      expect(res.status).toBe(200);
      expect(mockDb.insert).toHaveBeenCalled();
    });

    it('does NOT auto-create membership when folder update has serverVersion > 1', async () => {
      const changes = [
        {
          table: 'folders',
          op: 'put' as const,
          entityId: 'existing-folder',
          data: { name: 'updated name' },
        },
      ];

      mockCheckAccess.mockResolvedValue(true);
      mockProcessPush.mockResolvedValue([
        { table: 'folders', entityId: 'existing-folder', status: 'accepted', serverVersion: 3 },
      ]);

      const res = await app.request(
        jsonReq('POST', '/api/sync/push', { changes }, 'valid-token'),
      );
      expect(res.status).toBe(200);
      expect(mockDb.insert).not.toHaveBeenCalled();
    });

    it('broadcasts accepted changes via WebSocket with folderId', async () => {
      const changes = [
        {
          table: 'threats',
          op: 'put' as const,
          entityId: 'threat-1',
          data: { name: 'threat', folderId: 'folder-1' },
        },
      ];

      mockLookupEntityFolderId.mockResolvedValue('folder-1');
      mockCheckAccess.mockResolvedValue(true);
      mockProcessPush.mockResolvedValue([
        { table: 'threats', entityId: 'threat-1', status: 'accepted', serverVersion: 2 },
      ]);

      const res = await app.request(
        jsonReq('POST', '/api/sync/push', { changes }, 'valid-token'),
      );
      expect(res.status).toBe(200);
      expect(mockBroadcastToFolder).toHaveBeenCalledWith(
        'folder-1',
        expect.objectContaining({
          type: 'entity-change',
          table: 'threats',
          op: 'put',
          entityId: 'threat-1',
          updatedBy: 'user-1',
        }),
        'user-1',
      );
    });

    it('logs activity for each accepted change', async () => {
      const changes = [
        {
          table: 'threats',
          op: 'put' as const,
          entityId: 'threat-1',
          data: { name: 'threat', folderId: 'folder-1' },
        },
      ];

      mockLookupEntityFolderId.mockResolvedValue('folder-1');
      mockCheckAccess.mockResolvedValue(true);
      mockProcessPush.mockResolvedValue([
        { table: 'threats', entityId: 'threat-1', status: 'accepted', serverVersion: 2 },
      ]);

      await app.request(
        jsonReq('POST', '/api/sync/push', { changes }, 'valid-token'),
      );
      expect(mockLogActivity).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: 'user-1',
          action: 'update',
          itemId: 'threat-1',
          folderId: 'folder-1',
        }),
      );
    });

    it('does not log activity for rejected changes', async () => {
      const changes = [
        {
          table: 'threats',
          op: 'put' as const,
          entityId: 'threat-1',
          data: { name: 'threat', folderId: 'folder-1' },
        },
      ];

      mockLookupEntityFolderId.mockResolvedValue('folder-1');
      mockCheckAccess.mockResolvedValue(false);

      await app.request(
        jsonReq('POST', '/api/sync/push', { changes }, 'valid-token'),
      );
      expect(mockLogActivity).not.toHaveBeenCalled();
    });

    it('handles mixed authorized and unauthorized changes', async () => {
      const changes = [
        {
          table: 'threats',
          op: 'put' as const,
          entityId: 'threat-1',
          data: { folderId: 'folder-1' },
        },
        {
          table: 'threats',
          op: 'put' as const,
          entityId: 'threat-2',
          data: { folderId: 'folder-2' },
        },
      ];

      mockLookupEntityFolderId
        .mockResolvedValueOnce('folder-1')
        .mockResolvedValueOnce('folder-2');
      mockCheckAccess
        .mockResolvedValueOnce(true)
        .mockResolvedValueOnce(false);
      mockProcessPush.mockResolvedValue([
        { table: 'threats', entityId: 'threat-1', status: 'accepted', serverVersion: 2 },
      ]);

      const res = await app.request(
        jsonReq('POST', '/api/sync/push', { changes }, 'valid-token'),
      );
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.results).toHaveLength(2);
      expect(body.results[0].status).toBe('accepted');
      expect(body.results[1].status).toBe('rejected');
    });

    it('calls checkAccess for each folder-scoped change', async () => {
      const changes = [
        {
          table: 'threats',
          op: 'put' as const,
          entityId: 'threat-a',
          data: { folderId: 'folder-1' },
        },
        {
          table: 'threats',
          op: 'put' as const,
          entityId: 'threat-b',
          data: { folderId: 'folder-1' },
        },
      ];

      mockLookupEntityFolderId.mockResolvedValue('folder-1');
      mockCheckAccess.mockResolvedValue(true);
      mockProcessPush.mockResolvedValue([
        { table: 'threats', entityId: 'threat-a', status: 'accepted', serverVersion: 2 },
        { table: 'threats', entityId: 'threat-b', status: 'accepted', serverVersion: 2 },
      ]);

      const res = await app.request(
        jsonReq('POST', '/api/sync/push', { changes }, 'valid-token'),
      );
      expect(res.status).toBe(200);
      expect(mockCheckAccess).toHaveBeenCalledTimes(2);
    });

    it('rejects folder-scoped entity with no folderId found', async () => {
      const changes = [
        {
          table: 'threats',
          op: 'delete' as const,
          entityId: 'nonexistent-threat',
        },
      ];

      mockLookupEntityFolderId.mockResolvedValue(null);

      const res = await app.request(
        jsonReq('POST', '/api/sync/push', { changes }, 'valid-token'),
      );
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.results[0].status).toBe('rejected');
    });

    it('rejects update to existing folder without editor access', async () => {
      const changes = [
        {
          table: 'folders',
          op: 'put' as const,
          entityId: 'existing-folder',
          data: { name: 'hacked name' },
        },
      ];

      mockCheckAccess.mockResolvedValue(false);
      // Folder exists in DB
      selectQueue.push([{ id: 'existing-folder' }]);

      const res = await app.request(
        jsonReq('POST', '/api/sync/push', { changes }, 'valid-token'),
      );
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.results[0].status).toBe('rejected');
    });

    it('maps delete op to action delete in logActivity', async () => {
      const changes = [
        {
          table: 'threats',
          op: 'delete' as const,
          entityId: 'threat-1',
        },
      ];

      mockLookupEntityFolderId.mockResolvedValue('folder-1');
      mockCheckAccess.mockResolvedValue(true);
      mockProcessPush.mockResolvedValue([
        {
          table: 'threats',
          entityId: 'threat-1',
          status: 'accepted',
          serverVersion: 3,
          serverRecord: { folderId: 'folder-1' },
        },
      ]);

      await app.request(
        jsonReq('POST', '/api/sync/push', { changes }, 'valid-token'),
      );
      expect(mockLogActivity).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'delete',
        }),
      );
    });
  });

  // ────────────────────────────────────────────────────────────────────────────
  // GET /pull
  // ────────────────────────────────────────────────────────────────────────────

  describe('GET /pull', () => {
    it('returns 400 without since query parameter', async () => {
      const res = await app.request(
        getReq('/api/sync/pull', 'valid-token'),
      );
      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error).toMatch(/since/i);
    });

    it('pulls changes since timestamp without folderId (all memberships)', async () => {
      const since = String(Date.now() - 60000);
      selectQueue.push([
        { folderId: 'folder-1' },
        { folderId: 'folder-2' },
      ]);
      const mockResult = { changes: [{ id: 'c1' }], serverNow: Date.now() };
      mockPullChanges.mockResolvedValue(mockResult);

      const res = await app.request(
        getReq(`/api/sync/pull?since=${since}`, 'valid-token'),
      );
      expect(res.status).toBe(200);
      expect(mockPullChanges).toHaveBeenCalledWith(since, ['folder-1', 'folder-2']);
    });

    it('pulls changes scoped to folderId when provided', async () => {
      const since = String(Date.now() - 60000);
      mockCheckAccess.mockResolvedValue(true);
      const mockResult = { changes: [{ id: 'c1' }], serverNow: Date.now() };
      mockPullChanges.mockResolvedValue(mockResult);

      const res = await app.request(
        getReq(`/api/sync/pull?since=${since}&folderId=folder-1`, 'valid-token'),
      );
      expect(res.status).toBe(200);
      expect(mockCheckAccess).toHaveBeenCalledWith('user-1', 'folder-1', 'viewer');
      expect(mockPullChanges).toHaveBeenCalledWith(since, ['folder-1']);
    });

    it('returns 403 when pulling with folderId the user has no access to', async () => {
      const since = String(Date.now() - 60000);
      mockCheckAccess.mockResolvedValue(false);

      const res = await app.request(
        getReq(`/api/sync/pull?since=${since}&folderId=forbidden-folder`, 'valid-token'),
      );
      expect(res.status).toBe(403);
      const body = await res.json();
      expect(body.error).toBeDefined();
    });

    it('returns empty changes when user has no memberships and no folderId', async () => {
      const since = String(Date.now() - 60000);
      selectQueue.push([]);
      mockPullChanges.mockResolvedValue({ changes: [], serverNow: Date.now() });

      const res = await app.request(
        getReq(`/api/sync/pull?since=${since}`, 'valid-token'),
      );
      expect(res.status).toBe(200);
      expect(mockPullChanges).toHaveBeenCalledWith(since, []);
    });
  });

  // ────────────────────────────────────────────────────────────────────────────
  // GET /snapshot/:folderId
  // ────────────────────────────────────────────────────────────────────────────

  describe('GET /snapshot/:folderId', () => {
    it('returns snapshot data for authorized viewer', async () => {
      const snapshotData = {
        changes: [
          { table: 'threats', entityId: 'threat-1', data: { name: 'a threat' } },
          { table: 'mitigations', entityId: 'mit-1', data: { name: 'a mitigation' } },
        ],
      };
      mockCheckAccess.mockResolvedValue(true);
      mockGetSnapshot.mockResolvedValue(snapshotData);

      const res = await app.request(
        getReq('/api/sync/snapshot/folder-1', 'valid-token'),
      );
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.changes).toHaveLength(2);
    });

    it('checks viewer access on snapshot', async () => {
      mockCheckAccess.mockResolvedValue(true);
      mockGetSnapshot.mockResolvedValue({ changes: [] });

      await app.request(
        getReq('/api/sync/snapshot/folder-1', 'valid-token'),
      );

      expect(mockCheckAccess).toHaveBeenCalledWith('user-1', 'folder-1', 'viewer');
    });

    it('returns 403 if user has no viewer access to folder', async () => {
      mockCheckAccess.mockResolvedValue(false);

      const res = await app.request(
        getReq('/api/sync/snapshot/secret-folder', 'valid-token'),
      );
      expect(res.status).toBe(403);
      const body = await res.json();
      expect(body.error).toBeDefined();
    });

    it('returns empty snapshot for folder with no data', async () => {
      mockCheckAccess.mockResolvedValue(true);
      mockGetSnapshot.mockResolvedValue({ changes: [] });

      const res = await app.request(
        getReq('/api/sync/snapshot/empty-folder', 'valid-token'),
      );
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.changes).toHaveLength(0);
    });

    it('passes folderId to getSnapshot service', async () => {
      mockCheckAccess.mockResolvedValue(true);
      mockGetSnapshot.mockResolvedValue({ changes: [] });

      await app.request(
        getReq('/api/sync/snapshot/folder-xyz', 'valid-token'),
      );

      expect(mockGetSnapshot).toHaveBeenCalledWith('folder-xyz');
    });

    it('uses correct user context with user2-token', async () => {
      mockCheckAccess.mockResolvedValue(true);
      mockGetSnapshot.mockResolvedValue({ changes: [] });

      await app.request(
        getReq('/api/sync/snapshot/folder-1', 'user2-token'),
      );

      expect(mockCheckAccess).toHaveBeenCalledWith('user-2', 'folder-1', 'viewer');
    });
  });
});
