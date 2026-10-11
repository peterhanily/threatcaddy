import { Hono } from 'hono';
import { eq, and, lt, desc, isNull, or, inArray, count } from 'drizzle-orm';
import { nanoid } from 'nanoid';
import { requireAuth } from '../middleware/auth.js';
import { checkInvestigationAccess } from '../middleware/access.js';
import { withCurrentFeedAccess, type FeedVariables } from '../middleware/feed-access.js';
import { postScopeFolders, visiblePostScope } from '../services/feed-policy.js';
import { posts, reactions, users } from '../db/schema.js';
import { notifyMentions, createNotification } from '../services/notification-service.js';
import { broadcastToFolder, broadcastGlobal } from '../ws/handler.js';
import { ErrorCodes } from '../types/error-codes.js';

const app = new Hono<{ Variables: FeedVariables }>();

app.use('*', requireAuth);
app.use('*', withCurrentFeedAccess);

// GET /api/caddyshack — paginated feed
app.get('/', async (c) => {
  const db = c.get('feedDb');
  const user = c.get('user');
  const cursor = c.req.query('cursor');
  const rawLimitCs = parseInt(c.req.query('limit') || '', 10);
  const limit = Math.min(Math.max(isFinite(rawLimitCs) ? rawLimitCs : 20, 1), 100);
  const folderId = c.req.query('folderId');

  if (folderId) {
    const hasAccess = await checkInvestigationAccess(user.id, folderId, 'viewer', db);
    if (!hasAccess) {
      return c.json({ error: 'No access to this investigation', code: ErrorCodes.NO_ACCESS }, 403);
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
        visiblePostScope(user.id),
        isNull(posts.parentId), // Only top-level posts
        folderId
          ? eq(posts.folderId, folderId)
          : or(isNull(posts.folderId), eq(posts.folderId, '')),
        cursor && !isNaN(new Date(cursor).getTime()) ? lt(posts.createdAt, new Date(cursor)) : undefined
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
      map = Object.create(null) as Record<string, { count: number; userIds: string[] }>;
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
    .where(and(inArray(posts.parentId, postIds), eq(posts.deleted, false), visiblePostScope(user.id)))
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
  const db = c.get('feedDb');
  const user = c.get('user');
  const body = await c.req.json();
  const { content, attachments = [], mentions = [], folderId = null, parentId = null, replyToId = null, clsLevel = null } = body;

  if ([folderId, parentId, replyToId].some(id => id !== null && (typeof id !== 'string' || id.length === 0 || id.length > 128))) {
    return c.json({ error: 'Folder and reply identifiers must be non-empty strings or null', code: ErrorCodes.VALIDATION_FAILED }, 400);
  }
  if (replyToId && !parentId) {
    return c.json({ error: 'A reply target requires a parent post', code: ErrorCodes.VALIDATION_FAILED }, 400);
  }

  // Input validation
  if (typeof content !== 'string' || !content.trim()) {
    return c.json({ error: 'Content is required and must be a string', code: ErrorCodes.CONTENT_REQUIRED }, 400);
  }
  if (content.length > 50_000) {
    return c.json({ error: 'Content must be 50,000 characters or fewer', code: ErrorCodes.CONTENT_TOO_LONG }, 400);
  }
  if (!Array.isArray(attachments) || attachments.length > 10) {
    return c.json({ error: 'Attachments must be an array (max 10)', code: ErrorCodes.INVALID_ATTACHMENTS }, 400);
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
      return c.json({ error: 'Each attachment must have id, url, type, mimeType, and filename', code: ErrorCodes.INVALID_ATTACHMENT_FIELDS }, 400);
    }
    if (!validAttTypes.has(att.type)) {
      return c.json({ error: 'Attachment type must be image, video, audio, or document', code: ErrorCodes.INVALID_ATTACHMENT_TYPE }, 400);
    }
    // Reject dangerous URI schemes to prevent XSS
    const urlLower = att.url.toLowerCase().trim();
    if (
      urlLower.startsWith('javascript:') ||
      urlLower.startsWith('vbscript:') ||
      urlLower.startsWith('data:') ||
      urlLower.startsWith('blob:')
    ) {
      return c.json({ error: 'Invalid attachment URL', code: ErrorCodes.INVALID_ATTACHMENT_URL }, 400);
    }
    // Only allow http(s) and relative URLs
    if (att.url.includes(':') && !urlLower.startsWith('http://') && !urlLower.startsWith('https://') && !att.url.startsWith('/')) {
      return c.json({ error: 'Attachment URL must use http(s) or be a relative path', code: ErrorCodes.INVALID_ATTACHMENT_URL }, 400);
    }
  }
  if (!Array.isArray(mentions) || mentions.length > 50 || !mentions.every((m: unknown) => typeof m === 'string' && m.length <= 128)) {
    return c.json({ error: 'Mentions must be an array of strings (max 50, each max 128 chars)', code: ErrorCodes.INVALID_MENTIONS }, 400);
  }

  if (folderId) {
    const hasAccess = await checkInvestigationAccess(user.id, folderId, 'editor', db);
    if (!hasAccess) {
      return c.json({ error: 'No access to this investigation', code: ErrorCodes.NO_ACCESS }, 403);
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
      return c.json({ error: 'Parent post not found', code: ErrorCodes.PARENT_POST_NOT_FOUND }, 404);
    }
    parentPost = parentResult[0];

    // Prevent cross-folder replies
    if (parentPost.folderId !== folderId) {
      return c.json({ error: 'Reply must be in the same folder as parent post', code: ErrorCodes.CROSS_FOLDER_REPLY }, 400);
    }
    if (parentPost.folderId) {
      const hasParentAccess = await checkInvestigationAccess(user.id, parentPost.folderId, 'viewer', db);
      if (!hasParentAccess) {
        return c.json({ error: 'No access to parent post', code: ErrorCodes.NO_ACCESS }, 403);
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

  // Every reply target must belong to this exact live thread and folder. A
  // supplied replyToId must not disclose or notify an unrelated private post.
  let replyTarget = parentPost;
  if (rootParentId && parentPost?.parentId) {
    const [root] = await db.select().from(posts).where(eq(posts.id, rootParentId)).limit(1);
    if (!root || root.deleted || root.parentId || (root.folderId || null) !== folderId) {
      return c.json({ error: 'Parent post not found', code: ErrorCodes.PARENT_POST_NOT_FOUND }, 404);
    }
  }
  if (directReplyToId && directReplyToId !== parentPost?.id) {
    const [target] = await db.select().from(posts).where(eq(posts.id, directReplyToId)).limit(1);
    if (!target || target.deleted || (target.folderId || null) !== folderId
      || (target.id !== rootParentId && target.parentId !== rootParentId)) {
      return c.json({ error: 'Reply target must belong to the same thread', code: ErrorCodes.CROSS_FOLDER_REPLY }, 400);
    }
    replyTarget = target;
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

  // Notifications and broadcasts are best-effort effects of a committed post.
  c.get('afterFeedCommit')(async () => {
    if (mentions.length > 0) await notifyMentions(mentions, user.id, id, folderId, user.displayName);

    // Notify the author of the post being replied to.
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

    if (directReplyToId && directReplyToId !== rootParentId && replyTarget
      && replyTarget.authorId !== user.id && replyTarget.authorId !== notifyAuthorId) {
      await createNotification({
        userId: replyTarget.authorId,
        type: 'reply',
        sourceUserId: user.id,
        postId: id,
        folderId: folderId || undefined,
        message: `${user.displayName} replied to your comment`,
      });
    }

    const wsMsg = { type: 'new-post', postId: id, folderId };
    if (folderId) await broadcastToFolder(folderId, wsMsg);
    else await broadcastGlobal(wsMsg);
  });

  return c.json(post, 201);
});

// GET /api/caddyshack/posts/:id — post with all descendant replies (flat)
app.get('/posts/:id', async (c) => {
  const db = c.get('feedDb');
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
    .where(and(eq(posts.id, postId), visiblePostScope(c.get('user').id)))
    .limit(1);

  if (result.length === 0 || result[0].deleted) {
    return c.json({ error: 'Post not found', code: ErrorCodes.POST_NOT_FOUND }, 404);
  }

  if (result[0].folderId) {
    const user = c.get('user');
    const hasAccess = await checkInvestigationAccess(user.id, result[0].folderId, 'viewer', db);
    if (!hasAccess) {
      return c.json({ error: 'No access to this investigation', code: ErrorCodes.NO_ACCESS }, 403);
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
    .where(and(eq(posts.parentId, postId), eq(posts.deleted, false), visiblePostScope(c.get('user').id),
      result[0].folderId ? eq(posts.folderId, result[0].folderId) : or(isNull(posts.folderId), eq(posts.folderId, ''))))
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
      map = Object.create(null) as Record<string, { count: number; userIds: string[] }>;
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
  const db = c.get('feedDb');
  const user = c.get('user');
  const postId = c.req.param('id');
  const body = await c.req.json();

  const existing = await db.select().from(posts).where(and(eq(posts.id, postId), visiblePostScope(user.id))).limit(1);
  if (existing.length === 0 || existing[0].deleted) {
    return c.json({ error: 'Post not found', code: ErrorCodes.POST_NOT_FOUND }, 404);
  }
  if (existing[0].authorId !== user.id && user.role !== 'admin') {
    return c.json({ error: 'Not authorized', code: ErrorCodes.NOT_AUTHORIZED }, 403);
  }
  for (const scope of await postScopeFolders(db, existing[0])) {
    if (!await checkInvestigationAccess(user.id, scope, 'editor', db)) {
      return c.json({ error: 'No access to this investigation', code: ErrorCodes.NO_ACCESS }, 403);
    }
  }

  const updates: Record<string, unknown> = { updatedAt: new Date() };
  if (body.content !== undefined) {
    if (typeof body.content !== 'string' || !body.content.trim()) {
      return c.json({ error: 'Content must be a non-empty string', code: ErrorCodes.CONTENT_REQUIRED }, 400);
    }
    if (body.content.length > 50_000) {
      return c.json({ error: 'Content must be 50,000 characters or fewer', code: ErrorCodes.CONTENT_TOO_LONG }, 400);
    }
    updates.content = body.content;
  }
  if (body.pinned !== undefined) {
    if (typeof body.pinned !== 'boolean') {
      return c.json({ error: 'Pinned must be a boolean', code: ErrorCodes.VALIDATION_FAILED }, 400);
    }
    updates.pinned = body.pinned;
  }

  await db.update(posts).set(updates).where(eq(posts.id, postId));

  return c.json({ ok: true });
});

// DELETE /api/caddyshack/posts/:id — soft delete
app.delete('/posts/:id', async (c) => {
  const db = c.get('feedDb');
  const user = c.get('user');
  const postId = c.req.param('id');

  const existing = await db.select().from(posts).where(and(eq(posts.id, postId), visiblePostScope(user.id))).limit(1);
  if (existing.length === 0 || existing[0].deleted) {
    return c.json({ error: 'Post not found', code: ErrorCodes.POST_NOT_FOUND }, 404);
  }
  if (existing[0].authorId !== user.id && user.role !== 'admin') {
    return c.json({ error: 'Not authorized', code: ErrorCodes.NOT_AUTHORIZED }, 403);
  }
  for (const scope of await postScopeFolders(db, existing[0])) {
    if (!await checkInvestigationAccess(user.id, scope, 'editor', db)) {
      return c.json({ error: 'No access to this investigation', code: ErrorCodes.NO_ACCESS }, 403);
    }
  }

  await db.update(posts).set({ deleted: true, updatedAt: new Date() }).where(eq(posts.id, postId));

  return c.json({ ok: true });
});

// POST /api/caddyshack/posts/:id/reactions — add reaction
app.post('/posts/:id/reactions', async (c) => {
  const db = c.get('feedDb');
  const user = c.get('user');
  const postId = c.req.param('id');
  const body = await c.req.json();
  const { emoji } = body;

  if (!emoji || typeof emoji !== 'string' || emoji.length > 32) {
    return c.json({ error: 'Emoji is required (max 32 chars)', code: ErrorCodes.EMOJI_REQUIRED }, 400);
  }

  const [post] = await db.select().from(posts).where(and(eq(posts.id, postId), visiblePostScope(user.id))).limit(1);
  if (!post || post.deleted) return c.json({ error: 'Post not found', code: ErrorCodes.POST_NOT_FOUND }, 404);
  if (post.folderId && !await checkInvestigationAccess(user.id, post.folderId, 'viewer', db)) {
    return c.json({ error: 'No access to this investigation', code: ErrorCodes.NO_ACCESS }, 403);
  }
  const inserted = await db.insert(reactions).values({
      id: nanoid(),
      postId,
      userId: user.id,
      emoji,
    }).onConflictDoNothing().returning({ id: reactions.id });
  if (inserted.length === 0) {
    return c.json({ error: 'Already reacted with this emoji', code: ErrorCodes.ALREADY_REACTED }, 409);
  }

  // Notify post author
  if (post.authorId !== user.id) {
    c.get('afterFeedCommit')(() => createNotification({
      userId: post.authorId,
      type: 'reaction',
      sourceUserId: user.id,
      postId,
      folderId: post.folderId || undefined,
      message: `${user.displayName} reacted ${emoji} to your post`,
    }));
  }

  return c.json({ ok: true }, 201);
});

// DELETE /api/caddyshack/posts/:id/reactions/:emoji — remove reaction
app.delete('/posts/:id/reactions/:emoji', async (c) => {
  const db = c.get('feedDb');
  const user = c.get('user');
  const postId = c.req.param('id');
  const emoji = c.req.param('emoji');

  const [post] = await db.select().from(posts).where(and(eq(posts.id, postId), visiblePostScope(user.id))).limit(1);
  if (!post || post.deleted) return c.json({ error: 'Post not found', code: ErrorCodes.POST_NOT_FOUND }, 404);
  if (post.folderId && !await checkInvestigationAccess(user.id, post.folderId, 'viewer', db)) {
    return c.json({ error: 'No access to this investigation', code: ErrorCodes.NO_ACCESS }, 403);
  }

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
