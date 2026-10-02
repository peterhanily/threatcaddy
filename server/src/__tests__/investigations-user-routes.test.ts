import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Hono } from 'hono';

// ── vi.hoisted so mock fns are available in vi.mock factories ─────────────────

const {
  selectQueue,
  insertQueue,
  deleteQueue,
  mockDb,
  mockCheckAccess,
  mockGetEntityCounts,
  mockGetEntityCountsBatch,
  mockLogActivity,
  mockCreateNotification,
  mockBroadcastToUser,
  mockRevokeUserFolderAccess,
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
      'offset',
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

  const mockTransaction = vi.fn(async (fn: (tx: unknown) => Promise<void>) => {
    const txProxy = {
      delete: vi.fn(() => makeThenableChain([])),
    };
    await fn(txProxy);
  });

  return {
    selectQueue,
    insertQueue,
    deleteQueue,
    makeThenableChain,
    mockDb: {
      select: vi.fn(() => makeThenableChain(selectQueue)),
      insert: vi.fn(() => makeThenableChain(insertQueue)),
      delete: vi.fn(() => makeThenableChain(deleteQueue)),
      transaction: mockTransaction,
    },
    mockCheckAccess: vi.fn(),
    mockGetEntityCounts: vi.fn(),
    mockGetEntityCountsBatch: vi.fn(),
    mockLogActivity: vi.fn(),
    mockCreateNotification: vi.fn(),
    mockBroadcastToUser: vi.fn(),
    mockRevokeUserFolderAccess: vi.fn(),
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
  folders: { id: 'id', name: 'name', status: 'status', color: 'color', icon: 'icon', description: 'description', clsLevel: 'clsLevel', papLevel: 'papLevel', tags: 'tags', createdAt: 'createdAt', updatedAt: 'updatedAt' },
  investigationMembers: {
    id: 'id',
    folderId: 'folderId',
    userId: 'userId',
    role: 'role',
    joinedAt: 'joinedAt',
  },
  users: { id: 'id', displayName: 'displayName', email: 'email', avatarUrl: 'avatarUrl' },
  notes: { folderId: 'folderId', updatedAt: 'updatedAt', deletedAt: 'deletedAt' },
  tasks: { folderId: 'folderId', updatedAt: 'updatedAt', deletedAt: 'deletedAt' },
  timelineEvents: { folderId: 'folderId', updatedAt: 'updatedAt', deletedAt: 'deletedAt' },
  whiteboards: { folderId: 'folderId', updatedAt: 'updatedAt', deletedAt: 'deletedAt' },
  standaloneIOCs: { folderId: 'folderId', updatedAt: 'updatedAt', deletedAt: 'deletedAt' },
  chatThreads: { folderId: 'folderId', updatedAt: 'updatedAt', deletedAt: 'deletedAt' },
  evidenceItems: { folderId: 'folderId', updatedAt: 'updatedAt', deletedAt: 'deletedAt' },
  posts: { folderId: 'folderId' },
  files: { folderId: 'folderId', storagePath: 'storagePath', thumbnailPath: 'thumbnailPath' },
  notifications: { folderId: 'folderId' },
}));

// ── Mock: drizzle-orm ─────────────────────────────────────────────────────────

vi.mock('drizzle-orm', () => ({
  eq: vi.fn((_col: unknown, _val: unknown) => ({ _col, _val })),
  and: vi.fn((...args: unknown[]) => ({ _and: args })),
  count: vi.fn(() => 'count_fn'),
  sql: vi.fn((...args: unknown[]) => {
    // Return an object with .as() method to mimic sql`...`.as('alias')
    const result = { _sql: args, as: vi.fn(() => result) };
    return result;
  }),
  inArray: vi.fn((_col: unknown, _vals: unknown) => ({ _col, _vals })),
  isNull: vi.fn((_col: unknown) => ({ _isNull: _col })),
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
  getEntityCounts: mockGetEntityCounts,
  getEntityCountsBatch: mockGetEntityCountsBatch,
}));

// ── Mock: notification-service ────────────────────────────────────────────────

vi.mock('../services/notification-service.js', () => ({
  createNotification: mockCreateNotification,
}));

// ── Mock: audit-service ───────────────────────────────────────────────────────

vi.mock('../services/audit-service.js', () => ({
  logActivity: mockLogActivity,
}));

// ── Mock: ws/handler ──────────────────────────────────────────────────────────

vi.mock('../ws/handler.js', () => ({
  broadcastToUser: mockBroadcastToUser,
  revokeUserFolderAccess: mockRevokeUserFolderAccess,
}));

// ── Mock: logger ──────────────────────────────────────────────────────────────

vi.mock('../lib/logger.js', () => ({
  logger: mockLogger,
}));

// ── Mock: nanoid ──────────────────────────────────────────────────────────────

vi.mock('nanoid', () => ({
  nanoid: vi.fn(() => 'mock-nanoid-id'),
}));

// ── Mock: node:fs/promises ────────────────────────────────────────────────────

vi.mock('node:fs/promises', () => ({
  unlink: vi.fn(),
}));

// ── Import route module (after mocks) ─────────────────────────────────────────

import investigationRoutes from '../routes/investigations.js';

// ── Helpers ───────────────────────────────────────────────────────────────────

function buildApp() {
  const app = new Hono();
  app.route('/api/investigations', investigationRoutes);
  return app;
}

function getReq(path: string, token?: string) {
  const headers: Record<string, string> = {};
  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }
  return new Request(`http://localhost${path}`, { method: 'GET', headers });
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

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('investigation user routes', () => {
  let app: Hono;

  beforeEach(() => {
    vi.clearAllMocks();
    selectQueue.length = 0;
    insertQueue.length = 0;
    deleteQueue.length = 0;
    app = buildApp();

    // Sensible defaults
    mockCheckAccess.mockResolvedValue(true);
    mockGetEntityCounts.mockResolvedValue({ notes: 0, tasks: 0, iocs: 0, events: 0, whiteboards: 0, chats: 0 });
    mockGetEntityCountsBatch.mockResolvedValue(new Map());
    mockLogActivity.mockResolvedValue(undefined);
    mockCreateNotification.mockResolvedValue(undefined);
    mockBroadcastToUser.mockReturnValue(undefined);
    mockRevokeUserFolderAccess.mockReturnValue(undefined);
  });

  // ────────────────────────────────────────────────────────────────────────────
  // Authentication
  // ────────────────────────────────────────────────────────────────────────────

  describe('authentication', () => {
    it('GET /api/investigations returns 401 without auth', async () => {
      const res = await app.request(getReq('/api/investigations'));
      expect(res.status).toBe(401);
    });

    it('GET /api/investigations/:id/summary returns 401 without auth', async () => {
      const res = await app.request(getReq('/api/investigations/folder-1/summary'));
      expect(res.status).toBe(401);
    });
  });

  // ────────────────────────────────────────────────────────────────────────────
  // GET /api/investigations
  // ────────────────────────────────────────────────────────────────────────────

  describe('GET /api/investigations', () => {
    it('returns investigations the user is a member of', async () => {
      // First select: total count
      selectQueue.push([{ count: 1 }]);
      // Second select: membership rows
      selectQueue.push([
        {
          folderId: 'folder-1',
          role: 'owner',
          joinedAt: '2024-01-01T00:00:00Z',
          folderName: 'Op Falcon',
          folderStatus: 'active',
          folderColor: '#ff0000',
          folderIcon: null,
          folderDescription: 'A test investigation',
          folderClsLevel: 'TLP:GREEN',
          folderPapLevel: null,
          folderTags: null,
          folderCreatedAt: '2024-01-01T00:00:00Z',
          folderUpdatedAt: '2024-01-02T00:00:00Z',
          memberCount: 2,
        },
      ]);

      const entityCountsMap = new Map();
      entityCountsMap.set('folder-1', { notes: 5, tasks: 3, iocs: 2, events: 1, whiteboards: 0, chats: 0 });
      mockGetEntityCountsBatch.mockResolvedValue(entityCountsMap);

      const res = await app.request(
        getReq('/api/investigations', 'valid-token'),
      );
      expect(res.status).toBe(200);

      const body = await res.json();
      expect(body.data).toHaveLength(1);
      expect(body.data[0].folderId).toBe('folder-1');
      expect(body.data[0].role).toBe('owner');
    });

    it('includes entity counts in the response', async () => {
      selectQueue.push([{ count: 1 }]);
      selectQueue.push([
        {
          folderId: 'folder-1',
          role: 'editor',
          joinedAt: '2024-01-01T00:00:00Z',
          folderName: 'Op Falcon',
          folderStatus: 'active',
          folderColor: null,
          folderIcon: null,
          folderDescription: null,
          folderClsLevel: null,
          folderPapLevel: null,
          folderTags: null,
          folderCreatedAt: '2024-01-01T00:00:00Z',
          folderUpdatedAt: '2024-01-02T00:00:00Z',
          memberCount: 1,
        },
      ]);

      const entityCountsMap = new Map();
      entityCountsMap.set('folder-1', { notes: 10, tasks: 5, iocs: 3, events: 7, whiteboards: 2, chats: 1 });
      mockGetEntityCountsBatch.mockResolvedValue(entityCountsMap);

      const res = await app.request(
        getReq('/api/investigations', 'valid-token'),
      );
      const body = await res.json();
      expect(body.data[0].entityCounts).toEqual({
        notes: 10,
        tasks: 5,
        iocs: 3,
        events: 7,
        whiteboards: 2,
        chats: 1,
      });
    });

    it('includes member count', async () => {
      selectQueue.push([{ count: 1 }]);
      selectQueue.push([
        {
          folderId: 'folder-1',
          role: 'owner',
          joinedAt: '2024-01-01T00:00:00Z',
          folderName: 'Test',
          folderStatus: 'active',
          folderColor: null,
          folderIcon: null,
          folderDescription: null,
          folderClsLevel: null,
          folderPapLevel: null,
          folderTags: null,
          folderCreatedAt: '2024-01-01T00:00:00Z',
          folderUpdatedAt: '2024-01-01T00:00:00Z',
          memberCount: 4,
        },
      ]);
      mockGetEntityCountsBatch.mockResolvedValue(new Map());

      const res = await app.request(
        getReq('/api/investigations', 'valid-token'),
      );
      const body = await res.json();
      expect(body.data[0].memberCount).toBe(4);
    });

    it('returns nested folder object with all metadata fields', async () => {
      selectQueue.push([{ count: 1 }]);
      selectQueue.push([
        {
          folderId: 'folder-1',
          role: 'owner',
          joinedAt: '2024-01-01T00:00:00Z',
          folderName: 'Op Midnight',
          folderStatus: 'active',
          folderColor: '#3b82f6',
          folderIcon: '🔍',
          folderDescription: 'Investigation description',
          folderClsLevel: 'TLP:AMBER',
          folderPapLevel: 'PAP:GREEN',
          folderTags: ['apt', 'malware'],
          folderCreatedAt: '2024-01-01T00:00:00Z',
          folderUpdatedAt: '2024-06-15T12:00:00Z',
          memberCount: 3,
        },
      ]);
      mockGetEntityCountsBatch.mockResolvedValue(new Map());

      const res = await app.request(
        getReq('/api/investigations', 'valid-token'),
      );
      const body = await res.json();
      const folder = body.data[0].folder;
      expect(folder.name).toBe('Op Midnight');
      expect(folder.status).toBe('active');
      expect(folder.color).toBe('#3b82f6');
      expect(folder.icon).toBe('🔍');
      expect(folder.description).toBe('Investigation description');
      expect(folder.clsLevel).toBe('TLP:AMBER');
      expect(folder.papLevel).toBe('PAP:GREEN');
      expect(folder.tags).toEqual(['apt', 'malware']);
    });

    it('respects pagination (limit/offset)', async () => {
      selectQueue.push([{ count: 100 }]);
      selectQueue.push([]);
      mockGetEntityCountsBatch.mockResolvedValue(new Map());

      const res = await app.request(
        getReq('/api/investigations?limit=10&offset=20', 'valid-token'),
      );
      const body = await res.json();
      expect(body.limit).toBe(10);
      expect(body.offset).toBe(20);
      expect(body.total).toBe(100);
    });

    it('defaults to limit=50, offset=0', async () => {
      selectQueue.push([{ count: 0 }]);
      selectQueue.push([]);
      mockGetEntityCountsBatch.mockResolvedValue(new Map());

      const res = await app.request(
        getReq('/api/investigations', 'valid-token'),
      );
      const body = await res.json();
      expect(body.limit).toBe(50);
      expect(body.offset).toBe(0);
    });

    it('clamps limit to max 200', async () => {
      selectQueue.push([{ count: 0 }]);
      selectQueue.push([]);
      mockGetEntityCountsBatch.mockResolvedValue(new Map());

      const res = await app.request(
        getReq('/api/investigations?limit=999', 'valid-token'),
      );
      const body = await res.json();
      expect(body.limit).toBe(200);
    });

    it('returns zero entity counts for folders with no entities', async () => {
      selectQueue.push([{ count: 1 }]);
      selectQueue.push([
        {
          folderId: 'empty-folder',
          role: 'owner',
          joinedAt: '2024-01-01T00:00:00Z',
          folderName: 'Empty',
          folderStatus: 'active',
          folderColor: null,
          folderIcon: null,
          folderDescription: null,
          folderClsLevel: null,
          folderPapLevel: null,
          folderTags: null,
          folderCreatedAt: '2024-01-01T00:00:00Z',
          folderUpdatedAt: '2024-01-01T00:00:00Z',
          memberCount: 1,
        },
      ]);
      // No entry in counts map for empty-folder -> should default to zeros
      mockGetEntityCountsBatch.mockResolvedValue(new Map());

      const res = await app.request(
        getReq('/api/investigations', 'valid-token'),
      );
      const body = await res.json();
      expect(body.data[0].entityCounts).toEqual({
        notes: 0,
        tasks: 0,
        iocs: 0,
        events: 0,
        whiteboards: 0,
        chats: 0,
        evidence: 0,
      });
    });
  });

  // ────────────────────────────────────────────────────────────────────────────
  // GET /api/investigations/:id/summary
  // ────────────────────────────────────────────────────────────────────────────

  describe('GET /api/investigations/:id/summary', () => {
    it('returns 403 when user has no access', async () => {
      mockCheckAccess.mockResolvedValue(false);

      const res = await app.request(
        getReq('/api/investigations/folder-secret/summary', 'valid-token'),
      );
      expect(res.status).toBe(403);
      const body = await res.json();
      expect(body.error).toBeDefined();
    });

    it('returns 401 without authentication', async () => {
      const res = await app.request(
        getReq('/api/investigations/folder-1/summary'),
      );
      expect(res.status).toBe(401);
    });

    it('returns folder metadata, entity counts, members list, lastActivity', async () => {
      mockCheckAccess.mockResolvedValue(true);

      // The summary route uses Promise.all with a nested Promise.all for last-activity.
      // Because the inner Promise.all (6 selects) is constructed first (as an argument to
      // the outer Promise.all), its thenables consume from the queue before the outer items.
      // Queue order: 6 last-activity, then folder metadata, then members.

      // Last activity: 6 subqueries (consumed first by inner Promise.all)
      selectQueue.push([{ latest: '2024-06-15T12:00:00Z' }]);
      selectQueue.push([{ latest: '2024-06-10T10:00:00Z' }]);
      selectQueue.push([{ latest: null }]);
      selectQueue.push([{ latest: '2024-06-14T08:00:00Z' }]);
      selectQueue.push([{ latest: null }]);
      selectQueue.push([{ latest: '2024-05-01T00:00:00Z' }]);
      // Evidence can be the newest activity in an investigation.
      selectQueue.push([{ latest: '2024-06-16T12:00:00Z' }]);

      // Folder metadata (consumed after inner Promise.all thenables)
      selectQueue.push([
        {
          name: 'Op Thunder',
          status: 'active',
          color: '#ef4444',
          icon: '\u26A1',
          description: 'Lightning investigation',
          clsLevel: 'TLP:RED',
          papLevel: 'PAP:RED',
          tags: ['urgent'],
          createdAt: '2024-01-01T00:00:00Z',
          updatedAt: '2024-06-01T00:00:00Z',
        },
      ]);

      // Members
      selectQueue.push([
        {
          id: 'mem-1',
          userId: 'user-1',
          role: 'owner',
          joinedAt: '2024-01-01T00:00:00Z',
          displayName: 'Test User',
          email: 'test@example.com',
          avatarUrl: null,
        },
        {
          id: 'mem-2',
          userId: 'user-2',
          role: 'editor',
          joinedAt: '2024-02-01T00:00:00Z',
          displayName: 'User Two',
          email: 'user2@example.com',
          avatarUrl: null,
        },
      ]);

      // Entity counts
      mockGetEntityCounts.mockResolvedValue({
        notes: 10,
        tasks: 5,
        iocs: 3,
        events: 7,
        whiteboards: 2,
        chats: 1,
      });

      const res = await app.request(
        getReq('/api/investigations/folder-1/summary', 'valid-token'),
      );
      expect(res.status).toBe(200);

      const body = await res.json();
      expect(body.folder.name).toBe('Op Thunder');
      expect(body.folder.clsLevel).toBe('TLP:RED');
      expect(body.entityCounts.notes).toBe(10);
      expect(body.entityCounts.tasks).toBe(5);
      expect(body.members).toHaveLength(2);
      expect(body.members[0].displayName).toBe('Test User');
      expect(body.lastActivity).toBe('2024-06-16T12:00:00.000Z');
    });

    it('returns 404 when folder does not exist', async () => {
      mockCheckAccess.mockResolvedValue(true);

      // Queue order: 6 last-activity first, then folder (empty), then members
      // Last activity: 6 empty subqueries
      selectQueue.push([{ latest: null }]);
      selectQueue.push([{ latest: null }]);
      selectQueue.push([{ latest: null }]);
      selectQueue.push([{ latest: null }]);
      selectQueue.push([{ latest: null }]);
      selectQueue.push([{ latest: null }]);
      // Folder metadata: empty (not found)
      selectQueue.push([{ latest: null }]);
      selectQueue.push([]);
      // Members
      selectQueue.push([]);

      // Entity counts
      mockGetEntityCounts.mockResolvedValue({ notes: 0, tasks: 0, iocs: 0, events: 0, whiteboards: 0, chats: 0 });

      const res = await app.request(
        getReq('/api/investigations/nonexistent/summary', 'valid-token'),
      );
      expect(res.status).toBe(404);
    });

    it('checks viewer-level access', async () => {
      mockCheckAccess.mockResolvedValue(false);

      const res = await app.request(
        getReq('/api/investigations/folder-1/summary', 'valid-token'),
      );
      expect(res.status).toBe(403);
      expect(mockCheckAccess).toHaveBeenCalledWith('user-1', 'folder-1', 'viewer');
    });
  });

  // ────────────────────────────────────────────────────────────────────────────
  // getEntityCounts / getEntityCountsBatch
  // ────────────────────────────────────────────────────────────────────────────

  describe('getEntityCounts / getEntityCountsBatch (via route integration)', () => {
    it('getEntityCountsBatch is called with all folder IDs from memberships', async () => {
      selectQueue.push([{ count: 2 }]);
      selectQueue.push([
        {
          folderId: 'f1',
          role: 'owner',
          joinedAt: '2024-01-01T00:00:00Z',
          folderName: 'A',
          folderStatus: 'active',
          folderColor: null,
          folderIcon: null,
          folderDescription: null,
          folderClsLevel: null,
          folderPapLevel: null,
          folderTags: null,
          folderCreatedAt: '2024-01-01T00:00:00Z',
          folderUpdatedAt: '2024-01-01T00:00:00Z',
          memberCount: 1,
        },
        {
          folderId: 'f2',
          role: 'editor',
          joinedAt: '2024-01-01T00:00:00Z',
          folderName: 'B',
          folderStatus: 'active',
          folderColor: null,
          folderIcon: null,
          folderDescription: null,
          folderClsLevel: null,
          folderPapLevel: null,
          folderTags: null,
          folderCreatedAt: '2024-01-01T00:00:00Z',
          folderUpdatedAt: '2024-01-01T00:00:00Z',
          memberCount: 1,
        },
      ]);

      const countsMap = new Map();
      countsMap.set('f1', { notes: 1, tasks: 2, iocs: 0, events: 0, whiteboards: 0, chats: 0 });
      countsMap.set('f2', { notes: 0, tasks: 0, iocs: 3, events: 0, whiteboards: 0, chats: 0 });
      mockGetEntityCountsBatch.mockResolvedValue(countsMap);

      const res = await app.request(
        getReq('/api/investigations', 'valid-token'),
      );
      expect(res.status).toBe(200);

      expect(mockGetEntityCountsBatch).toHaveBeenCalledWith(['f1', 'f2']);

      const body = await res.json();
      expect(body.data[0].entityCounts.notes).toBe(1);
      expect(body.data[1].entityCounts.iocs).toBe(3);
    });

    it('returns zero counts for empty folders (no entities)', async () => {
      selectQueue.push([{ count: 1 }]);
      selectQueue.push([
        {
          folderId: 'empty-f',
          role: 'owner',
          joinedAt: '2024-01-01T00:00:00Z',
          folderName: 'Empty',
          folderStatus: 'active',
          folderColor: null,
          folderIcon: null,
          folderDescription: null,
          folderClsLevel: null,
          folderPapLevel: null,
          folderTags: null,
          folderCreatedAt: '2024-01-01T00:00:00Z',
          folderUpdatedAt: '2024-01-01T00:00:00Z',
          memberCount: 1,
        },
      ]);
      // Empty map means no counts for any folder
      mockGetEntityCountsBatch.mockResolvedValue(new Map());

      const res = await app.request(
        getReq('/api/investigations', 'valid-token'),
      );
      const body = await res.json();
      expect(body.data[0].entityCounts).toEqual({
        notes: 0,
        tasks: 0,
        iocs: 0,
        events: 0,
        whiteboards: 0,
        chats: 0,
        evidence: 0,
      });
    });

    it('getEntityCounts is called for summary endpoint with folderId', async () => {
      mockCheckAccess.mockResolvedValue(true);

      // Queue order: 6 last-activity first, then folder, then members
      selectQueue.push([{ latest: null }]);
      selectQueue.push([{ latest: null }]);
      selectQueue.push([{ latest: null }]);
      selectQueue.push([{ latest: null }]);
      selectQueue.push([{ latest: null }]);
      selectQueue.push([{ latest: null }]);
      selectQueue.push([{ latest: null }]);
      // Folder metadata
      selectQueue.push([
        {
          name: 'Test',
          status: 'active',
          color: null,
          icon: null,
          description: null,
          clsLevel: null,
          papLevel: null,
          tags: null,
          createdAt: '2024-01-01T00:00:00Z',
          updatedAt: '2024-01-01T00:00:00Z',
        },
      ]);
      // Members
      selectQueue.push([]);
      // Entity counts
      mockGetEntityCounts.mockResolvedValue({
        notes: 3,
        tasks: 1,
        iocs: 0,
        events: 2,
        whiteboards: 0,
        chats: 0,
      });

      const res = await app.request(
        getReq('/api/investigations/folder-abc/summary', 'valid-token'),
      );
      expect(res.status).toBe(200);
      expect(mockGetEntityCounts).toHaveBeenCalledWith('folder-abc');

      const body = await res.json();
      expect(body.entityCounts.notes).toBe(3);
      expect(body.entityCounts.events).toBe(2);
    });
  });
});
