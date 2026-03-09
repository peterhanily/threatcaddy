import { nanoid } from 'nanoid';
import { eq, desc } from 'drizzle-orm';
import * as argon2 from 'argon2';
import { db } from '../db/index.js';
import * as schema from '../db/schema.js';
import { botManager, validateCronExpression } from '../bots/bot-manager.js';
import { encryptConfigSecrets, redactConfigSecrets } from '../bots/secret-store.js';
import { logActivity } from '../services/audit-service.js';
import type { BotCapability, BotTriggerConfig, BotType } from '../bots/types.js';

// ─── Shared Constants ────────────────────────────────────────────

export const VALID_BOT_TYPES: BotType[] = [
  'enrichment', 'feed', 'monitor', 'triage', 'report', 'correlation', 'ai-agent', 'custom',
];

export const VALID_CAPABILITIES: BotCapability[] = [
  'read_entities', 'create_entities', 'update_entities',
  'post_to_feed', 'notify_users', 'call_external_apis',
  'cross_investigation', 'execute_remote', 'run_code',
];

const DOMAIN_REGEX = /^[a-zA-Z0-9]([a-zA-Z0-9-]*\.)+[a-zA-Z]{2,}$/;

// ─── Validation ──────────────────────────────────────────────────

export interface BotCreateInput {
  name: string;
  description?: string;
  type: string;
  triggers?: Record<string, unknown>;
  config?: Record<string, unknown>;
  capabilities?: string[];
  allowedDomains?: string[];
  scopeType?: string;
  scopeFolderIds?: string[];
  rateLimitPerHour?: number;
  rateLimitPerDay?: number;
}

/** Validate input for bot creation. Returns error string or null. */
export function validateBotCreate(input: BotCreateInput): string | null {
  const { name, type, capabilities, allowedDomains, triggers } = input;

  if (!name || typeof name !== 'string' || name.trim().length < 1 || name.trim().length > 100) {
    return 'Name is required (1-100 chars)';
  }

  if (!type || !VALID_BOT_TYPES.includes(type as BotType)) {
    return `Invalid type. Must be one of: ${VALID_BOT_TYPES.join(', ')}`;
  }

  if (capabilities !== undefined) {
    if (!Array.isArray(capabilities)) return 'Capabilities must be an array';
    for (const cap of capabilities) {
      if (!VALID_CAPABILITIES.includes(cap as BotCapability)) {
        return `Invalid capability: ${cap}`;
      }
    }
  }

  if (Array.isArray(allowedDomains)) {
    if (allowedDomains.length > 50) {
      return 'Too many allowed domains (max 50)';
    }
    for (const domain of allowedDomains) {
      if (typeof domain !== 'string' || !DOMAIN_REGEX.test(domain)) {
        return `Invalid domain: ${domain}. Use bare hostnames (e.g., api.virustotal.com)`;
      }
    }
  }

  if (triggers?.events) {
    if (!Array.isArray(triggers.events)) return 'triggers.events must be an array';
    if ((triggers.events as unknown[]).length > 100) {
      return 'Too many trigger events (max 100)';
    }
  }

  // Validate overall config serialized size
  if (input.config) {
    const configSize = JSON.stringify(input.config).length;
    if (configSize > 100 * 1024) {
      return 'Bot config is too large (max 100KB serialized)';
    }
  }

  if (triggers?.schedule) {
    if (typeof triggers.schedule !== 'string') return 'Schedule must be a string';
    const cronError = validateCronExpression(triggers.schedule);
    if (cronError) return cronError;
  }

  if (triggers?.webhook && !input.config?.webhookSecret) {
    return 'webhookSecret is required in config when triggers.webhook is enabled';
  }

  if (input.scopeType !== undefined && !['global', 'investigation'].includes(input.scopeType)) {
    return 'Invalid scopeType. Must be "global" or "investigation"';
  }

  if (input.rateLimitPerHour !== undefined) {
    if (typeof input.rateLimitPerHour !== 'number' || input.rateLimitPerHour <= 0) {
      return 'rateLimitPerHour must be a positive number';
    }
  }

  if (input.rateLimitPerDay !== undefined) {
    if (typeof input.rateLimitPerDay !== 'number' || input.rateLimitPerDay <= 0) {
      return 'rateLimitPerDay must be a positive number';
    }
  }

  if (Array.isArray(input.scopeFolderIds)) {
    for (const fid of input.scopeFolderIds) {
      if (typeof fid !== 'string' || fid.length === 0) {
        return 'scopeFolderIds must contain non-empty strings';
      }
    }
  }

  return null;
}

/** Validate and build updates for bot patch. Returns { updates } or { error }. */
export function validateBotUpdate(body: Record<string, unknown>): { updates: Record<string, unknown> } | { error: string } {
  const updates: Record<string, unknown> = { updatedAt: new Date() };

  if (body.name !== undefined) {
    if (typeof body.name !== 'string' || body.name.trim().length < 1 || body.name.trim().length > 100) {
      return { error: 'Name must be 1-100 characters' };
    }
    updates.name = (body.name as string).trim();
  }

  if (body.description !== undefined) {
    updates.description = typeof body.description === 'string' ? body.description.trim() : '';
  }

  if (body.type !== undefined) {
    if (!VALID_BOT_TYPES.includes(body.type as BotType)) {
      return { error: `Invalid bot type: ${body.type}` };
    }
    updates.type = body.type;
  }

  if (body.triggers !== undefined) {
    const triggers = body.triggers as Record<string, unknown> | null;
    if (triggers?.events) {
      if (!Array.isArray(triggers.events)) return { error: 'triggers.events must be an array' };
      if ((triggers.events as unknown[]).length > 100) {
        return { error: 'Too many trigger events (max 100)' };
      }
    }
    if (triggers?.schedule) {
      if (typeof triggers.schedule !== 'string') return { error: 'Schedule must be a string' };
      const cronError = validateCronExpression(triggers.schedule);
      if (cronError) return { error: cronError };
    }
    // Cross-validate: enabling webhooks requires a webhookSecret
    if (triggers?.webhook === true) {
      const hasNewSecret = body.config && typeof body.config === 'object' && (body.config as Record<string, unknown>).webhookSecret;
      if (!hasNewSecret) {
        return { error: 'webhookSecret is required in config when triggers.webhook is enabled' };
      }
    }
    updates.triggers = triggers && typeof triggers === 'object' ? triggers : {};
  }

  if (body.config !== undefined) {
    if (body.config && typeof body.config === 'object') {
      const configSize = JSON.stringify(body.config).length;
      if (configSize > 100 * 1024) {
        return { error: 'Bot config is too large (max 100KB serialized)' };
      }
      updates.config = encryptConfigSecrets(body.config as Record<string, unknown>);
    } else {
      updates.config = {};
    }
  }

  if (body.capabilities !== undefined) {
    if (!Array.isArray(body.capabilities)) return { error: 'Capabilities must be an array' };
    for (const cap of body.capabilities) {
      if (!VALID_CAPABILITIES.includes(cap as BotCapability)) {
        return { error: `Invalid capability: ${cap}` };
      }
    }
    updates.capabilities = body.capabilities;
  }

  if (body.allowedDomains !== undefined) {
    if (Array.isArray(body.allowedDomains)) {
      if ((body.allowedDomains as unknown[]).length > 50) {
        return { error: 'Too many allowed domains (max 50)' };
      }
      for (const domain of body.allowedDomains as string[]) {
        if (typeof domain !== 'string' || !DOMAIN_REGEX.test(domain)) {
          return { error: `Invalid domain: ${domain}. Use bare hostnames (e.g., api.virustotal.com)` };
        }
      }
    }
    updates.allowedDomains = Array.isArray(body.allowedDomains) ? body.allowedDomains : [];
  }

  if (body.scopeType !== undefined) {
    if (!['global', 'investigation'].includes(body.scopeType as string)) {
      return { error: 'Invalid scopeType' };
    }
    updates.scopeType = body.scopeType;
  }

  if (body.scopeFolderIds !== undefined) {
    if (Array.isArray(body.scopeFolderIds)) {
      for (const fid of body.scopeFolderIds) {
        if (typeof fid !== 'string' || fid.length === 0) {
          return { error: 'scopeFolderIds must contain non-empty strings' };
        }
      }
      updates.scopeFolderIds = body.scopeFolderIds;
    } else {
      updates.scopeFolderIds = [];
    }
  }

  if (body.rateLimitPerHour !== undefined) {
    if (typeof body.rateLimitPerHour !== 'number' || body.rateLimitPerHour <= 0) {
      return { error: 'rateLimitPerHour must be a positive number' };
    }
    updates.rateLimitPerHour = body.rateLimitPerHour;
  }

  if (body.rateLimitPerDay !== undefined) {
    if (typeof body.rateLimitPerDay !== 'number' || body.rateLimitPerDay <= 0) {
      return { error: 'rateLimitPerDay must be a positive number' };
    }
    updates.rateLimitPerDay = body.rateLimitPerDay;
  }

  return { updates };
}

// ─── Operations ──────────────────────────────────────────────────

export interface CreateBotResult {
  id: string;
  userId: string;
  name: string;
  type: string;
  enabled: boolean;
}

/** Create a new bot with its user account and investigation memberships.
 *  Wrapped in a transaction so partial failures don't leave orphaned records. */
export async function createBot(input: BotCreateInput, createdBy: string): Promise<CreateBotResult> {
  const botId = nanoid();
  const botUserId = nanoid();
  const now = new Date();

  // Pre-hash outside transaction to avoid holding it open during slow argon2
  const botEmail = `bot-${botUserId}@threatcaddy.internal`;
  const passwordHash = await argon2.hash(nanoid(32));

  const encryptedConfig = input.config && typeof input.config === 'object'
    ? encryptConfigSecrets(input.config)
    : {};
  const caps = Array.isArray(input.capabilities) ? input.capabilities : [];

  await db.transaction(async (tx) => {
    // Create bot user account
    await tx.insert(schema.users).values({
      id: botUserId,
      email: botEmail,
      displayName: `[Bot] ${input.name.trim()}`,
      passwordHash,
      role: 'analyst',
      active: true,
      createdAt: now,
      updatedAt: now,
    });

    // Create bot config record
    await tx.insert(schema.botConfigs).values({
      id: botId,
      userId: botUserId,
      type: input.type as BotType,
      name: input.name.trim(),
      description: (input.description || '').trim(),
      enabled: false,
      triggers: (input.triggers || {}) as BotTriggerConfig,
      config: encryptedConfig,
      capabilities: caps as BotCapability[],
      allowedDomains: Array.isArray(input.allowedDomains) ? input.allowedDomains : [],
      scopeType: (['global', 'investigation'].includes(input.scopeType || '') ? input.scopeType : 'investigation') as 'global' | 'investigation',
      scopeFolderIds: Array.isArray(input.scopeFolderIds) ? input.scopeFolderIds : [],
      rateLimitPerHour: typeof input.rateLimitPerHour === 'number' && input.rateLimitPerHour > 0 ? input.rateLimitPerHour : 100,
      rateLimitPerDay: typeof input.rateLimitPerDay === 'number' && input.rateLimitPerDay > 0 ? input.rateLimitPerDay : 1000,
      createdBy,
      createdAt: now,
      updatedAt: now,
    });

    // Grant investigation access if scoped
    if (input.scopeType === 'investigation' && Array.isArray(input.scopeFolderIds)) {
      for (const folderId of input.scopeFolderIds) {
        if (typeof folderId !== 'string') continue;
        await tx.insert(schema.investigationMembers).values({
          id: nanoid(),
          folderId,
          userId: botUserId,
          role: caps.includes('create_entities') || caps.includes('update_entities') ? 'editor' : 'viewer',
          joinedAt: new Date(),
        }).onConflictDoNothing();
      }
    }
  });

  return { id: botId, userId: botUserId, name: input.name.trim(), type: input.type, enabled: false };
}

/** Update a bot config. Returns the existing bot name for audit logging. */
export async function updateBot(id: string, updates: Record<string, unknown>): Promise<{ name: string } | null> {
  const rows = await db.select({ id: schema.botConfigs.id, name: schema.botConfigs.name, config: schema.botConfigs.config })
    .from(schema.botConfigs).where(eq(schema.botConfigs.id, id)).limit(1);
  if (rows.length === 0) return null;

  // If config is being updated, merge sentinel values (***configured***, ***not set***)
  // back to the existing encrypted values so we don't destroy real secrets on edit
  if (updates.config && typeof updates.config === 'object') {
    const existingConfig = (rows[0].config || {}) as Record<string, unknown>;
    updates.config = mergeSentinelSecrets(updates.config as Record<string, unknown>, existingConfig);
  }

  await db.update(schema.botConfigs).set(updates).where(eq(schema.botConfigs.id, id));
  await botManager.reloadBot(id);

  return { name: rows[0].name };
}

/** Replace sentinel redacted values with existing encrypted values from DB */
function mergeSentinelSecrets(newConfig: Record<string, unknown>, existingConfig: Record<string, unknown>): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(newConfig)) {
    if (value === '***configured***') {
      // Restore the existing encrypted value
      result[key] = existingConfig[key] ?? '';
    } else if (value === '***not set***') {
      // Admin explicitly cleared this secret
      result[key] = '';
    } else if (value && typeof value === 'object' && !Array.isArray(value)) {
      // Recurse into nested objects
      const existingNested = (existingConfig[key] && typeof existingConfig[key] === 'object' && !Array.isArray(existingConfig[key]))
        ? existingConfig[key] as Record<string, unknown> : {};
      result[key] = mergeSentinelSecrets(value as Record<string, unknown>, existingNested);
    } else {
      result[key] = value;
    }
  }
  return result;
}

/** Enable a bot. Returns bot name or null if not found. */
export async function enableBot(id: string): Promise<{ name: string } | null> {
  const rows = await db.update(schema.botConfigs)
    .set({ enabled: true, updatedAt: new Date() })
    .where(eq(schema.botConfigs.id, id))
    .returning({ name: schema.botConfigs.name });
  if (rows.length === 0) return null;

  await botManager.reloadBot(id);
  return { name: rows[0].name };
}

/** Disable a bot. Returns bot name or null if not found. */
export async function disableBot(id: string): Promise<{ name: string } | null> {
  const rows = await db.update(schema.botConfigs)
    .set({ enabled: false, updatedAt: new Date() })
    .where(eq(schema.botConfigs.id, id))
    .returning({ name: schema.botConfigs.name });
  if (rows.length === 0) return null;

  await botManager.unloadBot(id);
  return { name: rows[0].name };
}

/** Trigger a bot manually. Returns { name } or { error } or null if not found. */
export async function triggerBot(id: string): Promise<{ name: string } | { error: string } | null> {
  const rows = await db.select({ id: schema.botConfigs.id, name: schema.botConfigs.name, enabled: schema.botConfigs.enabled })
    .from(schema.botConfigs).where(eq(schema.botConfigs.id, id)).limit(1);
  if (rows.length === 0) return null;
  if (!rows[0].enabled) return { error: 'Bot is disabled' };

  botManager.executeBot(id, 'manual').catch(() => { /* fire-and-forget */ });
  return { name: rows[0].name };
}

/** Delete a bot and deactivate its user account. Returns bot name or null. */
export async function deleteBot(id: string): Promise<{ name: string } | null> {
  const rows = await db.select({ id: schema.botConfigs.id, name: schema.botConfigs.name, userId: schema.botConfigs.userId })
    .from(schema.botConfigs).where(eq(schema.botConfigs.id, id)).limit(1);
  if (rows.length === 0) return null;

  await botManager.unloadBot(id);

  await db.transaction(async (tx) => {
    await tx.delete(schema.investigationMembers).where(eq(schema.investigationMembers.userId, rows[0].userId));
    await tx.delete(schema.botConfigs).where(eq(schema.botConfigs.id, id));
    await tx.update(schema.users).set({ active: false, updatedAt: new Date() })
      .where(eq(schema.users.id, rows[0].userId));
  });

  return { name: rows[0].name };
}

// ─── Queries ─────────────────────────────────────────────────────

/** List all bots with redacted configs. */
export async function listBots() {
  const rows = await db.select().from(schema.botConfigs).orderBy(desc(schema.botConfigs.createdAt));
  return rows.map((row) => ({
    ...row,
    config: redactConfigSecrets(row.config as Record<string, unknown>),
  }));
}

/** List all bots with creator name (for admin panel). */
export async function listBotsWithCreator() {
  const rows = await db
    .select({
      id: schema.botConfigs.id,
      userId: schema.botConfigs.userId,
      type: schema.botConfigs.type,
      name: schema.botConfigs.name,
      description: schema.botConfigs.description,
      enabled: schema.botConfigs.enabled,
      triggers: schema.botConfigs.triggers,
      config: schema.botConfigs.config,
      capabilities: schema.botConfigs.capabilities,
      allowedDomains: schema.botConfigs.allowedDomains,
      scopeType: schema.botConfigs.scopeType,
      scopeFolderIds: schema.botConfigs.scopeFolderIds,
      rateLimitPerHour: schema.botConfigs.rateLimitPerHour,
      rateLimitPerDay: schema.botConfigs.rateLimitPerDay,
      lastRunAt: schema.botConfigs.lastRunAt,
      lastError: schema.botConfigs.lastError,
      runCount: schema.botConfigs.runCount,
      errorCount: schema.botConfigs.errorCount,
      createdBy: schema.botConfigs.createdBy,
      createdAt: schema.botConfigs.createdAt,
      updatedAt: schema.botConfigs.updatedAt,
      creatorName: schema.users.displayName,
    })
    .from(schema.botConfigs)
    .leftJoin(schema.users, eq(schema.users.id, schema.botConfigs.createdBy))
    .orderBy(desc(schema.botConfigs.createdAt));

  return rows.map((r) => ({
    ...r,
    config: redactConfigSecrets(r.config as Record<string, unknown>),
  }));
}

/** Get a single bot with redacted config. */
export async function getBot(id: string) {
  const rows = await db.select().from(schema.botConfigs).where(eq(schema.botConfigs.id, id)).limit(1);
  if (rows.length === 0) return null;
  return { ...rows[0], config: redactConfigSecrets(rows[0].config as Record<string, unknown>) };
}

/** Get bot detail with creator name, recent runs, and memberships (for admin panel). */
export async function getBotDetail(id: string) {
  const [bot] = await db
    .select({
      id: schema.botConfigs.id,
      userId: schema.botConfigs.userId,
      type: schema.botConfigs.type,
      name: schema.botConfigs.name,
      description: schema.botConfigs.description,
      enabled: schema.botConfigs.enabled,
      triggers: schema.botConfigs.triggers,
      config: schema.botConfigs.config,
      capabilities: schema.botConfigs.capabilities,
      allowedDomains: schema.botConfigs.allowedDomains,
      scopeType: schema.botConfigs.scopeType,
      scopeFolderIds: schema.botConfigs.scopeFolderIds,
      rateLimitPerHour: schema.botConfigs.rateLimitPerHour,
      rateLimitPerDay: schema.botConfigs.rateLimitPerDay,
      lastRunAt: schema.botConfigs.lastRunAt,
      lastError: schema.botConfigs.lastError,
      runCount: schema.botConfigs.runCount,
      errorCount: schema.botConfigs.errorCount,
      createdBy: schema.botConfigs.createdBy,
      createdAt: schema.botConfigs.createdAt,
      updatedAt: schema.botConfigs.updatedAt,
      creatorName: schema.users.displayName,
    })
    .from(schema.botConfigs)
    .leftJoin(schema.users, eq(schema.users.id, schema.botConfigs.createdBy))
    .where(eq(schema.botConfigs.id, id))
    .limit(1);

  if (!bot) return null;

  const [recentRuns, memberships] = await Promise.all([
    getBotRuns(id, 20),
    db.select({
      folderId: schema.investigationMembers.folderId,
      role: schema.investigationMembers.role,
      folderName: schema.folders.name,
    }).from(schema.investigationMembers)
      .leftJoin(schema.folders, eq(schema.folders.id, schema.investigationMembers.folderId))
      .where(eq(schema.investigationMembers.userId, bot.userId)),
  ]);

  return {
    bot: { ...bot, config: redactConfigSecrets(bot.config as Record<string, unknown>) },
    recentRuns,
    memberships,
  };
}

/** Get bot run history. */
export async function getBotRuns(botId: string, limit = 50) {
  return db.select({
    id: schema.botRuns.id,
    status: schema.botRuns.status,
    trigger: schema.botRuns.trigger,
    inputSummary: schema.botRuns.inputSummary,
    outputSummary: schema.botRuns.outputSummary,
    durationMs: schema.botRuns.durationMs,
    error: schema.botRuns.error,
    entitiesCreated: schema.botRuns.entitiesCreated,
    entitiesUpdated: schema.botRuns.entitiesUpdated,
    apiCallsMade: schema.botRuns.apiCallsMade,
    createdAt: schema.botRuns.createdAt,
  }).from(schema.botRuns)
    .where(eq(schema.botRuns.botConfigId, botId))
    .orderBy(desc(schema.botRuns.createdAt))
    .limit(Math.min(limit, 200));
}

export async function getBotRunDetail(runId: string) {
  const rows = await db.select().from(schema.botRuns)
    .where(eq(schema.botRuns.id, runId))
    .limit(1);
  return rows.length > 0 ? rows[0] : null;
}

/** Audit helper — log a bot action attributed to a specific user. */
export async function auditBotAction(
  userId: string,
  action: string,
  botName: string,
  detail: string,
  botId?: string,
) {
  await logActivity({
    userId,
    category: 'bot',
    action,
    detail,
    itemId: botId,
    itemTitle: botName,
  });
}
