import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Hono } from 'hono';

// ---------------------------------------------------------------------------
// Queue-based thenable chain helpers
// ---------------------------------------------------------------------------

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
  chain.then = (onFulfilled?: (v: unknown) => unknown, onRejected?: (e: unknown) => unknown) => {
    return resolve().then(onFulfilled, onRejected);
  };
  chain.catch = (onRejected?: (e: unknown) => unknown) => {
    return resolve().catch(onRejected);
  };
  return chain;
}

// ---------------------------------------------------------------------------
// Mock user
// ---------------------------------------------------------------------------

const mockUser = {
  id: 'user-1',
  email: 'test@example.com',
  displayName: 'Test User',
  role: 'member',
};

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

vi.mock('../db/index.js', () => ({
  db: {
    select: vi.fn(() => makeThenableChain(selectQueue)),
    insert: vi.fn(() => makeThenableChain(insertQueue)),
    delete: vi.fn(() => makeThenableChain(deleteQueue)),
  },
}));

vi.mock('../db/schema.js', () => {
  const col = (name: string) => ({ name });
  return {
    backups: {
      id: col('id'),
      userId: col('userId'),
      name: col('name'),
      type: col('type'),
      scope: col('scope'),
      scopeId: col('scopeId'),
      entityCount: col('entityCount'),
      sizeBytes: col('sizeBytes'),
      storagePath: col('storagePath'),
      parentBackupId: col('parentBackupId'),
      createdAt: col('createdAt'),
    },
  };
});

vi.mock('../middleware/auth.js', async () => {
  const { createMiddleware } = await import('hono/factory');
  return {
    requireAuth: createMiddleware(async (c, next) => {
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

const mockMkdir = vi.fn().mockResolvedValue(undefined);
const mockWriteFile = vi.fn().mockResolvedValue(undefined);
const mockReadFile = vi.fn().mockResolvedValue(Buffer.from('encrypted-data'));
const mockUnlink = vi.fn().mockResolvedValue(undefined);

vi.mock('node:fs/promises', () => ({
  default: {
    mkdir: (...args: unknown[]) => mockMkdir(...args),
    writeFile: (...args: unknown[]) => mockWriteFile(...args),
    readFile: (...args: unknown[]) => mockReadFile(...args),
    unlink: (...args: unknown[]) => mockUnlink(...args),
  },
  mkdir: (...args: unknown[]) => mockMkdir(...args),
  writeFile: (...args: unknown[]) => mockWriteFile(...args),
  readFile: (...args: unknown[]) => mockReadFile(...args),
  unlink: (...args: unknown[]) => mockUnlink(...args),
}));

vi.mock('nanoid', () => ({
  nanoid: vi.fn(() => 'test-nano-id'),
}));

vi.mock('../lib/logger.js', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

// ---------------------------------------------------------------------------
// Import route module AFTER mocks
// ---------------------------------------------------------------------------

import backupsApp from '../routes/backups.js';

// ---------------------------------------------------------------------------
// App setup
// ---------------------------------------------------------------------------

let app: Hono;

function buildApp() {
  const a = new Hono();
  a.route('/api/backups', backupsApp);
  return a;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function authHeader(token = 'valid-token') {
  return { Authorization: `Bearer ${token}` };
}

function makeUploadFormData(
  metadata: Record<string, unknown> = {
    name: 'Test Backup',
    type: 'full',
    scope: 'all',
    entityCount: 10,
  },
  includeBlob = true,
  metadataRaw?: string,
) {
  const formData = new FormData();
  formData.append('metadata', metadataRaw ?? JSON.stringify(metadata));
  if (includeBlob) {
    formData.append('blob', new Blob(['encrypted-data']), 'backup.enc');
  }
  return formData;
}

// Generate an array of N backup stubs for the count-limit check
function backupIdStubs(n: number) {
  return Array.from({ length: n }, (_, i) => ({ id: `b-${i}` }));
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

beforeEach(() => {
  vi.clearAllMocks();
  selectQueue.length = 0;
  insertQueue.length = 0;
  deleteQueue.length = 0;
  mockMkdir.mockResolvedValue(undefined);
  mockWriteFile.mockResolvedValue(undefined);
  mockReadFile.mockResolvedValue(Buffer.from('encrypted-data'));
  mockUnlink.mockResolvedValue(undefined);
  app = buildApp();
});

describe('Backup routes — /api/backups', () => {
  // ----------------------------------------------------------------
  //  Auth required on all endpoints
  // ----------------------------------------------------------------

  describe('Auth required', () => {
    it('POST / returns 401 without auth header', async () => {
      const res = await app.request('/api/backups', { method: 'POST' });
      expect(res.status).toBe(401);
    });

    it('GET / returns 401 without auth header', async () => {
      const res = await app.request('/api/backups');
      expect(res.status).toBe(401);
    });

    it('GET /:id returns 401 without auth header', async () => {
      const res = await app.request('/api/backups/some-id');
      expect(res.status).toBe(401);
    });

    it('DELETE /:id returns 401 without auth header', async () => {
      const res = await app.request('/api/backups/some-id', { method: 'DELETE' });
      expect(res.status).toBe(401);
    });

    it('POST / returns 401 with invalid token', async () => {
      const formData = makeUploadFormData();
      const res = await app.request('/api/backups', {
        method: 'POST',
        headers: authHeader('invalid'),
        body: formData,
      });
      expect(res.status).toBe(401);
    });
  });

  // ----------------------------------------------------------------
  //  POST / — Upload backup
  // ----------------------------------------------------------------

  describe('POST / — Upload backup', () => {
    it('succeeds with valid metadata and blob, returns 201', async () => {
      // existing backups count check — returns under the limit
      selectQueue.push(backupIdStubs(3));
      // insert returns void (no .returning() in the route)
      insertQueue.push([]);

      const formData = makeUploadFormData();
      const res = await app.request('/api/backups', {
        method: 'POST',
        headers: authHeader(),
        body: formData,
      });

      expect(res.status).toBe(201);
      const body = await res.json();
      expect(body.id).toBe('test-nano-id');
      expect(body.name).toBe('Test Backup');
      expect(body.type).toBe('full');
      expect(body.scope).toBe('all');
      expect(body.entityCount).toBe(10);
      expect(body.sizeBytes).toBeGreaterThan(0);
      expect(mockMkdir).toHaveBeenCalled();
      expect(mockWriteFile).toHaveBeenCalled();
    });

    it('rejects when metadata field is missing', async () => {
      const formData = new FormData();
      formData.append('blob', new Blob(['encrypted-data']), 'backup.enc');

      const res = await app.request('/api/backups', {
        method: 'POST',
        headers: authHeader(),
        body: formData,
      });

      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error).toMatch(/metadata/i);
    });

    it('rejects when metadata is invalid JSON', async () => {
      // existing backups check (route checks limit first)
      selectQueue.push([]);

      const formData = makeUploadFormData({}, true, '{not-valid-json!!!');

      const res = await app.request('/api/backups', {
        method: 'POST',
        headers: authHeader(),
        body: formData,
      });

      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error).toMatch(/json/i);
    });

    it('rejects when blob file is missing', async () => {
      // existing backups check
      selectQueue.push([]);

      const formData = makeUploadFormData(
        { name: 'Test Backup', type: 'full', scope: 'all', entityCount: 10 },
        false,
      );

      const res = await app.request('/api/backups', {
        method: 'POST',
        headers: authHeader(),
        body: formData,
      });

      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error).toMatch(/blob/i);
    });

    it('rejects when name is missing from metadata', async () => {
      // existing backups check
      selectQueue.push([]);

      const formData = makeUploadFormData({ type: 'full', scope: 'all', entityCount: 5 });

      const res = await app.request('/api/backups', {
        method: 'POST',
        headers: authHeader(),
        body: formData,
      });

      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error).toMatch(/name/i);
    });

    it('rejects when name is an empty string', async () => {
      selectQueue.push([]);

      const formData = makeUploadFormData({ name: '', type: 'full', scope: 'all', entityCount: 5 });

      const res = await app.request('/api/backups', {
        method: 'POST',
        headers: authHeader(),
        body: formData,
      });

      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error).toMatch(/name/i);
    });

    it('rejects when user has reached max 50 backups', async () => {
      // existing backups check returns 50 items
      selectQueue.push(backupIdStubs(50));

      const formData = makeUploadFormData();

      const res = await app.request('/api/backups', {
        method: 'POST',
        headers: authHeader(),
        body: formData,
      });

      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error).toMatch(/50/);
    });

    it('truncates name to 200 characters silently', async () => {
      selectQueue.push([]);
      insertQueue.push([]);

      const longName = 'x'.repeat(250);
      const formData = makeUploadFormData({
        name: longName,
        type: 'full',
        scope: 'all',
        entityCount: 1,
      });

      const res = await app.request('/api/backups', {
        method: 'POST',
        headers: authHeader(),
        body: formData,
      });

      expect(res.status).toBe(201);
      const body = await res.json();
      expect(body.name).toHaveLength(200);
    });

    it('includes optional fields like scopeId and parentBackupId', async () => {
      selectQueue.push([]);
      insertQueue.push([]);

      const formData = makeUploadFormData({
        name: 'Investigation Backup',
        type: 'differential',
        scope: 'investigation',
        scopeId: 'inv-123',
        parentBackupId: 'parent-1',
        entityCount: 3,
      });

      const res = await app.request('/api/backups', {
        method: 'POST',
        headers: authHeader(),
        body: formData,
      });

      expect(res.status).toBe(201);
      const body = await res.json();
      expect(body.type).toBe('differential');
      expect(body.scope).toBe('investigation');
      expect(body.scopeId).toBe('inv-123');
      expect(body.parentBackupId).toBe('parent-1');
      expect(mockWriteFile).toHaveBeenCalled();
    });
  });

  // ----------------------------------------------------------------
  //  GET / — List backups
  // ----------------------------------------------------------------

  describe('GET / — List backups', () => {
    it('returns user backups ordered by createdAt desc', async () => {
      const backupList = [
        {
          id: 'backup-2',
          name: 'Backup 2',
          type: 'full',
          scope: 'all',
          entityCount: 20,
          sizeBytes: 200,
          parentBackupId: null,
          createdAt: '2026-03-07T12:00:00Z',
        },
        {
          id: 'backup-1',
          name: 'Backup 1',
          type: 'full',
          scope: 'all',
          entityCount: 10,
          sizeBytes: 100,
          parentBackupId: null,
          createdAt: '2026-03-06T12:00:00Z',
        },
      ];
      selectQueue.push(backupList);

      const res = await app.request('/api/backups', {
        headers: authHeader(),
      });

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.backups).toHaveLength(2);
      expect(body.backups[0].id).toBe('backup-2');
      expect(body.backups[1].id).toBe('backup-1');
    });

    it('returns empty array when user has no backups', async () => {
      selectQueue.push([]);

      const res = await app.request('/api/backups', {
        headers: authHeader(),
      });

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.backups).toHaveLength(0);
    });
  });

  // ----------------------------------------------------------------
  //  GET /:id — Download backup
  // ----------------------------------------------------------------

  describe('GET /:id — Download backup', () => {
    it('returns the encrypted blob with correct headers', async () => {
      const backup = {
        id: 'backup-1',
        userId: mockUser.id,
        name: 'Test Backup',
        storagePath: 'backups/backup-1.enc',
        sizeBytes: 14,
        createdAt: '2026-03-07T12:00:00Z',
      };
      selectQueue.push([backup]);
      mockReadFile.mockResolvedValue(Buffer.from('encrypted-data'));

      const res = await app.request('/api/backups/backup-1', {
        headers: authHeader(),
      });

      expect(res.status).toBe(200);
      const contentType = res.headers.get('content-type');
      expect(contentType).toMatch(/octet-stream/);
      const disposition = res.headers.get('content-disposition');
      expect(disposition).toContain('backup-1.enc');
      expect(mockReadFile).toHaveBeenCalled();

      const arrayBuf = await res.arrayBuffer();
      expect(Buffer.from(arrayBuf).toString()).toBe('encrypted-data');
    });

    it('returns 404 when backup does not exist', async () => {
      selectQueue.push([]);

      const res = await app.request('/api/backups/nonexistent', {
        headers: authHeader(),
      });

      expect(res.status).toBe(404);
    });

    it('returns 404 when backup file is missing on disk', async () => {
      const backup = {
        id: 'backup-1',
        userId: mockUser.id,
        name: 'Test Backup',
        storagePath: 'backups/backup-1.enc',
        sizeBytes: 14,
        createdAt: '2026-03-07T12:00:00Z',
      };
      selectQueue.push([backup]);
      mockReadFile.mockRejectedValue(new Error('ENOENT: no such file'));

      const res = await app.request('/api/backups/backup-1', {
        headers: authHeader(),
      });

      expect(res.status).toBe(404);
      const body = await res.json();
      expect(body.error).toMatch(/not found/i);
    });
  });

  // ----------------------------------------------------------------
  //  DELETE /:id — Delete backup
  // ----------------------------------------------------------------

  describe('DELETE /:id — Delete backup', () => {
    it('deletes backup record and disk file successfully', async () => {
      const backup = {
        id: 'backup-1',
        userId: mockUser.id,
        name: 'Test Backup',
        storagePath: 'backups/backup-1.enc',
        createdAt: '2026-03-07T12:00:00Z',
      };
      selectQueue.push([backup]);
      deleteQueue.push([]);

      const res = await app.request('/api/backups/backup-1', {
        method: 'DELETE',
        headers: authHeader(),
      });

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.ok).toBe(true);
      expect(mockUnlink).toHaveBeenCalled();
    });

    it('returns 404 when backup does not exist', async () => {
      selectQueue.push([]);

      const res = await app.request('/api/backups/nonexistent', {
        method: 'DELETE',
        headers: authHeader(),
      });

      expect(res.status).toBe(404);
    });

    it('handles missing disk file gracefully (still deletes DB record)', async () => {
      const backup = {
        id: 'backup-1',
        userId: mockUser.id,
        name: 'Test Backup',
        storagePath: 'backups/backup-1.enc',
        createdAt: '2026-03-07T12:00:00Z',
      };
      selectQueue.push([backup]);
      deleteQueue.push([]);

      // Simulate file not found on disk
      const enoent = new Error('ENOENT: no such file or directory');
      (enoent as NodeJS.ErrnoException).code = 'ENOENT';
      mockUnlink.mockRejectedValue(enoent);

      const res = await app.request('/api/backups/backup-1', {
        method: 'DELETE',
        headers: authHeader(),
      });

      // Should still succeed — missing file is not a hard error
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.ok).toBe(true);
      expect(mockUnlink).toHaveBeenCalled();
    });
  });
});
