import { Hono } from 'hono';
import { eq, and, count, sql } from 'drizzle-orm';
import { nanoid } from 'nanoid';
import { requireAuth } from '../middleware/auth.js';
import { checkInvestigationAccess } from '../middleware/access.js';
import { db } from '../db/index.js';
import { investigationMembers, folders, users, notes, tasks, timelineEvents, whiteboards, standaloneIOCs, chatThreads, posts, files, notifications } from '../db/schema.js';
import { createNotification } from '../services/notification-service.js';
import { logActivity } from '../services/audit-service.js';
import { revokeUserFolderAccess, broadcastToUser } from '../ws/handler.js';
import { getEntityCounts, getEntityCountsBatch } from '../services/sync-service.js';
import type { AuthUser } from '../types.js';
import { ErrorCodes } from '../types/error-codes.js';
import { unlink } from 'node:fs/promises';
import { join } from 'node:path';
import { logger } from '../lib/logger.js';

const FILE_STORAGE_PATH = process.env.FILE_STORAGE_PATH || '/data/files';

const app = new Hono<{ Variables: { user: AuthUser } }>();

app.use('*', requireAuth);

// GET /api/investigations — list investigations the user has access to
app.get('/', async (c) => {
  const user = c.get('user');
  const limit = Math.min(Math.max(parseInt(c.req.query('limit') || '50', 10) || 50, 1), 200);
  const offset = Math.max(parseInt(c.req.query('offset') || '0', 10) || 0, 0);

  const [totalResult, memberships] = await Promise.all([
    db
      .select({ count: count() })
      .from(investigationMembers)
      .where(eq(investigationMembers.userId, user.id)),
    db
      .select({
        folderId: investigationMembers.folderId,
        role: investigationMembers.role,
        joinedAt: investigationMembers.joinedAt,
        folderName: folders.name,
        folderStatus: folders.status,
        folderColor: folders.color,
        folderIcon: folders.icon,
        folderDescription: folders.description,
        folderClsLevel: folders.clsLevel,
        folderPapLevel: folders.papLevel,
        folderTags: folders.tags,
        folderCreatedAt: folders.createdAt,
        folderUpdatedAt: folders.updatedAt,
        memberCount: sql<number>`(select count(*) from investigation_members where folder_id = ${investigationMembers.folderId})`.as('member_count'),
      })
      .from(investigationMembers)
      .innerJoin(folders, eq(folders.id, investigationMembers.folderId))
      .where(eq(investigationMembers.userId, user.id))
      .limit(limit)
      .offset(offset),
  ]);

  const total = totalResult[0]?.count ?? 0;
  const folderIds = memberships.map((m) => m.folderId);

  // Batch entity counts: one query per table with GROUP BY
  const entityCountsMap = await getEntityCountsBatch(folderIds);

  const data = memberships.map((m) => ({
    folderId: m.folderId,
    role: m.role,
    joinedAt: m.joinedAt,
    folder: {
      name: m.folderName,
      status: m.folderStatus,
      color: m.folderColor,
      icon: m.folderIcon,
      description: m.folderDescription,
      clsLevel: m.folderClsLevel,
      papLevel: m.folderPapLevel,
      tags: m.folderTags,
      createdAt: m.folderCreatedAt,
      updatedAt: m.folderUpdatedAt,
    },
    entityCounts: entityCountsMap.get(m.folderId) ?? { notes: 0, tasks: 0, iocs: 0, events: 0, whiteboards: 0, chats: 0 },
    memberCount: m.memberCount,
  }));

  return c.json({ data, total, limit, offset });
});

// GET /api/investigations/:id/summary — detailed metadata without full entity data
app.get('/:id/summary', async (c) => {
  const user = c.get('user');
  const folderId = c.req.param('id');

  const hasAccess = await checkInvestigationAccess(user.id, folderId, 'viewer');
  if (!hasAccess) {
    return c.json({ error: 'No access to this investigation', code: ErrorCodes.NO_ACCESS }, 403);
  }

  const [folderResult, members, entityCounts, lastActivityResult] = await Promise.all([
    // Folder metadata
    db
      .select({
        name: folders.name,
        status: folders.status,
        color: folders.color,
        icon: folders.icon,
        description: folders.description,
        clsLevel: folders.clsLevel,
        papLevel: folders.papLevel,
        tags: folders.tags,
        createdAt: folders.createdAt,
        updatedAt: folders.updatedAt,
      })
      .from(folders)
      .where(eq(folders.id, folderId))
      .limit(1),

    // Members with user info
    db
      .select({
        id: investigationMembers.id,
        userId: investigationMembers.userId,
        role: investigationMembers.role,
        joinedAt: investigationMembers.joinedAt,
        displayName: users.displayName,
        email: users.email,
        avatarUrl: users.avatarUrl,
      })
      .from(investigationMembers)
      .innerJoin(users, eq(users.id, investigationMembers.userId))
      .where(eq(investigationMembers.folderId, folderId)),

    // Entity counts (parallel internally)
    getEntityCounts(folderId),

    // Last activity: most recent updatedAt across all entity tables
    Promise.all([
      db.select({ latest: sql<string>`max(${notes.updatedAt})` }).from(notes).where(eq(notes.folderId, folderId)),
      db.select({ latest: sql<string>`max(${tasks.updatedAt})` }).from(tasks).where(eq(tasks.folderId, folderId)),
      db.select({ latest: sql<string>`max(${standaloneIOCs.updatedAt})` }).from(standaloneIOCs).where(eq(standaloneIOCs.folderId, folderId)),
      db.select({ latest: sql<string>`max(${timelineEvents.updatedAt})` }).from(timelineEvents).where(eq(timelineEvents.folderId, folderId)),
      db.select({ latest: sql<string>`max(${whiteboards.updatedAt})` }).from(whiteboards).where(eq(whiteboards.folderId, folderId)),
      db.select({ latest: sql<string>`max(${chatThreads.updatedAt})` }).from(chatThreads).where(eq(chatThreads.folderId, folderId)),
    ]),
  ]);

  const folder = folderResult[0];
  if (!folder) {
    return c.json({ error: 'Investigation not found', code: ErrorCodes.INVESTIGATION_NOT_FOUND }, 404);
  }

  // Find the most recent updatedAt across all entity tables
  const latestDates = lastActivityResult
    .map((r) => r[0]?.latest)
    .filter((d): d is string => d != null)
    .map((d) => new Date(d).getTime());
  const lastActivity = latestDates.length > 0
    ? new Date(Math.max(...latestDates)).toISOString()
    : undefined;

  return c.json({
    folder,
    entityCounts,
    members,
    lastActivity,
  });
});

// GET /api/investigations/:id/members
app.get('/:id/members', async (c) => {
  const user = c.get('user');
  const folderId = c.req.param('id');

  const hasAccess = await checkInvestigationAccess(user.id, folderId, 'viewer');
  if (!hasAccess) {
    return c.json({ error: 'No access to this investigation', code: ErrorCodes.NO_ACCESS }, 403);
  }

  const members = await db
    .select({
      id: investigationMembers.id,
      userId: investigationMembers.userId,
      role: investigationMembers.role,
      joinedAt: investigationMembers.joinedAt,
      displayName: users.displayName,
      email: users.email,
      avatarUrl: users.avatarUrl,
    })
    .from(investigationMembers)
    .innerJoin(users, eq(users.id, investigationMembers.userId))
    .where(eq(investigationMembers.folderId, folderId));

  return c.json(members);
});

// POST /api/investigations/:id/members — add member
app.post('/:id/members', async (c) => {
  const user = c.get('user');
  const folderId = c.req.param('id');
  const body = await c.req.json();
  const { userId, role = 'editor' } = body;

  if (!['owner', 'editor', 'viewer'].includes(role)) {
    return c.json({ error: 'Invalid role', code: ErrorCodes.INVALID_ROLE }, 400);
  }

  // Check folder exists
  const [folder] = await db.select({ id: folders.id, name: folders.name }).from(folders).where(eq(folders.id, folderId)).limit(1);
  if (!folder) {
    return c.json({ error: 'Investigation not found', code: ErrorCodes.INVESTIGATION_NOT_FOUND }, 404);
  }

  // Check requester is owner
  const requesterMembership = await db
    .select()
    .from(investigationMembers)
    .where(
      and(
        eq(investigationMembers.folderId, folderId),
        eq(investigationMembers.userId, user.id)
      )
    )
    .limit(1);

  if (requesterMembership.length === 0 || requesterMembership[0].role !== 'owner') {
    return c.json({ error: 'Only investigation owners can add members', code: ErrorCodes.OWNER_REQUIRED }, 403);
  }

  // Check target user exists
  const targetUser = await db.select().from(users).where(eq(users.id, userId)).limit(1);
  if (targetUser.length === 0) {
    return c.json({ error: 'User not found', code: ErrorCodes.USER_NOT_FOUND }, 404);
  }

  // Check not already a member
  const existing = await db.select({ id: investigationMembers.id }).from(investigationMembers)
    .where(and(eq(investigationMembers.folderId, folderId), eq(investigationMembers.userId, userId)))
    .limit(1);
  if (existing.length > 0) {
    return c.json({ error: 'User already a member', code: ErrorCodes.USER_ALREADY_MEMBER }, 409);
  }

  await db.insert(investigationMembers).values({
    id: nanoid(),
    folderId,
    userId,
    role,
  });

  await createNotification({
    userId,
    type: 'invite',
    sourceUserId: user.id,
    folderId,
    message: `${user.displayName} added you to ${folder.name}`,
  });

  // Notify the invited user via WS so their client pulls the investigation data
  broadcastToUser(userId, { type: 'folder-invite', folderId });

  return c.json({ ok: true }, 201);
});

// PATCH /api/investigations/:id/members/:userId — update member role
app.patch('/:id/members/:userId', async (c) => {
  const user = c.get('user');
  const folderId = c.req.param('id');
  const targetUserId = c.req.param('userId');
  const body = await c.req.json();
  const { role } = body;

  if (!['owner', 'editor', 'viewer'].includes(role)) {
    return c.json({ error: 'Invalid role', code: ErrorCodes.INVALID_ROLE }, 400);
  }

  // Check permissions — must be owner
  const requesterMembership = await db
    .select()
    .from(investigationMembers)
    .where(
      and(
        eq(investigationMembers.folderId, folderId),
        eq(investigationMembers.userId, user.id)
      )
    )
    .limit(1);

  if (requesterMembership.length === 0 || requesterMembership[0].role !== 'owner') {
    return c.json({ error: 'Insufficient permissions', code: ErrorCodes.INSUFFICIENT_PERMISSIONS }, 403);
  }

  const result = await db
    .update(investigationMembers)
    .set({ role })
    .where(
      and(
        eq(investigationMembers.folderId, folderId),
        eq(investigationMembers.userId, targetUserId)
      )
    )
    .returning({ id: investigationMembers.id });

  if (result.length === 0) {
    return c.json({ error: 'Member not found', code: ErrorCodes.MEMBER_NOT_FOUND }, 404);
  }

  return c.json({ ok: true });
});

// DELETE /api/investigations/:id/members/:userId — remove member
app.delete('/:id/members/:userId', async (c) => {
  const user = c.get('user');
  const folderId = c.req.param('id');
  const targetUserId = c.req.param('userId');

  // Users can remove themselves, or owners can remove others
  if (user.id !== targetUserId) {
    const requesterMembership = await db
      .select()
      .from(investigationMembers)
      .where(
        and(
          eq(investigationMembers.folderId, folderId),
          eq(investigationMembers.userId, user.id)
        )
      )
      .limit(1);

    if (requesterMembership.length === 0 || requesterMembership[0].role !== 'owner') {
      return c.json({ error: 'Insufficient permissions', code: ErrorCodes.INSUFFICIENT_PERMISSIONS }, 403);
    }
  }

  const result = await db
    .delete(investigationMembers)
    .where(
      and(
        eq(investigationMembers.folderId, folderId),
        eq(investigationMembers.userId, targetUserId)
      )
    )
    .returning({ id: investigationMembers.id });

  if (result.length === 0) {
    return c.json({ error: 'Member not found', code: ErrorCodes.MEMBER_NOT_FOUND }, 404);
  }

  // Revoke WS subscriptions immediately so removed user can't receive further data
  revokeUserFolderAccess(targetUserId, folderId);

  await logActivity({
    userId: user.id,
    category: 'investigation',
    action: 'remove-member',
    detail: `Removed user ${targetUserId} from investigation`,
    folderId,
  });

  return c.json({ ok: true });
});

// DELETE /api/investigations/:id — delete investigation (owner only)
app.delete('/:id', async (c) => {
  const user = c.get('user');
  const folderId = c.req.param('id');

  // Must be owner
  const membership = await db.select()
    .from(investigationMembers)
    .where(and(eq(investigationMembers.folderId, folderId), eq(investigationMembers.userId, user.id)))
    .limit(1);

  if (membership.length === 0 || membership[0].role !== 'owner') {
    return c.json({ error: 'Only investigation owners can delete investigations', code: ErrorCodes.OWNER_REQUIRED }, 403);
  }

  const [folder] = await db.select({ id: folders.id, name: folders.name }).from(folders).where(eq(folders.id, folderId)).limit(1);
  if (!folder) {
    return c.json({ error: 'Investigation not found', code: ErrorCodes.INVESTIGATION_NOT_FOUND }, 404);
  }

  // Delete files from disk
  const folderFiles = await db.select({ storagePath: files.storagePath, thumbnailPath: files.thumbnailPath })
    .from(files).where(eq(files.folderId, folderId));
  for (const f of folderFiles) {
    try { await unlink(join(FILE_STORAGE_PATH, f.storagePath)); } catch (err) { logger.warn('Failed to unlink file', { path: f.storagePath, error: String(err) }); }
    if (f.thumbnailPath) {
      try { await unlink(join(FILE_STORAGE_PATH, f.thumbnailPath)); } catch (err) { logger.warn('Failed to unlink file', { path: f.thumbnailPath, error: String(err) }); }
    }
  }

  // Delete all content atomically
  await db.transaction(async (tx) => {
    await tx.delete(notes).where(eq(notes.folderId, folderId));
    await tx.delete(tasks).where(eq(tasks.folderId, folderId));
    await tx.delete(timelineEvents).where(eq(timelineEvents.folderId, folderId));
    await tx.delete(whiteboards).where(eq(whiteboards.folderId, folderId));
    await tx.delete(standaloneIOCs).where(eq(standaloneIOCs.folderId, folderId));
    await tx.delete(chatThreads).where(eq(chatThreads.folderId, folderId));
    await tx.delete(posts).where(eq(posts.folderId, folderId));
    await tx.delete(files).where(eq(files.folderId, folderId));
    await tx.delete(notifications).where(eq(notifications.folderId, folderId));
    await tx.delete(investigationMembers).where(eq(investigationMembers.folderId, folderId));
    await tx.delete(folders).where(eq(folders.id, folderId));
  });

  await logActivity({
    userId: user.id,
    category: 'investigation',
    action: 'delete',
    detail: `Deleted investigation "${folder.name}"`,
    folderId,
  });

  return c.json({ ok: true });
});

// POST /api/investigations/:id/invite — invite by email
app.post('/:id/invite', async (c) => {
  const user = c.get('user');
  const folderId = c.req.param('id');
  const body = await c.req.json();
  const { email, role = 'editor' } = body;

  if (!['owner', 'editor', 'viewer'].includes(role)) {
    return c.json({ error: 'Invalid role', code: ErrorCodes.INVALID_ROLE }, 400);
  }

  // Check folder exists
  const [folder] = await db.select({ id: folders.id, name: folders.name }).from(folders).where(eq(folders.id, folderId)).limit(1);
  if (!folder) {
    return c.json({ error: 'Investigation not found', code: ErrorCodes.INVESTIGATION_NOT_FOUND }, 404);
  }

  // Find user by email
  const targetUser = await db.select().from(users).where(eq(users.email, email)).limit(1);
  if (targetUser.length === 0) {
    return c.json({ error: 'No user with that email found', code: ErrorCodes.USER_NOT_FOUND }, 404);
  }

  const userId = targetUser[0].id;

  // Check requester is owner
  const requesterMembership = await db
    .select()
    .from(investigationMembers)
    .where(
      and(
        eq(investigationMembers.folderId, folderId),
        eq(investigationMembers.userId, user.id)
      )
    )
    .limit(1);

  if (requesterMembership.length === 0 || requesterMembership[0].role !== 'owner') {
    return c.json({ error: 'Only investigation owners can invite members', code: ErrorCodes.OWNER_REQUIRED }, 403);
  }

  // Check not already a member
  const existing = await db.select({ id: investigationMembers.id }).from(investigationMembers)
    .where(and(eq(investigationMembers.folderId, folderId), eq(investigationMembers.userId, userId)))
    .limit(1);
  if (existing.length > 0) {
    return c.json({ error: 'User already a member', code: ErrorCodes.USER_ALREADY_MEMBER }, 409);
  }

  await db.insert(investigationMembers).values({
    id: nanoid(),
    folderId,
    userId,
    role,
  });

  await createNotification({
    userId,
    type: 'invite',
    sourceUserId: user.id,
    folderId,
    message: `${user.displayName} invited you to ${folder.name}`,
  });

  // Notify the invited user via WS so their client pulls the investigation data
  broadcastToUser(userId, { type: 'folder-invite', folderId });

  return c.json({ ok: true }, 201);
});

export default app;
