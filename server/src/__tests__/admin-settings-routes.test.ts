import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Hono } from 'hono';

// ─── Hoisted mock state ────────────────────────────────────────

const {
  selectQueue, insertQueue, deleteQueue,
  makeThenableChain,
  mockLogAdminAction, mockGetAdminId,
  mockGetRegistrationMode, mockSetRegistrationMode,
  mockGetSessionSettings, mockSetSessionSettings,
  mockGetServerName, mockSetServerName,
  mockGetRetentionSettings, mockSetRetentionSettings,
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

  const mockGetRegistrationMode = vi.fn().mockResolvedValue('invite');
  const mockSetRegistrationMode = vi.fn().mockResolvedValue(undefined);
  const mockGetSessionSettings = vi.fn().mockResolvedValue({ ttlHours: 24, maxPerUser: 5 });
  const mockSetSessionSettings = vi.fn().mockResolvedValue(undefined);
  const mockGetServerName = vi.fn().mockResolvedValue('ThreatCaddy');
  const mockSetServerName = vi.fn().mockResolvedValue(undefined);
  const mockGetRetentionSettings = vi.fn().mockResolvedValue({ notificationRetentionDays: 90, auditLogRetentionDays: 365 });
  const mockSetRetentionSettings = vi.fn().mockResolvedValue(undefined);

  return {
    selectQueue, insertQueue, deleteQueue,
    makeThenableChain,
    mockLogAdminAction, mockGetAdminId,
    mockGetRegistrationMode, mockSetRegistrationMode,
    mockGetSessionSettings, mockSetSessionSettings,
    mockGetServerName, mockSetServerName,
    mockGetRetentionSettings, mockSetRetentionSettings,
  };
});

// ─── Mock the shared module ────────────────────────────────────

vi.mock('../routes/admin/shared.js', async () => {
  const { initAdminKey: _initAdminKey, requireAdminAuth: _requireAdminAuth } = await import('../middleware/admin-auth.js');
  _initAdminKey();

  return {
    db: {
      select: (...args: any[]) => makeThenableChain(selectQueue),
      insert: () => makeThenableChain(insertQueue),
      update: () => makeThenableChain([]),
      delete: () => makeThenableChain(deleteQueue),
    },
    users: {
      id: 'id', email: 'email', displayName: 'display_name', active: 'active',
    },
    folders: { id: 'id', name: 'name' },
    sessions: { id: 'id', expiresAt: 'expires_at' },
    activityLog: {
      id: 'id', userId: 'user_id', category: 'category', action: 'action',
      detail: 'detail', timestamp: 'timestamp',
    },
    allowedEmails: {
      id: 'id', email: 'email', createdAt: 'created_at',
    },
    requireAdminAuth: _requireAdminAuth,
    logAdminAction: mockLogAdminAction,
    getAdminId: mockGetAdminId,
    logger: { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} },
  };
});

vi.mock('../services/admin-secret.js', () => ({
  getRegistrationMode: mockGetRegistrationMode,
  setRegistrationMode: mockSetRegistrationMode,
  getSessionSettings: mockGetSessionSettings,
  setSessionSettings: mockSetSessionSettings,
  getServerName: mockGetServerName,
  setServerName: mockSetServerName,
  ADMIN_SYSTEM_USER_ID: '__system_admin__',
}));

vi.mock('../services/cleanup-service.js', () => ({
  getRetentionSettings: mockGetRetentionSettings,
  setRetentionSettings: mockSetRetentionSettings,
}));

vi.mock('../services/audit-service.js', () => ({
  logActivity: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../lib/logger.js', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

// ─── Import under test ─────────────────────────────────────────

import settingsApp from '../routes/admin/settings.js';
import { signAdminToken } from '../middleware/admin-auth.js';

// ─── Helpers ───────────────────────────────────────────────────

function buildApp() {
  const app = new Hono();
  app.route('/admin', settingsApp);
  return app;
}

function authHeader(token: string): Record<string, string> {
  return { Authorization: `Bearer ${token}` };
}

async function getAdminToken(id = 'admin-1', username = 'testadmin'): Promise<string> {
  return signAdminToken(id, username);
}

// ─── Tests ─────────────────────────────────────────────────────

let app: Hono;

beforeEach(() => {
  vi.clearAllMocks();
  selectQueue.length = 0;
  insertQueue.length = 0;
  deleteQueue.length = 0;
  app = buildApp();

  // Reset default return values
  mockGetRegistrationMode.mockResolvedValue('invite');
  mockSetRegistrationMode.mockResolvedValue(undefined);
  mockGetSessionSettings.mockResolvedValue({ ttlHours: 24, maxPerUser: 5 });
  mockSetSessionSettings.mockResolvedValue(undefined);
  mockGetServerName.mockResolvedValue('ThreatCaddy');
  mockSetServerName.mockResolvedValue(undefined);
  mockGetRetentionSettings.mockResolvedValue({ notificationRetentionDays: 90, auditLogRetentionDays: 365 });
  mockSetRetentionSettings.mockResolvedValue(undefined);
});

// ═══════════════════════════════════════════════════════════════
// 1. Admin auth required
// ═══════════════════════════════════════════════════════════════

describe('Admin auth requirements', () => {
  it('GET /admin/api/stats returns 401 without auth', async () => {
    const res = await app.request('/admin/api/stats');
    expect(res.status).toBe(401);
  });

  it('GET /admin/api/settings returns 401 without auth', async () => {
    const res = await app.request('/admin/api/settings');
    expect(res.status).toBe(401);
  });

  it('PATCH /admin/api/settings returns 401 without auth', async () => {
    const res = await app.request('/admin/api/settings', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ serverName: 'New Name' }),
    });
    expect(res.status).toBe(401);
  });

  it('GET /admin/api/allowed-emails returns 401 without auth', async () => {
    const res = await app.request('/admin/api/allowed-emails');
    expect(res.status).toBe(401);
  });

  it('POST /admin/api/allowed-emails returns 401 without auth', async () => {
    const res = await app.request('/admin/api/allowed-emails', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'test@example.com' }),
    });
    expect(res.status).toBe(401);
  });

  it('DELETE /admin/api/allowed-emails/:email returns 401 without auth', async () => {
    const res = await app.request('/admin/api/allowed-emails/test@example.com', {
      method: 'DELETE',
    });
    expect(res.status).toBe(401);
  });
});

// ═══════════════════════════════════════════════════════════════
// 2. GET /api/stats
// ═══════════════════════════════════════════════════════════════

describe('GET /admin/api/stats', () => {
  it('returns dashboard statistics', async () => {
    const token = await getAdminToken();
    // 5 select queries: totalUsers, activeUsers, investigations, activeSessions, auditLog24h
    selectQueue.push([{ count: 10 }]);
    selectQueue.push([{ count: 8 }]);
    selectQueue.push([{ count: 5 }]);
    selectQueue.push([{ count: 3 }]);
    selectQueue.push([{ count: 42 }]);

    const res = await app.request('/admin/api/stats', {
      headers: authHeader(token),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.totalUsers).toBe(10);
    expect(body.activeUsers).toBe(8);
    expect(body.investigations).toBe(5);
    expect(body.activeSessions).toBe(3);
    expect(body.auditLogEntries24h).toBe(42);
  });
});

// ═══════════════════════════════════════════════════════════════
// 3. GET /api/settings
// ═══════════════════════════════════════════════════════════════

describe('GET /admin/api/settings', () => {
  it('returns all settings', async () => {
    const token = await getAdminToken();
    const res = await app.request('/admin/api/settings', {
      headers: authHeader(token),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.serverName).toBe('ThreatCaddy');
    expect(body.registrationMode).toBe('invite');
    expect(body.ttlHours).toBe(24);
    expect(body.maxPerUser).toBe(5);
    expect(body.notificationRetentionDays).toBe(90);
    expect(body.auditLogRetentionDays).toBe(365);
    expect(mockGetRegistrationMode).toHaveBeenCalled();
    expect(mockGetServerName).toHaveBeenCalled();
    expect(mockGetSessionSettings).toHaveBeenCalled();
    expect(mockGetRetentionSettings).toHaveBeenCalled();
  });
});

// ═══════════════════════════════════════════════════════════════
// 4. PATCH /api/settings
// ═══════════════════════════════════════════════════════════════

describe('PATCH /admin/api/settings', () => {
  it('updates server name', async () => {
    const token = await getAdminToken();
    const res = await app.request('/admin/api/settings', {
      method: 'PATCH',
      headers: { ...authHeader(token), 'Content-Type': 'application/json' },
      body: JSON.stringify({ serverName: 'My Server' }),
    });
    expect(res.status).toBe(200);
    expect(mockSetServerName).toHaveBeenCalledWith('My Server');
  });

  it('rejects server name longer than 100 characters', async () => {
    const token = await getAdminToken();
    const res = await app.request('/admin/api/settings', {
      method: 'PATCH',
      headers: { ...authHeader(token), 'Content-Type': 'application/json' },
      body: JSON.stringify({ serverName: 'a'.repeat(101) }),
    });
    expect(res.status).toBe(400);
    expect(mockSetServerName).not.toHaveBeenCalled();
  });

  it('rejects empty server name', async () => {
    const token = await getAdminToken();
    const res = await app.request('/admin/api/settings', {
      method: 'PATCH',
      headers: { ...authHeader(token), 'Content-Type': 'application/json' },
      body: JSON.stringify({ serverName: '' }),
    });
    expect(res.status).toBe(400);
    expect(mockSetServerName).not.toHaveBeenCalled();
  });

  it('updates registration mode to open', async () => {
    const token = await getAdminToken();
    const res = await app.request('/admin/api/settings', {
      method: 'PATCH',
      headers: { ...authHeader(token), 'Content-Type': 'application/json' },
      body: JSON.stringify({ registrationMode: 'open' }),
    });
    expect(res.status).toBe(200);
    expect(mockSetRegistrationMode).toHaveBeenCalledWith('open');
  });

  it('updates registration mode to invite', async () => {
    const token = await getAdminToken();
    const res = await app.request('/admin/api/settings', {
      method: 'PATCH',
      headers: { ...authHeader(token), 'Content-Type': 'application/json' },
      body: JSON.stringify({ registrationMode: 'invite' }),
    });
    expect(res.status).toBe(200);
    expect(mockSetRegistrationMode).toHaveBeenCalledWith('invite');
  });

  it('rejects invalid registration mode', async () => {
    const token = await getAdminToken();
    const res = await app.request('/admin/api/settings', {
      method: 'PATCH',
      headers: { ...authHeader(token), 'Content-Type': 'application/json' },
      body: JSON.stringify({ registrationMode: 'invalid' }),
    });
    expect(res.status).toBe(400);
    expect(mockSetRegistrationMode).not.toHaveBeenCalled();
  });

  it('updates session settings (ttlHours and maxPerUser)', async () => {
    const token = await getAdminToken();
    const res = await app.request('/admin/api/settings', {
      method: 'PATCH',
      headers: { ...authHeader(token), 'Content-Type': 'application/json' },
      body: JSON.stringify({ ttlHours: 48, maxPerUser: 10 }),
    });
    expect(res.status).toBe(200);
    expect(mockSetSessionSettings).toHaveBeenCalledWith(48, 10);
  });

  it('updates retention settings', async () => {
    const token = await getAdminToken();
    const res = await app.request('/admin/api/settings', {
      method: 'PATCH',
      headers: { ...authHeader(token), 'Content-Type': 'application/json' },
      body: JSON.stringify({ notificationRetentionDays: 30, auditLogRetentionDays: 180 }),
    });
    expect(res.status).toBe(200);
    expect(mockSetRetentionSettings).toHaveBeenCalledWith(30, 180);
  });
});

// ═══════════════════════════════════════════════════════════════
// 5. Allowed Emails CRUD
// ═══════════════════════════════════════════════════════════════

describe('GET /admin/api/allowed-emails', () => {
  it('returns list of allowed emails', async () => {
    const token = await getAdminToken();
    selectQueue.push([
      { id: 1, email: 'user1@example.com', createdAt: new Date() },
      { id: 2, email: 'user2@example.com', createdAt: new Date() },
    ]);

    const res = await app.request('/admin/api/allowed-emails', {
      headers: authHeader(token),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.emails).toHaveLength(2);
    expect(body.emails[0].email).toBe('user1@example.com');
  });
});

describe('POST /admin/api/allowed-emails', () => {
  it('adds a valid email to the allowlist', async () => {
    const token = await getAdminToken();
    const res = await app.request('/admin/api/allowed-emails', {
      method: 'POST',
      headers: { ...authHeader(token), 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'new@example.com' }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.email).toBe('new@example.com');
  });

  it('rejects an invalid email', async () => {
    const token = await getAdminToken();
    const res = await app.request('/admin/api/allowed-emails', {
      method: 'POST',
      headers: { ...authHeader(token), 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'not-an-email' }),
    });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toContain('email');
  });
});

describe('DELETE /admin/api/allowed-emails/:email', () => {
  it('deletes an allowed email', async () => {
    const token = await getAdminToken();
    deleteQueue.push([{ email: 'old@example.com' }]);

    const res = await app.request('/admin/api/allowed-emails/old@example.com', {
      method: 'DELETE',
      headers: authHeader(token),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
  });

  it('returns 404 when deleting non-existent email', async () => {
    const token = await getAdminToken();
    deleteQueue.push([]);

    const res = await app.request('/admin/api/allowed-emails/nonexistent@example.com', {
      method: 'DELETE',
      headers: authHeader(token),
    });
    expect(res.status).toBe(404);
  });
});
