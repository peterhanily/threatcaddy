import type { Context, Next } from 'hono';
import { isIP } from 'node:net';

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

export function proxyConfiguration(env = process.env): { enabled: boolean; peers: Set<string> } {
  const value = (env.TRUST_PROXY ?? '0').trim().toLowerCase();
  if (!['0', '1', 'false', 'true'].includes(value)) throw new Error('TRUST_PROXY must be true/false or 1/0');
  const peers = (env.TRUSTED_PROXY_IPS ?? '127.0.0.1,::1').split(',').map(ip => ip.trim()).filter(Boolean);
  if (peers.some(ip => !isIP(ip))) throw new Error('TRUSTED_PROXY_IPS must contain exact IP addresses, not hostnames or CIDRs');
  return { enabled: value === '1' || value === 'true', peers: new Set(peers.map(normalizeIP)) };
}

export function getClientIp(c: Context): string {
  const remote = (c.env as { incoming?: { socket?: { remoteAddress?: string } } } | undefined)?.incoming?.socket?.remoteAddress;
  if (!remote || !isIP(remote)) return 'unknown';
  const address = normalizeIP(remote);
  const config = proxyConfiguration();
  // Forwarding only has meaning when the immediate connection is a known proxy.
  if (!config.enabled || !config.peers.has(address)) return address;
  const forwarded = c.req.header('x-forwarded-for');
  if (forwarded) {
    const chain = forwarded.split(',').map(ip => ip.trim());
    if (chain.some(ip => !isIP(ip))) return address;
    for (const hop of chain.reverse().map(normalizeIP)) {
      if (!config.peers.has(hop)) return hop;
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
