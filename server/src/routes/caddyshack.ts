import { Hono } from 'hono';
import { eq, and, lt, desc, isNull, or, inArray, count } from 'drizzle-orm';
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

// GET /api/caddyshack — paginated feed
app.get('/', async (c) => {
  const user = c.get('user');
  const cursor = c.req.query('cursor');
  const limit = Math.min(Math.max(parseInt(c.req.query('limit') || '20', 10), 1), 100);
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

  const feedPosts = await query;

  if (feedPosts.length === 0) {
    return c.json([]);
  }

  const postIds = feedPosts.map((p) => p.id);

  // Batch-fetch all reactions for these posts
  const allReactions = await db
    .select()
    .from(reactions)
    .where(inArray(reactions.postId, postIds));

  const reactionsByPost = new Map<string, Record<string, { count: number; userIds: string[] }>>();
  for (const r of allReactions) {
    let map = reactionsByPost.get(r.postId);
    if (!map) {
      map = {};
      reactionsByPost.set(r.postId, map);
    }
    if (!map[r.emoji]) map[r.emoji] = { count: 0, userIds: [] };
    map[r.emoji].count++;
    map[r.emoji].userIds.push(r.userId);
  }

  // Batch-fetch reply counts
  const replyCounts = await db
    .select({ parentId: posts.parentId, cnt: count() })
    .from(posts)
    .where(and(inArray(posts.parentId, postIds), eq(posts.deleted, false)))
    .groupBy(posts.parentId);

  const replyCountMap = new Map<string, number>();
  for (const r of replyCounts) {
    if (r.parentId) replyCountMap.set(r.parentId, Number(r.cnt));
  }

  const postsWithReactions = feedPosts.map((post) => ({
    ...post,
    reactions: reactionsByPost.get(post.id) || {},
    replyCount: replyCountMap.get(post.id) || 0,
  }));

  return c.json(postsWithReactions);
});

// POST /api/caddyshack/posts — create post
app.post('/posts', async (c) => {
  const user = c.get('user');
  const body = await c.req.json();
  const { content, attachments = [], mentions = [], folderId = null, parentId = null, replyToId = null, clsLevel = null } = body;

  // Input validation
  if (typeof content !== 'string' || !content.trim()) {
    return c.json({ error: 'Content is required and must be a string' }, 400);
  }
  if (content.length > 50_000) {
    return c.json({ error: 'Content must be 50,000 characters or fewer' }, 400);
  }
  if (!Array.isArray(attachments) || attachments.length > 10) {
    return c.json({ error: 'Attachments must be an array (max 10)' }, 400);
  }
  const validAttTypes = new Set(['image', 'video', 'audio', 'document']);
  for (const att of attachments) {
    if (
      !att || typeof att !== 'object' ||
      typeof att.id !== 'string' ||
      typeof att.url !== 'string' ||
      typeof att.type !== 'string' ||
      typeof att.mimeType !== 'string' ||
      typeof att.filename !== 'string'
    ) {
      return c.json({ error: 'Each attachment must have id, url, type, mimeType, and filename' }, 400);
    }
    if (!validAttTypes.has(att.type)) {
      return c.json({ error: 'Attachment type must be image, video, audio, or document' }, 400);
    }
    // Reject dangerous URI schemes to prevent XSS
    const urlLower = att.url.toLowerCase().trim();
    if (
      urlLower.startsWith('javascript:') ||
      urlLower.startsWith('vbscript:') ||
      urlLower.startsWith('data:') ||
      urlLower.startsWith('blob:')
    ) {
      return c.json({ error: 'Invalid attachment URL' }, 400);
    }
    // Only allow http(s) and relative URLs
    if (att.url.includes(':') && !urlLower.startsWith('http://') && !urlLower.startsWith('https://') && !att.url.startsWith('/')) {
      return c.json({ error: 'Attachment URL must use http(s) or be a relative path' }, 400);
    }
  }
  if (!Array.isArray(mentions) || mentions.length > 50 || !mentions.every((m: unknown) => typeof m === 'string' && m.length <= 128)) {
    return c.json({ error: 'Mentions must be an array of strings (max 50, each max 128 chars)' }, 400);
  }

  if (folderId) {
    const hasAccess = await checkInvestigationAccess(user.id, folderId, 'editor');
    if (!hasAccess) {
      return c.json({ error: 'No access to this investigation' }, 403);
    }
  }

  // Flat threading: walk up to root post
  let rootParentId: string | null = null;
  let directReplyToId: string | null = replyToId;
  let parentPost: (typeof posts.$inferSelect) | null = null;

  if (parentId) {
    // Find the specified parent
    const parentResult = await db.select().from(posts).where(eq(posts.id, parentId)).limit(1);
    if (parentResult.length === 0 || parentResult[0].deleted) {
      return c.json({ error: 'Parent post not found' }, 404);
    }
    parentPost = parentResult[0];

    // Prevent cross-folder replies
    if (parentPost.folderId !== folderId) {
      return c.json({ error: 'Reply must be in the same folder as parent post' }, 400);
    }
    if (parentPost.folderId) {
      const hasParentAccess = await checkInvestigationAccess(user.id, parentPost.folderId, 'viewer');
      if (!hasParentAccess) {
        return c.json({ error: 'No access to parent post' }, 403);
      }
    }

    // Walk up to root: if parentPost itself has a parentId, use the root
    if (parentPost.parentId) {
      // parentPost is already a reply — its parentId is the root (flat threading)
      rootParentId = parentPost.parentId;
      // The direct reply target is the parentId the user specified
      if (!directReplyToId) directReplyToId = parentId;
    } else {
      // parentPost is a top-level post — this is a direct reply to root
      rootParentId = parentId;
      if (!directReplyToId) directReplyToId = parentId;
    }
  }

  const id = nanoid();
  const now = new Date();

  await db.insert(posts).values({
    id,
    authorId: user.id,
    content,
    attachments,
    folderId,
    parentId: rootParentId,
    replyToId: directReplyToId,
    mentions,
    clsLevel: typeof clsLevel === 'string' && clsLevel.length > 0 && clsLevel.length <= 50 ? clsLevel : null,
    pinned: false,
    deleted: false,
    createdAt: now,
    updatedAt: now,
  });

  // Look up replyTo author name for the response
  let replyToAuthorName: string | undefined;
  if (directReplyToId) {
    const replyToPost = await db
      .select({ authorId: posts.authorId, displayName: users.displayName })
      .from(posts)
      .innerJoin(users, eq(users.id, posts.authorId))
      .where(eq(posts.id, directReplyToId))
      .limit(1);
    if (replyToPost.length > 0) {
      replyToAuthorName = replyToPost[0].displayName;
    }
  }

  const post = {
    id,
    authorId: user.id,
    content,
    attachments,
    folderId,
    parentId: rootParentId,
    replyToId: directReplyToId,
    replyToAuthorName,
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

  // Notify the author of the post being replied to
  const notifyAuthorId = parentPost?.authorId;
  if (notifyAuthorId && notifyAuthorId !== user.id) {
    await createNotification({
      userId: notifyAuthorId,
      type: 'reply',
      sourceUserId: user.id,
      postId: id,
      folderId: folderId || undefined,
      message: `${user.displayName} replied to your post`,
    });
  }

  // If replying to a different user than the parent post author, notify them too
  if (directReplyToId && directReplyToId !== rootParentId) {
    const replyTarget = await db.select().from(posts).where(eq(posts.id, directReplyToId)).limit(1);
    if (replyTarget.length > 0 && replyTarget[0].authorId !== user.id && replyTarget[0].authorId !== notifyAuthorId) {
      await createNotification({
        userId: replyTarget[0].authorId,
        type: 'reply',
        sourceUserId: user.id,
        postId: id,
        folderId: folderId || undefined,
        message: `${user.displayName} replied to your comment`,
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

// GET /api/caddyshack/posts/:id — post with all descendant replies (flat)
app.get('/posts/:id', async (c) => {
  const postId = c.req.param('id');

  const result = await db
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

  // Get all replies (flat — all posts with parentId = this post)
  const allReplies = await db
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
    .where(and(eq(posts.parentId, postId), eq(posts.deleted, false)))
    .orderBy(posts.createdAt);

  // Build a map of post id → author name for replyTo resolution
  const allPostIds = [postId, ...allReplies.map((r) => r.id)];
  const authorMap = new Map<string, string>();
  // Include root post author
  authorMap.set(postId, result[0].authorDisplayName || 'Unknown');
  for (const reply of allReplies) {
    authorMap.set(reply.id, reply.authorDisplayName || 'Unknown');
  }

  // Enrich replies with replyToAuthorName
  const enrichedReplies = allReplies.map((reply) => ({
    ...reply,
    replyToAuthorName: reply.replyToId ? authorMap.get(reply.replyToId) || undefined : undefined,
  }));

  // Get reactions for the root post and all replies
  const reactionRows = await db
    .select()
    .from(reactions)
    .where(inArray(reactions.postId, allPostIds));

  const reactionsByPost = new Map<string, Record<string, { count: number; userIds: string[] }>>();
  for (const r of reactionRows) {
    let map = reactionsByPost.get(r.postId);
    if (!map) {
      map = {};
      reactionsByPost.set(r.postId, map);
    }
    if (!map[r.emoji]) map[r.emoji] = { count: 0, userIds: [] };
    map[r.emoji].count++;
    map[r.emoji].userIds.push(r.userId);
  }

  return c.json({
    ...result[0],
    reactions: reactionsByPost.get(postId) || {},
    replies: enrichedReplies.map((reply) => ({
      ...reply,
      reactions: reactionsByPost.get(reply.id) || {},
    })),
  });
});

// PATCH /api/caddyshack/posts/:id — edit post (author or admin only)
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
  if (body.content !== undefined) {
    if (typeof body.content !== 'string' || !body.content.trim()) {
      return c.json({ error: 'Content must be a non-empty string' }, 400);
    }
    if (body.content.length > 50_000) {
      return c.json({ error: 'Content must be 50,000 characters or fewer' }, 400);
    }
    updates.content = body.content;
  }
  if (body.pinned !== undefined) {
    if (typeof body.pinned !== 'boolean') {
      return c.json({ error: 'Pinned must be a boolean' }, 400);
    }
    updates.pinned = body.pinned;
  }

  await db.update(posts).set(updates).where(eq(posts.id, postId));

  return c.json({ ok: true });
});

// DELETE /api/caddyshack/posts/:id — soft delete
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

// POST /api/caddyshack/posts/:id/reactions — add reaction
app.post('/posts/:id/reactions', async (c) => {
  const user = c.get('user');
  const postId = c.req.param('id');
  const body = await c.req.json();
  const { emoji } = body;

  if (!emoji || typeof emoji !== 'string' || emoji.length > 32) {
    return c.json({ error: 'Emoji is required (max 32 chars)' }, 400);
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

// DELETE /api/caddyshack/posts/:id/reactions/:emoji — remove reaction
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
