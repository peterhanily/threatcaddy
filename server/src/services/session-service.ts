import { createHash } from 'node:crypto';
import { nanoid } from 'nanoid';
import { and, asc, eq, gt, gte, inArray, or } from 'drizzle-orm';
import { db } from '../db/index.js';
import { sessions, users } from '../db/schema.js';
import { signAccessToken } from '../middleware/auth.js';
import { getSessionSettings } from './admin-secret.js';
import { notifySessionRevocation } from './session-events.js';
import type { AuthUser } from '../types.js';

export class SessionAuthorizationError extends Error {}

export function hashRefreshToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

function authUser(user: typeof users.$inferSelect): AuthUser {
  return { id: user.id, email: user.email, role: user.role, displayName: user.displayName, avatarUrl: user.avatarUrl };
}

function activeInteractiveUser(user: typeof users.$inferSelect | undefined): user is typeof users.$inferSelect {
  return !!user?.active && !user.email.endsWith('@threatcaddy.internal');
}

/** User-row locking serializes login, rotation, credential changes, and session revocation. */
export async function createTokenPair(userId: string, expectedPasswordHash?: string) {
  const settings = await getSessionSettings();
  const removedFamilies: string[] = [];
  const result = await db.transaction(async tx => {
    const [user] = await tx.select().from(users).where(eq(users.id, userId)).for('update');
    if (!activeInteractiveUser(user) || (expectedPasswordHash !== undefined && user.passwordHash !== expectedPasswordHash)) {
      throw new SessionAuthorizationError('Account credentials changed; sign in again');
    }
    const now = new Date();
    const live = await tx.select().from(sessions).where(and(eq(sessions.userId, userId), gte(sessions.rotationCounter, 0), gt(sessions.expiresAt, now))).orderBy(asc(sessions.createdAt));
    if (settings.maxPerUser > 0) {
      for (const session of live.slice(0, Math.max(0, live.length - settings.maxPerUser + 1))) {
        if (session.tokenFamily) {
          await tx.delete(sessions).where(and(eq(sessions.userId, userId), eq(sessions.tokenFamily, session.tokenFamily)));
          removedFamilies.push(session.tokenFamily);
        } else await tx.delete(sessions).where(eq(sessions.id, session.id));
      }
    }
    const family = nanoid(24);
    const refreshToken = nanoid(32);
    await tx.insert(sessions).values({ id: hashRefreshToken(refreshToken), userId, tokenFamily: family, rotationCounter: 0, expiresAt: new Date(now.getTime() + settings.ttlHours * 3_600_000) });
    return { accessToken: await signAccessToken(authUser(user), family), refreshToken };
  });
  for (const family of removedFamilies) notifySessionRevocation({ userId, family });
  return result;
}

type RefreshFailure = { error: 'invalid' | 'expired' | 'disabled' | 'reuse'; userId?: string; family?: string };
export async function rotateRefreshToken(token: string): Promise<RefreshFailure | { accessToken: string; refreshToken: string; user: AuthUser }> {
  if (!/^[A-Za-z0-9_-]{32}$/.test(token)) return { error: 'invalid' };
  const hashed = hashRefreshToken(token);
  // The raw-id alternative accepts an existing installation's token once; rotation replaces it with a hash.
  const tokenCondition = or(eq(sessions.id, hashed), eq(sessions.id, token));
  const [candidate] = await db.select({ userId: sessions.userId }).from(sessions).where(tokenCondition).limit(1);
  if (!candidate) return { error: 'invalid' };
  const result = await db.transaction(async tx => {
    const [user] = await tx.select().from(users).where(eq(users.id, candidate.userId)).for('update');
    const [session] = await tx.select().from(sessions).where(and(eq(sessions.userId, candidate.userId), tokenCondition)).for('update');
    if (!session) return { error: 'invalid' as const };
    const family = session.tokenFamily ?? nanoid(24);
    if (!activeInteractiveUser(user)) {
      await tx.delete(sessions).where(eq(sessions.userId, candidate.userId));
      return { error: 'disabled' as const, userId: candidate.userId };
    }
    if (session.expiresAt.getTime() <= Date.now()) {
      await tx.delete(sessions).where(session.tokenFamily ? and(eq(sessions.userId, user.id), eq(sessions.tokenFamily, family)) : eq(sessions.id, session.id));
      return { error: 'expired' as const, userId: user.id, family };
    }
    if (session.rotationCounter < 0) {
      await tx.delete(sessions).where(and(eq(sessions.userId, user.id), eq(sessions.tokenFamily, family)));
      return { error: 'reuse' as const, userId: user.id, family };
    }
    // Keep a consumed hash until the family's absolute expiry. Negative counters are retained lineage.
    await tx.update(sessions).set({ id: hashed, tokenFamily: family, rotationCounter: -(session.rotationCounter + 1) }).where(eq(sessions.id, session.id));
    const refreshToken = nanoid(32);
    await tx.insert(sessions).values({ id: hashRefreshToken(refreshToken), userId: user.id, tokenFamily: family, rotationCounter: session.rotationCounter + 1, expiresAt: session.expiresAt });
    return { accessToken: await signAccessToken(authUser(user), family), refreshToken, user: authUser(user) };
  });
  if ('error' in result && result.userId) notifySessionRevocation({ userId: result.userId, ...('family' in result && result.family ? { family: result.family } : {}) });
  return result;
}

export async function revokeUserSessions(userId: string): Promise<number> {
  const count = await db.transaction(async tx => {
    await tx.select({ id: users.id }).from(users).where(eq(users.id, userId)).for('update');
    return (await tx.delete(sessions).where(eq(sessions.userId, userId)).returning({ id: sessions.id })).length;
  });
  notifySessionRevocation({ userId });
  return count;
}

export async function revokeSessionFamily(userId: string, family: string): Promise<void> {
  await db.transaction(async tx => {
    await tx.select({ id: users.id }).from(users).where(eq(users.id, userId)).for('update');
    await tx.delete(sessions).where(and(eq(sessions.userId, userId), eq(sessions.tokenFamily, family)));
  });
  notifySessionRevocation({ userId, family });
}

export async function revokeAllSessions(): Promise<number> {
  const count = await db.transaction(async tx => {
    await tx.select({ id: users.id }).from(users).orderBy(asc(users.id)).for('update');
    return (await tx.delete(sessions).returning({ id: sessions.id })).length;
  });
  notifySessionRevocation({ all: true });
  return count;
}

export async function updateUsersAndRevokeSessions(userIds: string[], updates: Partial<typeof users.$inferInsert>, expectedPasswordHash?: string): Promise<{ id: string }[]> {
  if (!userIds.length) return [];
  const updated = await db.transaction(async tx => {
    const locked = await tx.select().from(users).where(inArray(users.id, userIds)).orderBy(asc(users.id)).for('update');
    if (expectedPasswordHash !== undefined && (userIds.length !== 1 || !activeInteractiveUser(locked[0]) || locked[0].passwordHash !== expectedPasswordHash)) {
      throw new SessionAuthorizationError('Account credentials changed; sign in again');
    }
    const result = await tx.update(users).set(updates).where(inArray(users.id, userIds)).returning({ id: users.id });
    await tx.delete(sessions).where(inArray(sessions.userId, userIds));
    return result;
  });
  for (const userId of userIds) notifySessionRevocation({ userId });
  return updated;
}
