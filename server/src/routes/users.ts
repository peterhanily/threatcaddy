import { Hono } from 'hono';
import { eq, and, ilike, or, desc, inArray, count, sql } from 'drizzle-orm';
import { requireAuth, requireRole } from '../middleware/auth.js';
import { db } from '../db/index.js';
import { users, posts, reactions, activityLog } from '../db/schema.js';
import { updateUsersAndRevokeSessions } from '../services/session-service.js';
import { InvestigationPolicyError } from '../services/investigation-policy.js';
import { ErrorCodes } from '../types/error-codes.js';
import { withCurrentFeedAccess, type FeedVariables } from '../middleware/feed-access.js';
import { visibleFeedScope, visiblePostScope, PROFILE_ACTIVITY_CATEGORIES, projectProfileActivity } from '../services/feed-policy.js';

const app = new Hono<{ Variables: FeedVariables }>();

app.use('*', requireAuth);

// GET /api/users — list all users (admin) or search users (any authenticated)
app.get('/', async (c) => {
  const search = c.req.query('search');
  const limit = Math.min(Math.max(parseInt(c.req.query('limit') || '50', 10) || 50, 1), 200);
  const offset = Math.max(parseInt(c.req.query('offset') || '0', 10) || 0, 0);

  if (search) {
    // Allow any authenticated user to search (for @mentions, invite by email)
    const escaped = search.replace(/[%_\\]/g, '\\$&');
    const pattern = `%${escaped}%`;
    const result = await db
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
      .limit(Math.min(limit, 20));

    return c.json(result);
  }

  // Full list requires admin
  const user = c.get('user');
  if (user.role !== 'admin') {
    return c.json({ error: 'Admin access required', code: ErrorCodes.ADMIN_REQUIRED }, 403);
  }

  const [totalResult, result] = await Promise.all([
    db.select({ count: count() }).from(users),
    db
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
      .from(users)
      .limit(limit)
      .offset(offset),
  ]);

  const total = totalResult[0]?.count ?? 0;
  return c.json({ data: result, total, limit, offset });
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
    return c.json({ error: 'User not found', code: ErrorCodes.USER_NOT_FOUND }, 404);
  }

  return c.json(result[0]);
});

// GET /api/users/:id/feed — user's posts timeline
app.get('/:id/feed', withCurrentFeedAccess, async (c) => {
  const db = c.get('feedDb');
  const requestingUser = c.get('user');
  const targetUserId = c.req.param('id');

  // Fetch the user's non-deleted posts (global + investigation-scoped), limited to 50
  const allPosts = await db
    .select()
    .from(posts)
    .where(
      and(
        eq(posts.authorId, targetUserId),
        eq(posts.deleted, false),
        visiblePostScope(requestingUser.id),
      )
    )
    .orderBy(desc(posts.createdAt))
    .limit(50);

  // Filter to only posts the requesting user can see
  const result = allPosts.reverse();

  return c.json(result);
});

// GET /api/users/:id/likes — posts the user has liked
app.get('/:id/likes', withCurrentFeedAccess, async (c) => {
  const db = c.get('feedDb');
  const requestingUser = c.get('user');
  const targetUserId = c.req.param('id');

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
      sql`EXISTS (SELECT 1 FROM ${reactions} WHERE ${reactions.postId} = ${posts.id} AND ${reactions.userId} = ${targetUserId})`,
      eq(posts.deleted, false),
      visiblePostScope(requestingUser.id),
    ))
    .orderBy(desc(posts.createdAt))
    .limit(50);

  return c.json(likedPosts);
});

// GET /api/users/:id/activity — user's recent activity from audit log
app.get('/:id/activity', withCurrentFeedAccess, async (c) => {
  const db = c.get('feedDb');
  const requestingUser = c.get('user');
  const targetUserId = c.req.param('id');

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
    .where(and(eq(activityLog.userId, targetUserId),
      visibleFeedScope(activityLog.folderId, requestingUser.id, false),
      inArray(activityLog.category, [...PROFILE_ACTIVITY_CATEGORIES])))
    .orderBy(desc(activityLog.timestamp))
    .limit(50);

  return c.json(entries.map(projectProfileActivity));
});

// PATCH /api/users/:id — admin update user
app.patch('/:id', requireRole('admin'), async (c) => {
  const userId = c.req.param('id');
  const body = await c.req.json();
  const updates: Record<string, unknown> = { updatedAt: new Date() };

  const VALID_ROLES = ['admin', 'analyst', 'viewer'] as const;
  if (body.role) {
    if (!VALID_ROLES.includes(body.role)) {
      return c.json({ error: `Invalid role. Must be one of: ${VALID_ROLES.join(', ')}`, code: ErrorCodes.INVALID_ROLE }, 400);
    }
    updates.role = body.role;
  }
  if (body.active !== undefined) {
    if (typeof body.active !== 'boolean') return c.json({ error: 'Invalid active value' }, 400);
    updates.active = body.active;
  }
  if (body.displayName) {
    if (typeof body.displayName !== 'string' || body.displayName.trim().length > 100) {
      return c.json({ error: 'Display name must be a string of 100 characters or fewer' }, 400);
    }
    updates.displayName = body.displayName.trim();
  }

  try {
    if (body.role !== undefined || body.active !== undefined) await updateUsersAndRevokeSessions([userId], updates, undefined, { kind: 'user', userId: c.get('user').id });
    else await db.update(users).set(updates).where(eq(users.id, userId));
  } catch (error) {
    if (error instanceof InvestigationPolicyError) return c.json({ error: error.message, code: error.code }, error.status);
    throw error;
  }

  return c.json({ ok: true });
});

// DELETE /api/users/:id — admin deactivate user
app.delete('/:id', requireRole('admin'), async (c) => {
  const userId = c.req.param('id');
  const requestingUser = c.get('user');

  // Prevent self-deactivation
  if (userId === requestingUser.id) {
    return c.json({ error: 'Cannot deactivate yourself', code: ErrorCodes.CANNOT_DEACTIVATE_SELF }, 400);
  }

  try { await updateUsersAndRevokeSessions([userId], { active: false, updatedAt: new Date() }, undefined, { kind: 'user', userId: requestingUser.id }); }
  catch (error) {
    if (error instanceof InvestigationPolicyError) return c.json({ error: error.message, code: error.code }, error.status);
    throw error;
  }

  return c.json({ ok: true });
});

export default app;
