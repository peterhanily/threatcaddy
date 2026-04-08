import { Hono } from 'hono';
import { eq, and, desc } from 'drizzle-orm';
import { requireAuth } from '../middleware/auth.js';
import { db } from '../db/index.js';
import { notifications, users } from '../db/schema.js';
import type { AuthUser } from '../types.js';

const app = new Hono<{ Variables: { user: AuthUser } }>();

app.use('*', requireAuth);

// GET /api/notifications
app.get('/', async (c) => {
  const user = c.get('user');
  const unread = c.req.query('unread');
  const rawLimitN = parseInt(c.req.query('limit') || '', 10);
  const limit = Math.min(isFinite(rawLimitN) && rawLimitN > 0 ? rawLimitN : 50, 500);

  const conditions = [eq(notifications.userId, user.id)];
  if (unread === 'true') {
    conditions.push(eq(notifications.read, false));
  }

  const result = await db
    .select({
      id: notifications.id,
      type: notifications.type,
      sourceUserId: notifications.sourceUserId,
      postId: notifications.postId,
      folderId: notifications.folderId,
      message: notifications.message,
      read: notifications.read,
      createdAt: notifications.createdAt,
      sourceUserDisplayName: users.displayName,
      sourceUserAvatarUrl: users.avatarUrl,
    })
    .from(notifications)
    .leftJoin(users, eq(users.id, notifications.sourceUserId))
    .where(and(...conditions))
    .orderBy(desc(notifications.createdAt))
    .limit(limit);

  return c.json(result);
});

// PATCH /api/notifications/:id/read
app.patch('/:id/read', async (c) => {
  const user = c.get('user');
  const notifId = c.req.param('id');

  await db
    .update(notifications)
    .set({ read: true })
    .where(and(eq(notifications.id, notifId), eq(notifications.userId, user.id)));

  return c.json({ ok: true });
});

// DELETE /api/notifications/read — delete all read notifications for current user
app.delete('/read', async (c) => {
  const user = c.get('user');

  const deleted = await db
    .delete(notifications)
    .where(and(eq(notifications.userId, user.id), eq(notifications.read, true)))
    .returning({ id: notifications.id });

  return c.json({ ok: true, deleted: deleted.length });
});

// POST /api/notifications/mark-all-read
app.post('/mark-all-read', async (c) => {
  const user = c.get('user');

  await db
    .update(notifications)
    .set({ read: true })
    .where(and(eq(notifications.userId, user.id), eq(notifications.read, false)));

  return c.json({ ok: true });
});

export default app;
