import { db } from '../db/index.js';
import { eq, count, desc, and, gte, sql } from 'drizzle-orm';
import * as schema from '../db/schema.js';
import { logActivity } from './audit-service.js';

// Tool definitions for the admin AI assistant
export interface AdminTool {
  name: string;
  description: string;
  input_schema: Record<string, unknown>;
  requiresConfirm: boolean;
  execute: (input: Record<string, unknown>, adminId: string) => Promise<unknown>;
}

const readTools: AdminTool[] = [
  {
    name: 'get_server_stats',
    description: 'Get current server statistics: total users, active users, investigations count, active sessions, recent audit events',
    input_schema: { type: 'object', properties: {} },
    requiresConfirm: false,
    execute: async () => {
      const [userCount] = await db.select({ count: count() }).from(schema.users);
      const [activeCount] = await db.select({ count: count() }).from(schema.users).where(eq(schema.users.active, true));
      const [invCount] = await db.select({ count: count() }).from(schema.folders);
      const [sessionCount] = await db.select({ count: count() }).from(schema.sessions);
      const since24h = new Date(Date.now() - 24 * 60 * 60 * 1000);
      const [auditCount] = await db.select({ count: count() }).from(schema.activityLog).where(gte(schema.activityLog.timestamp, since24h));
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
    execute: async (input) => {
      const conditions = [];
      // Filter out internal system users
      conditions.push(sql`${schema.users.email} NOT LIKE '%@threatcaddy.internal'`);
      if (input.role) conditions.push(eq(schema.users.role, input.role as 'admin' | 'analyst' | 'viewer'));
      if (input.active !== undefined) conditions.push(eq(schema.users.active, input.active as boolean));
      const limit = Math.min(Math.max(1, (input.limit as number) || 20), 100);

      return db.select({
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
    execute: async (input) => {
      const conditions = [];
      if (input.status) conditions.push(eq(schema.folders.status, input.status as 'active' | 'closed' | 'archived'));
      const limit = Math.min(Math.max(1, (input.limit as number) || 20), 100);
      const where = conditions.length > 0 ? and(...conditions) : undefined;

      return db.select({
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
      },
    },
    requiresConfirm: false,
    execute: async (input) => {
      const conditions = [];
      if (input.enabled !== undefined) conditions.push(eq(schema.botConfigs.enabled, input.enabled as boolean));
      const where = conditions.length > 0 ? and(...conditions) : undefined;

      return db.select({
        id: schema.botConfigs.id,
        name: schema.botConfigs.name,
        type: schema.botConfigs.type,
        enabled: schema.botConfigs.enabled,
        runCount: schema.botConfigs.runCount,
        errorCount: schema.botConfigs.errorCount,
        lastRunAt: schema.botConfigs.lastRunAt,
        lastError: schema.botConfigs.lastError,
      }).from(schema.botConfigs)
        .where(where)
        .orderBy(desc(schema.botConfigs.createdAt));
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
    execute: async (input) => {
      const conditions = [];
      if (input.category) conditions.push(eq(schema.activityLog.category, input.category as string));
      if (input.userId) conditions.push(eq(schema.activityLog.userId, input.userId as string));
      const where = conditions.length > 0 ? and(...conditions) : undefined;
      const limit = Math.min(Math.max(1, (input.limit as number) || 20), 50);

      return db.select({
        id: schema.activityLog.id,
        userId: schema.activityLog.userId,
        category: schema.activityLog.category,
        action: schema.activityLog.action,
        detail: schema.activityLog.detail,
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
    execute: async (input) => {
      const limit = Math.min(Math.max(1, (input.limit as number) || 20), 100);
      return db.select({
        id: schema.sessions.id,
        userId: schema.sessions.userId,
        userEmail: schema.users.email,
        displayName: schema.users.displayName,
        createdAt: schema.sessions.createdAt,
        expiresAt: schema.sessions.expiresAt,
      }).from(schema.sessions)
        .leftJoin(schema.users, eq(schema.users.id, schema.sessions.userId))
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
    execute: async (input, adminId) => {
      const result = await db.update(schema.users)
        .set({ role: input.role as 'admin' | 'analyst' | 'viewer', updatedAt: new Date() })
        .where(eq(schema.users.id, input.userId as string))
        .returning({ id: schema.users.id, email: schema.users.email });
      if (result.length === 0) return { error: 'User not found' };
      await logActivity({
        userId: adminId,
        category: 'admin',
        action: 'user.role-change',
        detail: `AI Assistant changed role of ${result[0].email} to ${input.role}`,
        itemId: input.userId as string,
      });
      return { ok: true, user: result[0], newRole: input.role };
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
    execute: async (input, adminId) => {
      const result = await db.update(schema.users)
        .set({ active: input.active as boolean, updatedAt: new Date() })
        .where(eq(schema.users.id, input.userId as string))
        .returning({ id: schema.users.id, email: schema.users.email });
      if (result.length === 0) return { error: 'User not found' };
      await logActivity({
        userId: adminId,
        category: 'admin',
        action: input.active ? 'user.enable' : 'user.disable',
        detail: `AI Assistant ${input.active ? 'enabled' : 'disabled'} user ${result[0].email}`,
        itemId: input.userId as string,
      });
      return { ok: true, user: result[0], active: input.active };
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
    execute: async (input, adminId) => {
      const result = await db.update(schema.botConfigs)
        .set({ enabled: input.enabled as boolean, updatedAt: new Date() })
        .where(eq(schema.botConfigs.id, input.botId as string))
        .returning({ id: schema.botConfigs.id, name: schema.botConfigs.name });
      if (result.length === 0) return { error: 'Bot not found' };

      // Reload bot in BotManager
      const { botManager } = await import('../bots/bot-manager.js');
      await botManager.reloadBot(input.botId as string);

      await logActivity({
        userId: adminId,
        category: 'admin',
        action: input.enabled ? 'bot.enable' : 'bot.disable',
        detail: `AI Assistant ${input.enabled ? 'enabled' : 'disabled'} bot "${result[0].name}"`,
        itemId: input.botId as string,
      });
      return { ok: true, bot: result[0], enabled: input.enabled };
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

export function getToolByName(name: string): AdminTool | undefined {
  return toolMap.get(name);
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
