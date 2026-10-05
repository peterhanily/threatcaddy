import { Hono } from 'hono';
import { eq, count, and, gte, not, ilike } from 'drizzle-orm';
import {
  db, users, folders, sessions, activityLog, allowedEmails,
  requireAdminAuth, logger, logAdminAction, getAdminId,
} from './shared.js';
import {
  getRegistrationMode, getSessionSettings, getServerName,
  validateAdminSettings, setAdminSettings,
} from '../../services/admin-secret.js';
import { getRetentionSettings } from '../../services/cleanup-service.js';

const app = new Hono();

// ─── Stats ───────────────────────────────────────────────────────

app.get('/api/stats', requireAdminAuth, async (c) => {
  const [totalResult] = await db.select({ count: count() }).from(users).where(not(ilike(users.email, '%@threatcaddy.internal')));
  const [activeResult] = await db.select({ count: count() }).from(users).where(and(eq(users.active, true), not(ilike(users.email, '%@threatcaddy.internal'))));
  const [invResult] = await db.select({ count: count() }).from(folders);
  const [sessionResult] = await db.select({ count: count() }).from(sessions).where(gte(sessions.expiresAt, new Date()));
  const twentyFourHoursAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const [auditResult] = await db.select({ count: count() }).from(activityLog).where(gte(activityLog.timestamp, twentyFourHoursAgo));

  return c.json({
    totalUsers: totalResult.count,
    activeUsers: activeResult.count,
    investigations: invResult.count,
    activeSessions: sessionResult.count,
    auditLogEntries24h: auditResult.count,
  });
});

// ─── Settings ────────────────────────────────────────────────────

app.get('/api/settings', requireAdminAuth, async (c) => {
  const registrationMode = await getRegistrationMode();
  const sessionSettings = await getSessionSettings();
  const retentionSettings = await getRetentionSettings();
  const serverName = await getServerName();
  return c.json({ serverName, registrationMode, ...sessionSettings, ...retentionSettings });
});

app.patch('/api/settings', requireAdminAuth, async (c) => {
  let body: unknown;
  try { body = await c.req.json(); } catch { return c.json({ error: 'Invalid JSON' }, 400); }
  let updates;
  try { updates = validateAdminSettings(body); }
  catch (error) { return c.json({ error: error instanceof Error ? error.message : 'Invalid settings' }, 400); }
  await setAdminSettings(updates);
  const changedSettings = Object.entries(updates).map(([field, value]) => `${field}=${value}`);
  if (changedSettings.length > 0) {
    await logAdminAction(getAdminId(c), 'settings.update', `Updated ${changedSettings.join(', ')}`);
  }

  const registrationMode = await getRegistrationMode();
  const sessionSettings = await getSessionSettings();
  const retentionSettings = await getRetentionSettings();
  const serverName = await getServerName();
  return c.json({ ok: true, serverName, registrationMode, ...sessionSettings, ...retentionSettings });
});

// ─── Allowed Emails ──────────────────────────────────────────────

app.get('/api/allowed-emails', requireAdminAuth, async (c) => {
  const emails = await db.select().from(allowedEmails).orderBy(allowedEmails.createdAt);
  return c.json({ emails });
});

app.post('/api/allowed-emails', requireAdminAuth, async (c) => {
  const body = await c.req.json();
  const email = body?.email?.trim()?.toLowerCase();
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return c.json({ error: 'Invalid email' }, 400);
  }
  await db.insert(allowedEmails).values({ email }).onConflictDoNothing();
  logger.info('Admin action: email added to allowlist', { email });
  await logAdminAction(getAdminId(c), 'allowlist.add', `Added ${email}`);
  return c.json({ ok: true, email });
});

app.delete('/api/allowed-emails/:email', requireAdminAuth, async (c) => {
  const email = decodeURIComponent(c.req.param('email'));
  const result = await db.delete(allowedEmails).where(eq(allowedEmails.email, email)).returning({ email: allowedEmails.email });
  if (result.length === 0) {
    return c.json({ error: 'Email not found' }, 404);
  }
  logger.info('Admin action: email removed from allowlist', { email });
  await logAdminAction(getAdminId(c), 'allowlist.remove', `Removed ${email}`);
  return c.json({ ok: true });
});

export default app;
