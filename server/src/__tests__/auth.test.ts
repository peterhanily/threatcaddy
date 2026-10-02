import { describe, it, expect, beforeAll, vi } from 'vitest';
const { currentUser } = vi.hoisted(() => ({ currentUser: { value: null as Record<string, unknown> | null } }));
vi.mock('../db/index.js', () => ({ db: { select: () => { const chain = { from: () => chain, innerJoin: () => chain, where: () => chain, limit: async () => currentUser.value ? [currentUser.value] : [] }; return chain; } } }));
import * as jose from 'jose';

describe('auth middleware', () => {
  let signAccessToken: (user: { id: string; email: string; role: string; displayName: string; avatarUrl: string | null }, family: string) => Promise<string>;
  let verifyAccessToken: (token: string) => Promise<{ id: string; email: string; role: string; displayName: string; avatarUrl: string | null }>;
  let privateKey: jose.KeyLike;
  let publicKey: jose.KeyLike;

  beforeAll(async () => {
    // Generate keys and set env vars BEFORE importing the auth module
    const keyPair = await jose.generateKeyPair('EdDSA');
    privateKey = keyPair.privateKey;
    publicKey = keyPair.publicKey;

    process.env.JWT_PRIVATE_KEY = await jose.exportPKCS8(privateKey);
    process.env.JWT_PUBLIC_KEY = await jose.exportSPKI(publicKey);

    // Dynamic import after env vars are set
    const auth = await import('../middleware/auth.js');
    signAccessToken = auth.signAccessToken;
    verifyAccessToken = auth.verifyAccessToken;
  });

  it('should sign and verify an access token round-trip', async () => {
    const user = {
      id: 'user-123',
      email: 'test@example.com',
      role: 'analyst',
      displayName: 'Test User',
      avatarUrl: null,
    };

    const token = await signAccessToken(user, 'test-family');
    expect(typeof token).toBe('string');
    expect(token.split('.')).toHaveLength(3);

    currentUser.value = user;
    const verified = await verifyAccessToken(token);
    expect(verified.id).toBe(user.id);
    expect(verified.email).toBe(user.email);
    expect(verified.role).toBe(user.role);
    expect(verified.displayName).toBe(user.displayName);
  });

  it('should reject an invalid token', async () => {
    await expect(verifyAccessToken('invalid.token.here')).rejects.toThrow();
  });

  it('should reject a token signed with a different key', async () => {
    const otherKeyPair = await jose.generateKeyPair('EdDSA');
    const badToken = await new jose.SignJWT({
      sub: 'user-999',
      email: 'bad@example.com',
      role: 'admin',
      displayName: 'Bad User',
    })
      .setProtectedHeader({ alg: 'EdDSA' })
      .setIssuedAt()
      .setExpirationTime('15m')
      .sign(otherKeyPair.privateKey);

    await expect(verifyAccessToken(badToken)).rejects.toThrow();
  });

  it('should reject an expired token', async () => {
    const expiredToken = await new jose.SignJWT({
      sub: 'user-expired',
      email: 'expired@example.com',
      role: 'viewer',
      displayName: 'Expired',
    })
      .setProtectedHeader({ alg: 'EdDSA' })
      .setIssuedAt(Math.floor(Date.now() / 1000) - 3600)
      .setExpirationTime(Math.floor(Date.now() / 1000) - 1800)
      .sign(privateKey);

    await expect(verifyAccessToken(expiredToken)).rejects.toThrow();
  });

  it('should include correct claims in signed token', async () => {
    const user = {
      id: 'user-claims',
      email: 'claims@example.com',
      role: 'admin',
      displayName: 'Claims User',
      avatarUrl: 'https://example.com/avatar.png',
    };

    const token = await signAccessToken(user, 'test-family');
    const { payload } = await jose.jwtVerify(token, publicKey);

    expect(payload.sub).toBe(user.id);
    expect(payload.email).toBe(user.email);
    expect(payload.role).toBe(user.role);
    expect(payload.displayName).toBe(user.displayName);
    expect(payload.exp).toBeDefined();
    expect(payload.iat).toBeDefined();
    expect(payload.exp! - payload.iat!).toBe(900); // 15 minutes
  });
});
