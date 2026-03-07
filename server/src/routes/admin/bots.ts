import { Hono } from 'hono';
import { eq, desc } from 'drizzle-orm';
import * as argon2 from 'argon2';
import { nanoid } from 'nanoid';
import {
  db, users, folders, investigationMembers, botConfigs, botRuns,
  requireAdminAuth, logAdminAction, ADMIN_SYSTEM_USER_ID,
} from './shared.js';
import { botManager, validateCronExpression } from '../../bots/bot-manager.js';
import { encryptConfigSecrets, redactConfigSecrets } from '../../bots/secret-store.js';

const app = new Hono();

// ─── Bots ────────────────────────────────────────────────────

const VALID_BOT_TYPES = ['enrichment', 'feed', 'monitor', 'triage', 'report', 'correlation', 'ai-agent', 'custom'];
const VALID_BOT_CAPABILITIES = [
  'read_entities', 'create_entities', 'update_entities', 'delete_entities',
  'link_entities', 'post_to_feed', 'notify_users', 'call_external_apis',
  'use_llm', 'manage_investigations', 'cross_investigation',
];

// GET /admin/api/bots — list all bots
app.get('/api/bots', requireAdminAuth, async (c) => {
  const rows = await db
    .select({
      id: botConfigs.id,
      userId: botConfigs.userId,
      type: botConfigs.type,
      name: botConfigs.name,
      description: botConfigs.description,
      enabled: botConfigs.enabled,
      triggers: botConfigs.triggers,
      config: botConfigs.config,
      capabilities: botConfigs.capabilities,
      allowedDomains: botConfigs.allowedDomains,
      scopeType: botConfigs.scopeType,
      scopeFolderIds: botConfigs.scopeFolderIds,
      rateLimitPerHour: botConfigs.rateLimitPerHour,
      rateLimitPerDay: botConfigs.rateLimitPerDay,
      lastRunAt: botConfigs.lastRunAt,
      lastError: botConfigs.lastError,
      runCount: botConfigs.runCount,
      errorCount: botConfigs.errorCount,
      createdBy: botConfigs.createdBy,
      createdAt: botConfigs.createdAt,
      updatedAt: botConfigs.updatedAt,
      creatorName: users.displayName,
    })
    .from(botConfigs)
    .leftJoin(users, eq(users.id, botConfigs.createdBy))
    .orderBy(desc(botConfigs.createdAt));

  const bots = rows.map((r) => ({
    ...r,
    config: redactConfigSecrets(r.config as Record<string, unknown>),
  }));

  return c.json({ bots });
});

// POST /admin/api/bots — create a new bot
app.post('/api/bots', requireAdminAuth, async (c) => {
  const body = await c.req.json();
  const {
    name, description, type, triggers, config, capabilities,
    allowedDomains, scopeType, scopeFolderIds, rateLimitPerHour, rateLimitPerDay,
  } = body || {};

  // Validate name
  if (!name || typeof name !== 'string' || name.trim().length < 1 || name.trim().length > 100) {
    return c.json({ error: 'Name is required (1-100 characters)' }, 400);
  }

  // Validate type
  if (!VALID_BOT_TYPES.includes(type)) {
    return c.json({ error: `Invalid type. Must be one of: ${VALID_BOT_TYPES.join(', ')}` }, 400);
  }

  // Validate capabilities
  if (capabilities !== undefined) {
    if (!Array.isArray(capabilities)) {
      return c.json({ error: 'Capabilities must be an array' }, 400);
    }
    for (const cap of capabilities) {
      if (!VALID_BOT_CAPABILITIES.includes(cap)) {
        return c.json({ error: `Invalid capability: ${cap}. Must be one of: ${VALID_BOT_CAPABILITIES.join(', ')}` }, 400);
      }
    }
  }

  // Validate allowedDomains
  if (Array.isArray(allowedDomains)) {
    for (const domain of allowedDomains) {
      if (typeof domain !== 'string' || !domain.match(/^[a-zA-Z0-9]([a-zA-Z0-9-]*\.)+[a-zA-Z]{2,}$/)) {
        return c.json({ error: `Invalid domain: ${domain}. Use bare hostnames (e.g., api.virustotal.com)` }, 400);
      }
    }
  }

  if (triggers?.schedule) {
    const cronError = validateCronExpression(triggers.schedule);
    if (cronError) return c.json({ error: cronError }, 400);
  }

  const botId = nanoid();
  const botUserId = nanoid();
  const now = new Date();

  // Create bot user account
  const botEmail = `bot-${botUserId}@threatcaddy.internal`;
  const botPassword = nanoid(32);
  const passwordHash = await argon2.hash(botPassword, { type: argon2.argon2id });

  await db.insert(users).values({
    id: botUserId,
    email: botEmail,
    displayName: `[Bot] ${name.trim()}`,
    passwordHash,
    role: 'analyst',
    active: true,
    createdAt: now,
    updatedAt: now,
  });

  // Encrypt config secrets if provided
  const encryptedConfig = config && typeof config === 'object'
    ? encryptConfigSecrets(config as Record<string, unknown>)
    : {};

  // Create bot config record
  await db.insert(botConfigs).values({
    id: botId,
    userId: botUserId,
    type,
    name: name.trim(),
    description: typeof description === 'string' ? description.trim() : '',
    enabled: false,
    triggers: triggers && typeof triggers === 'object' ? triggers : {},
    config: encryptedConfig,
    capabilities: Array.isArray(capabilities) ? capabilities : [],
    allowedDomains: Array.isArray(allowedDomains) ? allowedDomains : [],
    scopeType: ['global', 'investigation', 'tag-based'].includes(scopeType) ? scopeType : 'investigation',
    scopeFolderIds: Array.isArray(scopeFolderIds) ? scopeFolderIds : [],
    rateLimitPerHour: typeof rateLimitPerHour === 'number' && rateLimitPerHour > 0 ? rateLimitPerHour : 100,
    rateLimitPerDay: typeof rateLimitPerDay === 'number' && rateLimitPerDay > 0 ? rateLimitPerDay : 1000,
    createdBy: ADMIN_SYSTEM_USER_ID,
    createdAt: now,
    updatedAt: now,
  });

  // If scopeType is 'investigation', add bot user as member of each scoped folder
  if (scopeType === 'investigation' && Array.isArray(scopeFolderIds)) {
    for (const folderId of scopeFolderIds) {
      if (typeof folderId !== 'string') continue;
      await db.insert(investigationMembers).values({
        id: nanoid(),
        folderId,
        userId: botUserId,
        role: 'editor',
      }).onConflictDoNothing();
    }
  }

  await logAdminAction('bot.create', `Created bot "${name.trim()}" (${type})`, { itemId: botId });

  return c.json({
    ok: true,
    bot: {
      id: botId,
      userId: botUserId,
      name: name.trim(),
      type,
      enabled: false,
    },
  }, 201);
});

// GET /admin/api/bots/:id — bot detail
app.get('/api/bots/:id', requireAdminAuth, async (c) => {
  const id = c.req.param('id');

  const [bot] = await db
    .select({
      id: botConfigs.id,
      userId: botConfigs.userId,
      type: botConfigs.type,
      name: botConfigs.name,
      description: botConfigs.description,
      enabled: botConfigs.enabled,
      triggers: botConfigs.triggers,
      config: botConfigs.config,
      capabilities: botConfigs.capabilities,
      allowedDomains: botConfigs.allowedDomains,
      scopeType: botConfigs.scopeType,
      scopeFolderIds: botConfigs.scopeFolderIds,
      rateLimitPerHour: botConfigs.rateLimitPerHour,
      rateLimitPerDay: botConfigs.rateLimitPerDay,
      lastRunAt: botConfigs.lastRunAt,
      lastError: botConfigs.lastError,
      runCount: botConfigs.runCount,
      errorCount: botConfigs.errorCount,
      createdBy: botConfigs.createdBy,
      createdAt: botConfigs.createdAt,
      updatedAt: botConfigs.updatedAt,
      creatorName: users.displayName,
    })
    .from(botConfigs)
    .leftJoin(users, eq(users.id, botConfigs.createdBy))
    .where(eq(botConfigs.id, id))
    .limit(1);

  if (!bot) return c.json({ error: 'Bot not found' }, 404);

  const recentRuns = await db.select({
    id: botRuns.id,
    status: botRuns.status,
    trigger: botRuns.trigger,
    inputSummary: botRuns.inputSummary,
    outputSummary: botRuns.outputSummary,
    durationMs: botRuns.durationMs,
    error: botRuns.error,
    entitiesCreated: botRuns.entitiesCreated,
    entitiesUpdated: botRuns.entitiesUpdated,
    apiCallsMade: botRuns.apiCallsMade,
    createdAt: botRuns.createdAt,
  }).from(botRuns)
    .where(eq(botRuns.botConfigId, id))
    .orderBy(desc(botRuns.createdAt))
    .limit(20);

  const memberships = await db.select({
    folderId: investigationMembers.folderId,
    role: investigationMembers.role,
    folderName: folders.name,
  }).from(investigationMembers)
    .leftJoin(folders, eq(folders.id, investigationMembers.folderId))
    .where(eq(investigationMembers.userId, bot.userId));

  return c.json({
    bot: { ...bot, config: redactConfigSecrets(bot.config as Record<string, unknown>) },
    recentRuns,
    memberships,
  });
});

// PATCH /admin/api/bots/:id — update bot config
app.patch('/api/bots/:id', requireAdminAuth, async (c) => {
  const id = c.req.param('id');
  const body = await c.req.json();

  const [existing] = await db.select({ id: botConfigs.id, name: botConfigs.name }).from(botConfigs).where(eq(botConfigs.id, id)).limit(1);
  if (!existing) return c.json({ error: 'Bot not found' }, 404);

  const updates: Record<string, unknown> = { updatedAt: new Date() };

  if (body.name !== undefined) {
    if (typeof body.name !== 'string' || body.name.trim().length < 1 || body.name.trim().length > 100) {
      return c.json({ error: 'Name must be 1-100 characters' }, 400);
    }
    updates.name = body.name.trim();
  }
  if (body.description !== undefined) {
    updates.description = typeof body.description === 'string' ? body.description.trim() : '';
  }
  if (body.triggers !== undefined) {
    if (body.triggers?.schedule) {
      const cronError = validateCronExpression(body.triggers.schedule);
      if (cronError) return c.json({ error: cronError }, 400);
    }
    updates.triggers = body.triggers && typeof body.triggers === 'object' ? body.triggers : {};
  }
  if (body.config !== undefined) {
    updates.config = body.config && typeof body.config === 'object'
      ? encryptConfigSecrets(body.config as Record<string, unknown>)
      : {};
  }
  if (body.capabilities !== undefined) {
    if (!Array.isArray(body.capabilities)) {
      return c.json({ error: 'Capabilities must be an array' }, 400);
    }
    for (const cap of body.capabilities) {
      if (!VALID_BOT_CAPABILITIES.includes(cap)) {
        return c.json({ error: `Invalid capability: ${cap}` }, 400);
      }
    }
    updates.capabilities = body.capabilities;
  }
  if (body.allowedDomains !== undefined) {
    if (Array.isArray(body.allowedDomains)) {
      for (const domain of body.allowedDomains) {
        if (typeof domain !== 'string' || !domain.match(/^[a-zA-Z0-9]([a-zA-Z0-9-]*\.)+[a-zA-Z]{2,}$/)) {
          return c.json({ error: `Invalid domain: ${domain}. Use bare hostnames (e.g., api.virustotal.com)` }, 400);
        }
      }
    }
    updates.allowedDomains = Array.isArray(body.allowedDomains) ? body.allowedDomains : [];
  }
  if (body.scopeType !== undefined) {
    if (!['global', 'investigation', 'tag-based'].includes(body.scopeType)) {
      return c.json({ error: 'Invalid scopeType' }, 400);
    }
    updates.scopeType = body.scopeType;
  }
  if (body.scopeFolderIds !== undefined) {
    updates.scopeFolderIds = Array.isArray(body.scopeFolderIds) ? body.scopeFolderIds : [];
  }
  if (body.rateLimitPerHour !== undefined) {
    updates.rateLimitPerHour = typeof body.rateLimitPerHour === 'number' && body.rateLimitPerHour > 0 ? body.rateLimitPerHour : 100;
  }
  if (body.rateLimitPerDay !== undefined) {
    updates.rateLimitPerDay = typeof body.rateLimitPerDay === 'number' && body.rateLimitPerDay > 0 ? body.rateLimitPerDay : 1000;
  }

  await db.update(botConfigs).set(updates).where(eq(botConfigs.id, id));
  await botManager.reloadBot(id);

  await logAdminAction('bot.update', `Updated bot "${existing.name}"`, { itemId: id });

  return c.json({ ok: true });
});

// POST /admin/api/bots/:id/enable
app.post('/api/bots/:id/enable', requireAdminAuth, async (c) => {
  const id = c.req.param('id');
  const [bot] = await db.select({ id: botConfigs.id, name: botConfigs.name }).from(botConfigs).where(eq(botConfigs.id, id)).limit(1);
  if (!bot) return c.json({ error: 'Bot not found' }, 404);

  await db.update(botConfigs).set({ enabled: true, updatedAt: new Date() }).where(eq(botConfigs.id, id));
  await botManager.reloadBot(id);

  await logAdminAction('bot.enable', `Enabled bot "${bot.name}"`, { itemId: id });
  return c.json({ ok: true });
});

// POST /admin/api/bots/:id/disable
app.post('/api/bots/:id/disable', requireAdminAuth, async (c) => {
  const id = c.req.param('id');
  const [bot] = await db.select({ id: botConfigs.id, name: botConfigs.name }).from(botConfigs).where(eq(botConfigs.id, id)).limit(1);
  if (!bot) return c.json({ error: 'Bot not found' }, 404);

  await db.update(botConfigs).set({ enabled: false, updatedAt: new Date() }).where(eq(botConfigs.id, id));
  await botManager.unloadBot(id);

  await logAdminAction('bot.disable', `Disabled bot "${bot.name}"`, { itemId: id });
  return c.json({ ok: true });
});

// POST /admin/api/bots/:id/trigger — manual trigger
app.post('/api/bots/:id/trigger', requireAdminAuth, async (c) => {
  const id = c.req.param('id');
  const [bot] = await db.select({ id: botConfigs.id, name: botConfigs.name, enabled: botConfigs.enabled }).from(botConfigs).where(eq(botConfigs.id, id)).limit(1);
  if (!bot) return c.json({ error: 'Bot not found' }, 404);
  if (!bot.enabled) return c.json({ error: 'Bot is not enabled' }, 400);

  // Fire-and-forget
  void botManager.executeBot(id, 'manual');

  await logAdminAction('bot.trigger', `Manually triggered bot "${bot.name}"`, { itemId: id });
  return c.json({ ok: true });
});

// DELETE /admin/api/bots/:id — delete bot
app.delete('/api/bots/:id', requireAdminAuth, async (c) => {
  const id = c.req.param('id');
  const [bot] = await db.select({ id: botConfigs.id, name: botConfigs.name, userId: botConfigs.userId }).from(botConfigs).where(eq(botConfigs.id, id)).limit(1);
  if (!bot) return c.json({ error: 'Bot not found' }, 404);

  // Unload from runtime
  await botManager.unloadBot(id);

  // Delete bot config (cascades to bot_runs)
  await db.delete(botConfigs).where(eq(botConfigs.id, id));

  // Deactivate the bot user account (preserve for audit trail)
  await db.update(users).set({ active: false, updatedAt: new Date() }).where(eq(users.id, bot.userId));

  await logAdminAction('bot.delete', `Deleted bot "${bot.name}"`, { itemId: id });
  return c.json({ ok: true });
});

// GET /admin/api/bots/:id/runs — run history
app.get('/api/bots/:id/runs', requireAdminAuth, async (c) => {
  const id = c.req.param('id');

  const [bot] = await db.select({ id: botConfigs.id }).from(botConfigs).where(eq(botConfigs.id, id)).limit(1);
  if (!bot) return c.json({ error: 'Bot not found' }, 404);

  const limit = Math.min(200, Math.max(1, parseInt(c.req.query('limit') || '50', 10)));

  const runs = await db.select({
    id: botRuns.id,
    status: botRuns.status,
    trigger: botRuns.trigger,
    inputSummary: botRuns.inputSummary,
    outputSummary: botRuns.outputSummary,
    durationMs: botRuns.durationMs,
    error: botRuns.error,
    entitiesCreated: botRuns.entitiesCreated,
    entitiesUpdated: botRuns.entitiesUpdated,
    apiCallsMade: botRuns.apiCallsMade,
    createdAt: botRuns.createdAt,
  }).from(botRuns)
    .where(eq(botRuns.botConfigId, id))
    .orderBy(desc(botRuns.createdAt))
    .limit(limit);

  return c.json({ runs });
});

export default app;
