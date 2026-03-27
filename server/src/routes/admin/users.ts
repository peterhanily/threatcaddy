import { Hono } from 'hono';
import { eq, desc, and, gte, not, ilike, inArray } from 'drizzle-orm';
import * as argon2 from 'argon2';
import { nanoid } from 'nanoid';
import {
  db, users, sessions, activityLog, investigationMembers, folders,
  requireAdminAuth, logger, logAdminAction, getAdminId,
} from './shared.js';
import { changeAdminSecret } from '../../services/admin-secret.js';

const app = new Hono();

// ─── Users ───────────────────────────────────────────────────────

app.get('/api/users', requireAdminAuth, async (c) => {
  const allUsers = await db.select({
    id: users.id,
    email: users.email,
    displayName: users.displayName,
    role: users.role,
    active: users.active,
    lastLoginAt: users.lastLoginAt,
    createdAt: users.createdAt,
  }).from(users)
    .where(not(ilike(users.email, '%@threatcaddy.internal')))
    .orderBy(users.createdAt);

  return c.json({ users: allUsers });
});

app.patch('/api/users/:id', requireAdminAuth, async (c) => {
  const id = c.req.param('id');
  const body = await c.req.json();
  const updates: Record<string, unknown> = { updatedAt: new Date() };

  // Look up user for audit detail
  const [target] = await db.select({ email: users.email }).from(users).where(eq(users.id, id)).limit(1);
  if (!target) return c.json({ error: 'User not found' }, 404);

  if (body.role !== undefined) {
    const validRoles = ['admin', 'analyst', 'viewer'];
    if (!validRoles.includes(body.role)) {
      return c.json({ error: 'Invalid role' }, 400);
    }
    updates.role = body.role;
    logger.info('Admin action: user role changed', { targetUserId: id, newRole: body.role });
    await logAdminAction(getAdminId(c), 'user.role-change', `Changed ${target.email} role to ${body.role}`, { itemId: id });
  }

  if (body.active !== undefined) {
    if (typeof body.active !== 'boolean') {
      return c.json({ error: 'Invalid active value' }, 400);
    }
    updates.active = body.active;
    logger.info('Admin action: user active status changed', { targetUserId: id, active: body.active });
    await logAdminAction(getAdminId(c), 'user.toggle-active', `${body.active ? 'Activated' : 'Deactivated'} ${target.email}`, { itemId: id });
  }

  await db.update(users).set(updates).where(eq(users.id, id));

  return c.json({ ok: true });
});

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
  await logAdminAction(getAdminId(c), 'user.reset-password', `Reset password for ${user[0].email}`, { itemId: id });

  return c.json({ temporaryPassword });
});

// POST /admin/api/users — create user
app.post('/api/users', requireAdminAuth, async (c) => {
  const body = await c.req.json();
  const { email, displayName, password, role } = body || {};

  if (!email || typeof email !== 'string' || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
    return c.json({ error: 'Invalid email' }, 400);
  }
  if (!displayName || typeof displayName !== 'string' || displayName.trim().length < 1) {
    return c.json({ error: 'Display name required' }, 400);
  }
  if (!password || typeof password !== 'string' || password.length < 8) {
    return c.json({ error: 'Password must be at least 8 characters' }, 400);
  }
  const validRoles = ['admin', 'analyst', 'viewer'];
  const userRole = validRoles.includes(role) ? role : 'analyst';

  const trimmedEmail = email.trim().toLowerCase();
  const existing = await db.select({ id: users.id }).from(users).where(eq(users.email, trimmedEmail)).limit(1);
  if (existing.length > 0) {
    return c.json({ error: 'Email already registered' }, 409);
  }

  const passwordHash = await argon2.hash(password, { type: argon2.argon2id });
  const userId = nanoid();
  const now = new Date();

  await db.insert(users).values({
    id: userId,
    email: trimmedEmail,
    displayName: displayName.trim(),
    passwordHash,
    role: userRole,
    active: true,
    createdAt: now,
    updatedAt: now,
  });

  await logAdminAction(getAdminId(c), 'user.create', `Created user ${trimmedEmail} with role ${userRole}`, { itemId: userId });

  return c.json({ ok: true, user: { id: userId, email: trimmedEmail, displayName: displayName.trim(), role: userRole } }, 201);
});

// POST /admin/api/users/bulk
app.post('/api/users/bulk', requireAdminAuth, async (c) => {
  const body = await c.req.json();
  const { userIds, action, role } = body || {};

  if (!Array.isArray(userIds) || userIds.length === 0) {
    return c.json({ error: 'userIds array required' }, 400);
  }
  const validActions = ['changeRole', 'enable', 'disable'];
  if (!validActions.includes(action)) {
    return c.json({ error: 'Invalid action' }, 400);
  }

  const validIds = userIds.filter((uid): uid is string => typeof uid === 'string');
  if (validIds.length === 0) return c.json({ error: 'No valid userIds' }, 400);

  const updates: Record<string, unknown> = { updatedAt: new Date() };
  if (action === 'changeRole') {
    const validRoles = ['admin', 'analyst', 'viewer'];
    if (!validRoles.includes(role)) return c.json({ error: 'Invalid role' }, 400);
    updates.role = role;
  } else if (action === 'enable') {
    updates.active = true;
  } else {
    updates.active = false;
  }

  // Prevent disabling or demoting every admin — ensure at least one admin remains
  if (action === 'disable' || (action === 'changeRole' && role !== 'admin')) {
    const adminCount = await db.select({ id: users.id }).from(users)
      .where(and(eq(users.role, 'admin'), eq(users.active, true)));
    const remainingAdmins = adminCount.filter((u) => !validIds.includes(u.id));
    if (remainingAdmins.length === 0) {
      return c.json({ error: 'Cannot disable or demote all admin users — at least one must remain' }, 400);
    }
  }

  const result = await db.update(users).set(updates).where(inArray(users.id, validIds)).returning({ id: users.id });
  const affected = result.length;

  await logAdminAction(getAdminId(c), 'user.bulk', `Bulk ${action} on ${affected} user(s)${action === 'changeRole' ? ` to ${role}` : ''}`);

  return c.json({ ok: true, affected });
});

// GET /admin/api/users/export — CSV
app.get('/api/users/export', requireAdminAuth, async (c) => {
  const allUsers = await db.select({
    id: users.id,
    email: users.email,
    displayName: users.displayName,
    role: users.role,
    active: users.active,
    lastLoginAt: users.lastLoginAt,
    createdAt: users.createdAt,
  }).from(users)
    .where(not(ilike(users.email, '%@threatcaddy.internal')))
    .orderBy(users.createdAt);

  const csvEscape = (s: string | null | undefined) => {
    if (s == null) return '';
    const str = String(s);
    if (str.includes(',') || str.includes('"') || str.includes('\n')) {
      return '"' + str.replace(/"/g, '""') + '"';
    }
    return str;
  };

  const header = 'id,email,displayName,role,active,lastLoginAt,createdAt';
  const rows = allUsers.map(u =>
    [u.id, u.email, u.displayName, u.role, u.active, u.lastLoginAt?.toISOString() ?? '', u.createdAt.toISOString()]
      .map(v => csvEscape(String(v))).join(',')
  );

  await logAdminAction(getAdminId(c), 'user.export', `Exported ${allUsers.length} users as CSV`);

  c.header('Content-Type', 'text/csv');
  c.header('Content-Disposition', 'attachment; filename="users.csv"');
  return c.text([header, ...rows].join('\n'));
});

// GET /admin/api/users/:id/detail — composite detail
app.get('/api/users/:id/detail', requireAdminAuth, async (c) => {
  const id = c.req.param('id');
  const [user] = await db.select({
    id: users.id,
    email: users.email,
    displayName: users.displayName,
    role: users.role,
    active: users.active,
    lastLoginAt: users.lastLoginAt,
    createdAt: users.createdAt,
  }).from(users).where(eq(users.id, id)).limit(1);

  if (!user) return c.json({ error: 'User not found' }, 404);

  const activeSessions = await db.select({
    id: sessions.id,
    createdAt: sessions.createdAt,
    expiresAt: sessions.expiresAt,
  }).from(sessions).where(and(eq(sessions.userId, id), gte(sessions.expiresAt, new Date())));

  const memberships = await db.select({
    folderId: investigationMembers.folderId,
    role: investigationMembers.role,
    folderName: folders.name,
  }).from(investigationMembers)
    .leftJoin(folders, eq(folders.id, investigationMembers.folderId))
    .where(eq(investigationMembers.userId, id));

  const recentActivity = await db.select({
    id: activityLog.id,
    category: activityLog.category,
    action: activityLog.action,
    detail: activityLog.detail,
    itemId: activityLog.itemId,
    itemTitle: activityLog.itemTitle,
    folderId: activityLog.folderId,
    timestamp: activityLog.timestamp,
  }).from(activityLog)
    .where(eq(activityLog.userId, id))
    .orderBy(desc(activityLog.timestamp))
    .limit(50);

  return c.json({ user, sessions: activeSessions, memberships, recentActivity });
});

// ─── Change Admin Secret ─────────────────────────────────────────

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
  await logAdminAction(getAdminId(c), 'secret.change', 'Admin bootstrap secret changed');
  return c.json({ ok: true });
});

// ─── Sessions ────────────────────────────────────────────────────

app.get('/api/sessions', requireAdminAuth, async (c) => {
  const activeSessions = await db.select({
    id: sessions.id,
    userId: sessions.userId,
    userEmail: users.email,
    userDisplayName: users.displayName,
    createdAt: sessions.createdAt,
    expiresAt: sessions.expiresAt,
  }).from(sessions)
    .leftJoin(users, eq(users.id, sessions.userId))
    .where(gte(sessions.expiresAt, new Date()))
    .orderBy(desc(sessions.createdAt));

  return c.json({ sessions: activeSessions });
});

app.delete('/api/sessions/user/:userId', requireAdminAuth, async (c) => {
  const userId = c.req.param('userId');
  const result = await db.delete(sessions).where(eq(sessions.userId, userId)).returning({ id: sessions.id });
  await logAdminAction(getAdminId(c), 'session.force-logout', `Force-logged out user ${userId} (${result.length} sessions)`);
  return c.json({ ok: true, deletedCount: result.length });
});

app.delete('/api/sessions/all', requireAdminAuth, async (c) => {
  const result = await db.delete(sessions).returning({ id: sessions.id });
  await logAdminAction(getAdminId(c), 'session.force-logout-all', `Force-logged out all users (${result.length} sessions)`);
  return c.json({ ok: true, deletedCount: result.length });
});

export default app;
