import { createMiddleware } from 'hono/factory';
import * as jose from 'jose';
import { randomBytes, createHmac, createHash, randomUUID } from 'node:crypto';
import { getActiveAdmin, adminSessionVersion } from '../services/admin-session-service.js';
import type { DB } from '../db/index.js';

const ADMIN_AUDIENCE = 'admin-panel';

// Separate HMAC key for admin tokens — generated at startup, lives in memory only.
// Admin tokens auto-invalidate on server restart (feature, not bug).
let adminKey: Uint8Array | null = null;

export interface AdminAiPrincipal {
  readonly adminId: string;
  readonly tokenFingerprint: string;
  readonly sessionVersion: string;
  readonly credentialVersion: string;
  readonly expiresAt: number;
}

export class AdminAuthorizationError extends Error {
  readonly status = 401;
  readonly code = 'ADMIN_SESSION_REVOKED';
  constructor() { super('Administrator session expired or changed. Sign in again.'); }
}

function credentialVersion(passwordHash: string): string {
  if (!adminKey) throw new AdminAuthorizationError();
  return createHmac('sha256', adminKey).update(passwordHash).digest('base64url');
}

/** Call inside the write transaction, after the shared policy clock lock. */
export async function assertAdminAiPrincipal(database: Pick<DB, 'select'>, principal: AdminAiPrincipal): Promise<void> {
  const admin = await getActiveAdmin(principal.adminId, database, true);
  if (!admin || principal.expiresAt <= Date.now() || principal.sessionVersion !== adminSessionVersion(admin.id)
    || principal.credentialVersion !== credentialVersion(admin.passwordHash)) throw new AdminAuthorizationError();
}

export function getAdminAiPrincipal(c: { get: (key: string) => unknown }): AdminAiPrincipal {
  const principal = c.get('adminAiPrincipal') as AdminAiPrincipal | undefined;
  if (!principal) throw new AdminAuthorizationError();
  return principal;
}

export function initAdminKey(): void {
  adminKey = randomBytes(32);
}

export async function signAdminToken(adminUserId: string, adminUsername: string, expectedPasswordHash: string): Promise<string> {
  if (!adminKey) throw new Error('Admin key not initialized');
  const version = adminSessionVersion(adminUserId);
  const admin = await getActiveAdmin(adminUserId);
  if (!admin || admin.passwordHash !== expectedPasswordHash) throw new Error('Admin account credentials changed');
  return new jose.SignJWT({ username: adminUsername, sessionVersion: version, credentialVersion: credentialVersion(admin.passwordHash) })
    .setProtectedHeader({ alg: 'HS256' })
    .setAudience(ADMIN_AUDIENCE)
    .setSubject(adminUserId)
    .setJti(randomUUID())
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
    if (!payload.sub || typeof payload.exp !== 'number' || typeof payload.sessionVersion !== 'string' || typeof payload.credentialVersion !== 'string') throw new Error('Missing admin identity');
    const admin = await getActiveAdmin(payload.sub);
    if (!admin || payload.sessionVersion !== adminSessionVersion(admin.id) || payload.credentialVersion !== credentialVersion(admin.passwordHash)) throw new Error('Admin credentials revoked');
    c.set('adminUserId', admin.id);
    c.set('adminUsername', admin.username);
    c.set('adminAiPrincipal', Object.freeze({ adminId: admin.id, tokenFingerprint: createHash('sha256').update(token).digest('hex'),
      sessionVersion: payload.sessionVersion, credentialVersion: payload.credentialVersion, expiresAt: payload.exp * 1000 } satisfies AdminAiPrincipal));
  } catch {
    return c.json({ error: 'Invalid or expired admin token' }, 401);
  }
  await next();
});
