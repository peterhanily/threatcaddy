import { Hono } from 'hono';
import { eq, count, and, gte, not, ilike } from 'drizzle-orm';
import {
  db, users, folders, sessions, activityLog, allowedEmails,
  requireAdminAuth, logger, logAdminAction,
} from './shared.js';
import {
  getRegistrationMode, setRegistrationMode,
  getSessionSettings, setSessionSettings,
  getServerName, setServerName,
} from '../../services/admin-secret.js';
import { getRetentionSettings, setRetentionSettings } from '../../services/cleanup-service.js';

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
  const body = await c.req.json();
  const changedSettings: string[] = [];

  if (body.serverName !== undefined) {
    const name = typeof body.serverName === 'string' ? body.serverName.trim() : '';
    if (!name || name.length > 100) {
      return c.json({ error: 'Server name must be 1-100 characters' }, 400);
    }
    await setServerName(name);
    changedSettings.push(`serverName=${name}`);
    logger.info('Admin action: server name changed', { serverName: name });
  }

  if (body.registrationMode !== undefined) {
    const mode = body.registrationMode;
    if (mode !== 'invite' && mode !== 'open') {
      return c.json({ error: 'Invalid registrationMode, must be "invite" or "open"' }, 400);
    }
    await setRegistrationMode(mode);
    changedSettings.push(`registrationMode=${mode}`);
    logger.info('Admin action: registration mode changed', { registrationMode: mode });
  }

  if (body.ttlHours !== undefined || body.maxPerUser !== undefined) {
    const current = await getSessionSettings();
    const ttlHours = typeof body.ttlHours === 'number' && body.ttlHours >= 1 ? Math.floor(body.ttlHours) : current.ttlHours;
    const maxPerUser = typeof body.maxPerUser === 'number' && body.maxPerUser >= 0 ? Math.floor(body.maxPerUser) : current.maxPerUser;
    await setSessionSettings(ttlHours, maxPerUser);
    changedSettings.push(`ttlHours=${ttlHours}`, `maxPerUser=${maxPerUser}`);
    logger.info('Admin action: session settings changed', { ttlHours, maxPerUser });
  }

  if (body.notificationRetentionDays !== undefined || body.auditLogRetentionDays !== undefined) {
    const current = await getRetentionSettings();
    const notifDays = typeof body.notificationRetentionDays === 'number' &&
      Number.isInteger(body.notificationRetentionDays) &&
      body.notificationRetentionDays >= 1 && body.notificationRetentionDays <= 3650
      ? body.notificationRetentionDays : current.notificationRetentionDays;
    const auditDays = typeof body.auditLogRetentionDays === 'number' &&
      Number.isInteger(body.auditLogRetentionDays) &&
      body.auditLogRetentionDays >= 1 && body.auditLogRetentionDays <= 3650
      ? body.auditLogRetentionDays : current.auditLogRetentionDays;
    await setRetentionSettings(notifDays, auditDays);
    changedSettings.push(`notifRetention=${notifDays}`, `auditRetention=${auditDays}`);
    logger.info('Admin action: retention settings changed', { notifDays, auditDays });
  }

  if (changedSettings.length > 0) {
    await logAdminAction('settings.update', `Updated ${changedSettings.join(', ')}`);
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
  await logAdminAction('allowlist.add', `Added ${email}`);
  return c.json({ ok: true, email });
});

app.delete('/api/allowed-emails/:email', requireAdminAuth, async (c) => {
  const email = decodeURIComponent(c.req.param('email'));
  const result = await db.delete(allowedEmails).where(eq(allowedEmails.email, email)).returning({ email: allowedEmails.email });
  if (result.length === 0) {
    return c.json({ error: 'Email not found' }, 404);
  }
  logger.info('Admin action: email removed from allowlist', { email });
  await logAdminAction('allowlist.remove', `Removed ${email}`);
  return c.json({ ok: true });
});

export default app;
