import { Hono } from 'hono';
import { eq, and } from 'drizzle-orm';
import { nanoid } from 'nanoid';
import { requireAuth } from '../middleware/auth.js';
import { checkInvestigationAccess } from '../middleware/access.js';
import { db } from '../db/index.js';
import { investigationMembers, folders, users, notes, tasks, timelineEvents, whiteboards, standaloneIOCs, chatThreads, posts, files, notifications } from '../db/schema.js';
import { createNotification } from '../services/notification-service.js';
import { logActivity } from '../services/audit-service.js';
import { revokeUserFolderAccess, broadcastToUser } from '../ws/handler.js';
import type { AuthUser } from '../types.js';
import { unlink } from 'node:fs/promises';

const app = new Hono<{ Variables: { user: AuthUser } }>();

app.use('*', requireAuth);

// GET /api/investigations — list investigations the user has access to
app.get('/', async (c) => {
  const user = c.get('user');

  const memberships = await db
    .select({
      folderId: investigationMembers.folderId,
      role: investigationMembers.role,
      joinedAt: investigationMembers.joinedAt,
      folderName: folders.name,
      folderStatus: folders.status,
      folderColor: folders.color,
      folderIcon: folders.icon,
    })
    .from(investigationMembers)
    .innerJoin(folders, eq(folders.id, investigationMembers.folderId))
    .where(eq(investigationMembers.userId, user.id));

  return c.json(memberships);
});

// GET /api/investigations/:id/members
app.get('/:id/members', async (c) => {
  const user = c.get('user');
  const folderId = c.req.param('id');

  const hasAccess = await checkInvestigationAccess(user.id, folderId, 'viewer');
  if (!hasAccess) {
    return c.json({ error: 'No access to this investigation' }, 403);
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
    return c.json({ error: 'Invalid role' }, 400);
  }

  // Check folder exists
  const [folder] = await db.select({ id: folders.id, name: folders.name }).from(folders).where(eq(folders.id, folderId)).limit(1);
  if (!folder) {
    return c.json({ error: 'Investigation not found' }, 404);
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
    return c.json({ error: 'Only investigation owners can add members' }, 403);
  }

  // Check target user exists
  const targetUser = await db.select().from(users).where(eq(users.id, userId)).limit(1);
  if (targetUser.length === 0) {
    return c.json({ error: 'User not found' }, 404);
  }

  // Check not already a member
  const existing = await db.select({ id: investigationMembers.id }).from(investigationMembers)
    .where(and(eq(investigationMembers.folderId, folderId), eq(investigationMembers.userId, userId)))
    .limit(1);
  if (existing.length > 0) {
    return c.json({ error: 'User already a member' }, 409);
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
    return c.json({ error: 'Invalid role' }, 400);
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
    return c.json({ error: 'Insufficient permissions' }, 403);
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
    return c.json({ error: 'Member not found' }, 404);
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
      return c.json({ error: 'Insufficient permissions' }, 403);
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
    return c.json({ error: 'Member not found' }, 404);
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
    return c.json({ error: 'Only investigation owners can delete investigations' }, 403);
  }

  const [folder] = await db.select({ id: folders.id, name: folders.name }).from(folders).where(eq(folders.id, folderId)).limit(1);
  if (!folder) {
    return c.json({ error: 'Investigation not found' }, 404);
  }

  // Delete files from disk
  const folderFiles = await db.select({ storagePath: files.storagePath, thumbnailPath: files.thumbnailPath })
    .from(files).where(eq(files.folderId, folderId));
  for (const f of folderFiles) {
    try { await unlink(f.storagePath); } catch { /* ignore */ }
    if (f.thumbnailPath) {
      try { await unlink(f.thumbnailPath); } catch { /* ignore */ }
    }
  }

  // Delete all content
  await db.delete(notes).where(eq(notes.folderId, folderId));
  await db.delete(tasks).where(eq(tasks.folderId, folderId));
  await db.delete(timelineEvents).where(eq(timelineEvents.folderId, folderId));
  await db.delete(whiteboards).where(eq(whiteboards.folderId, folderId));
  await db.delete(standaloneIOCs).where(eq(standaloneIOCs.folderId, folderId));
  await db.delete(chatThreads).where(eq(chatThreads.folderId, folderId));
  await db.delete(posts).where(eq(posts.folderId, folderId));
  await db.delete(files).where(eq(files.folderId, folderId));
  await db.delete(notifications).where(eq(notifications.folderId, folderId));

  // Delete all memberships
  await db.delete(investigationMembers).where(eq(investigationMembers.folderId, folderId));

  // Delete the folder itself
  await db.delete(folders).where(eq(folders.id, folderId));

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
    return c.json({ error: 'Invalid role' }, 400);
  }

  // Check folder exists
  const [folder] = await db.select({ id: folders.id, name: folders.name }).from(folders).where(eq(folders.id, folderId)).limit(1);
  if (!folder) {
    return c.json({ error: 'Investigation not found' }, 404);
  }

  // Find user by email
  const targetUser = await db.select().from(users).where(eq(users.email, email)).limit(1);
  if (targetUser.length === 0) {
    return c.json({ error: 'No user with that email found' }, 404);
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
    return c.json({ error: 'Only investigation owners can invite members' }, 403);
  }

  // Check not already a member
  const existing = await db.select({ id: investigationMembers.id }).from(investigationMembers)
    .where(and(eq(investigationMembers.folderId, folderId), eq(investigationMembers.userId, userId)))
    .limit(1);
  if (existing.length > 0) {
    return c.json({ error: 'User already a member' }, 409);
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
