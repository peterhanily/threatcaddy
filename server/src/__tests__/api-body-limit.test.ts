import { readFileSync } from 'node:fs';
import { Hono } from 'hono';
import { describe, expect, it } from 'vitest';
import { apiBodyLimit } from '../middleware/api-body-limit.js';

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
