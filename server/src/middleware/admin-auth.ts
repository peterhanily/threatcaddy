import { createMiddleware } from 'hono/factory';
import * as jose from 'jose';
import { randomBytes, createHmac } from 'node:crypto';
import { getActiveAdmin, adminSessionVersion } from '../services/admin-session-service.js';

const ADMIN_AUDIENCE = 'admin-panel';

// Separate HMAC key for admin tokens — generated at startup, lives in memory only.
// Admin tokens auto-invalidate on server restart (feature, not bug).
let adminKey: Uint8Array | null = null;

export function initAdminKey(): void {
  adminKey = randomBytes(32);
}

export async function signAdminToken(adminUserId: string, adminUsername: string, expectedPasswordHash: string): Promise<string> {
  if (!adminKey) throw new Error('Admin key not initialized');
  const version = adminSessionVersion(adminUserId);
  const admin = await getActiveAdmin(adminUserId);
  if (!admin || admin.passwordHash !== expectedPasswordHash) throw new Error('Admin account credentials changed');
  return new jose.SignJWT({ username: adminUsername, sessionVersion: version, credentialVersion: createHmac('sha256', adminKey).update(admin.passwordHash).digest('base64url') })
    .setProtectedHeader({ alg: 'HS256' })
    .setAudience(ADMIN_AUDIENCE)
    .setSubject(adminUserId)
    .setIssuedAt()
    .setExpirationTime('1h')
    .sign(adminKey);
}

export const requireAdminAuth = createMiddleware(async (c, next) => {
  if (!adminKey) return c.json({ error: 'Admin key not initialized' }, 500);
  const header = c.req.header('Authorization');
  if (!header?.startsWith('Bearer ')) {
    return c.json({ error: 'Missing authorization header' }, 401);
  }
  const token = header.slice(7);
  try {
    const { payload } = await jose.jwtVerify(token, adminKey, { audience: ADMIN_AUDIENCE, algorithms: ['HS256'] });
    if (!payload.sub) throw new Error('Missing admin identity');
    const admin = await getActiveAdmin(payload.sub);
    if (!admin || payload.sessionVersion !== adminSessionVersion(admin.id) || payload.credentialVersion !== createHmac('sha256', adminKey).update(admin.passwordHash).digest('base64url')) throw new Error('Admin credentials revoked');
    c.set('adminUserId', admin.id);
    c.set('adminUsername', admin.username);
  } catch {
    return c.json({ error: 'Invalid or expired admin token' }, 401);
  }
  await next();
});
