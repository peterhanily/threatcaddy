import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Hono } from 'hono';

// ─── Mock modules ──────────────────────────────────────────────

const mockDbSelect = vi.fn();
const mockDbInsert = vi.fn();
const mockDbUpdate = vi.fn();
const mockDbDelete = vi.fn();

const mockFrom = vi.fn();
const mockWhere = vi.fn();
const mockLimit = vi.fn();
const mockValues = vi.fn();


function chainSelect() {
  mockDbSelect.mockReturnValue({ from: mockFrom });
  mockFrom.mockReturnValue({ where: mockWhere, leftJoin: vi.fn().mockReturnValue({ where: mockWhere }) });
  mockWhere.mockReturnValue({ limit: mockLimit, orderBy: vi.fn().mockReturnValue({ limit: mockLimit }) });
  mockLimit.mockReturnValue([]);
}

function chainInsert() {
  mockDbInsert.mockReturnValue({ values: mockValues });
  mockValues.mockResolvedValue(undefined);
}

vi.mock('../db/index.js', () => ({
  db: {
    select: (...args: unknown[]) => mockDbSelect(...args),
    insert: (...args: unknown[]) => mockDbInsert(...args),
    update: (...args: unknown[]) => mockDbUpdate(...args),
    delete: (...args: unknown[]) => mockDbDelete(...args),
  },
}));

vi.mock('../db/schema.js', () => ({
  files: {
    id: 'id', uploadedBy: 'uploaded_by', filename: 'filename',
    mimeType: 'mime_type', sizeBytes: 'size_bytes', storagePath: 'storage_path',
    thumbnailPath: 'thumbnail_path', folderId: 'folder_id', createdAt: 'created_at',
  },
  users: {
    id: 'id', email: 'email', displayName: 'display_name', avatarUrl: 'avatar_url',
    role: 'role', active: 'active',
  },
}));

const mockCheckAccess = vi.fn();
vi.mock('../middleware/access.js', () => ({
  checkInvestigationAccess: (...args: unknown[]) => mockCheckAccess(...args),
}));

vi.mock('../lib/logger.js', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

const mockWriteFile = vi.fn().mockResolvedValue(undefined);
const mockReadFile = vi.fn();
const mockStat = vi.fn();
const mockMkdir = vi.fn().mockResolvedValue(undefined);
const mockRealpath = vi.fn().mockImplementation((p: string) => Promise.resolve(p));

vi.mock('node:fs/promises', () => ({
  writeFile: (...args: unknown[]) => mockWriteFile(...args),
  readFile: (...args: unknown[]) => mockReadFile(...args),
  stat: (...args: unknown[]) => mockStat(...args),
  mkdir: (...args: unknown[]) => mockMkdir(...args),
  realpath: (...args: unknown[]) => mockRealpath(...args),
}));

// Mock createReadStream and Readable.toWeb for streaming file downloads
vi.mock('node:fs', () => ({
  createReadStream: vi.fn(() => 'mock-stream'),
}));
vi.mock('node:stream', () => ({
  Readable: {
    toWeb: vi.fn(() => new ReadableStream({ start(c) { c.close(); } })),
  },
}));

vi.mock('sharp', () => ({
  default: vi.fn(() => ({
    resize: vi.fn().mockReturnThis(),
    webp: vi.fn().mockReturnThis(),
    toFile: vi.fn().mockResolvedValue(undefined),
  })),
}));

// ─── Mock auth middleware — simulate authenticated user ────────

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
      const role = header === 'Bearer viewer-token' ? 'viewer' : 'analyst';
      c.set('user', { ...mockUser, role });
      await next();
    }),
    requireRole: (...roles: string[]) => {
      return createMiddleware(async (c: { get: (k: string) => unknown; json: (body: unknown, status: number) => Response }, next: () => Promise<void>) => {
        const user = c.get('user') as typeof mockUser;
        if (!roles.includes(user.role)) {
          return c.json({ error: 'Insufficient permissions' }, 403);
        }
        await next();
      });
    },
  };
});

// ─── Import under test ─────────────────────────────────────────

import filesApp from '../routes/files.js';

// ─── Helpers ────────────────────────────────────────────────────

function buildApp() {
  const app = new Hono();
  app.route('/api/files', filesApp);
  return app;
}

function authHeader(token = 'valid-token'): Record<string, string> {
  return { Authorization: `Bearer ${token}` };
}

// ─── Tests ──────────────────────────────────────────────────────

let app: Hono;

beforeEach(() => {
  vi.clearAllMocks();
  mockRealpath.mockImplementation((p: string) => Promise.resolve(p));
  app = buildApp();
  chainSelect();
  chainInsert();
});

// ═══════════════════════════════════════════════════════════════
// 1. Auth required
// ═══════════════════════════════════════════════════════════════

describe('Auth requirements', () => {
  it('GET /api/files/:id returns 401 without auth', async () => {
    const res = await app.request('/api/files/some-id');
    expect(res.status).toBe(401);
  });

  it('POST /api/files/upload returns 401 without auth', async () => {
    const res = await app.request('/api/files/upload', { method: 'POST' });
    expect(res.status).toBe(401);
  });

  it('GET /api/files/:id/thumbnail returns 401 without auth', async () => {
    const res = await app.request('/api/files/some-id/thumbnail');
    expect(res.status).toBe(401);
  });

  it('returns 401 for invalid token on file download', async () => {
    const res = await app.request('/api/files/some-id', {
      headers: authHeader('invalid'),
    });
    expect(res.status).toBe(401);
  });
});

// ═══════════════════════════════════════════════════════════════
// 2. File upload (POST /api/files/upload)
// ═══════════════════════════════════════════════════════════════

describe('POST /api/files/upload', () => {
  it('returns 400 when no file is provided', async () => {
    const formData = new FormData();
    const res = await app.request('/api/files/upload', {
      method: 'POST',
      headers: authHeader(),
      body: formData,
    });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/no file/i);
  });

  it('returns 400 when file extension is not allowed', async () => {
    const formData = new FormData();
    const blob = new Blob(['test content'], { type: 'application/x-executable' });
    formData.append('file', blob, 'malware.exe');

    const res = await app.request('/api/files/upload', {
      method: 'POST',
      headers: authHeader(),
      body: formData,
    });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/not allowed/i);
  });

  it('returns 413 when file exceeds 50MB', async () => {
    const formData = new FormData();
    // Create a File object that reports a large size
    const largeContent = new Uint8Array(51 * 1024 * 1024);
    const blob = new File([largeContent], 'huge.pdf', { type: 'application/pdf' });
    formData.append('file', blob);

    const res = await app.request('/api/files/upload', {
      method: 'POST',
      headers: authHeader(),
      body: formData,
    });
    expect(res.status).toBe(413);
    const body = await res.json();
    expect(body.error).toMatch(/too large/i);
  });

  it('returns 400 when SVG magic bytes are detected (XSS prevention)', async () => {
    const formData = new FormData();
    const svgContent = '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>';
    // Pad to at least 12 bytes
    const padded = svgContent.padEnd(512, ' ');
    const blob = new File([padded], 'image.png', { type: 'image/png' });
    formData.append('file', blob);

    const res = await app.request('/api/files/upload', {
      method: 'POST',
      headers: authHeader(),
      body: formData,
    });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/SVG/i);
  });

  it('successfully uploads a valid PNG file and returns 201', async () => {
    const formData = new FormData();
    // PNG magic bytes: 89 50 4E 47
    const pngHeader = new Uint8Array([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A, 0x00, 0x00, 0x00, 0x0D]);
    const blob = new File([pngHeader], 'test.png', { type: 'image/png' });
    formData.append('file', blob);

    const res = await app.request('/api/files/upload', {
      method: 'POST',
      headers: authHeader(),
      body: formData,
    });
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.id).toBeDefined();
    expect(body.url).toMatch(/^\/api\/files\//);
    expect(body.mimeType).toBe('image/png');
    expect(body.filename).toBe('test.png');
  });

  it('uploads a text file without image magic byte validation', async () => {
    const formData = new FormData();
    const blob = new File(['Some text content here.'], 'notes.txt', { type: 'text/plain' });
    formData.append('file', blob);

    const res = await app.request('/api/files/upload', {
      method: 'POST',
      headers: authHeader(),
      body: formData,
    });
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.filename).toBe('notes.txt');
    expect(body.thumbnailUrl).toBeNull();
  });

  it('accepts folderId to scope file to an investigation', async () => {
    mockCheckAccess.mockResolvedValue(true);
    const formData = new FormData();
    const blob = new File(['content'], 'doc.pdf', { type: 'application/pdf' });
    formData.append('file', blob);
    formData.append('folderId', 'folder-123');

    const res = await app.request('/api/files/upload', {
      method: 'POST',
      headers: authHeader(),
      body: formData,
    });
    expect(res.status).toBe(201);
    expect(mockValues).toHaveBeenCalled();
  });

  it('returns 403 when viewer tries to upload (insufficient role)', async () => {
    const formData = new FormData();
    const blob = new File(['content'], 'doc.txt', { type: 'text/plain' });
    formData.append('file', blob);

    const res = await app.request('/api/files/upload', {
      method: 'POST',
      headers: authHeader('viewer-token'),
      body: formData,
    });
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error).toMatch(/insufficient/i);
  });

  it('rejects file claiming to be image but with mismatched magic bytes', async () => {
    const formData = new FormData();
    // PDF magic bytes but claiming image/jpeg
    const pdfHeader = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2D, 0x31, 0x2E, 0x34, 0x0A, 0x00, 0x00, 0x00]);
    const blob = new File([pdfHeader], 'fake.jpg', { type: 'image/jpeg' });
    formData.append('file', blob);

    const res = await app.request('/api/files/upload', {
      method: 'POST',
      headers: authHeader(),
      body: formData,
    });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/does not match/i);
  });
});

// ═══════════════════════════════════════════════════════════════
// 3. File download (GET /api/files/:id)
// ═══════════════════════════════════════════════════════════════

describe('GET /api/files/:id', () => {
  it('returns 404 when file does not exist in database', async () => {
    mockLimit.mockResolvedValueOnce([]);

    const res = await app.request('/api/files/nonexistent', {
      headers: authHeader(),
    });
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.error).toMatch(/not found/i);
  });

  it('returns 403 when user does not own unscoped file', async () => {
    mockLimit.mockResolvedValueOnce([{
      id: 'file-1', uploadedBy: 'other-user', filename: 'secret.pdf',
      mimeType: 'application/pdf', storagePath: 'file-1.pdf',
      folderId: null, thumbnailPath: null,
    }]);

    const res = await app.request('/api/files/file-1', {
      headers: authHeader(),
    });
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error).toMatch(/no access/i);
  });

  it('returns 403 when user has no investigation access to folder-scoped file', async () => {
    mockLimit.mockResolvedValueOnce([{
      id: 'file-2', uploadedBy: 'other-user', filename: 'evidence.pdf',
      mimeType: 'application/pdf', storagePath: 'file-2.pdf',
      folderId: 'folder-1', thumbnailPath: null,
    }]);
    mockCheckAccess.mockResolvedValueOnce(false);

    const res = await app.request('/api/files/file-2', {
      headers: authHeader(),
    });
    expect(res.status).toBe(403);
  });

  it('serves file with Content-Disposition: inline for safe MIME types (images)', async () => {
    mockLimit.mockResolvedValueOnce([{
      id: 'file-3', uploadedBy: 'user-1', filename: 'photo.png',
      mimeType: 'image/png', storagePath: 'file-3.png',
      folderId: null, thumbnailPath: null,
    }]);
    const fileData = Buffer.from('fake png data');
    mockReadFile.mockResolvedValueOnce(fileData);
    mockStat.mockResolvedValueOnce({ size: fileData.length });

    const res = await app.request('/api/files/file-3', {
      headers: authHeader(),
    });
    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Disposition')).toContain('inline');
    expect(res.headers.get('Content-Type')).toBe('image/png');
    expect(res.headers.get('X-Content-Type-Options')).toBe('nosniff');
  });

  it('serves file with Content-Disposition: attachment for non-safe MIME types', async () => {
    mockLimit.mockResolvedValueOnce([{
      id: 'file-4', uploadedBy: 'user-1', filename: 'data.zip',
      mimeType: 'application/zip', storagePath: 'file-4.zip',
      folderId: null, thumbnailPath: null,
    }]);
    const fileData = Buffer.from('fake zip data');
    mockReadFile.mockResolvedValueOnce(fileData);
    mockStat.mockResolvedValueOnce({ size: fileData.length });

    const res = await app.request('/api/files/file-4', {
      headers: authHeader(),
    });
    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Disposition')).toContain('attachment');
  });

  it('returns 404 when file exists in DB but not on disk', async () => {
    mockLimit.mockResolvedValueOnce([{
      id: 'file-5', uploadedBy: 'user-1', filename: 'missing.pdf',
      mimeType: 'application/pdf', storagePath: 'file-5.pdf',
      folderId: null, thumbnailPath: null,
    }]);
    mockStat.mockRejectedValueOnce(new Error('ENOENT'));

    const res = await app.request('/api/files/file-5', {
      headers: authHeader(),
    });
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.error).toMatch(/not found on disk/i);
  });

  it('allows access to folder-scoped file when user has investigation access', async () => {
    mockLimit.mockResolvedValueOnce([{
      id: 'file-6', uploadedBy: 'other-user', filename: 'shared.pdf',
      mimeType: 'application/pdf', storagePath: 'file-6.pdf',
      folderId: 'folder-abc', thumbnailPath: null,
    }]);
    mockCheckAccess.mockResolvedValueOnce(true);
    const fileData = Buffer.from('shared file data');
    mockReadFile.mockResolvedValueOnce(fileData);
    mockStat.mockResolvedValueOnce({ size: fileData.length });

    const res = await app.request('/api/files/file-6', {
      headers: authHeader(),
    });
    expect(res.status).toBe(200);
    expect(mockCheckAccess).toHaveBeenCalledWith('user-1', 'folder-abc', 'viewer');
  });

  it('sanitizes filenames in Content-Disposition header', async () => {
    mockLimit.mockResolvedValueOnce([{
      id: 'file-7', uploadedBy: 'user-1', filename: 'file"with\nnewlines.pdf',
      mimeType: 'application/pdf', storagePath: 'file-7.pdf',
      folderId: null, thumbnailPath: null,
    }]);
    const fileData = Buffer.from('pdf content');
    mockReadFile.mockResolvedValueOnce(fileData);
    mockStat.mockResolvedValueOnce({ size: fileData.length });

    const res = await app.request('/api/files/file-7', {
      headers: authHeader(),
    });
    expect(res.status).toBe(200);
    const disposition = res.headers.get('Content-Disposition')!;
    expect(disposition).not.toContain('"with');
    expect(disposition).not.toContain('\n');
  });
});

// ═══════════════════════════════════════════════════════════════
// 4. Thumbnail (GET /api/files/:id/thumbnail)
// ═══════════════════════════════════════════════════════════════

describe('GET /api/files/:id/thumbnail', () => {
  it('returns 404 when file has no thumbnail', async () => {
    mockLimit.mockResolvedValueOnce([{
      id: 'file-8', uploadedBy: 'user-1', filename: 'doc.pdf',
      mimeType: 'application/pdf', storagePath: 'file-8.pdf',
      thumbnailPath: null, folderId: null,
    }]);

    const res = await app.request('/api/files/file-8/thumbnail', {
      headers: authHeader(),
    });
    expect(res.status).toBe(404);
  });

  it('returns 404 when file does not exist', async () => {
    mockLimit.mockResolvedValueOnce([]);

    const res = await app.request('/api/files/nonexistent/thumbnail', {
      headers: authHeader(),
    });
    expect(res.status).toBe(404);
  });

  it('serves thumbnail with image/webp content type', async () => {
    mockLimit.mockResolvedValueOnce([{
      id: 'file-9', uploadedBy: 'user-1', filename: 'photo.jpg',
      mimeType: 'image/jpeg', storagePath: 'file-9.jpg',
      thumbnailPath: 'file-9_thumb.webp', folderId: null,
    }]);
    const thumbData = Buffer.from('webp thumbnail data');
    mockReadFile.mockResolvedValueOnce(thumbData);

    const res = await app.request('/api/files/file-9/thumbnail', {
      headers: authHeader(),
    });
    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toBe('image/webp');
  });

  it('returns 403 for folder-scoped thumbnail without access', async () => {
    mockLimit.mockResolvedValueOnce([{
      id: 'file-10', uploadedBy: 'other-user', filename: 'img.png',
      mimeType: 'image/png', storagePath: 'file-10.png',
      thumbnailPath: 'file-10_thumb.webp', folderId: 'folder-x',
    }]);
    mockCheckAccess.mockResolvedValueOnce(false);

    const res = await app.request('/api/files/file-10/thumbnail', {
      headers: authHeader(),
    });
    expect(res.status).toBe(403);
  });

  it('returns 404 when thumbnail file is missing on disk', async () => {
    mockLimit.mockResolvedValueOnce([{
      id: 'file-11', uploadedBy: 'user-1', filename: 'img.png',
      mimeType: 'image/png', storagePath: 'file-11.png',
      thumbnailPath: 'file-11_thumb.webp', folderId: null,
    }]);
    mockStat.mockRejectedValueOnce(new Error('ENOENT'));

    const res = await app.request('/api/files/file-11/thumbnail', {
      headers: authHeader(),
    });
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.error).toMatch(/not found on disk/i);
  });
});
