import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Hono } from 'hono';
import { DrizzleQueryError } from 'drizzle-orm';

const { createAdminUser } = vi.hoisted(() => ({ createAdminUser: vi.fn() }));
vi.mock('../services/admin-secret.js', async (importOriginal) => ({
  ...await importOriginal<typeof import('../services/admin-secret.js')>(),
  createAdminUser,
}));
vi.mock('../middleware/admin-auth.js', async (importOriginal) => {
  const { createMiddleware } = await import('hono/factory');
  return {
    ...await importOriginal<typeof import('../middleware/admin-auth.js')>(),
    requireAdminAuth: createMiddleware(async (c, next) => { c.set('adminUserId', 'admin-1'); await next(); }),
  };
});
vi.mock('../services/audit-service.js', () => ({ logActivity: vi.fn(async () => undefined) }));

// The production admin router and global error handler, not a re-implemented route.
import adminRoutes from '../routes/admin/index.js';
import { globalErrorHandler } from '../middleware/error-handler.js';

const HASH = '$argon2id$v=19$m=65536,t=3,p=4$Zml4dHVyZXNhbHQ$fixture-hash-of-typed-password';
let logged = '';

function createAccount() {
  const app = new Hono();
  app.onError(globalErrorHandler);
  app.route('/admin', adminRoutes);
  return app.request('/admin/api/admin-accounts', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'admin', displayName: 'Administrator', password: 'fixture-password-123' }),
  });
}

beforeEach(() => {
  logged = '';
  createAdminUser.mockReset();
  for (const stream of [process.stdout, process.stderr]) {
    vi.spyOn(stream, 'write').mockImplementation((chunk: string | Uint8Array) => { logged += String(chunk); return true; });
  }
});
afterEach(() => vi.restoreAllMocks());

describe('POST /admin/api/admin-accounts', () => {
  it('returns 409 for a duplicate username reported by the database and never echoes or logs the hash', async () => {
    createAdminUser.mockRejectedValue(new DrizzleQueryError(
      'insert into "admin_users" ("id", "username", "display_name", "password_hash") values ($1, $2, $3, $4)',
      ['admin-id', 'admin', 'Administrator', HASH],
      Object.assign(new Error('duplicate key value violates unique constraint "admin_users_username_unique"'), { code: '23505' }),
    ));
    const response = await createAccount();
    const text = await response.text();
    expect(response.status).toBe(409);
    expect(JSON.parse(text)).toEqual({ error: 'Username already exists' });
    expect(text).not.toContain(HASH);
    expect(logged).not.toContain(HASH);
  });

  it('does not treat other database failures as a duplicate username', async () => {
    createAdminUser.mockRejectedValue(new DrizzleQueryError('insert into "admin_users" values ($1)', [HASH],
      Object.assign(new Error('value too long for type character varying(64)'), { code: '22001' })));
    const response = await createAccount();
    const text = await response.text();
    expect(response.status).toBe(500);
    expect(JSON.parse(text).error).toBe('Internal server error');
    expect(text + logged).not.toContain(HASH);
  });
});
