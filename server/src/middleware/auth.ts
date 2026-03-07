import { createMiddleware } from 'hono/factory';
import * as jose from 'jose';
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

export async function signAccessToken(user: AuthUser): Promise<string> {
  const key = await getPrivateKey();
  return new jose.SignJWT({
    sub: user.id,
    email: user.email,
    role: user.role,
    displayName: user.displayName,
  })
    .setProtectedHeader({ alg: 'EdDSA' })
    .setIssuedAt()
    .setExpirationTime('15m')
    .sign(key);
}

export async function verifyAccessToken(token: string): Promise<AuthUser> {
  const key = await getPublicKey();
  const { payload } = await jose.jwtVerify(token, key);
  return {
    id: payload.sub as string,
    email: payload.email as string,
    role: payload.role as string,
    displayName: payload.displayName as string,
    avatarUrl: null,
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
