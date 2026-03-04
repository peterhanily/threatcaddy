import { Hono } from 'hono';
import { eq, count, sql } from 'drizzle-orm';
import * as argon2 from 'argon2';
import { nanoid } from 'nanoid';
import { db } from '../db/index.js';
import { users, folders, allowedEmails, investigationMembers } from '../db/schema.js';
import {
  verifyAdminSecret, changeAdminSecret, getRegistrationMode, setRegistrationMode,
  getSessionSettings, setSessionSettings,
} from '../services/admin-secret.js';
import { signAdminToken, requireAdminAuth } from '../middleware/admin-auth.js';
import { getAdminHtml } from './admin-html.js';
import { logger } from '../lib/logger.js';
import { randomBytes } from 'node:crypto';

const app = new Hono();

// GET /admin — serve HTML admin panel with CSP nonce
app.get('/', (c) => {
  const nonce = randomBytes(16).toString('base64');
  c.header('Content-Security-Policy',
    `default-src 'none'; script-src 'nonce-${nonce}'; style-src 'unsafe-inline'; connect-src 'self'; frame-ancestors 'none'`);
  c.header('X-Frame-Options', 'DENY');
  c.header('X-Content-Type-Options', 'nosniff');
  return c.html(getAdminHtml(nonce));
});

// POST /admin/api/login
app.post('/api/login', async (c) => {
  const body = await c.req.json();
  const secret = body?.secret;
  if (!secret || typeof secret !== 'string') {
    return c.json({ error: 'Missing secret' }, 400);
  }

  const valid = await verifyAdminSecret(secret);
  if (!valid) {
    logger.info('Admin login failed — invalid secret');
    return c.json({ error: 'Invalid admin secret' }, 401);
  }

  const token = await signAdminToken();
  logger.info('Admin login successful');
  return c.json({ token });
});

// GET /admin/api/users
app.get('/api/users', requireAdminAuth, async (c) => {
  const allUsers = await db.select({
    id: users.id,
    email: users.email,
    displayName: users.displayName,
    role: users.role,
    active: users.active,
    lastLoginAt: users.lastLoginAt,
    createdAt: users.createdAt,
  }).from(users).orderBy(users.createdAt);

  return c.json({ users: allUsers });
});

// PATCH /admin/api/users/:id
app.patch('/api/users/:id', requireAdminAuth, async (c) => {
  const id = c.req.param('id');
  const body = await c.req.json();
  const updates: Record<string, unknown> = { updatedAt: new Date() };

  if (body.role !== undefined) {
    const validRoles = ['admin', 'analyst', 'viewer'];
    if (!validRoles.includes(body.role)) {
      return c.json({ error: 'Invalid role' }, 400);
    }
    updates.role = body.role;
    logger.info('Admin action: user role changed', { targetUserId: id, newRole: body.role });
  }

  if (body.active !== undefined) {
    if (typeof body.active !== 'boolean') {
      return c.json({ error: 'Invalid active value' }, 400);
    }
    updates.active = body.active;
    logger.info('Admin action: user active status changed', { targetUserId: id, active: body.active });
  }

  const result = await db.update(users).set(updates).where(eq(users.id, id)).returning({ id: users.id });
  if (result.length === 0) {
    return c.json({ error: 'User not found' }, 404);
  }

  return c.json({ ok: true });
});

// POST /admin/api/users/:id/reset-password
app.post('/api/users/:id/reset-password', requireAdminAuth, async (c) => {
  const id = c.req.param('id');

  const user = await db.select({ id: users.id, email: users.email }).from(users).where(eq(users.id, id)).limit(1);
  if (user.length === 0) {
    return c.json({ error: 'User not found' }, 404);
  }

  const temporaryPassword = nanoid(16);
  const hash = await argon2.hash(temporaryPassword, { type: argon2.argon2id });
  await db.update(users).set({ passwordHash: hash, updatedAt: new Date() }).where(eq(users.id, id));

  logger.info('Admin action: password reset', { targetUserId: id, targetEmail: user[0].email });

  return c.json({ temporaryPassword });
});

// POST /admin/api/change-secret
app.post('/api/change-secret', requireAdminAuth, async (c) => {
  const body = await c.req.json();
  const { currentSecret, newSecret } = body || {};
  if (!currentSecret || typeof currentSecret !== 'string') {
    return c.json({ error: 'Missing current secret' }, 400);
  }
  if (!newSecret || typeof newSecret !== 'string' || newSecret.length < 12) {
    return c.json({ error: 'New secret must be at least 12 characters' }, 400);
  }
  const changed = await changeAdminSecret(currentSecret, newSecret);
  if (!changed) {
    return c.json({ error: 'Current secret is incorrect' }, 401);
  }
  logger.info('Admin action: admin secret changed');
  return c.json({ ok: true });
});

// GET /admin/api/stats
app.get('/api/stats', requireAdminAuth, async (c) => {
  const [totalResult] = await db.select({ count: count() }).from(users);
  const [activeResult] = await db.select({ count: count() }).from(users).where(eq(users.active, true));
  const [invResult] = await db.select({ count: count() }).from(folders);

  return c.json({
    totalUsers: totalResult.count,
    activeUsers: activeResult.count,
    investigations: invResult.count,
  });
});

// GET /admin/api/settings
app.get('/api/settings', requireAdminAuth, async (c) => {
  const registrationMode = await getRegistrationMode();
  const sessionSettings = await getSessionSettings();
  return c.json({ registrationMode, ...sessionSettings });
});

// PATCH /admin/api/settings
app.patch('/api/settings', requireAdminAuth, async (c) => {
  const body = await c.req.json();

  if (body.registrationMode !== undefined) {
    const mode = body.registrationMode;
    if (mode !== 'invite' && mode !== 'open') {
      return c.json({ error: 'Invalid registrationMode, must be "invite" or "open"' }, 400);
    }
    await setRegistrationMode(mode);
    logger.info('Admin action: registration mode changed', { registrationMode: mode });
  }

  if (body.ttlHours !== undefined || body.maxPerUser !== undefined) {
    const current = await getSessionSettings();
    const ttlHours = typeof body.ttlHours === 'number' && body.ttlHours >= 1 ? Math.floor(body.ttlHours) : current.ttlHours;
    const maxPerUser = typeof body.maxPerUser === 'number' && body.maxPerUser >= 0 ? Math.floor(body.maxPerUser) : current.maxPerUser;
    await setSessionSettings(ttlHours, maxPerUser);
    logger.info('Admin action: session settings changed', { ttlHours, maxPerUser });
  }

  const registrationMode = await getRegistrationMode();
  const sessionSettings = await getSessionSettings();
  return c.json({ ok: true, registrationMode, ...sessionSettings });
});

// GET /admin/api/allowed-emails
app.get('/api/allowed-emails', requireAdminAuth, async (c) => {
  const emails = await db.select().from(allowedEmails).orderBy(allowedEmails.createdAt);
  return c.json({ emails });
});

// POST /admin/api/allowed-emails
app.post('/api/allowed-emails', requireAdminAuth, async (c) => {
  const body = await c.req.json();
  const email = body?.email?.trim()?.toLowerCase();
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return c.json({ error: 'Invalid email' }, 400);
  }
  await db.insert(allowedEmails).values({ email }).onConflictDoNothing();
  logger.info('Admin action: email added to allowlist', { email });
  return c.json({ ok: true, email });
});

// DELETE /admin/api/allowed-emails/:email
app.delete('/api/allowed-emails/:email', requireAdminAuth, async (c) => {
  const email = decodeURIComponent(c.req.param('email'));
  const result = await db.delete(allowedEmails).where(eq(allowedEmails.email, email)).returning({ email: allowedEmails.email });
  if (result.length === 0) {
    return c.json({ error: 'Email not found' }, 404);
  }
  logger.info('Admin action: email removed from allowlist', { email });
  return c.json({ ok: true });
});

// GET /admin/api/investigations — overview (metadata only, no content)
app.get('/api/investigations', requireAdminAuth, async (c) => {
  const rows = await db
    .select({
      id: folders.id,
      name: folders.name,
      status: folders.status,
      color: folders.color,
      createdAt: folders.createdAt,
      creatorName: users.displayName,
      creatorEmail: users.email,
      memberCount: sql<number>`(select count(*) from investigation_members where folder_id = ${folders.id})`.as('member_count'),
    })
    .from(folders)
    .innerJoin(users, eq(users.id, folders.createdBy))
    .orderBy(folders.createdAt);

  return c.json({ investigations: rows });
});

export default app;
