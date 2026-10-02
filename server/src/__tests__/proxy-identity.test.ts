import { Hono } from 'hono';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { getClientIp, proxyConfiguration } from '../middleware/rate-limit.js';

afterEach(() => vi.unstubAllEnvs());
async function identity(remote: string, forwarded = '203.0.113.20') {
  const app = new Hono();
  app.get('/', c => c.text(getClientIp(c)));
  return (await app.request('/', { headers: { 'x-forwarded-for': forwarded } }, { incoming: { socket: { remoteAddress: remote } } })).text();
}
describe('explicit proxy identity', () => {
  it.each(['1', 'true'])('accepts %s only from configured peers', async flag => {
    vi.stubEnv('TRUST_PROXY', flag);
    vi.stubEnv('TRUSTED_PROXY_IPS', '127.0.0.1');
    expect(await identity('127.0.0.1')).toBe('203.0.113.20');
    expect(await identity('203.0.113.10')).toBe('203.0.113.10');
  });
  it.each(['0', 'false'])('uses the socket when disabled with %s', async flag => {
    vi.stubEnv('TRUST_PROXY', flag);
    expect(await identity('127.0.0.1')).toBe('127.0.0.1');
  });
  it('uses the nearest untrusted address in a valid configured proxy chain', async () => {
    vi.stubEnv('TRUST_PROXY', 'true');
    vi.stubEnv('TRUSTED_PROXY_IPS', '127.0.0.1,192.0.2.3');
    expect(await identity('127.0.0.1', '203.0.113.20,192.0.2.3')).toBe('203.0.113.20');
    expect(await identity('127.0.0.1', 'unknown')).toBe('127.0.0.1');
  });
  it('rejects ambiguous deployment configuration at startup', () => {
    expect(() => proxyConfiguration({ TRUST_PROXY: 'yes' })).toThrow('TRUST_PROXY');
    expect(() => proxyConfiguration({ TRUST_PROXY: 'true', TRUSTED_PROXY_IPS: 'proxy.example' })).toThrow('exact IP');
  });
});
