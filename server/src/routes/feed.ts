import { Hono } from 'hono';
import { eq, and, lt, desc, isNull, or } from 'drizzle-orm';
import { nanoid } from 'nanoid';
import { requireAuth } from '../middleware/auth.js';
import { checkInvestigationAccess } from '../middleware/access.js';
import { db } from '../db/index.js';
import { posts, reactions, users } from '../db/schema.js';
import { notifyMentions, createNotification } from '../services/notification-service.js';
import { broadcastToFolder, broadcastGlobal } from '../ws/handler.js';
import type { AuthUser } from '../types.js';

const app = new Hono<{ Variables: { user: AuthUser } }>();

app.use('*', requireAuth);

// GET /api/feed — paginated feed
app.get('/', async (c) => {
  const user = c.get('user');
  const cursor = c.req.query('cursor');
  const limit = parseInt(c.req.query('limit') || '20', 10);
  const folderId = c.req.query('folderId');

  if (folderId) {
    const hasAccess = await checkInvestigationAccess(user.id, folderId, 'viewer');
    if (!hasAccess) {
      return c.json({ error: 'No access to this investigation' }, 403);
    }
  }

  const query = db
    .select({
      id: posts.id,
      authorId: posts.authorId,
      content: posts.content,
      images: posts.images,
      folderId: posts.folderId,
      parentId: posts.parentId,
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
    .where(
      and(
        eq(posts.deleted, false),
        isNull(posts.parentId), // Only top-level posts
        folderId
          ? eq(posts.folderId, folderId)
          : or(isNull(posts.folderId), eq(posts.folderId, '')),
        cursor ? lt(posts.createdAt, new Date(cursor)) : undefined
      )
    )
    .orderBy(desc(posts.createdAt))
    .limit(limit);

  // Simplified: just execute
  const feedPosts = await query;

  // Get reaction counts for each post
  const postsWithReactions = await Promise.all(
    feedPosts.map(async (post) => {
      const postReactions = await db
        .select()
        .from(reactions)
        .where(eq(reactions.postId, post.id));

      // Count replies
      const replies = await db
        .select({ id: posts.id })
        .from(posts)
        .where(and(eq(posts.parentId, post.id), eq(posts.deleted, false)));

      // Group reactions by emoji
      const reactionMap: Record<string, { count: number; userIds: string[] }> = {};
      for (const r of postReactions) {
        if (!reactionMap[r.emoji]) reactionMap[r.emoji] = { count: 0, userIds: [] };
        reactionMap[r.emoji].count++;
        reactionMap[r.emoji].userIds.push(r.userId);
      }

      return {
        ...post,
        reactions: reactionMap,
        replyCount: replies.length,
      };
    })
  );

  return c.json(postsWithReactions);
});

// POST /api/feed/posts — create post
app.post('/posts', async (c) => {
  const user = c.get('user');
  const body = await c.req.json();
  const { content, images = [], mentions = [], folderId = null, parentId = null } = body;

  if (!content?.trim()) {
    return c.json({ error: 'Content is required' }, 400);
  }

  if (folderId) {
    const hasAccess = await checkInvestigationAccess(user.id, folderId, 'editor');
    if (!hasAccess) {
      return c.json({ error: 'No access to this investigation' }, 403);
    }
  }

  const id = nanoid();
  const now = new Date();

  await db.insert(posts).values({
    id,
    authorId: user.id,
    content,
    images,
    folderId,
    parentId,
    mentions,
    pinned: false,
    deleted: false,
    createdAt: now,
    updatedAt: now,
  });

  const post = {
    id,
    authorId: user.id,
    content,
    images,
    folderId,
    parentId,
    mentions,
    pinned: false,
    deleted: false,
    createdAt: now,
    updatedAt: now,
    authorDisplayName: user.displayName,
    authorAvatarUrl: user.avatarUrl,
    reactions: {},
    replyCount: 0,
  };

  // Notify mentions
  if (mentions.length > 0) {
    await notifyMentions(mentions, user.id, id, folderId, user.displayName);
  }

  // Notify parent post author on reply
  if (parentId) {
    const parentPost = await db.select().from(posts).where(eq(posts.id, parentId)).limit(1);
    if (parentPost.length > 0 && parentPost[0].authorId !== user.id) {
      await createNotification({
        userId: parentPost[0].authorId,
        type: 'reply',
        sourceUserId: user.id,
        postId: id,
        folderId: folderId || undefined,
        message: `${user.displayName} replied to your post`,
      });
    }
  }

  // Broadcast
  const wsMsg = { type: 'new-post', postId: id, folderId };
  if (folderId) {
    broadcastToFolder(folderId, wsMsg);
  } else {
    broadcastGlobal(wsMsg);
  }

  return c.json(post, 201);
});

// GET /api/feed/posts/:id — post with replies
app.get('/posts/:id', async (c) => {
  const postId = c.req.param('id');

  const result = await db
    .select({
      id: posts.id,
      authorId: posts.authorId,
      content: posts.content,
      images: posts.images,
      folderId: posts.folderId,
      parentId: posts.parentId,
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
    .where(eq(posts.id, postId))
    .limit(1);

  if (result.length === 0) {
    return c.json({ error: 'Post not found' }, 404);
  }

  if (result[0].folderId) {
    const user = c.get('user');
    const hasAccess = await checkInvestigationAccess(user.id, result[0].folderId, 'viewer');
    if (!hasAccess) {
      return c.json({ error: 'No access to this investigation' }, 403);
    }
  }

  // Get replies
  const replies = await db
    .select({
      id: posts.id,
      authorId: posts.authorId,
      content: posts.content,
      images: posts.images,
      folderId: posts.folderId,
      parentId: posts.parentId,
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
    .where(and(eq(posts.parentId, postId), eq(posts.deleted, false)))
    .orderBy(posts.createdAt);

  // Get reactions
  const postReactions = await db.select().from(reactions).where(eq(reactions.postId, postId));
  const reactionMap: Record<string, { count: number; userIds: string[] }> = {};
  for (const r of postReactions) {
    if (!reactionMap[r.emoji]) reactionMap[r.emoji] = { count: 0, userIds: [] };
    reactionMap[r.emoji].count++;
    reactionMap[r.emoji].userIds.push(r.userId);
  }

  return c.json({
    ...result[0],
    reactions: reactionMap,
    replies,
  });
});

// PATCH /api/feed/posts/:id — edit post (author only)
app.patch('/posts/:id', async (c) => {
  const user = c.get('user');
  const postId = c.req.param('id');
  const body = await c.req.json();

  const existing = await db.select().from(posts).where(eq(posts.id, postId)).limit(1);
  if (existing.length === 0) {
    return c.json({ error: 'Post not found' }, 404);
  }
  if (existing[0].authorId !== user.id && user.role !== 'admin') {
    return c.json({ error: 'Not authorized' }, 403);
  }

  const updates: Record<string, unknown> = { updatedAt: new Date() };
  if (body.content !== undefined) updates.content = body.content;
  if (body.pinned !== undefined) updates.pinned = body.pinned;

  await db.update(posts).set(updates).where(eq(posts.id, postId));

  return c.json({ ok: true });
});

// DELETE /api/feed/posts/:id — soft delete
app.delete('/posts/:id', async (c) => {
  const user = c.get('user');
  const postId = c.req.param('id');

  const existing = await db.select().from(posts).where(eq(posts.id, postId)).limit(1);
  if (existing.length === 0) {
    return c.json({ error: 'Post not found' }, 404);
  }
  if (existing[0].authorId !== user.id && user.role !== 'admin') {
    return c.json({ error: 'Not authorized' }, 403);
  }

  await db.update(posts).set({ deleted: true, updatedAt: new Date() }).where(eq(posts.id, postId));

  return c.json({ ok: true });
});

// POST /api/feed/posts/:id/reactions — add reaction
app.post('/posts/:id/reactions', async (c) => {
  const user = c.get('user');
  const postId = c.req.param('id');
  const body = await c.req.json();
  const { emoji } = body;

  if (!emoji) {
    return c.json({ error: 'Emoji is required' }, 400);
  }

  try {
    await db.insert(reactions).values({
      id: nanoid(),
      postId,
      userId: user.id,
      emoji,
    });
  } catch {
    return c.json({ error: 'Already reacted with this emoji' }, 409);
  }

  // Notify post author
  const post = await db.select().from(posts).where(eq(posts.id, postId)).limit(1);
  if (post.length > 0 && post[0].authorId !== user.id) {
    await createNotification({
      userId: post[0].authorId,
      type: 'reaction',
      sourceUserId: user.id,
      postId,
      message: `${user.displayName} reacted ${emoji} to your post`,
    });
  }

  return c.json({ ok: true }, 201);
});

// DELETE /api/feed/posts/:id/reactions/:emoji — remove reaction
app.delete('/posts/:id/reactions/:emoji', async (c) => {
  const user = c.get('user');
  const postId = c.req.param('id');
  const emoji = c.req.param('emoji');

  await db
    .delete(reactions)
    .where(
      and(
        eq(reactions.postId, postId),
        eq(reactions.userId, user.id),
        eq(reactions.emoji, emoji)
      )
    );

  return c.json({ ok: true });
});

export default app;
