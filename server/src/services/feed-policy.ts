import { and, eq, isNull, isNotNull, or, sql, type SQL } from 'drizzle-orm';
import type { AnyPgColumn } from 'drizzle-orm/pg-core';
import { posts } from '../db/schema.js';
import type { FeedTransaction } from '../middleware/feed-access.js';

/** Apply scope in SQL before ordering/pagination, never after a fixed row limit. */
export function visibleFeedScope(folderColumn: AnyPgColumn | SQL, userId: string, includePublic = true) {
  const member = sql`EXISTS (
    SELECT 1 FROM investigation_members AS feed_member
    JOIN folders AS feed_folder ON feed_folder.id = feed_member.folder_id
    JOIN users AS feed_viewer ON feed_viewer.id = feed_member.user_id
    WHERE feed_member.user_id = ${userId} AND feed_member.folder_id = ${folderColumn}
      AND feed_folder.deleted_at IS NULL AND feed_viewer.active = true
  )`;
  return includePublic ? or(isNull(folderColumn), sql`${folderColumn} = ''`, member) : and(member);
}

/** Older replies can have a missing folderId. Their root still defines a
 * private boundary; malformed, orphaned or deleted-root threads stay hidden. */
export function visiblePostScope(userId: string) {
  return and(visibleFeedScope(posts.folderId, userId), or(isNull(posts.parentId), sql`EXISTS (
    SELECT 1 FROM posts AS feed_root WHERE feed_root.id = ${posts.parentId}
      AND feed_root.parent_id IS NULL AND feed_root.deleted = false
      AND ${visibleFeedScope(sql`feed_root.folder_id`, userId)}
  )`), or(isNull(posts.replyToId), and(isNotNull(posts.parentId), sql`EXISTS (
    SELECT 1 FROM posts AS feed_target WHERE feed_target.id = ${posts.replyToId}
      AND (feed_target.id = ${posts.parentId} OR feed_target.parent_id = ${posts.parentId})
      AND ${visibleFeedScope(sql`feed_target.folder_id`, userId)}
  )`)));
}

export async function postScopeFolders(database: Pick<FeedTransaction, 'select'>,
  post: { folderId: string | null; parentId?: string | null; replyToId?: string | null }): Promise<string[]> {
  const folderIds = new Set<string>();
  if (post.folderId) folderIds.add(post.folderId);
  for (const targetId of new Set([post.parentId, post.replyToId].filter((id): id is string => !!id))) {
    const [root] = await database.select({ folderId: posts.folderId }).from(posts)
      .where(eq(posts.id, targetId)).limit(1);
    if (root?.folderId) folderIds.add(root.folderId);
  }
  return [...folderIds];
}

// Profile activity is not a security audit endpoint. Unknown categories and all
// folderless audit entries remain private; the owner/admin audit APIs retain
// their richer records. Adding a public category requires a deliberate review.
export const PROFILE_ACTIVITY_CATEGORIES = ['note', 'task', 'folder', 'ioc', 'timeline', 'whiteboard', 'chat', 'post'] as const;

export function projectProfileActivity<T extends { detail: string; category: string; action: string }>(entry: T): T {
  return { ...entry, detail: '' };
}
