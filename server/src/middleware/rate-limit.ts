import type { Context, Next } from 'hono';
import { BlockList, isIP } from 'node:net';
import { logger } from '../lib/logger.js';

interface RateLimitEntry {
  count: number;
  resetAt: number;
}

interface RateLimitOptions {
  windowMs: number;
  max: number;
}

function normalizeIP(ip: string): string {
  // Strip ::ffff: prefix for IPv4-mapped IPv6 addresses
  if (ip.startsWith('::ffff:')) {
    return ip.slice(7);
  }
  // Lowercase IPv6 addresses for consistent matching
  return ip.toLowerCase();
}

interface ProxyConfiguration { enabled: boolean; trusts(ip: string): boolean }

/** One exact address, or a CIDR range such as 172.16.0.0/12 or fd00::/8; a /0 range would trust every peer. */
function addTrustedPeer(peers: BlockList, entry: string): boolean {
  const [address, prefix, extra] = entry.split('/');
  const family = isIP(address);
  if (!family || extra !== undefined) return false;
  const type = family === 4 ? 'ipv4' : 'ipv6';
  if (prefix === undefined) {
    peers.addAddress(address, type);
    return true;
  }
  const bits = /^[1-9]\d{0,2}$/.test(prefix) ? Number(prefix) : 0;
  if (bits < 1 || bits > (family === 4 ? 32 : 128)) return false;
  peers.addSubnet(address, bits, type);
  return true;
}

let cachedConfiguration: { key: string; config: ProxyConfiguration } | undefined;

export function proxyConfiguration(env = process.env): ProxyConfiguration {
  const key = `${env.TRUST_PROXY}\n${env.TRUSTED_PROXY_IPS}`;
  if (cachedConfiguration?.key === key) return cachedConfiguration.config;
  const value = (env.TRUST_PROXY ?? '0').trim().toLowerCase();
  if (!['0', '1', 'false', 'true'].includes(value)) throw new Error('TRUST_PROXY must be true/false or 1/0');
  const peers = new BlockList();
  const entries = (env.TRUSTED_PROXY_IPS ?? '127.0.0.1,::1').split(',').map(ip => ip.trim()).filter(Boolean);
  if (!entries.every(entry => addTrustedPeer(peers, entry))) {
    throw new Error('TRUSTED_PROXY_IPS must contain IP addresses or CIDR ranges (prefix 1-32 for IPv4, 1-128 for IPv6), not hostnames');
  }
  const config = { enabled: value === '1' || value === 'true', trusts: (ip: string) => peers.check(ip, isIP(ip) === 4 ? 'ipv4' : 'ipv6') };
  cachedConfiguration = { key, config };
  return config;
}

let untrustedForwardingLogged = false;

export function getClientIp(c: Context): string {
  const remote = (c.env as { incoming?: { socket?: { remoteAddress?: string } } } | undefined)?.incoming?.socket?.remoteAddress;
  if (!remote || !isIP(remote)) return 'unknown';
  const address = normalizeIP(remote);
  const config = proxyConfiguration();
  const forwarded = c.req.header('x-forwarded-for');
  // Forwarding only has meaning when the immediate connection is a known proxy.
  if (!config.enabled || !config.trusts(address)) {
    if (forwarded !== undefined && !untrustedForwardingLogged) {
      untrustedForwardingLogged = true;
      logger.warn('Ignoring X-Forwarded-For from a peer that is not a trusted proxy, so every client behind it shares this address for rate limits and login lockouts. If this peer is your reverse proxy, set TRUST_PROXY=1 and add it to TRUSTED_PROXY_IPS. Logged once.', {
        peer: address, trustProxy: config.enabled,
      });
    }
    return address;
  }
  if (forwarded) {
    const chain = forwarded.split(',').map(ip => ip.trim());
    if (chain.some(ip => !isIP(ip))) return address;
    for (const hop of chain.reverse().map(normalizeIP)) {
      if (!config.trusts(hop)) return hop;
    }
    return chain.length ? normalizeIP(chain[chain.length - 1]) : address;
  }
  const realIp = c.req.header('x-real-ip')?.trim();
  return realIp && isIP(realIp) ? normalizeIP(realIp) : address;
}

/**
 * In-memory sliding-window rate limiter. Suitable for single-instance deployments.
 * State is lost on restart and not shared across instances — if horizontal scaling
 * is needed, replace the Map store with Redis or a shared cache.
 */
export function rateLimiter(options: RateLimitOptions) {
  const { windowMs, max } = options;
  const store = new Map<string, RateLimitEntry>();

  // Periodic cleanup every 60s
  const cleanup = setInterval(() => {
    const now = Date.now();
    for (const [key, entry] of store) {
      if (entry.resetAt <= now) store.delete(key);
    }
  }, 60_000);
  cleanup.unref();

  return async (c: Context, next: Next) => {
    const ip = getClientIp(c);
    const key = normalizeIP(ip);
    const now = Date.now();
    let entry = store.get(key);

    if (!entry || entry.resetAt <= now) {
      entry = { count: 0, resetAt: now + windowMs };
      store.set(key, entry);
    }

    entry.count++;

    if (entry.count > max) {
      const retryAfter = Math.ceil((entry.resetAt - now) / 1000);
      c.header('Retry-After', String(retryAfter));
      return c.json({ error: 'Too many requests' }, 429);
    }

    await next();
  };
}
