import { Hono } from 'hono';
import { describe, expect, it } from 'vitest';
import { apiBodyLimit } from '../middleware/api-body-limit.js';

describe('composed API upload limits', () => {
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
