import { Hono } from 'hono';
import { randomBytes } from 'node:crypto';
import { signAdminToken } from '../../middleware/admin-auth.js';
import {
  verifyBootstrapSecret, verifyAdminUser, verifyAdminUserById,
  getAdminUserCount, createAdminUser, listAdminUsers,
  updateAdminUser, changeAdminUserPassword, deleteAdminUser,
} from '../../services/admin-secret.js';
import { getAdminHtml } from '../admin-html/index.js';
import { logger } from '../../lib/logger.js';
import { requireAdminAuth, logAdminAction, getAdminId } from './shared.js';

import usersRouter from './users.js';
import investigationsRouter from './investigations.js';
import botsRouter from './bots.js';
import settingsRouter from './settings.js';
import auditRouter from './audit.js';
import aiRouter from './ai.js';

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

// ─── Check if admin accounts exist (for UI to decide login vs setup) ─

app.get('/api/setup-status', async (c) => {
  const count = await getAdminUserCount();
  return c.json({ hasAdminAccounts: count > 0 });
});

// ─── Bootstrap: create first admin account using bootstrap secret ─

app.post('/api/bootstrap', async (c) => {
  const body = await c.req.json();
  const { bootstrapSecret, username, displayName, password } = body || {};

  if (!bootstrapSecret || typeof bootstrapSecret !== 'string') {
    return c.json({ error: 'Missing bootstrap secret' }, 400);
  }
  if (!username || typeof username !== 'string' || username.trim().length < 2) {
    return c.json({ error: 'Username must be at least 2 characters' }, 400);
  }
  if (!/^[a-zA-Z0-9._-]+$/.test(username.trim())) {
    return c.json({ error: 'Username may only contain letters, numbers, dots, hyphens, and underscores' }, 400);
  }
  if (!displayName || typeof displayName !== 'string' || displayName.trim().length < 1) {
    return c.json({ error: 'Display name required' }, 400);
  }
  if (!password || typeof password !== 'string' || password.length < 12) {
    return c.json({ error: 'Password must be at least 12 characters' }, 400);
  }

  const valid = await verifyBootstrapSecret(bootstrapSecret);
  if (!valid) {
    logger.info('Admin bootstrap failed — invalid secret');
    return c.json({ error: 'Invalid bootstrap secret' }, 401);
  }

  try {
    const admin = await createAdminUser(username, displayName, password);
    const token = await signAdminToken(admin.id, admin.username);
    logger.info('Admin account created via bootstrap', { username: admin.username });
    return c.json({ token, admin: { id: admin.id, username: admin.username, displayName: admin.displayName } });
  } catch (err: unknown) {
    if (err instanceof Error && err.message.includes('unique')) {
      return c.json({ error: 'Username already exists' }, 409);
    }
    throw err;
  }
});

// ─── Login ───────────────────────────────────────────────────────

app.post('/api/login', async (c) => {
  const body = await c.req.json();
  const { username, password } = body || {};

  if (!username || typeof username !== 'string' || !password || typeof password !== 'string') {
    return c.json({ error: 'Missing username or password' }, 400);
  }

  const admin = await verifyAdminUser(username, password);
  if (!admin) {
    logger.info('Admin login failed', { username });
    return c.json({ error: 'Invalid credentials' }, 401);
  }

  const token = await signAdminToken(admin.id, admin.username);
  logger.info('Admin login successful', { username: admin.username, adminId: admin.id });
  return c.json({ token, admin: { id: admin.id, username: admin.username, displayName: admin.displayName } });
});

// ─── Admin Accounts Management ──────────────────────────────────

app.get('/api/admin-accounts', requireAdminAuth, async (c) => {
  const accounts = await listAdminUsers();
  return c.json({ accounts });
});

app.post('/api/admin-accounts', requireAdminAuth, async (c) => {
  const body = await c.req.json();
  const { username, displayName, password } = body || {};

  if (!username || typeof username !== 'string' || username.trim().length < 2) {
    return c.json({ error: 'Username must be at least 2 characters' }, 400);
  }
  if (!/^[a-zA-Z0-9._-]+$/.test(username.trim())) {
    return c.json({ error: 'Username may only contain letters, numbers, dots, hyphens, and underscores' }, 400);
  }
  if (!displayName || typeof displayName !== 'string' || displayName.trim().length < 1) {
    return c.json({ error: 'Display name required' }, 400);
  }
  if (!password || typeof password !== 'string' || password.length < 12) {
    return c.json({ error: 'Password must be at least 12 characters' }, 400);
  }

  try {
    const admin = await createAdminUser(username, displayName, password);
    const adminId = getAdminId(c);
    await logAdminAction(adminId, 'admin-account.create', `Created admin account "${admin.username}"`);
    return c.json({ ok: true, admin }, 201);
  } catch (err: unknown) {
    if (err instanceof Error && err.message.includes('unique')) {
      return c.json({ error: 'Username already exists' }, 409);
    }
    throw err;
  }
});

app.patch('/api/admin-accounts/:id', requireAdminAuth, async (c) => {
  const id = c.req.param('id');
  const body = await c.req.json();
  const updates: { displayName?: string; active?: boolean } = {};

  if (body.displayName !== undefined) {
    if (typeof body.displayName !== 'string' || body.displayName.trim().length < 1) {
      return c.json({ error: 'Display name required' }, 400);
    }
    updates.displayName = body.displayName.trim();
  }
  if (body.active !== undefined) {
    if (typeof body.active !== 'boolean') {
      return c.json({ error: 'Invalid active value' }, 400);
    }
    // Prevent disabling yourself
    const adminId = getAdminId(c);
    if (id === adminId && body.active === false) {
      return c.json({ error: 'Cannot disable your own account' }, 400);
    }
    updates.active = body.active;
  }

  const ok = await updateAdminUser(id, updates);
  if (!ok) return c.json({ error: 'Admin account not found' }, 404);

  const adminId = getAdminId(c);
  await logAdminAction(adminId, 'admin-account.update', `Updated admin account ${id}`);
  return c.json({ ok: true });
});

app.post('/api/admin-accounts/me/change-password', requireAdminAuth, async (c) => {
  const body = await c.req.json();
  const { currentPassword, newPassword } = body || {};

  if (!currentPassword || typeof currentPassword !== 'string') {
    return c.json({ error: 'Current password required' }, 400);
  }
  if (!newPassword || typeof newPassword !== 'string' || newPassword.length < 12) {
    return c.json({ error: 'New password must be at least 12 characters' }, 400);
  }

  const adminId = getAdminId(c);
  const valid = await verifyAdminUserById(adminId, currentPassword);
  if (!valid) {
    return c.json({ error: 'Current password is incorrect' }, 401);
  }

  await changeAdminUserPassword(adminId, newPassword);
  await logAdminAction(adminId, 'admin-account.change-password', 'Changed own password');
  return c.json({ ok: true });
});

app.post('/api/admin-accounts/:id/reset-password', requireAdminAuth, async (c) => {
  const id = c.req.param('id');
  const body = await c.req.json();
  const { password } = body || {};

  if (!password || typeof password !== 'string' || password.length < 12) {
    return c.json({ error: 'Password must be at least 12 characters' }, 400);
  }

  const ok = await changeAdminUserPassword(id, password);
  if (!ok) return c.json({ error: 'Admin account not found' }, 404);

  const adminId = getAdminId(c);
  await logAdminAction(adminId, 'admin-account.reset-password', `Reset password for admin account ${id}`);
  return c.json({ ok: true });
});

app.delete('/api/admin-accounts/:id', requireAdminAuth, async (c) => {
  const id = c.req.param('id');
  // Prevent deleting yourself
  const adminId = getAdminId(c);
  if (id === adminId) {
    return c.json({ error: 'Cannot delete your own account' }, 400);
  }

  const ok = await deleteAdminUser(id);
  if (!ok) return c.json({ error: 'Admin account not found' }, 404);

  await logAdminAction(adminId, 'admin-account.delete', `Deleted admin account ${id}`);
  return c.json({ ok: true });
});

// ─── Mount sub-routers ──────────────────────────────────────────

app.route('', usersRouter);
app.route('', investigationsRouter);
app.route('', botsRouter);
app.route('', settingsRouter);
app.route('', auditRouter);
app.route('', aiRouter);

export default app;
