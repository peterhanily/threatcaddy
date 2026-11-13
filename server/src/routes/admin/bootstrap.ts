import { Hono } from 'hono';
import { signAdminToken } from '../../middleware/admin-auth.js';
import { rateLimiter } from '../../middleware/rate-limit.js';
import { bootstrapAdminUser } from '../../services/admin-session-service.js';
import { logger } from '../../lib/logger.js';

const app = new Hono();

app.use('/api/bootstrap', rateLimiter({ windowMs: 60_000, max: 5 }));
app.post('/api/bootstrap', async (c) => {
  const body: unknown = await c.req.json().catch(() => null);
  if (!body || typeof body !== 'object' || Array.isArray(body)) return c.json({ error: 'Invalid setup request' }, 400);
  const { bootstrapSecret, username, displayName, password } = body as Record<string, unknown>;
  if (typeof bootstrapSecret !== 'string' || !bootstrapSecret || bootstrapSecret.length > 1024) {
    return c.json({ error: 'Bootstrap secret must be between 1 and 1024 characters' }, 400);
  }
  if (typeof username !== 'string' || username.length > 64 || username.trim().length < 2
    || !/^[a-zA-Z0-9._-]+$/.test(username.trim())) {
    return c.json({ error: 'Username must be 2–64 characters using letters, numbers, dots, hyphens or underscores' }, 400);
  }
  if (typeof displayName !== 'string' || displayName.length > 128 || !displayName.trim()) {
    return c.json({ error: 'Display name must be 1–128 characters' }, 400);
  }
  if (typeof password !== 'string' || password.length < 12 || password.length > 1024) {
    return c.json({ error: 'Password must be 12–1024 characters' }, 400);
  }

  try {
    const result = await bootstrapAdminUser(bootstrapSecret, username, displayName, password);
    if ('error' in result) {
      if (result.error === 'busy') {
        c.header('Retry-After', '1');
        return c.json({ error: 'Administrator setup is busy. Retry shortly.' }, 429);
      }
      return result.error === 'configured'
        ? c.json({ error: 'Administrator setup is already complete' }, 409)
        : c.json({ error: 'Invalid bootstrap secret' }, 401);
    }
    const { admin } = result;
    const token = await signAdminToken(admin.id, admin.username, result.passwordHash);
    logger.info('Admin account created via bootstrap', { username: admin.username });
    return c.json({ token, admin: { id: admin.id, username: admin.username, displayName: admin.displayName } });
  } catch (err: unknown) {
    if (err instanceof Error && err.message.includes('unique')) return c.json({ error: 'Username already exists' }, 409);
    throw err;
  }
});

export default app;
