import { db, type DB } from '../db/index.js';
import { eq, count, desc, and, gte, gt, sql } from 'drizzle-orm';
import { z } from 'zod';
import * as schema from '../db/schema.js';
import { logActivity } from './audit-service.js';
import { updateUsersAndRevokeSessions } from './session-service.js';
import { assertAdminAiPrincipal, AdminAuthorizationError, type AdminAiPrincipal } from '../middleware/admin-auth.js';
import { adminAiApprovals, AdminAiApprovalError, type AdminAiApproval } from './admin-ai-approvals.js';
import { InvestigationPolicyError } from './investigation-policy.js';
import { withAbort } from '../lib/bounded-http.js';

export interface AdminAiToolContext {
  principal: AdminAiPrincipal;
  signal?: AbortSignal;
  database?: Pick<DB, 'select'>;
}

function checkCancelled(signal?: AbortSignal): void {
  if (signal?.aborted) throw new DOMException('Action cancelled', 'AbortError');
}

async function guardAdmin(context: AdminAiToolContext, tx: Pick<DB, 'select'>): Promise<void> {
  checkCancelled(context.signal);
  await assertAdminAiPrincipal(tx, context.principal);
  checkCancelled(context.signal);
}

const idSchema = z.string().min(1).max(128);
const limitSchema = z.number().int().min(1).max(100).optional();
const toolInputs: Record<string, z.ZodType<Record<string, unknown>>> = {
  get_server_stats: z.object({}).strict(),
  list_users: z.object({ role: z.enum(['admin', 'analyst', 'viewer']).optional(), active: z.boolean().optional(), limit: limitSchema }).strict(),
  list_investigations: z.object({ status: z.enum(['active', 'closed', 'archived']).optional(), limit: limitSchema }).strict(),
  list_bots: z.object({ enabled: z.boolean().optional(), limit: limitSchema }).strict(),
  get_recent_audit_log: z.object({ category: z.string().min(1).max(128).optional(), userId: idSchema.optional(), limit: z.number().int().min(1).max(50).optional() }).strict(),
  get_active_sessions: z.object({ limit: limitSchema }).strict(),
  set_user_role: z.object({ userId: idSchema, role: z.enum(['admin', 'analyst', 'viewer']) }).strict(),
  toggle_user_active: z.object({ userId: idSchema, active: z.boolean() }).strict(),
  toggle_bot: z.object({ botId: idSchema, enabled: z.boolean() }).strict(),
};

export function validateAdminAiToolInput(name: string, input: unknown): Record<string, unknown> {
  const parsed = Object.hasOwn(toolInputs, name) ? toolInputs[name].safeParse(input) : undefined;
  if (!parsed?.success) throw new AdminAiApprovalError('Unknown tool or invalid action arguments.', 400, 'INVALID_ACTION');
  return parsed.data;
}

const activeSessions = () => and(gt(schema.sessions.expiresAt, new Date()), gte(schema.sessions.rotationCounter, 0), eq(schema.users.active, true));

async function auditCommittedAction(input: Parameters<typeof logActivity>[0]): Promise<string[]> {
  const deadline = new AbortController();
  const timer = setTimeout(() => deadline.abort(new DOMException('Audit deadline exceeded', 'AbortError')), 5000);
  try {
    // An auxiliary transaction which acquires a connection late may not start a
    // write. If its query settles late, the final check rolls it back.
    await withAbort(db.transaction(async tx => {
      deadline.signal.throwIfAborted();
      await tx.execute(sql`SET LOCAL lock_timeout = '5s'`);
      await tx.execute(sql`SET LOCAL statement_timeout = '5s'`);
      deadline.signal.throwIfAborted();
      await logActivity(input, tx);
      deadline.signal.throwIfAborted();
    }), deadline.signal);
    return [];
  }
  catch { return ['The action committed, but its audit entry could not be saved.']; }
  finally { clearTimeout(timer); }
}

// Tool definitions for the admin AI assistant
export interface AdminTool {
  name: string;
  description: string;
  input_schema: Record<string, unknown>;
  requiresConfirm: boolean;
  execute: (input: Record<string, unknown>, adminId: string, context?: AdminAiToolContext) => Promise<unknown>;
}

const readTools: AdminTool[] = [
  {
    name: 'get_server_stats',
    description: 'Get current server statistics: total users, active users, investigations count, active sessions, recent audit events',
    input_schema: { type: 'object', properties: {} },
    requiresConfirm: false,
    execute: async (_input, _adminId, context) => {
      const database = context?.database ?? db;
      const [userCount] = await database.select({ count: count() }).from(schema.users);
      const [activeCount] = await database.select({ count: count() }).from(schema.users).where(eq(schema.users.active, true));
      const [invCount] = await database.select({ count: count() }).from(schema.folders);
      const [sessionCount] = await database.select({ count: count() }).from(schema.sessions).innerJoin(schema.users, eq(schema.users.id, schema.sessions.userId)).where(activeSessions());
      const since24h = new Date(Date.now() - 24 * 60 * 60 * 1000);
      const [auditCount] = await database.select({ count: count() }).from(schema.activityLog).where(gte(schema.activityLog.timestamp, since24h));
      return {
        totalUsers: userCount.count,
        activeUsers: activeCount.count,
        investigations: invCount.count,
        activeSessions: sessionCount.count,
        auditEvents24h: auditCount.count,
      };
    },
  },
  {
    name: 'list_users',
    description: 'List users with optional filters. Returns id, email, displayName, role, active status, lastLoginAt',
    input_schema: {
      type: 'object',
      properties: {
        role: { type: 'string', enum: ['admin', 'analyst', 'viewer'], description: 'Filter by role' },
        active: { type: 'boolean', description: 'Filter by active status' },
        limit: { type: 'number', description: 'Max results (default 20, max 100)' },
      },
    },
    requiresConfirm: false,
    execute: async (input, _adminId, context) => {
      const conditions = [];
      // Filter out internal system users
      conditions.push(sql`${schema.users.email} NOT ILIKE '%@threatcaddy.internal'`);
      if (input.role) conditions.push(eq(schema.users.role, input.role as 'admin' | 'analyst' | 'viewer'));
      if (input.active !== undefined) conditions.push(eq(schema.users.active, input.active as boolean));
      const limit = Math.min(Math.max(1, (input.limit as number) || 20), 100);

      return (context?.database ?? db).select({
        id: schema.users.id,
        email: schema.users.email,
        displayName: schema.users.displayName,
        role: schema.users.role,
        active: schema.users.active,
        lastLoginAt: schema.users.lastLoginAt,
        createdAt: schema.users.createdAt,
      }).from(schema.users)
        .where(and(...conditions))
        .orderBy(desc(schema.users.createdAt))
        .limit(limit);
    },
  },
  {
    name: 'list_investigations',
    description: 'List investigations with member counts. Returns id, name, status, createdAt',
    input_schema: {
      type: 'object',
      properties: {
        status: { type: 'string', enum: ['active', 'closed', 'archived'], description: 'Filter by status' },
        limit: { type: 'number', description: 'Max results (default 20, max 100)' },
      },
    },
    requiresConfirm: false,
    execute: async (input, _adminId, context) => {
      const conditions = [];
      if (input.status) conditions.push(eq(schema.folders.status, input.status as 'active' | 'closed' | 'archived'));
      const limit = Math.min(Math.max(1, (input.limit as number) || 20), 100);
      const where = conditions.length > 0 ? and(...conditions) : undefined;

      return (context?.database ?? db).select({
        id: schema.folders.id,
        name: schema.folders.name,
        status: schema.folders.status,
        createdAt: schema.folders.createdAt,
      }).from(schema.folders)
        .where(where)
        .orderBy(desc(schema.folders.createdAt))
        .limit(limit);
    },
  },
  {
    name: 'list_bots',
    description: 'List bot configurations with run stats',
    input_schema: {
      type: 'object',
      properties: {
        enabled: { type: 'boolean', description: 'Filter by enabled status' },
        limit: { type: 'integer', minimum: 1, maximum: 100, description: 'Max results (default 20, max 100)' },
      },
    },
    requiresConfirm: false,
    execute: async (input, _adminId, context) => {
      const conditions = [];
      if (input.enabled !== undefined) conditions.push(eq(schema.botConfigs.enabled, input.enabled as boolean));
      const where = conditions.length > 0 ? and(...conditions) : undefined;

      return (context?.database ?? db).select({
        id: schema.botConfigs.id,
        name: schema.botConfigs.name,
        type: schema.botConfigs.type,
        enabled: schema.botConfigs.enabled,
        runCount: schema.botConfigs.runCount,
        errorCount: schema.botConfigs.errorCount,
        lastRunAt: schema.botConfigs.lastRunAt,
        lastError: sql<string | null>`left(${schema.botConfigs.lastError}, 1000)`,
      }).from(schema.botConfigs)
        .where(where)
        .orderBy(desc(schema.botConfigs.createdAt))
        .limit((input.limit as number | undefined) ?? 20);
    },
  },
  {
    name: 'get_recent_audit_log',
    description: 'Get recent audit log entries, optionally filtered by category or userId',
    input_schema: {
      type: 'object',
      properties: {
        category: { type: 'string', description: 'Filter by category (admin, auth, note, task, etc.)' },
        userId: { type: 'string', description: 'Filter by user ID' },
        limit: { type: 'number', description: 'Max results (default 20, max 50)' },
      },
    },
    requiresConfirm: false,
    execute: async (input, _adminId, context) => {
      const conditions = [];
      if (input.category) conditions.push(eq(schema.activityLog.category, input.category as string));
      if (input.userId) conditions.push(eq(schema.activityLog.userId, input.userId as string));
      const where = conditions.length > 0 ? and(...conditions) : undefined;
      const limit = Math.min(Math.max(1, (input.limit as number) || 20), 50);

      return (context?.database ?? db).select({
        id: schema.activityLog.id,
        userId: schema.activityLog.userId,
        category: schema.activityLog.category,
        action: schema.activityLog.action,
        detail: sql<string | null>`left(${schema.activityLog.detail}, 2000)`,
        timestamp: schema.activityLog.timestamp,
      }).from(schema.activityLog)
        .where(where)
        .orderBy(desc(schema.activityLog.timestamp))
        .limit(limit);
    },
  },
  {
    name: 'get_active_sessions',
    description: 'List currently active user sessions',
    input_schema: {
      type: 'object',
      properties: {
        limit: { type: 'number', description: 'Max results (default 20)' },
      },
    },
    requiresConfirm: false,
    execute: async (input, _adminId, context) => {
      const limit = Math.min(Math.max(1, (input.limit as number) || 20), 100);
      return (context?.database ?? db).select({
        userId: schema.sessions.userId,
        userEmail: schema.users.email,
        displayName: schema.users.displayName,
        createdAt: schema.sessions.createdAt,
        expiresAt: schema.sessions.expiresAt,
      }).from(schema.sessions)
        .innerJoin(schema.users, eq(schema.users.id, schema.sessions.userId))
        .where(activeSessions())
        .orderBy(desc(schema.sessions.createdAt))
        .limit(limit);
    },
  },
];

const writeTools: AdminTool[] = [
  {
    name: 'set_user_role',
    description: 'Change a user\'s role. Requires confirmation.',
    input_schema: {
      type: 'object',
      properties: {
        userId: { type: 'string', description: 'User ID to update' },
        role: { type: 'string', enum: ['admin', 'analyst', 'viewer'], description: 'New role' },
      },
      required: ['userId', 'role'],
    },
    requiresConfirm: true,
    execute: async (input, adminId, context) => {
      if (!context) throw new AdminAuthorizationError();
      checkCancelled(context.signal);
      if (typeof input.userId !== 'string' || !input.userId || !['admin', 'analyst', 'viewer'].includes(input.role as string)) return { error: 'A user ID and valid role are required' };
      const user = { id: input.userId };
      const result = await updateUsersAndRevokeSessions([user.id], { role: input.role as 'admin' | 'analyst' | 'viewer', updatedAt: new Date() }, undefined, { kind: 'admin', userId: adminId }, tx => guardAdmin(context, tx));
      if (!result.length) throw new AdminAiApprovalError('User not found', 404, 'USER_NOT_FOUND');
      const warnings = await auditCommittedAction({
        userId: adminId,
        category: 'admin',
        action: 'user.role-change',
        detail: `AI Assistant changed role of user ${user.id} to ${input.role}`,
        itemId: input.userId as string,
      });
      return { ok: true, user, newRole: input.role, warnings };
    },
  },
  {
    name: 'toggle_user_active',
    description: 'Enable or disable a user account. Requires confirmation.',
    input_schema: {
      type: 'object',
      properties: {
        userId: { type: 'string', description: 'User ID to update' },
        active: { type: 'boolean', description: 'Set active status' },
      },
      required: ['userId', 'active'],
    },
    requiresConfirm: true,
    execute: async (input, adminId, context) => {
      if (!context) throw new AdminAuthorizationError();
      checkCancelled(context.signal);
      if (typeof input.userId !== 'string' || !input.userId || typeof input.active !== 'boolean') return { error: 'A user ID and boolean active status are required' };
      const user = { id: input.userId };
      const result = await updateUsersAndRevokeSessions([user.id], { active: input.active, updatedAt: new Date() }, undefined, { kind: 'admin', userId: adminId }, tx => guardAdmin(context, tx));
      if (!result.length) throw new AdminAiApprovalError('User not found', 404, 'USER_NOT_FOUND');
      const warnings = await auditCommittedAction({
        userId: adminId,
        category: 'admin',
        action: input.active ? 'user.enable' : 'user.disable',
        detail: `AI Assistant ${input.active ? 'enabled' : 'disabled'} user ${user.id}`,
        itemId: input.userId as string,
      });
      return { ok: true, user, active: input.active, warnings };
    },
  },
  {
    name: 'toggle_bot',
    description: 'Enable or disable a bot. Requires confirmation.',
    input_schema: {
      type: 'object',
      properties: {
        botId: { type: 'string', description: 'Bot ID to enable/disable' },
        enabled: { type: 'boolean', description: 'Set enabled status' },
      },
      required: ['botId', 'enabled'],
    },
    requiresConfirm: true,
    execute: async (input, adminId, context) => {
      if (!context) throw new AdminAuthorizationError();
      checkCancelled(context.signal);
      const { setBotEnabled } = await import('./bot-service.js');
      const result = await setBotEnabled(input.botId as string, input.enabled as boolean, tx => guardAdmin(context, tx));
      if (!result) throw new AdminAiApprovalError('Bot not found', 404, 'BOT_NOT_FOUND');
      if ('error' in result) throw new AdminAiApprovalError(result.error, 409, 'BOT_UNAVAILABLE');
      const warnings = await auditCommittedAction({
        userId: adminId,
        category: 'admin',
        action: input.enabled ? 'bot.enable' : 'bot.disable',
        detail: `AI Assistant ${input.enabled ? 'enabled' : 'disabled'} bot "${result.name}"`,
        itemId: input.botId as string,
      });
      return { ok: true, bot: { id: input.botId, name: result.name }, enabled: input.enabled, warnings: [...(result.warnings ?? []), ...warnings] };
    },
  },
];

export const allAdminTools = [...readTools, ...writeTools];
const toolMap = new Map(allAdminTools.map(t => [t.name, t]));

// Build Anthropic-format tools
export function getAnthropicTools() {
  return allAdminTools.map(t => ({
    name: t.name,
    description: t.description + (t.requiresConfirm ? ' [REQUIRES CONFIRMATION -- describe what you want to do and ask the user to confirm before calling this tool]' : ''),
    input_schema: t.input_schema,
  }));
}

// Build OpenAI-format tools (also works for Mistral)
export function getOpenAITools() {
  return allAdminTools.map(t => ({
    type: 'function' as const,
    function: {
      name: t.name,
      description: t.description + (t.requiresConfirm ? ' [REQUIRES CONFIRMATION -- describe what you want to do and ask the user to confirm before calling this tool]' : ''),
      parameters: t.input_schema,
    },
  }));
}

// Build Gemini-format tools
export function getGeminiTools() {
  return [{
    functionDeclarations: allAdminTools.map(t => ({
      name: t.name,
      description: t.description + (t.requiresConfirm ? ' [REQUIRES CONFIRMATION]' : ''),
      parameters: t.input_schema,
    })),
  }];
}

export function getToolByName(name: string): AdminTool | undefined {
  return toolMap.get(name);
}

/** Recheck before sending server-derived data to a provider; never hold a DB transaction over network I/O. */
export async function assertCurrentAdminAiSession(context: AdminAiToolContext): Promise<void> {
  checkCancelled(context.signal);
  await db.transaction(async tx => {
    await tx.execute(sql`SET LOCAL lock_timeout = '5s'`);
    await tx.execute(sql`SET LOCAL statement_timeout = '10s'`);
    await guardAdmin(context, tx);
  });
  checkCancelled(context.signal);
}

export async function dispatchAdminAiTool(name: string, input: unknown, context: AdminAiToolContext):
  Promise<{ kind: 'result'; result: unknown } | { kind: 'approval'; approval: AdminAiApproval }> {
  checkCancelled(context.signal);
  const validated = validateAdminAiToolInput(name, input);
  const tool = toolMap.get(name);
  if (!tool) throw new AdminAiApprovalError('The requested tool is unavailable.', 400, 'INVALID_ACTION');
  const result = await db.transaction(async tx => {
    await tx.execute(sql`SET LOCAL lock_timeout = '5s'`);
    await tx.execute(sql`SET LOCAL statement_timeout = '10s'`);
    // Read snapshots serialize with membership/account policy changes, but not with other readers.
    const clock = await tx.execute(sql`SELECT id FROM sync_clock WHERE id = 1 FOR SHARE`);
    if (!clock.length) throw new Error('Investigation policy lock is unavailable');
    await guardAdmin(context, tx);
    if (tool.requiresConfirm) return { kind: 'approval' as const, approval: adminAiApprovals.issue(context.principal, name, validated) };
    const value = await tool.execute(validated, context.principal.adminId, { ...context, database: tx });
    await guardAdmin(context, tx);
    return { kind: 'result' as const, result: value };
  });
  checkCancelled(context.signal);
  return result;
}

/** Only the approval endpoint calls this, using the registry's stored (not request-supplied) action. */
export async function executeApprovedAdminAiTool(name: string, input: unknown, context: AdminAiToolContext): Promise<unknown> {
  checkCancelled(context.signal);
  const validated = validateAdminAiToolInput(name, input);
  const tool = toolMap.get(name);
  if (!tool?.requiresConfirm) throw new AdminAiApprovalError('The approved action is unavailable.', 400, 'INVALID_ACTION');
  try { return await tool.execute(validated, context.principal.adminId, context); }
  catch (error) {
    if (error instanceof AdminAuthorizationError || error instanceof InvestigationPolicyError) {
      throw new AdminAiApprovalError(error.message, error.status, error.code);
    }
    throw error;
  }
}

export const ADMIN_AI_SYSTEM_PROMPT = `You are an AI assistant for the ThreatCaddy admin panel. You help administrators understand their server's state and manage users, bots, and investigations.

Guidelines:
- Use tools to get data rather than guessing. Always query before answering questions about server state.
- For read operations, use tools immediately.
- For write operations (role changes, enabling/disabling users or bots), ALWAYS describe what you intend to do and ask the user to confirm BEFORE calling the write tool. Never perform write operations without explicit user confirmation.
- Be concise and format data in clear tables or bullet points.
- If you lack information to answer a question, say so.
- Do not make up data or speculate about system state.

You have access to read-only tools (can use freely) and write tools (require user confirmation first).`;
