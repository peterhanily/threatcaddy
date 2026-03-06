import { Hono } from 'hono';
import { eq, and, ilike, or, desc, inArray } from 'drizzle-orm';
import { requireAuth, requireRole } from '../middleware/auth.js';
import { db } from '../db/index.js';
import { users, posts, investigationMembers, sessions, reactions, activityLog } from '../db/schema.js';
import { disconnectUser } from '../ws/handler.js';
import type { AuthUser } from '../types.js';

const app = new Hono<{ Variables: { user: AuthUser } }>();

app.use('*', requireAuth);

// GET /api/users — list all users (admin) or search users (any authenticated)
app.get('/', async (c) => {
  const search = c.req.query('search');
  let result;

  if (search) {
    // Allow any authenticated user to search (for @mentions, invite by email)
    const pattern = `%${search}%`;
    result = await db
      .select({
        id: users.id,
        email: users.email,
        displayName: users.displayName,
        avatarUrl: users.avatarUrl,
        role: users.role,
        active: users.active,
      })
      .from(users)
      .where(and(
        eq(users.active, true),
        or(
          ilike(users.displayName, pattern),
          ilike(users.email, pattern),
        )
      ))
      .limit(20);
  } else {
    // Full list requires admin
    const user = c.get('user');
    if (user.role !== 'admin') {
      return c.json({ error: 'Admin access required' }, 403);
    }

    result = await db
      .select({
        id: users.id,
        email: users.email,
        displayName: users.displayName,
        avatarUrl: users.avatarUrl,
        role: users.role,
        active: users.active,
        lastLoginAt: users.lastLoginAt,
        createdAt: users.createdAt,
      })
      .from(users);
  }

  return c.json(result);
});

// GET /api/users/:id — get user profile
app.get('/:id', async (c) => {
  const userId = c.req.param('id');
  const result = await db
    .select({
      id: users.id,
      email: users.email,
      displayName: users.displayName,
      avatarUrl: users.avatarUrl,
      role: users.role,
      createdAt: users.createdAt,
    })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);

  if (result.length === 0) {
    return c.json({ error: 'User not found' }, 404);
  }

  return c.json(result[0]);
});

// GET /api/users/:id/feed — user's posts timeline
app.get('/:id/feed', async (c) => {
  const requestingUser = c.get('user');
  const targetUserId = c.req.param('id');

  // Get folders the requesting user has access to
  const memberships = await db
    .select({ folderId: investigationMembers.folderId })
    .from(investigationMembers)
    .where(eq(investigationMembers.userId, requestingUser.id));
  const accessibleFolderIds = new Set(memberships.map((m) => m.folderId));

  // Fetch the user's non-deleted posts (global + investigation-scoped), limited to 50
  const allPosts = await db
    .select()
    .from(posts)
    .where(
      and(
        eq(posts.authorId, targetUserId),
        eq(posts.deleted, false),
      )
    )
    .orderBy(posts.createdAt)
    .limit(100);

  // Filter to only posts the requesting user can see
  const result = allPosts
    .filter((post) => !post.folderId || accessibleFolderIds.has(post.folderId))
    .slice(-50);

  return c.json(result);
});

// GET /api/users/:id/likes — posts the user has liked
app.get('/:id/likes', async (c) => {
  const requestingUser = c.get('user');
  const targetUserId = c.req.param('id');

  // Get accessible folder IDs for scoping
  const memberships = await db
    .select({ folderId: investigationMembers.folderId })
    .from(investigationMembers)
    .where(eq(investigationMembers.userId, requestingUser.id));
  const accessibleFolderIds = new Set(memberships.map((m) => m.folderId));

  // Find posts the user reacted to
  const userReactions = await db
    .select({ postId: reactions.postId })
    .from(reactions)
    .where(eq(reactions.userId, targetUserId));
  const postIds = [...new Set(userReactions.map((r) => r.postId))];

  if (postIds.length === 0) return c.json([]);

  const likedPosts = await db
    .select({
      id: posts.id,
      authorId: posts.authorId,
      content: posts.content,
      attachments: posts.attachments,
      folderId: posts.folderId,
      parentId: posts.parentId,
      replyToId: posts.replyToId,
      mentions: posts.mentions,
      pinned: posts.pinned,
      deleted: posts.deleted,
      createdAt: posts.createdAt,
      updatedAt: posts.updatedAt,
      authorDisplayName: users.displayName,
      authorAvatarUrl: users.avatarUrl,
    })
    .from(posts)
    .innerJoin(users, eq(users.id, posts.authorId))
    .where(and(
      inArray(posts.id, postIds),
      eq(posts.deleted, false),
    ))
    .orderBy(desc(posts.createdAt))
    .limit(50);

  // Filter by access
  const result = likedPosts.filter((p) => !p.folderId || accessibleFolderIds.has(p.folderId));
  return c.json(result);
});

// GET /api/users/:id/activity — user's recent activity from audit log
app.get('/:id/activity', async (c) => {
  const requestingUser = c.get('user');
  const targetUserId = c.req.param('id');

  // Get accessible folder IDs for scoping
  const memberships = await db
    .select({ folderId: investigationMembers.folderId })
    .from(investigationMembers)
    .where(eq(investigationMembers.userId, requestingUser.id));
  const accessibleFolderIds = new Set(memberships.map((m) => m.folderId));

  const entries = await db
    .select({
      id: activityLog.id,
      category: activityLog.category,
      action: activityLog.action,
      detail: activityLog.detail,
      itemId: activityLog.itemId,
      itemTitle: activityLog.itemTitle,
      folderId: activityLog.folderId,
      timestamp: activityLog.timestamp,
    })
    .from(activityLog)
    .where(eq(activityLog.userId, targetUserId))
    .orderBy(desc(activityLog.timestamp))
    .limit(100);

  // Filter: global entries (no folderId) visible to all; folder-scoped need access
  const result = entries.filter((e) => !e.folderId || accessibleFolderIds.has(e.folderId));
  return c.json(result.slice(0, 50));
});

// PATCH /api/users/:id — admin update user
app.patch('/:id', requireRole('admin'), async (c) => {
  const userId = c.req.param('id');
  const body = await c.req.json();
  const updates: Record<string, unknown> = { updatedAt: new Date() };

  if (body.role) updates.role = body.role;
  if (body.active !== undefined) updates.active = body.active;
  if (body.displayName) updates.displayName = body.displayName;

  await db.update(users).set(updates).where(eq(users.id, userId));

  return c.json({ ok: true });
});

// DELETE /api/users/:id — admin deactivate user
app.delete('/:id', requireRole('admin'), async (c) => {
  const userId = c.req.param('id');
  const requestingUser = c.get('user');

  // Prevent self-deactivation
  if (userId === requestingUser.id) {
    return c.json({ error: 'Cannot deactivate yourself' }, 400);
  }

  await db.update(users).set({ active: false, updatedAt: new Date() }).where(eq(users.id, userId));
  // Invalidate all sessions so refresh tokens stop working
  await db.delete(sessions).where(eq(sessions.userId, userId));
  // Force-disconnect all WebSocket connections
  disconnectUser(userId);

  return c.json({ ok: true });
});

export default app;
