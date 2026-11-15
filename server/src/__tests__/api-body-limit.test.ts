import { readFileSync } from 'node:fs';
import { Hono } from 'hono';
import { beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ user: { id: 'synthetic-user', role: 'analyst' } as { id: string; role: string } | null }));
vi.mock('../middleware/auth.js', () => ({
  requireAuth: async (c: { set: (key: string, value: unknown) => void; json: (body: unknown, status: number) => Response }, next: () => Promise<void>) => {
    if (!mocks.user) return c.json({ error: 'Missing authorization header' }, 401);
    c.set('user', mocks.user); await next();
  },
}));
import { apiBodyLimit } from '../middleware/api-body-limit.js';

beforeEach(() => { mocks.user = { id: 'synthetic-user', role: 'analyst' }; });

describe('composed API upload limits', () => {
  it('runs on a Hono release whose bodyLimit does not retain every body chunk (GHSA-39q9-qp46-w8xg)', () => {
    const read = (path: string) => JSON.parse(readFileSync(new URL(path, import.meta.url), 'utf8')) as {
      version?: string; dependencies?: Record<string, string>;
    };
    const installed = read('../../node_modules/hono/package.json').version ?? '';
    expect(read('../../package.json').dependencies?.hono).toBe(installed);
    const [major, minor, patch] = installed.split('.').map(Number);
    expect(major === 4 && (minor > 13 || (minor === 13 && patch >= 18))).toBe(true);
  });
  function app() {
    const app = new Hono();
    app.use('/api/*', apiBodyLimit);
    app.post('*', async c => { const body = await c.req.parseBody(); return c.json({ size: (body.file as File).size }); });
    return app;
  }
  it.each(['/api/files/upload', '/api/backups', '/api/backups/', '/api/sync/push'])('allows ordinary multi-megabyte uploads at %s', async path => {
    const body = new FormData();
    body.append('file', new File([new Uint8Array(2 * 1024 * 1024)], 'ordinary.bin'));
    const response = await app().request(path, { method: 'POST', body });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ size: 2 * 1024 * 1024 });
  });
  it.each(['/api/files/upload', '/api/backups', '/api/sync/push'])('reads no anonymous chunked body before authentication at %s', async path => {
    mocks.user = null;
    let pulled = 0;
    const body = new ReadableStream<Uint8Array>({
      pull(controller) {
        if (pulled >= 2 * 1024 * 1024) { controller.close(); return; }
        pulled += 64 * 1024;
        controller.enqueue(new Uint8Array(64 * 1024));
      },
    }, { highWaterMark: 0 });
    const response = await app().request(path, { method: 'POST', body, duplex: 'half' } as RequestInit);
    expect(response.status).toBe(401);
    expect(pulled).toBe(0);
  });
  it('still returns the large-route 413 to an authenticated caller', async () => {
    const response = await app().request('/api/backups', { method: 'POST', body: new Uint8Array(1),
      headers: { 'content-length': String(100 * 1024 * 1024 + 1024 * 1024 + 1) } });
    expect(response.status).toBe(413);
  });
  it('retains the ordinary API request limit', async () => {
    const body = new FormData();
    body.append('file', new File([new Uint8Array(2 * 1024 * 1024)], 'ordinary.bin'));
    expect((await app().request('/api/notes', { method: 'POST', body })).status).toBe(413);
  });
  it('rejects a sync batch beyond its dedicated 16 MiB limit', async () => {
    expect((await app().request('/api/sync/push', { method: 'POST', body: new Uint8Array(16 * 1024 * 1024 + 1) })).status).toBe(413);
  });
  it.each([false, true])('returns a bounded 413 envelope and closes an unread HTTP/1 body (content-length=%s)', async contentLength => {
    const server = new Hono();
    server.use('*', async (c, next) => { c.set('requestId' as never, 'synthetic-request' as never); await next(); });
    server.use('/api/*', apiBodyLimit);
    server.post('*', c => c.text('accepted'));
    const body = new Uint8Array(1024 * 1024 + 1);
    const response = await server.request('/api/integrations/templates', { method: 'POST', body,
      headers: contentLength ? { 'content-length': String(body.byteLength) } : {} });
    expect(response.status).toBe(413);
    expect(response.headers.get('connection')).toBe('close');
    expect(await response.json()).toEqual({ error: 'Payload too large', code: 'PAYLOAD_TOO_LARGE', requestId: 'synthetic-request' });
  });
});
