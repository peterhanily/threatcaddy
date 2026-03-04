import type { Context, Next } from 'hono';

interface RateLimitEntry {
  count: number;
  resetAt: number;
}

interface RateLimitOptions {
  windowMs: number;
  max: number;
}

function getClientIp(c: Context): string {
  // Only trust proxy headers behind a reverse proxy (opt-in via TRUST_PROXY)
  if (process.env.TRUST_PROXY === '1') {
    const forwarded = c.req.header('x-forwarded-for')?.split(',').pop()?.trim();
    if (forwarded) return forwarded;
    const realIp = c.req.header('x-real-ip');
    if (realIp) return realIp;
  }

  // Use actual connection remote address
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const env = c.env as any;
  const remoteAddr: string | undefined = env?.incoming?.socket?.remoteAddress;
  return remoteAddr || 'unknown';
}

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
    const now = Date.now();
    let entry = store.get(ip);

    if (!entry || entry.resetAt <= now) {
      entry = { count: 0, resetAt: now + windowMs };
      store.set(ip, entry);
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
