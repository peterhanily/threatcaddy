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
});
