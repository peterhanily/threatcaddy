import { createMiddleware } from 'hono/factory';
import * as jose from 'jose';
import { and, eq, gt, gte } from 'drizzle-orm';
import { db } from '../db/index.js';
import { users, sessions } from '../db/schema.js';
import type { AuthUser } from '../types.js';

let publicKey: jose.KeyLike | null = null;

export async function getPublicKey(): Promise<jose.KeyLike> {
  if (publicKey) return publicKey;
  const raw = process.env.JWT_PUBLIC_KEY;
  if (!raw) throw new Error('JWT_PUBLIC_KEY not set');
  publicKey = await jose.importSPKI(raw, 'EdDSA');
  return publicKey;
}

let privateKey: jose.KeyLike | null = null;

export async function getPrivateKey(): Promise<jose.KeyLike> {
  if (privateKey) return privateKey;
  const raw = process.env.JWT_PRIVATE_KEY;
  if (!raw) throw new Error('JWT_PRIVATE_KEY not set');
  privateKey = await jose.importPKCS8(raw, 'EdDSA');
  return privateKey;
}

export async function signAccessToken(user: AuthUser, sessionFamily: string): Promise<string> {
  if (!sessionFamily) throw new Error('Access tokens require a session family');
  const key = await getPrivateKey();
  return new jose.SignJWT({
    sub: user.id,
    email: user.email,
    role: user.role,
    displayName: user.displayName,
    sid: sessionFamily,
  })
    .setProtectedHeader({ alg: 'EdDSA' })
    .setIssuedAt()
    .setExpirationTime('15m')
    .sign(key);
}

export async function verifyAccessToken(token: string): Promise<AuthUser> {
  const key = await getPublicKey();
  const { payload } = await jose.jwtVerify(token, key, { algorithms: ['EdDSA'] });
  if (typeof payload.sub !== 'string' || !payload.sub || typeof payload.sid !== 'string'
    || !payload.sid || typeof payload.exp !== 'number' || !Number.isFinite(payload.exp)) {
    throw new Error('Invalid session claims');
  }
  const [current] = await db.select({
    id: users.id, email: users.email, role: users.role, displayName: users.displayName, avatarUrl: users.avatarUrl,
  }).from(users).innerJoin(sessions, eq(sessions.userId, users.id)).where(and(
    eq(users.id, payload.sub), eq(users.active, true), eq(sessions.tokenFamily, payload.sid),
    gte(sessions.rotationCounter, 0), gt(sessions.expiresAt, new Date()),
  )).limit(1);
  if (!current || current.email.endsWith('@threatcaddy.internal') || !['admin', 'analyst', 'viewer'].includes(current.role)) {
    throw new Error('Account or session is no longer authorized');
  }
  return {
    ...current,
    sessionFamily: payload.sid,
    tokenExpiresAt: payload.exp * 1000,
  };
}

// Hono middleware: sets c.get('user') on valid JWT
export const requireAuth = createMiddleware<{
  Variables: { user: AuthUser };
}>(async (c, next) => {
  const header = c.req.header('Authorization');
  if (!header?.startsWith('Bearer ')) {
    return c.json({ error: 'Missing authorization header' }, 401);
  }
  const token = header.slice(7);
  try {
    const user = await verifyAccessToken(token);
    if (user.email?.endsWith('@threatcaddy.internal')) {
      return c.json({ error: 'Bot accounts cannot use the API directly' }, 403);
    }
    c.set('user', user);
  } catch {
    return c.json({ error: 'Invalid or expired token' }, 401);
  }
  await next();
});

// Require minimum server role
export function requireRole(...roles: string[]) {
  return createMiddleware<{ Variables: { user: AuthUser } }>(async (c, next) => {
    const user = c.get('user');
    if (!roles.includes(user.role)) {
      return c.json({ error: 'Insufficient permissions' }, 403);
    }
    await next();
  });
}
