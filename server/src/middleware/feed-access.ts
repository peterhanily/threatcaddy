import { createMiddleware } from 'hono/factory';
import { and, eq, gt, gte, sql } from 'drizzle-orm';
import { db } from '../db/index.js';
import { sessions, users } from '../db/schema.js';
import { logger } from '../lib/logger.js';
import type { AuthUser } from '../types.js';

export type FeedTransaction = Parameters<Parameters<typeof db.transaction>[0]>[0];
export type FeedVariables = {
  user: AuthUser;
  feedDb: FeedTransaction;
  afterFeedCommit: (effect: () => void | Promise<unknown>) => void;
};

/** Keep membership and post reads/writes on one side of a permission change.
 * The clock lock is also used by membership, account and folder lifecycle writes.
 * Read requests share it; mutations serialize with deletion and other mutations.
 * No notification or websocket side effect is emitted for a rolled-back write.
 */
export const withCurrentFeedAccess = createMiddleware<{ Variables: FeedVariables }>(async (c, next) => {
  const effects: Array<() => void | Promise<unknown>> = [];
  await db.transaction(async tx => {
    const clock = await tx.execute(c.req.method === 'GET' || c.req.method === 'HEAD'
      ? sql`SELECT id FROM sync_clock WHERE id = 1 FOR SHARE`
      : sql`SELECT id FROM sync_clock WHERE id = 1 FOR UPDATE`);
    if (!clock.length) throw new Error('Feed authorization lock is unavailable');
    const identity = c.get('user');
    const [current] = await tx.select({
      id: users.id, email: users.email, role: users.role, active: users.active,
      displayName: users.displayName, avatarUrl: users.avatarUrl,
    }).from(users).where(eq(users.id, identity.id)).for('share');
    if (!current?.active || !identity.sessionFamily || !identity.tokenExpiresAt || identity.tokenExpiresAt <= Date.now()) {
      c.res = c.json({ error: 'Account is no longer authorized' }, 403);
      return;
    }
    // Revocation takes the same user-row lock. A request queued behind a logout
    // must not use an identity verified before that logout committed.
    const [session] = await tx.select({ id: sessions.id }).from(sessions).where(and(
      eq(sessions.userId, current.id), eq(sessions.tokenFamily, identity.sessionFamily),
      gte(sessions.rotationCounter, 0), gt(sessions.expiresAt, new Date()),
    )).limit(1);
    if (!session) {
      c.res = c.json({ error: 'Session is no longer authorized' }, 403);
      return;
    }
    c.set('user', { ...identity, ...current });
    c.set('feedDb', tx);
    c.set('afterFeedCommit', effect => { effects.push(effect); });
    await next();
    // Hono captures handler errors; rethrow inside the transaction so a partial
    // write cannot commit just because the error handler created an HTTP reply.
    if (c.error) throw c.error;
  });
  for (const effect of effects) {
    try { await effect(); }
    catch (error) { logger.warn('Committed feed notification failed', { error: error instanceof Error ? error.message : String(error) }); }
  }
});
