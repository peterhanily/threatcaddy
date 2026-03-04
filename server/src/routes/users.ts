import { Hono } from 'hono';
import { eq, and } from 'drizzle-orm';
import { requireAuth, requireRole } from '../middleware/auth.js';
import { checkInvestigationAccess } from '../middleware/access.js';
import { db } from '../db/index.js';
import { users, posts } from '../db/schema.js';
import type { AuthUser } from '../types.js';

const app = new Hono<{ Variables: { user: AuthUser } }>();

app.use('*', requireAuth);

// GET /api/users — list all users (admin) or search users (any authenticated)
app.get('/', async (c) => {
  const search = c.req.query('search');
  let result;

  if (search) {
    // Allow any authenticated user to search (for @mentions, invite by email)
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
      .where(eq(users.active, true))
      .limit(50);

    // Filter in-memory for simplicity (PostgreSQL ILIKE would be better for large datasets)
    const lower = search.toLowerCase();
    result = result.filter(
      (u) =>
        u.displayName.toLowerCase().includes(lower) ||
        u.email.toLowerCase().includes(lower)
    );
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

  // Fetch the user's non-deleted posts (global + investigation-scoped)
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
    .limit(200);

  // Filter out investigation-scoped posts the requesting user doesn't have access to
  const result = [];
  for (const post of allPosts) {
    if (!post.folderId) {
      // Global post — always visible
      result.push(post);
    } else {
      // Investigation-scoped — check membership
      const hasAccess = await checkInvestigationAccess(requestingUser.id, post.folderId, 'viewer');
      if (hasAccess) {
        result.push(post);
      }
    }
  }

  // Return most recent 50
  return c.json(result.slice(-50));
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

  await db.update(users).set({ active: false, updatedAt: new Date() }).where(eq(users.id, userId));

  return c.json({ ok: true });
});

export default app;
