import { Hono } from 'hono';
import { z } from 'zod';
import { eq, asc } from 'drizzle-orm';
import * as argon2 from 'argon2';
import { nanoid } from 'nanoid';
import { db } from '../db/index.js';
import { users, sessions, allowedEmails } from '../db/schema.js';
import { requireAuth, signAccessToken } from '../middleware/auth.js';
import { getRegistrationMode, getSessionSettings, ADMIN_SYSTEM_USER_ID } from '../services/admin-secret.js';
import { logActivity } from '../services/audit-service.js';
import type { AuthUser } from '../types.js';

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

async function createTokenPair(user: AuthUser) {
  const accessToken = await signAccessToken(user);
  const refreshTokenId = nanoid(32);

  const settings = await getSessionSettings();
  const expiresAt = new Date(Date.now() + settings.ttlHours * 60 * 60 * 1000);

  // Enforce max sessions per user
  if (settings.maxPerUser > 0) {
    const existing = await db
      .select({ id: sessions.id })
      .from(sessions)
      .where(eq(sessions.userId, user.id))
      .orderBy(asc(sessions.createdAt));

    const excess = existing.length - settings.maxPerUser + 1;
    if (excess > 0) {
      const toDelete = existing.slice(0, excess);
      for (const s of toDelete) {
        await db.delete(sessions).where(eq(sessions.id, s.id));
      }
    }
  }

  await db.insert(sessions).values({
    id: refreshTokenId,
    userId: user.id,
    expiresAt,
  });

  return { accessToken, refreshToken: refreshTokenId };
}

// POST /api/auth/register
app.post('/register', async (c) => {
  const body = await c.req.json();
  const parsed = registerSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: 'Validation failed', details: parsed.error.flatten() }, 400);
  }

  const { email, displayName, password } = parsed.data;

  // Check if email already exists
  const existing = await db.select().from(users).where(eq(users.email, email)).limit(1);
  if (existing.length > 0) {
    return c.json({ error: 'Email already registered' }, 409);
  }

  // Invite-only gate
  const mode = await getRegistrationMode();
  if (mode === 'invite') {
    const allowed = await db.select().from(allowedEmails).where(eq(allowedEmails.email, email)).limit(1);
    if (allowed.length === 0) {
      return c.json({ error: 'Registration is invite-only. Contact an admin.' }, 403);
    }
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

  // Consume invite if in invite mode
  if (mode === 'invite') {
    await db.delete(allowedEmails).where(eq(allowedEmails.email, email));
  }

  const user: AuthUser = { id: userId, email, role, displayName, avatarUrl: null };
  const tokens = await createTokenPair(user);

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
    return c.json({ error: 'Validation failed' }, 400);
  }

  const { email, password } = parsed.data;

  const result = await db.select().from(users).where(eq(users.email, email)).limit(1);
  if (result.length === 0) {
    await logActivity({ userId: ADMIN_SYSTEM_USER_ID, category: 'auth', action: 'login.failed', detail: `Login failed for unknown email ${email}` });
    return c.json({ error: 'Invalid credentials' }, 401);
  }

  const user = result[0];
  if (!user.active) {
    return c.json({ error: 'Account disabled' }, 403);
  }

  if (user.email.endsWith('@threatcaddy.internal')) {
    return c.json({ error: 'Bot accounts cannot log in interactively' }, 403);
  }

  const valid = await argon2.verify(user.passwordHash, password);
  if (!valid) {
    await logActivity({ userId: user.id, category: 'auth', action: 'login.failed', detail: 'Login failed' });
    return c.json({ error: 'Invalid credentials' }, 401);
  }

  await db.update(users).set({ lastLoginAt: new Date() }).where(eq(users.id, user.id));

  const authUser: AuthUser = {
    id: user.id,
    email: user.email,
    role: user.role,
    displayName: user.displayName,
    avatarUrl: user.avatarUrl,
  };
  const tokens = await createTokenPair(authUser);

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
    return c.json({ error: 'Missing refresh token' }, 400);
  }

  const session = await db.select().from(sessions).where(eq(sessions.id, refreshToken)).limit(1);
  if (session.length === 0) {
    return c.json({ error: 'Invalid refresh token' }, 401);
  }

  const s = session[0];
  if (new Date() > s.expiresAt) {
    await db.delete(sessions).where(eq(sessions.id, s.id));
    return c.json({ error: 'Refresh token expired' }, 401);
  }

  // Rotate: delete old session
  await db.delete(sessions).where(eq(sessions.id, s.id));

  const user = await db.select().from(users).where(eq(users.id, s.userId)).limit(1);
  if (user.length === 0 || !user[0].active) {
    return c.json({ error: 'User not found or disabled' }, 401);
  }

  const u = user[0];
  const authUser: AuthUser = {
    id: u.id,
    email: u.email,
    role: u.role,
    displayName: u.displayName,
    avatarUrl: u.avatarUrl,
  };
  const tokens = await createTokenPair(authUser);

  return c.json({
    ...tokens,
    user: { id: u.id, email: u.email, displayName: u.displayName, role: u.role, avatarUrl: u.avatarUrl },
  });
});

// POST /api/auth/logout
app.post('/logout', requireAuth, async (c) => {
  const authUser = c.get('user');
  const body = await c.req.json();
  const { refreshToken } = body;
  if (refreshToken) {
    await db.delete(sessions).where(eq(sessions.id, refreshToken));
  }
  await logActivity({ userId: authUser.id, category: 'auth', action: 'logout', detail: 'User logged out' });
  return c.json({ ok: true });
});

// GET /api/auth/me
app.get('/me', requireAuth, async (c) => {
  const authUser = c.get('user');
  const result = await db.select().from(users).where(eq(users.id, authUser.id)).limit(1);
  if (result.length === 0) {
    return c.json({ error: 'User not found' }, 404);
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
    return c.json({ error: 'Validation failed', details: parsed.error.flatten() }, 400);
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
    return c.json({ error: 'Validation failed' }, 400);
  }

  const result = await db.select().from(users).where(eq(users.id, authUser.id)).limit(1);
  if (result.length === 0) {
    return c.json({ error: 'User not found' }, 404);
  }

  const valid = await argon2.verify(result[0].passwordHash, parsed.data.oldPassword);
  if (!valid) {
    return c.json({ error: 'Incorrect current password' }, 401);
  }

  const newHash = await argon2.hash(parsed.data.newPassword, { type: argon2.argon2id });
  await db.update(users).set({ passwordHash: newHash, updatedAt: new Date() }).where(eq(users.id, authUser.id));

  // Invalidate all existing sessions for this user
  await db.delete(sessions).where(eq(sessions.userId, authUser.id));

  return c.json({ ok: true });
});

export default app;
