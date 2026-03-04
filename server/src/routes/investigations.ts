import { Hono } from 'hono';
import { eq, and } from 'drizzle-orm';
import { nanoid } from 'nanoid';
import { requireAuth } from '../middleware/auth.js';
import { checkInvestigationAccess } from '../middleware/access.js';
import { db } from '../db/index.js';
import { investigationMembers, folders, users } from '../db/schema.js';
import { createNotification } from '../services/notification-service.js';
import type { AuthUser } from '../types.js';

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

  try {
    await db.insert(investigationMembers).values({
      id: nanoid(),
      folderId,
      userId,
      role,
    });
  } catch {
    return c.json({ error: 'User already a member' }, 409);
  }

  // Get folder name for notification
  const folder = await db.select().from(folders).where(eq(folders.id, folderId)).limit(1);
  const folderName = folder[0]?.name || 'an investigation';

  await createNotification({
    userId,
    type: 'invite',
    sourceUserId: user.id,
    folderId,
    message: `${user.displayName} added you to ${folderName}`,
  });

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
  const requesterMembershipPatch = await db
    .select()
    .from(investigationMembers)
    .where(
      and(
        eq(investigationMembers.folderId, folderId),
        eq(investigationMembers.userId, user.id)
      )
    )
    .limit(1);

  if (requesterMembershipPatch.length === 0 || requesterMembershipPatch[0].role !== 'owner') {
    return c.json({ error: 'Insufficient permissions' }, 403);
  }

  await db
    .update(investigationMembers)
    .set({ role })
    .where(
      and(
        eq(investigationMembers.folderId, folderId),
        eq(investigationMembers.userId, targetUserId)
      )
    );

  return c.json({ ok: true });
});

// DELETE /api/investigations/:id/members/:userId — remove member
app.delete('/:id/members/:userId', async (c) => {
  const user = c.get('user');
  const folderId = c.req.param('id');
  const targetUserId = c.req.param('userId');

  // Users can remove themselves, or owners can remove others
  if (user.id !== targetUserId) {
    const requesterMembershipDel = await db
      .select()
      .from(investigationMembers)
      .where(
        and(
          eq(investigationMembers.folderId, folderId),
          eq(investigationMembers.userId, user.id)
        )
      )
      .limit(1);

    if (requesterMembershipDel.length === 0 || requesterMembershipDel[0].role !== 'owner') {
      return c.json({ error: 'Insufficient permissions' }, 403);
    }
  }

  await db
    .delete(investigationMembers)
    .where(
      and(
        eq(investigationMembers.folderId, folderId),
        eq(investigationMembers.userId, targetUserId)
      )
    );

  return c.json({ ok: true });
});

// POST /api/investigations/:id/invite — invite by email
app.post('/:id/invite', async (c) => {
  const user = c.get('user');
  const folderId = c.req.param('id');
  const body = await c.req.json();
  const { email, role = 'editor' } = body;

  // Find user by email
  const targetUser = await db.select().from(users).where(eq(users.email, email)).limit(1);
  if (targetUser.length === 0) {
    return c.json({ error: 'No user with that email found' }, 404);
  }

  // Delegate to member add logic
  const userId = targetUser[0].id;

  // Check requester is owner
  const requesterMembershipInv = await db
    .select()
    .from(investigationMembers)
    .where(
      and(
        eq(investigationMembers.folderId, folderId),
        eq(investigationMembers.userId, user.id)
      )
    )
    .limit(1);

  if (requesterMembershipInv.length === 0 || requesterMembershipInv[0].role !== 'owner') {
    return c.json({ error: 'Only investigation owners can invite members' }, 403);
  }

  try {
    await db.insert(investigationMembers).values({
      id: nanoid(),
      folderId,
      userId,
      role,
    });
  } catch {
    return c.json({ error: 'User already a member' }, 409);
  }

  const folder = await db.select().from(folders).where(eq(folders.id, folderId)).limit(1);
  const folderName = folder[0]?.name || 'an investigation';

  await createNotification({
    userId,
    type: 'invite',
    sourceUserId: user.id,
    folderId,
    message: `${user.displayName} invited you to ${folderName}`,
  });

  return c.json({ ok: true }, 201);
});

export default app;
