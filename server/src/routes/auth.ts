import { Hono } from 'hono';
import { z } from 'zod';
import { eq } from 'drizzle-orm';
import * as argon2 from 'argon2';
import { nanoid } from 'nanoid';
import { db } from '../db/index.js';
import { users } from '../db/schema.js';
import { requireAuth } from '../middleware/auth.js';
import { getRegistrationMode, ADMIN_SYSTEM_USER_ID } from '../services/admin-secret.js';
import { logActivity } from '../services/audit-service.js';
import { isLocked, recordFailedAttempt, resetAttempts } from '../services/login-limiter.js';
import type { AuthUser } from '../types.js';
import { ErrorCodes } from '../types/error-codes.js';
import { createTokenPair, rotateRefreshToken, revokeSessionFamily, updateUsersAndRevokeSessions, SessionAuthorizationError } from '../services/session-service.js';

const app = new Hono<{ Variables: { user: AuthUser } }>();

const registerSchema = z.object({
  email: z.string().email(),
  displayName: z.string().min(1).max(15),
  password: z.string().min(8).max(128),
});

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string(),
});

const changePasswordSchema = z.object({
  oldPassword: z.string(),
  newPassword: z.string().min(8).max(128),
});

const updateProfileSchema = z.object({
  displayName: z.string().min(1).max(15).optional(),
  avatarUrl: z.string().url().nullish(),
});

// POST /api/auth/register
app.post('/register', async (c) => {
  const body = await c.req.json();
  const parsed = registerSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: 'Validation failed', code: ErrorCodes.VALIDATION_FAILED, details: parsed.error.flatten() }, 400);
  }

  const { displayName, password } = parsed.data;
  const email = parsed.data.email.trim().toLowerCase();

  // Block internal bot domain from registration
  if (email.endsWith('@threatcaddy.internal')) {
    return c.json({ error: 'Cannot register with this email domain', code: ErrorCodes.BOT_REGISTER_FORBIDDEN }, 400);
  }

  // Check if email already exists
  const existing = await db.select().from(users).where(eq(users.email, email)).limit(1);
  if (existing.length > 0) {
    return c.json({ error: 'Email already registered', code: ErrorCodes.EMAIL_ALREADY_REGISTERED }, 409);
  }

  // An email allowlist is not proof that this requester owns the mailbox.
  // Until a verified one-time invitation flow exists, closed registration uses
  // administrator-provisioned accounts only.
  const mode = await getRegistrationMode();
  if (mode === 'invite') {
    return c.json({ error: 'Self-registration is closed. Ask an administrator to provision your account; an email allowlist is not an invitation credential.', code: ErrorCodes.REGISTRATION_INVITE_ONLY }, 403);
  }

  const passwordHash = await argon2.hash(password, { type: argon2.argon2id });
  const userId = nanoid();
  const now = new Date();

  const role = 'analyst';

  await db.insert(users).values({
    id: userId,
    email,
    displayName,
    passwordHash,
    role,
    active: true,
    lastLoginAt: now,
    createdAt: now,
    updatedAt: now,
  });

  const user: AuthUser = { id: userId, email, role, displayName, avatarUrl: null };
  const tokens = await createTokenPair(user.id, passwordHash);

  await logActivity({ userId, category: 'auth', action: 'register', detail: 'User registered' });

  return c.json({
    ...tokens,
    user: { id: userId, email, displayName, role, avatarUrl: null },
  }, 201);
});

// POST /api/auth/login
app.post('/login', async (c) => {
  const body = await c.req.json();
  const parsed = loginSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: 'Validation failed', code: ErrorCodes.VALIDATION_FAILED }, 400);
  }

  const email = parsed.data.email.trim().toLowerCase();
  const { password } = parsed.data;

  // Check if account is locked before verifying credentials
  const lockStatus = isLocked(email);
  if (lockStatus.locked) {
    const retryMin = lockStatus.retryAfterMinutes ?? 15;
    c.header('Retry-After', String(retryMin * 60));
    return c.json({ error: `Account temporarily locked. Try again in ${retryMin} minutes.`, code: ErrorCodes.ACCOUNT_LOCKED }, 429);
  }

  const result = await db.select().from(users).where(eq(users.email, email)).limit(1);
  if (result.length === 0) {
    const failResult = recordFailedAttempt(email);
    await logActivity({ userId: ADMIN_SYSTEM_USER_ID, category: 'auth', action: 'login.failed', detail: `Login failed for unknown email ${email}` });
    if (failResult.locked) {
      const retryMin = failResult.retryAfterMinutes ?? 15;
      c.header('Retry-After', String(retryMin * 60));
      return c.json({ error: `Account temporarily locked. Try again in ${retryMin} minutes.`, code: ErrorCodes.ACCOUNT_LOCKED }, 429);
    }
    return c.json({ error: 'Invalid credentials', code: ErrorCodes.INVALID_CREDENTIALS }, 401);
  }

  const user = result[0];
  if (!user.active) {
    return c.json({ error: 'Account disabled', code: ErrorCodes.ACCOUNT_DISABLED }, 403);
  }

  if (user.email.endsWith('@threatcaddy.internal')) {
    return c.json({ error: 'Bot accounts cannot log in interactively', code: ErrorCodes.BOT_LOGIN_FORBIDDEN }, 403);
  }

  const valid = await argon2.verify(user.passwordHash, password);
  if (!valid) {
    const failResult = recordFailedAttempt(email);
    await logActivity({ userId: user.id, category: 'auth', action: 'login.failed', detail: 'Login failed' });
    if (failResult.locked) {
      const retryMin = failResult.retryAfterMinutes ?? 15;
      c.header('Retry-After', String(retryMin * 60));
      return c.json({ error: `Account temporarily locked. Try again in ${retryMin} minutes.`, code: ErrorCodes.ACCOUNT_LOCKED }, 429);
    }
    return c.json({ error: 'Invalid credentials', code: ErrorCodes.INVALID_CREDENTIALS }, 401);
  }

  resetAttempts(email);
  await db.update(users).set({ lastLoginAt: new Date() }).where(eq(users.id, user.id));

  const authUser: AuthUser = {
    id: user.id,
    email: user.email,
    role: user.role,
    displayName: user.displayName,
    avatarUrl: user.avatarUrl,
  };
  let tokens;
  try { tokens = await createTokenPair(authUser.id, user.passwordHash); }
  catch (error) {
    if (error instanceof SessionAuthorizationError) return c.json({ error: 'Credentials changed. Sign in again.', code: ErrorCodes.INVALID_CREDENTIALS }, 401);
    throw error;
  }

  await logActivity({ userId: user.id, category: 'auth', action: 'login', detail: 'User logged in' });

  return c.json({
    ...tokens,
    user: { id: user.id, email: user.email, displayName: user.displayName, role: user.role, avatarUrl: user.avatarUrl },
  });
});

// POST /api/auth/refresh
app.post('/refresh', async (c) => {
  const body = await c.req.json();
  const { refreshToken } = body;
  if (!refreshToken) {
    return c.json({ error: 'Missing refresh token', code: ErrorCodes.INVALID_REFRESH_TOKEN }, 400);
  }

  if (typeof refreshToken !== 'string') return c.json({ error: 'Invalid refresh token', code: ErrorCodes.INVALID_REFRESH_TOKEN }, 400);
  const result = await rotateRefreshToken(refreshToken);
  if ('error' in result) {
    const code = result.error === 'reuse' ? ErrorCodes.REFRESH_TOKEN_REUSE
      : result.error === 'expired' ? ErrorCodes.REFRESH_TOKEN_EXPIRED
      : result.error === 'disabled' ? ErrorCodes.ACCOUNT_DISABLED : ErrorCodes.INVALID_REFRESH_TOKEN;
    if (result.error === 'reuse' && result.userId) await logActivity({ userId: result.userId, category: 'auth', action: 'token.reuse_detected', detail: 'Refresh token reuse detected; session family revoked.' });
    return c.json({ error: 'Session no longer valid. Sign in again.', code }, 401);
  }
  return c.json(result);
});

// POST /api/auth/logout
app.post('/logout', requireAuth, async (c) => {
  const authUser = c.get('user');
  if (!authUser.sessionFamily) return c.json({ error: 'Invalid session', code: ErrorCodes.INVALID_REFRESH_TOKEN }, 401);
  await revokeSessionFamily(authUser.id, authUser.sessionFamily);
  await logActivity({ userId: authUser.id, category: 'auth', action: 'logout', detail: 'User logged out' });
  return c.json({ ok: true });
});

// GET /api/auth/me
app.get('/me', requireAuth, async (c) => {
  const authUser = c.get('user');
  const result = await db.select().from(users).where(eq(users.id, authUser.id)).limit(1);
  if (result.length === 0) {
    return c.json({ error: 'User not found', code: ErrorCodes.NOT_FOUND }, 404);
  }
  const u = result[0];
  return c.json({
    id: u.id,
    email: u.email,
    displayName: u.displayName,
    role: u.role,
    avatarUrl: u.avatarUrl,
    createdAt: u.createdAt,
  });
});

// PATCH /api/auth/me
app.patch('/me', requireAuth, async (c) => {
  const authUser = c.get('user');
  const body = await c.req.json();
  const parsed = updateProfileSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: 'Validation failed', code: ErrorCodes.VALIDATION_FAILED, details: parsed.error.flatten() }, 400);
  }

  const updates: Record<string, unknown> = { updatedAt: new Date() };
  if (parsed.data.displayName) updates.displayName = parsed.data.displayName;
  if (parsed.data.avatarUrl !== undefined) updates.avatarUrl = parsed.data.avatarUrl;

  await db.update(users).set(updates).where(eq(users.id, authUser.id));

  return c.json({ ok: true });
});

// POST /api/auth/change-password
app.post('/change-password', requireAuth, async (c) => {
  const authUser = c.get('user');
  const body = await c.req.json();
  const parsed = changePasswordSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: 'Validation failed', code: ErrorCodes.VALIDATION_FAILED }, 400);
  }

  const result = await db.select().from(users).where(eq(users.id, authUser.id)).limit(1);
  if (result.length === 0) {
    return c.json({ error: 'User not found', code: ErrorCodes.NOT_FOUND }, 404);
  }

  const valid = await argon2.verify(result[0].passwordHash, parsed.data.oldPassword);
  if (!valid) {
    return c.json({ error: 'Incorrect current password', code: ErrorCodes.INCORRECT_PASSWORD }, 401);
  }

  const newHash = await argon2.hash(parsed.data.newPassword, { type: argon2.argon2id });
  try { await updateUsersAndRevokeSessions([authUser.id], { passwordHash: newHash, updatedAt: new Date() }, result[0].passwordHash); }
  catch (error) {
    if (error instanceof SessionAuthorizationError) return c.json({ error: 'Credentials changed. Sign in again.', code: ErrorCodes.INVALID_CREDENTIALS }, 401);
    throw error;
  }

  return c.json({ ok: true });
});

export default app;
