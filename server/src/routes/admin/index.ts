import { Hono } from 'hono';
import { randomBytes } from 'node:crypto';
import { verifyAdminSecret } from '../../services/admin-secret.js';
import { signAdminToken } from '../../middleware/admin-auth.js';
import { getAdminHtml } from '../admin-html/index.js';
import { logger } from '../../lib/logger.js';
import { logAdminAction } from './shared.js';

import usersRouter from './users.js';
import investigationsRouter from './investigations.js';
import botsRouter from './bots.js';
import settingsRouter from './settings.js';
import auditRouter from './audit.js';

const app = new Hono();

// ─── HTML page ───────────────────────────────────────────────────

app.get('/', (c) => {
  const nonce = randomBytes(16).toString('base64');
  c.header('Content-Security-Policy',
    `default-src 'none'; script-src 'nonce-${nonce}'; style-src 'unsafe-inline'; connect-src 'self'; frame-ancestors 'none'`);
  c.header('X-Frame-Options', 'DENY');
  c.header('X-Content-Type-Options', 'nosniff');
  return c.html(getAdminHtml(nonce));
});

// ─── Login ───────────────────────────────────────────────────────

app.post('/api/login', async (c) => {
  const body = await c.req.json();
  const secret = body?.secret;
  if (!secret || typeof secret !== 'string') {
    return c.json({ error: 'Missing secret' }, 400);
  }

  const valid = await verifyAdminSecret(secret);
  if (!valid) {
    logger.info('Admin login failed — invalid secret');
    await logAdminAction('login.failure', 'Admin login failed');
    return c.json({ error: 'Invalid admin secret' }, 401);
  }

  const token = await signAdminToken();
  logger.info('Admin login successful');
  await logAdminAction('login.success', 'Admin login successful');
  return c.json({ token });
});

// ─── Mount sub-routers ──────────────────────────────────────────

app.route('', usersRouter);
app.route('', investigationsRouter);
app.route('', botsRouter);
app.route('', settingsRouter);
app.route('', auditRouter);

export default app;
