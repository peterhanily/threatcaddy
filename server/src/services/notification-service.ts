import { nanoid } from 'nanoid';
import { and, eq, sql } from 'drizzle-orm';
import { db } from '../db/index.js';
import { notifications, posts, users } from '../db/schema.js';
import { checkInvestigationAccess } from '../middleware/access.js';
import { postScopeFolders, visiblePostScope } from './feed-policy.js';
import { broadcastToUser } from '../ws/handler.js';

export async function createNotification(opts: {
  userId: string;
  type: string;
  sourceUserId?: string;
  postId?: string;
  folderId?: string;
  message: string;
}) {
  const id = nanoid();
  const notification = {
    id,
    userId: opts.userId,
    type: opts.type,
    sourceUserId: opts.sourceUserId ?? null,
    postId: opts.postId ?? null,
    folderId: opts.folderId ?? null,
    message: opts.message,
    read: false,
    createdAt: new Date(),
  };
  let scopeFolders: string[] = opts.folderId ? [opts.folderId] : [];

  const saved = await db.transaction(async tx => {
    const clock = await tx.execute(sql`SELECT id FROM sync_clock WHERE id = 1 FOR SHARE`);
    if (!clock.length) throw new Error('Notification authorization lock is unavailable');
    const [recipient] = await tx.select({ active: users.active }).from(users).where(eq(users.id, opts.userId));
    if (!recipient?.active) return false;
    if (opts.postId) {
      const [post] = await tx.select({ folderId: posts.folderId, parentId: posts.parentId, replyToId: posts.replyToId, deleted: posts.deleted }).from(posts)
        .where(and(eq(posts.id, opts.postId), visiblePostScope(opts.userId)));
      if (!post || post.deleted) return false;
      // Old callers may omit a reaction's folder. Derive it from the actual post.
      scopeFolders = await postScopeFolders(tx, post);
      notification.folderId = scopeFolders[0] ?? null;
    }
    if (notification.folderId && !await checkInvestigationAccess(opts.userId, notification.folderId, 'viewer', tx)) return false;
    await tx.insert(notifications).values(notification);
    return true;
  });
  if (!saved) return null;

  // Push via WebSocket
  await broadcastToUser(opts.userId, {
    type: 'notification',
    notification,
  }, scopeFolders);

  return notification;
}

export async function notifyMentions(
  mentions: string[],
  sourceUserId: string,
  postId: string,
  folderId: string | null,
  sourceDisplayName: string
) {
  for (const userId of new Set(mentions)) {
    if (userId === sourceUserId) continue; // Don't notify self
    await createNotification({
      userId,
      type: 'mention',
      sourceUserId,
      postId,
      folderId: folderId ?? undefined,
      message: `${sourceDisplayName} mentioned you in a post`,
    });
  }
}
