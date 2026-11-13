import { beforeEach, describe, expect, it, vi } from 'vitest';

const { bootstrap, sign } = vi.hoisted(() => ({ bootstrap: vi.fn(), sign: vi.fn() }));
vi.mock('../services/admin-session-service.js', () => ({ bootstrapAdminUser: bootstrap }));
vi.mock('../middleware/admin-auth.js', () => ({ signAdminToken: sign }));
vi.mock('../lib/logger.js', () => ({ logger: { info: vi.fn() } }));

// Import the production handler and rate limiter, not a duplicated route.
import app from '../routes/admin/bootstrap.js';

const valid = { bootstrapSecret: 'fixture-secret', username: 'admin', displayName: 'Administrator', password: 'fixture-password-123' };
let address = 0;
function request(body: unknown, ip = `192.0.2.${address}`) {
  return app.request('/api/bootstrap', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  }, { incoming: { socket: { remoteAddress: ip } } });
}

beforeEach(() => {
  address++;
  vi.clearAllMocks();
  bootstrap.mockResolvedValue({ error: 'invalid' });
  sign.mockResolvedValue('fixture-token');
});

describe('administrator bootstrap production route', () => {
  it.each([
    null, [], 'invalid',
    { ...valid, bootstrapSecret: 'x'.repeat(1025) },
    { ...valid, password: 'x'.repeat(1025) },
    { ...valid, password: 'short' },
    { ...valid, username: 'x'.repeat(65) },
    { ...valid, username: 'invalid name' },
    { ...valid, displayName: 'x'.repeat(129) },
    { ...valid, displayName: ' ' },
  ])('rejects malformed or excessive inputs before password work: %#', async body => {
    expect((await request(body)).status).toBe(400);
    expect(bootstrap).not.toHaveBeenCalled();
  });

  it('bounds attempts per peer before invoking password work and does not trust forwarding headers', async () => {
    for (let i = 0; i < 5; i++) expect((await request(valid)).status).toBe(401);
    const response = await app.request('/api/bootstrap', {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Forwarded-For': '198.51.100.42' }, body: JSON.stringify(valid),
    }, { incoming: { socket: { remoteAddress: `192.0.2.${address}` } } });
    expect(response.status).toBe(429);
    expect(Number(response.headers.get('Retry-After'))).toBeGreaterThan(0);
    expect(bootstrap).toHaveBeenCalledTimes(5);
    expect((await request(valid, '203.0.113.10')).status).toBe(401);
  });

  it('reports saturation and completed setup without issuing a token', async () => {
    bootstrap.mockResolvedValueOnce({ error: 'busy' }).mockResolvedValueOnce({ error: 'configured' });
    const busy = await request(valid);
    expect(busy.status).toBe(429);
    expect(busy.headers.get('Retry-After')).toBe('1');
    expect((await request(valid)).status).toBe(409);
    expect(sign).not.toHaveBeenCalled();
  });

  it('returns only the public account and signed token after successful setup', async () => {
    const admin = { id: 'admin-id', username: 'admin', displayName: 'Administrator' };
    bootstrap.mockResolvedValue({ admin, passwordHash: 'fixture-hash' });
    const response = await request(valid);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ token: 'fixture-token', admin });
    expect(sign).toHaveBeenCalledWith(admin.id, admin.username, 'fixture-hash');
  });
});
