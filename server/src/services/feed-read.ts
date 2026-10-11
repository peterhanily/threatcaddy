import { and, count, eq, inArray, isNull, or, sql } from 'drizzle-orm';
import { posts, reactions, users } from '../db/schema.js';
import type { FeedTransaction } from '../middleware/feed-access.js';
import { visiblePostScope } from './feed-policy.js';

export const REPLY_PAGE_LIMIT = 50;
export class FeedReadInputError extends Error {}

interface ReplyCursor { postId: string; createdAt: string; id: string }
export interface ReplyPageRequest { limit: number; cursor?: ReplyCursor }

/** Keep PostgreSQL's microseconds: a JavaScript Date alone would skip/duplicate
 * rows around sub-millisecond ties when it is sent back as a keyset cursor. */
export function encodeReplyCursor(cursor: ReplyCursor): string {
  return Buffer.from(JSON.stringify([1, cursor.postId, cursor.createdAt, cursor.id])).toString('base64url');
}

export function parseReplyPage(postId: string, limit?: string, encoded?: string): ReplyPageRequest {
  const size = limit === undefined ? REPLY_PAGE_LIMIT : Number(limit);
  if (!Number.isSafeInteger(size) || size < 1) throw new FeedReadInputError('Reply page limit must be a positive integer');
  const request: ReplyPageRequest = { limit: Math.min(size, REPLY_PAGE_LIMIT) };
  if (encoded === undefined) return request;
  try {
    if (!encoded || encoded.length > 1024 || !/^[A-Za-z0-9_-]+$/.test(encoded)) throw new Error();
    const value: unknown = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8'));
    if (!Array.isArray(value) || value.length !== 4 || value[0] !== 1 || value[1] !== postId
      || typeof value[2] !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/.test(value[2])
      || typeof value[3] !== 'string' || !value[3] || value[3].length > 128) throw new Error();
    const milliseconds = `${value[2].slice(0, 23)}Z`;
    if (new Date(milliseconds).toISOString() !== milliseconds) throw new Error();
    request.cursor = { postId, createdAt: value[2], id: value[3] };
    return request;
  } catch { throw new FeedReadInputError('Reply cursor is invalid or belongs to another post'); }
}

export interface FeedReaction {
  count: number;
  userIds: string[];
  /** Summary mode only: userIds contains the current viewer, not a reactor list. */
  reactedByMe?: boolean;
  userIdsScope?: 'viewer';
  userIdsComplete?: boolean;
}

/** Call only with posts already authorized in the current feed transaction.
 * Legacy mode deliberately preserves its full reactor-ID contract. */
export async function loadPostReactions(database: FeedTransaction, postIds: string[], viewerId: string, summary: boolean) {
  const result = new Map<string, Record<string, FeedReaction>>();
  if (!postIds.length) return result;
  const add = (postId: string, emoji: string, reaction: FeedReaction) => {
    let group = result.get(postId);
    if (!group) { group = Object.create(null) as Record<string, FeedReaction>; result.set(postId, group); }
    group[emoji] = reaction;
  };
  if (summary) {
    const rows = await database.select({ postId: reactions.postId, emoji: reactions.emoji, count: count(),
      reactedByMe: sql<boolean>`bool_or(${reactions.userId} = ${viewerId})`,
    }).from(reactions).where(inArray(reactions.postId, postIds)).groupBy(reactions.postId, reactions.emoji);
    for (const row of rows) {
      const userIds = row.reactedByMe ? [viewerId] : [];
      add(row.postId, row.emoji, { count: row.count, userIds, reactedByMe: row.reactedByMe,
        userIdsScope: 'viewer', userIdsComplete: row.count === userIds.length });
    }
  } else {
    const rows = await database.select().from(reactions).where(inArray(reactions.postId, postIds));
    for (const row of rows) {
      const prior = result.get(row.postId)?.[row.emoji];
      if (prior) { prior.count++; prior.userIds.push(row.userId); }
      else add(row.postId, row.emoji, { count: 1, userIds: [row.userId] });
    }
  }
  return result;
}

export async function loadReplyPage(database: FeedTransaction,
  root: { id: string; folderId: string | null; authorDisplayName: string | null }, viewerId: string, request: ReplyPageRequest) {
  const scope = and(eq(posts.parentId, root.id), eq(posts.deleted, false), visiblePostScope(viewerId),
    root.folderId ? eq(posts.folderId, root.folderId) : or(isNull(posts.folderId), eq(posts.folderId, '')));
  const cursor = request.cursor;
  const rows = await database.select({
    id: posts.id, authorId: posts.authorId, content: posts.content, attachments: posts.attachments,
    folderId: posts.folderId, parentId: posts.parentId, replyToId: posts.replyToId, mentions: posts.mentions,
    pinned: posts.pinned, deleted: posts.deleted, createdAt: posts.createdAt, updatedAt: posts.updatedAt,
    authorDisplayName: users.displayName, authorAvatarUrl: users.avatarUrl,
    cursorCreatedAt: sql<string>`to_char(${posts.createdAt} AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`,
  }).from(posts).innerJoin(users, eq(users.id, posts.authorId)).where(and(scope, cursor
    ? sql`(${posts.createdAt}, ${posts.id}) > (${cursor.createdAt}::timestamptz, ${cursor.id})` : undefined))
    .orderBy(posts.createdAt, posts.id).limit(request.limit + 1);
  const [{ total }] = await database.select({ total: count() }).from(posts).where(scope);
  const hasMore = rows.length > request.limit;
  const page = rows.slice(0, request.limit);
  const last = page.at(-1);

  // A reply can target an earlier page. Resolve only this page's targets, and
  // never disclose a removed/out-of-scope target's author as contextual metadata.
  const targets = [...new Set(page.map(row => row.replyToId).filter((id): id is string => !!id && id !== root.id))];
  const authors = new Map<string, string>([[root.id, root.authorDisplayName || 'Unknown']]);
  if (targets.length) {
    const targetRows = await database.select({ id: posts.id, name: users.displayName }).from(posts)
      .innerJoin(users, eq(users.id, posts.authorId)).where(and(scope, inArray(posts.id, targets)));
    for (const row of targetRows) authors.set(row.id, row.name || 'Unknown');
  }
  return {
    replies: page.map(({ cursorCreatedAt, ...reply }) => {
      // Strip this SQL-only field from the public post representation.
      void cursorCreatedAt;
      return { ...reply, replyToAuthorName: reply.replyToId ? authors.get(reply.replyToId) : undefined };
    }),
    replyPage: { total, limit: request.limit, hasMore,
      nextCursor: hasMore && last ? encodeReplyCursor({ postId: root.id, createdAt: last.cursorCreatedAt, id: last.id }) : null },
  };
}
