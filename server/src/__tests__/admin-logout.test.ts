import { beforeAll, describe, expect, it, vi } from 'vitest';
import { Hono } from 'hono';
import { createContext, Script } from 'node:vm';

vi.mock('../db/index.js', () => {
  const chain = () => {
    const query: Record<string, unknown> = {};
    for (const method of ['from', 'where', 'limit']) query[method] = () => query;
    query.then = (resolve: (rows: unknown[]) => unknown) => Promise.resolve([{ id: 'admin-1', username: 'root', passwordHash: 'fixture-hash' }]).then(resolve);
    return query;
  };
  return { db: { select: chain } };
});
vi.mock('../services/admin-secret.js', async (importOriginal) => ({
  ...await importOriginal<typeof import('../services/admin-secret.js')>(),
  listAdminUsers: vi.fn(async () => []),
}));
vi.mock('../services/audit-service.js', () => ({ logActivity: vi.fn(async () => undefined) }));
vi.mock('../lib/logger.js', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

// The production admin router, token signing and session revocation.
import adminRoutes from '../routes/admin/index.js';
import { initAdminKey, signAdminToken } from '../middleware/admin-auth.js';
import { sharedJs } from '../routes/admin-html/shared-js.js';

const app = new Hono();
app.route('/admin', adminRoutes);
const call = (path: string, token: string, method = 'GET') => app.request(path, { method, headers: { Authorization: `Bearer ${token}` } });

beforeAll(() => initAdminKey());

describe('administrator sign-out', () => {
  it('revokes the administrator token on the server', async () => {
    const token = await signAdminToken('admin-1', 'root', 'fixture-hash');
    expect((await call('/admin/api/admin-accounts', token)).status).toBe(200);
    expect((await call('/admin/api/logout', token, 'POST')).status).toBe(200);
    expect((await call('/admin/api/admin-accounts', token)).status).toBe(401);
  });

  it('requires a valid administrator token', async () => {
    expect((await app.request('/admin/api/logout', { method: 'POST' })).status).toBe(401);
  });

  it('the Sign Out button ends the session on the server before clearing it locally', () => {
    const handlers = new Map<string, () => void>();
    const element = (id: string) => ({
      style: {}, value: '', textContent: '',
      addEventListener: (type: string, handler: () => void) => handlers.set(`${id}:${type}`, handler),
    });
    const requests: Array<{ url: string; init: { method?: string; headers?: Record<string, string> } }> = [];
    const context = createContext({
      location: { origin: 'https://admin.example' },
      sessionStorage: { getItem: (key: string) => key === 'adminToken' ? 'fixture-session' : null, setItem() {}, removeItem() {} },
      document: { getElementById: element, querySelectorAll: () => [] },
      fetch: (url: string, init: { method?: string; headers?: Record<string, string> }) => { requests.push({ url, init }); return new Promise(() => {}); },
      resetAiSession: () => {},
    });
    new Script(sharedJs()).runInContext(context);

    handlers.get('logoutBtn:click')!();
    expect(requests[0].url).toBe('https://admin.example/admin/api/logout');
    expect(requests[0].init.method).toBe('POST');
    expect(requests[0].init.headers?.Authorization).toBe('Bearer fixture-session');
    expect(context.token).toBeNull();
  });
});
