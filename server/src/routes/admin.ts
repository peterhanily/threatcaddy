import { Hono } from 'hono';
import { eq, count, sql, desc, and, gte, lte, ilike, or } from 'drizzle-orm';
import * as argon2 from 'argon2';
import { nanoid } from 'nanoid';
import { unlink } from 'node:fs/promises';
import { db } from '../db/index.js';
import {
  users, folders, allowedEmails, sessions, activityLog,
  investigationMembers, notes, tasks, timelineEvents, whiteboards,
  standaloneIOCs, chatThreads, posts, files, notifications,
} from '../db/schema.js';
import {
  verifyAdminSecret, changeAdminSecret, getRegistrationMode, setRegistrationMode,
  getSessionSettings, setSessionSettings, ADMIN_SYSTEM_USER_ID,
} from '../services/admin-secret.js';
import { getRetentionSettings, setRetentionSettings } from '../services/cleanup-service.js';
import { logActivity } from '../services/audit-service.js';
import { signAdminToken, requireAdminAuth } from '../middleware/admin-auth.js';
import { getAdminHtml } from './admin-html.js';
import { logger } from '../lib/logger.js';
import { randomBytes } from 'node:crypto';

const app = new Hono();

// ─── Admin audit helper ──────────────────────────────────────────

function logAdminAction(action: string, detail: string, opts?: { itemId?: string; itemTitle?: string; folderId?: string }) {
  return logActivity({
    userId: ADMIN_SYSTEM_USER_ID,
    category: 'admin',
    action,
    detail,
    ...opts,
  });
}

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
  }).from(users).orderBy(users.createdAt);

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
    await logAdminAction('user.role-change', `Changed ${target.email} role to ${body.role}`, { itemId: id });
  }

  if (body.active !== undefined) {
    if (typeof body.active !== 'boolean') {
      return c.json({ error: 'Invalid active value' }, 400);
    }
    updates.active = body.active;
    logger.info('Admin action: user active status changed', { targetUserId: id, active: body.active });
    await logAdminAction('user.toggle-active', `${body.active ? 'Activated' : 'Deactivated'} ${target.email}`, { itemId: id });
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
  await logAdminAction('user.reset-password', `Reset password for ${user[0].email}`, { itemId: id });

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

  await logAdminAction('user.create', `Created user ${trimmedEmail} with role ${userRole}`, { itemId: userId });

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

  let affected = 0;
  for (const uid of userIds) {
    if (typeof uid !== 'string') continue;
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
    const result = await db.update(users).set(updates).where(eq(users.id, uid)).returning({ id: users.id });
    if (result.length > 0) affected++;
  }

  await logAdminAction('user.bulk', `Bulk ${action} on ${affected} user(s)${action === 'changeRole' ? ` to ${role}` : ''}`);

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
  }).from(users).orderBy(users.createdAt);

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

  await logAdminAction('user.export', `Exported ${allUsers.length} users as CSV`);

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
  await logAdminAction('secret.change', 'Admin secret changed');
  return c.json({ ok: true });
});

// ─── Stats ───────────────────────────────────────────────────────

app.get('/api/stats', requireAdminAuth, async (c) => {
  const [totalResult] = await db.select({ count: count() }).from(users);
  const [activeResult] = await db.select({ count: count() }).from(users).where(eq(users.active, true));
  const [invResult] = await db.select({ count: count() }).from(folders);
  const [sessionResult] = await db.select({ count: count() }).from(sessions).where(gte(sessions.expiresAt, new Date()));
  const twentyFourHoursAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const [auditResult] = await db.select({ count: count() }).from(activityLog).where(gte(activityLog.timestamp, twentyFourHoursAgo));

  return c.json({
    totalUsers: totalResult.count,
    activeUsers: activeResult.count,
    investigations: invResult.count,
    activeSessions: sessionResult.count,
    auditLogEntries24h: auditResult.count,
  });
});

// ─── Settings ────────────────────────────────────────────────────

app.get('/api/settings', requireAdminAuth, async (c) => {
  const registrationMode = await getRegistrationMode();
  const sessionSettings = await getSessionSettings();
  const retentionSettings = await getRetentionSettings();
  return c.json({ registrationMode, ...sessionSettings, ...retentionSettings });
});

app.patch('/api/settings', requireAdminAuth, async (c) => {
  const body = await c.req.json();
  const changedSettings: string[] = [];

  if (body.registrationMode !== undefined) {
    const mode = body.registrationMode;
    if (mode !== 'invite' && mode !== 'open') {
      return c.json({ error: 'Invalid registrationMode, must be "invite" or "open"' }, 400);
    }
    await setRegistrationMode(mode);
    changedSettings.push(`registrationMode=${mode}`);
    logger.info('Admin action: registration mode changed', { registrationMode: mode });
  }

  if (body.ttlHours !== undefined || body.maxPerUser !== undefined) {
    const current = await getSessionSettings();
    const ttlHours = typeof body.ttlHours === 'number' && body.ttlHours >= 1 ? Math.floor(body.ttlHours) : current.ttlHours;
    const maxPerUser = typeof body.maxPerUser === 'number' && body.maxPerUser >= 0 ? Math.floor(body.maxPerUser) : current.maxPerUser;
    await setSessionSettings(ttlHours, maxPerUser);
    changedSettings.push(`ttlHours=${ttlHours}`, `maxPerUser=${maxPerUser}`);
    logger.info('Admin action: session settings changed', { ttlHours, maxPerUser });
  }

  if (body.notificationRetentionDays !== undefined || body.auditLogRetentionDays !== undefined) {
    const current = await getRetentionSettings();
    const notifDays = typeof body.notificationRetentionDays === 'number' &&
      Number.isInteger(body.notificationRetentionDays) &&
      body.notificationRetentionDays >= 1 && body.notificationRetentionDays <= 3650
      ? body.notificationRetentionDays : current.notificationRetentionDays;
    const auditDays = typeof body.auditLogRetentionDays === 'number' &&
      Number.isInteger(body.auditLogRetentionDays) &&
      body.auditLogRetentionDays >= 1 && body.auditLogRetentionDays <= 3650
      ? body.auditLogRetentionDays : current.auditLogRetentionDays;
    await setRetentionSettings(notifDays, auditDays);
    changedSettings.push(`notifRetention=${notifDays}`, `auditRetention=${auditDays}`);
    logger.info('Admin action: retention settings changed', { notifDays, auditDays });
  }

  if (changedSettings.length > 0) {
    await logAdminAction('settings.update', `Updated ${changedSettings.join(', ')}`);
  }

  const registrationMode = await getRegistrationMode();
  const sessionSettings = await getSessionSettings();
  const retentionSettings = await getRetentionSettings();
  return c.json({ ok: true, registrationMode, ...sessionSettings, ...retentionSettings });
});

// ─── Allowed Emails ──────────────────────────────────────────────

app.get('/api/allowed-emails', requireAdminAuth, async (c) => {
  const emails = await db.select().from(allowedEmails).orderBy(allowedEmails.createdAt);
  return c.json({ emails });
});

app.post('/api/allowed-emails', requireAdminAuth, async (c) => {
  const body = await c.req.json();
  const email = body?.email?.trim()?.toLowerCase();
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return c.json({ error: 'Invalid email' }, 400);
  }
  await db.insert(allowedEmails).values({ email }).onConflictDoNothing();
  logger.info('Admin action: email added to allowlist', { email });
  await logAdminAction('allowlist.add', `Added ${email}`);
  return c.json({ ok: true, email });
});

app.delete('/api/allowed-emails/:email', requireAdminAuth, async (c) => {
  const email = decodeURIComponent(c.req.param('email'));
  const result = await db.delete(allowedEmails).where(eq(allowedEmails.email, email)).returning({ email: allowedEmails.email });
  if (result.length === 0) {
    return c.json({ error: 'Email not found' }, 404);
  }
  logger.info('Admin action: email removed from allowlist', { email });
  await logAdminAction('allowlist.remove', `Removed ${email}`);
  return c.json({ ok: true });
});

// ─── Investigations ──────────────────────────────────────────────

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

// GET /admin/api/investigations/:id/detail
app.get('/api/investigations/:id/detail', requireAdminAuth, async (c) => {
  const id = c.req.param('id');
  const [folder] = await db.select({
    id: folders.id,
    name: folders.name,
    status: folders.status,
    color: folders.color,
    description: folders.description,
    createdAt: folders.createdAt,
    updatedAt: folders.updatedAt,
    creatorName: users.displayName,
    creatorEmail: users.email,
  }).from(folders)
    .innerJoin(users, eq(users.id, folders.createdBy))
    .where(eq(folders.id, id)).limit(1);

  if (!folder) return c.json({ error: 'Investigation not found' }, 404);

  const members = await db.select({
    id: investigationMembers.id,
    userId: investigationMembers.userId,
    role: investigationMembers.role,
    joinedAt: investigationMembers.joinedAt,
    userEmail: users.email,
    userDisplayName: users.displayName,
  }).from(investigationMembers)
    .leftJoin(users, eq(users.id, investigationMembers.userId))
    .where(eq(investigationMembers.folderId, id));

  // Entity counts
  const [notesCount] = await db.select({ count: count() }).from(notes).where(eq(notes.folderId, id));
  const [tasksCount] = await db.select({ count: count() }).from(tasks).where(eq(tasks.folderId, id));
  const [eventsCount] = await db.select({ count: count() }).from(timelineEvents).where(eq(timelineEvents.folderId, id));
  const [wbCount] = await db.select({ count: count() }).from(whiteboards).where(eq(whiteboards.folderId, id));
  const [iocCount] = await db.select({ count: count() }).from(standaloneIOCs).where(eq(standaloneIOCs.folderId, id));
  const [chatCount] = await db.select({ count: count() }).from(chatThreads).where(eq(chatThreads.folderId, id));
  const [fileCount] = await db.select({ count: count() }).from(files).where(eq(files.folderId, id));

  return c.json({
    investigation: folder,
    members,
    entityCounts: {
      notes: notesCount.count,
      tasks: tasksCount.count,
      timelineEvents: eventsCount.count,
      whiteboards: wbCount.count,
      standaloneIOCs: iocCount.count,
      chatThreads: chatCount.count,
      files: fileCount.count,
    },
  });
});

// PATCH /admin/api/investigations/:id — update status
app.patch('/api/investigations/:id', requireAdminAuth, async (c) => {
  const id = c.req.param('id');
  const body = await c.req.json();
  const { status } = body || {};

  const validStatuses = ['active', 'closed', 'archived'];
  if (!validStatuses.includes(status)) {
    return c.json({ error: 'Invalid status' }, 400);
  }

  const [folder] = await db.select({ name: folders.name }).from(folders).where(eq(folders.id, id)).limit(1);
  if (!folder) return c.json({ error: 'Investigation not found' }, 404);

  const updates: Record<string, unknown> = { status, updatedAt: new Date() };
  if (status === 'closed') {
    updates.closedAt = new Date();
  }

  await db.update(folders).set(updates).where(eq(folders.id, id));
  await logAdminAction('investigation.status-change', `Changed "${folder.name}" status to ${status}`, { folderId: id });

  return c.json({ ok: true });
});

// POST /admin/api/investigations/:id/members — add member
app.post('/api/investigations/:id/members', requireAdminAuth, async (c) => {
  const folderId = c.req.param('id');
  const body = await c.req.json();
  const { userId, role } = body || {};

  if (!userId || typeof userId !== 'string') return c.json({ error: 'userId required' }, 400);
  const validRoles = ['owner', 'editor', 'viewer'];
  const memberRole = validRoles.includes(role) ? role : 'editor';

  // Check folder and user exist
  const [folder] = await db.select({ id: folders.id }).from(folders).where(eq(folders.id, folderId)).limit(1);
  if (!folder) return c.json({ error: 'Investigation not found' }, 404);
  const [user] = await db.select({ id: users.id, email: users.email }).from(users).where(eq(users.id, userId)).limit(1);
  if (!user) return c.json({ error: 'User not found' }, 404);

  await db.insert(investigationMembers).values({
    id: nanoid(),
    folderId,
    userId,
    role: memberRole,
  }).onConflictDoNothing();

  await logAdminAction('investigation.add-member', `Added ${user.email} as ${memberRole} to investigation`, { folderId });

  return c.json({ ok: true });
});

// PATCH /admin/api/investigations/:id/members/:userId — update member role
app.patch('/api/investigations/:id/members/:userId', requireAdminAuth, async (c) => {
  const folderId = c.req.param('id');
  const userId = c.req.param('userId');
  const body = await c.req.json();
  const { role } = body || {};

  const validRoles = ['owner', 'editor', 'viewer'];
  if (!validRoles.includes(role)) return c.json({ error: 'Invalid role' }, 400);

  const result = await db.update(investigationMembers)
    .set({ role })
    .where(and(eq(investigationMembers.folderId, folderId), eq(investigationMembers.userId, userId)))
    .returning({ id: investigationMembers.id });

  if (result.length === 0) return c.json({ error: 'Member not found' }, 404);

  await logAdminAction('investigation.update-member', `Changed member role to ${role}`, { folderId });
  return c.json({ ok: true });
});

// DELETE /admin/api/investigations/:id/members/:userId
app.delete('/api/investigations/:id/members/:userId', requireAdminAuth, async (c) => {
  const folderId = c.req.param('id');
  const userId = c.req.param('userId');

  const result = await db.delete(investigationMembers)
    .where(and(eq(investigationMembers.folderId, folderId), eq(investigationMembers.userId, userId)))
    .returning({ id: investigationMembers.id });

  if (result.length === 0) return c.json({ error: 'Member not found' }, 404);

  await logAdminAction('investigation.remove-member', `Removed member from investigation`, { folderId });
  return c.json({ ok: true });
});

// DELETE /admin/api/investigations/:id/content — purge all content
app.delete('/api/investigations/:id/content', requireAdminAuth, async (c) => {
  const folderId = c.req.param('id');
  const body = await c.req.json();
  const { confirmName } = body || {};

  const [folder] = await db.select({ name: folders.name }).from(folders).where(eq(folders.id, folderId)).limit(1);
  if (!folder) return c.json({ error: 'Investigation not found' }, 404);

  if (confirmName !== folder.name) {
    return c.json({ error: 'Confirmation name does not match' }, 400);
  }

  // Delete files from disk first
  const folderFiles = await db.select({ storagePath: files.storagePath, thumbnailPath: files.thumbnailPath })
    .from(files).where(eq(files.folderId, folderId));
  for (const f of folderFiles) {
    try { await unlink(f.storagePath); } catch { /* ignore */ }
    if (f.thumbnailPath) {
      try { await unlink(f.thumbnailPath); } catch { /* ignore */ }
    }
  }

  // Hard delete all entities
  const deleted: Record<string, number> = {};
  const delNotes = await db.delete(notes).where(eq(notes.folderId, folderId)).returning({ id: notes.id });
  deleted.notes = delNotes.length;
  const delTasks = await db.delete(tasks).where(eq(tasks.folderId, folderId)).returning({ id: tasks.id });
  deleted.tasks = delTasks.length;
  const delEvents = await db.delete(timelineEvents).where(eq(timelineEvents.folderId, folderId)).returning({ id: timelineEvents.id });
  deleted.timelineEvents = delEvents.length;
  const delWb = await db.delete(whiteboards).where(eq(whiteboards.folderId, folderId)).returning({ id: whiteboards.id });
  deleted.whiteboards = delWb.length;
  const delIoc = await db.delete(standaloneIOCs).where(eq(standaloneIOCs.folderId, folderId)).returning({ id: standaloneIOCs.id });
  deleted.standaloneIOCs = delIoc.length;
  const delChat = await db.delete(chatThreads).where(eq(chatThreads.folderId, folderId)).returning({ id: chatThreads.id });
  deleted.chatThreads = delChat.length;
  const delPosts = await db.delete(posts).where(eq(posts.folderId, folderId)).returning({ id: posts.id });
  deleted.posts = delPosts.length;
  const delFiles = await db.delete(files).where(eq(files.folderId, folderId)).returning({ id: files.id });
  deleted.files = delFiles.length;
  const delNotif = await db.delete(notifications).where(eq(notifications.folderId, folderId)).returning({ id: notifications.id });
  deleted.notifications = delNotif.length;

  await logAdminAction('investigation.purge', `Purged all content from "${folder.name}"`, { folderId });

  return c.json({ ok: true, deleted });
});

// ─── Audit Log ───────────────────────────────────────────────────

app.get('/api/audit-log', requireAdminAuth, async (c) => {
  const page = Math.max(1, parseInt(c.req.query('page') || '1', 10));
  const pageSize = Math.min(200, Math.max(1, parseInt(c.req.query('pageSize') || '50', 10)));
  const userId = c.req.query('userId');
  const category = c.req.query('category');
  const action = c.req.query('action');
  const folderId = c.req.query('folderId');
  const dateFrom = c.req.query('dateFrom');
  const dateTo = c.req.query('dateTo');
  const search = c.req.query('search');

  const conditions = [];
  if (userId) conditions.push(eq(activityLog.userId, userId));
  if (category) conditions.push(eq(activityLog.category, category));
  if (action) conditions.push(eq(activityLog.action, action));
  if (folderId) conditions.push(eq(activityLog.folderId, folderId));
  if (dateFrom) conditions.push(gte(activityLog.timestamp, new Date(dateFrom)));
  if (dateTo) conditions.push(lte(activityLog.timestamp, new Date(dateTo)));
  if (search) {
    conditions.push(or(
      ilike(activityLog.detail, `%${search}%`),
      ilike(activityLog.itemTitle, `%${search}%`),
    )!);
  }

  const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

  const [totalResult] = await db.select({ count: count() }).from(activityLog).where(whereClause);

  const entries = await db.select({
    id: activityLog.id,
    userId: activityLog.userId,
    userDisplayName: users.displayName,
    userEmail: users.email,
    category: activityLog.category,
    action: activityLog.action,
    detail: activityLog.detail,
    itemId: activityLog.itemId,
    itemTitle: activityLog.itemTitle,
    folderId: activityLog.folderId,
    folderName: folders.name,
    timestamp: activityLog.timestamp,
  }).from(activityLog)
    .leftJoin(users, eq(users.id, activityLog.userId))
    .leftJoin(folders, eq(folders.id, activityLog.folderId))
    .where(whereClause)
    .orderBy(desc(activityLog.timestamp))
    .limit(pageSize)
    .offset((page - 1) * pageSize);

  return c.json({ entries, total: totalResult.count, page, pageSize });
});

// GET /admin/api/audit-log/export — CSV
app.get('/api/audit-log/export', requireAdminAuth, async (c) => {
  const userId = c.req.query('userId');
  const category = c.req.query('category');
  const action = c.req.query('action');
  const folderId = c.req.query('folderId');
  const dateFrom = c.req.query('dateFrom');
  const dateTo = c.req.query('dateTo');
  const search = c.req.query('search');

  const conditions = [];
  if (userId) conditions.push(eq(activityLog.userId, userId));
  if (category) conditions.push(eq(activityLog.category, category));
  if (action) conditions.push(eq(activityLog.action, action));
  if (folderId) conditions.push(eq(activityLog.folderId, folderId));
  if (dateFrom) conditions.push(gte(activityLog.timestamp, new Date(dateFrom)));
  if (dateTo) conditions.push(lte(activityLog.timestamp, new Date(dateTo)));
  if (search) {
    conditions.push(or(
      ilike(activityLog.detail, `%${search}%`),
      ilike(activityLog.itemTitle, `%${search}%`),
    )!);
  }

  const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

  const entries = await db.select({
    id: activityLog.id,
    userId: activityLog.userId,
    userEmail: users.email,
    category: activityLog.category,
    action: activityLog.action,
    detail: activityLog.detail,
    itemId: activityLog.itemId,
    itemTitle: activityLog.itemTitle,
    folderId: activityLog.folderId,
    folderName: folders.name,
    timestamp: activityLog.timestamp,
  }).from(activityLog)
    .leftJoin(users, eq(users.id, activityLog.userId))
    .leftJoin(folders, eq(folders.id, activityLog.folderId))
    .where(whereClause)
    .orderBy(desc(activityLog.timestamp))
    .limit(50000);

  const csvEscape = (s: string | null | undefined) => {
    if (s == null) return '';
    const str = String(s);
    if (str.includes(',') || str.includes('"') || str.includes('\n')) {
      return '"' + str.replace(/"/g, '""') + '"';
    }
    return str;
  };

  const header = 'id,timestamp,userId,userEmail,category,action,detail,itemId,itemTitle,folderId,folderName';
  const rows = entries.map(e =>
    [e.id, e.timestamp?.toISOString() ?? '', e.userId, e.userEmail ?? '', e.category, e.action, e.detail,
     e.itemId ?? '', e.itemTitle ?? '', e.folderId ?? '', e.folderName ?? '']
      .map(v => csvEscape(String(v))).join(',')
  );

  await logAdminAction('audit-log.export', `Exported ${entries.length} audit log entries as CSV`);

  c.header('Content-Type', 'text/csv');
  c.header('Content-Disposition', 'attachment; filename="audit-log.csv"');
  return c.text([header, ...rows].join('\n'));
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
  await logAdminAction('session.force-logout', `Force-logged out user ${userId} (${result.length} sessions)`);
  return c.json({ ok: true, deletedCount: result.length });
});

app.delete('/api/sessions/all', requireAdminAuth, async (c) => {
  const result = await db.delete(sessions).returning({ id: sessions.id });
  await logAdminAction('session.force-logout-all', `Force-logged out all users (${result.length} sessions)`);
  return c.json({ ok: true, deletedCount: result.length });
});

export default app;
