import { Hono } from 'hono';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { getClientIp, proxyConfiguration } from '../middleware/rate-limit.js';

const { warn } = vi.hoisted(() => ({ warn: vi.fn() }));
vi.mock('../lib/logger.js', () => ({ logger: { info: vi.fn(), warn, error: vi.fn() } }));

afterEach(() => { vi.unstubAllEnvs(); warn.mockClear(); });
async function identityWith(clientIp: typeof getClientIp, remote: string, forwarded?: string) {
  const app = new Hono();
  app.get('/', c => c.text(clientIp(c)));
  const headers: Record<string, string> = forwarded === undefined ? {} : { 'x-forwarded-for': forwarded };
  return (await app.request('/', { headers }, { incoming: { socket: { remoteAddress: remote } } })).text();
}
const identity = (remote: string, forwarded = '203.0.113.20') => identityWith(getClientIp, remote, forwarded);
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
  it('trusts proxy peers inside configured IPv4 and IPv6 CIDR ranges only', async () => {
    vi.stubEnv('TRUST_PROXY', '1');
    // A host proxy publishing to a Compose port reaches the container from the bridge gateway.
    vi.stubEnv('TRUSTED_PROXY_IPS', '172.16.0.0/12, fd00:db8::/64');
    expect(await identity('172.18.0.1')).toBe('203.0.113.20');
    expect(await identity('::ffff:172.31.255.254')).toBe('203.0.113.20');
    expect(await identity('fd00:db8::1')).toBe('203.0.113.20');
    expect(await identity('FD00:DB8::FFFF')).toBe('203.0.113.20');
    expect(await identity('172.32.0.1')).toBe('172.32.0.1');
    expect(await identity('172.15.255.255')).toBe('172.15.255.255');
    expect(await identity('fd00:db8:0:1::1')).toBe('fd00:db8:0:1::1');
  });
  it('skips hops inside trusted ranges in a forwarded chain', async () => {
    vi.stubEnv('TRUST_PROXY', 'true');
    vi.stubEnv('TRUSTED_PROXY_IPS', '127.0.0.1,10.0.0.0/8');
    expect(await identity('127.0.0.1', '198.51.100.9, 203.0.113.20, 10.1.2.3')).toBe('203.0.113.20');
  });
  it('rejects ambiguous deployment configuration at startup', () => {
    expect(() => proxyConfiguration({ TRUST_PROXY: 'yes' })).toThrow('TRUST_PROXY');
    for (const value of ['proxy.example', '10.0.0.0/33', '10.0.0.0/', '/8', '10.0.0.0/8/8', '10.0.0.0/08',
      '10.0.0.0/-1', 'fd00::/129', 'proxy.example/24', '0.0.0.0/0', '::/0']) {
      expect(() => proxyConfiguration({ TRUST_PROXY: 'true', TRUSTED_PROXY_IPS: value }), value).toThrow('TRUSTED_PROXY_IPS');
    }
  });
  it('accepts exact addresses and CIDR ranges together', () => {
    expect(() => proxyConfiguration({ TRUST_PROXY: 'true', TRUSTED_PROXY_IPS: '127.0.0.1,::1,172.18.0.1/32,fd00::/8' })).not.toThrow();
  });
});

describe('forwarding headers from untrusted peers', () => {
  async function freshClientIp() {
    vi.resetModules();
    return (await import('../middleware/rate-limit.js')).getClientIp;
  }
  it('logs one warning naming the first untrusted peer that sent X-Forwarded-For', async () => {
    const clientIp = await freshClientIp();
    vi.stubEnv('TRUST_PROXY', '1');
    vi.stubEnv('TRUSTED_PROXY_IPS', '127.0.0.1,::1');
    expect(await identityWith(clientIp, '172.18.0.1', '203.0.113.20')).toBe('172.18.0.1');
    expect(await identityWith(clientIp, '172.18.0.1', '203.0.113.21')).toBe('172.18.0.1');
    expect(await identityWith(clientIp, '198.51.100.7', '203.0.113.22')).toBe('198.51.100.7');
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0][0]).toMatch(/X-Forwarded-For/);
    expect(warn.mock.calls[0][0]).toMatch(/TRUSTED_PROXY_IPS/);
    expect(warn.mock.calls[0][1]).toEqual({ peer: '172.18.0.1', trustProxy: true });
  });
  it('also warns when forwarding is disabled, but not for trusted peers or requests without the header', async () => {
    let clientIp = await freshClientIp();
    vi.stubEnv('TRUST_PROXY', '1');
    vi.stubEnv('TRUSTED_PROXY_IPS', '172.16.0.0/12');
    expect(await identityWith(clientIp, '172.18.0.1', '203.0.113.20')).toBe('203.0.113.20');
    expect(await identityWith(clientIp, '198.51.100.7')).toBe('198.51.100.7');
    expect(warn).not.toHaveBeenCalled();
    clientIp = await freshClientIp();
    vi.stubEnv('TRUST_PROXY', '0');
    expect(await identityWith(clientIp, '172.18.0.1', '203.0.113.20')).toBe('172.18.0.1');
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0][1]).toEqual({ peer: '172.18.0.1', trustProxy: false });
  });
});
