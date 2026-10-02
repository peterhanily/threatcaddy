/**
 * API routes for server-side AgentCaddy handoff.
 * Manages registration, heartbeats, and server-created agent actions.
 */

import { Hono } from 'hono';
import { eq, and, desc, sql } from 'drizzle-orm';
import { requireAuth } from '../middleware/auth.js';
import { checkInvestigationAccess } from '../middleware/access.js';
import { db } from '../db/index.js';
import { botConfigs, agentActions, agentHeartbeats } from '../db/schema.js';
import { convertProfileToBotConfig } from '../bots/caddy-agent-bridge.js';
import { HeartbeatManager } from '../bots/heartbeat-manager.js';
import { botManager } from '../bots/bot-manager.js';
import { HANDOFF_UNAVAILABLE } from '../bots/handoff-policy.js';
import { encryptConfigSecrets, redactConfigSecrets } from '../bots/secret-store.js';
import { z } from 'zod';

// Singleton — initialized with db, wired to BotManager later
export const heartbeatManager = new HeartbeatManager(db as never);

const app = new Hono();

// All routes require auth
app.use('*', requireAuth as never);

// ─── Register server-side agents ────────────────────────────────

const registrationSchema = z.object({
  investigationId: z.string().min(1).max(200),
  deployments: z.array(z.object({
    deploymentId: z.string().min(1).max(200),
    profile: z.object({
      id: z.string().min(1).max(200), name: z.string().min(1).max(100),
      description: z.string().max(5000).optional(),
      role: z.enum(['executive', 'lead', 'specialist', 'observer']),
      systemPrompt: z.string().max(10000),
      allowedTools: z.array(z.string().max(100)).max(200).optional(),
      readOnlyEntityTypes: z.array(z.string().max(100)).max(100).optional(),
      policy: z.record(z.unknown()), model: z.string().max(200).optional(),
    }),
    policyOverrides: z.record(z.unknown()).optional(), order: z.number().int(),
  })).min(1).max(50),
});

class DeploymentBoundaryError extends Error {
  constructor(message: string, readonly status: 403 | 409) { super(message); }
}

async function authorizeDeployment(userId: string, bot: typeof botConfigs.$inferSelect, database: Pick<typeof db, 'select'>) {
  const scopes = bot.scopeFolderIds;
  if (bot.createdBy !== userId || bot.userId !== userId || bot.scopeType !== 'investigation'
      || !Array.isArray(scopes) || scopes.length === 0 || scopes.some(id => typeof id !== 'string' || !id)) {
    throw new DeploymentBoundaryError('Deployment ownership or existing scope is not authorized', 403);
  }
  for (const folderId of scopes as string[]) {
    if (!await checkInvestigationAccess(userId, folderId, 'editor', database)) {
      throw new DeploymentBoundaryError('No access to an existing deployment investigation', 403);
    }
  }
}

app.post('/register', async (c) => {
  const user = c.get('user' as never) as { id: string };
  const parsed = registrationSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ error: 'Invalid deployment registration' }, 400);
  const body = parsed.data;
  if (new Set(body.deployments.map(dep => dep.deploymentId)).size !== body.deployments.length) {
    return c.json({ error: 'Duplicate deployment IDs in registration' }, 400);
  }
  if (!await checkInvestigationAccess(user.id, body.investigationId, 'editor')) {
    return c.json({ error: 'No access to this investigation' }, 403);
  }
  try {
    const results = await db.transaction(async tx => {
      // Lock identities in a consistent order. This serializes registration even
      // before the forward migration adds a database uniqueness constraint.
      for (const id of body.deployments.map(dep => dep.deploymentId).sort()) {
        await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${'caddy-agent:' + id}, 0))`);
      }
      if (!await checkInvestigationAccess(user.id, body.investigationId, 'editor', tx)) throw new DeploymentBoundaryError('No access to the destination investigation', 403);
      const plans = [];
      for (const dep of body.deployments) {
        const existing = await tx.select().from(botConfigs).where(and(
          eq(botConfigs.sourceType, 'caddy-agent'), eq(botConfigs.sourceDeploymentId, dep.deploymentId),
        ));
        if (existing.length > 1) throw new DeploymentBoundaryError('Deployment identity is ambiguous; administrator review required', 409);
        if (existing[0]) await authorizeDeployment(user.id, existing[0], tx);
        const { botConfig } = convertProfileToBotConfig(
          dep.profile as Parameters<typeof convertProfileToBotConfig>[0],
          { id: dep.deploymentId, investigationId: body.investigationId, profileId: dep.profile.id,
            order: dep.order, policyOverrides: dep.policyOverrides },
        );
        plans.push({ dep, existing: existing[0], botConfig });
      }
      const registered = [];
      for (const { dep, existing, botConfig } of plans) {
        const changes = { ...botConfig, config: encryptConfigSecrets(botConfig.config), enabled: false };
        if (existing) {
          await tx.update(botConfigs).set({ ...changes, id: existing.id, createdBy: user.id, updatedAt: new Date() })
            .where(and(eq(botConfigs.id, existing.id), eq(botConfigs.createdBy, user.id)));
          registered.push({ deploymentId: dep.deploymentId, botConfigId: existing.id });
        } else {
          await tx.insert(botConfigs).values({ ...changes, userId: user.id, createdBy: user.id });
          registered.push({ deploymentId: dep.deploymentId, botConfigId: botConfig.id });
        }
      }
      return registered;
    });
    for (const result of results) await botManager.unloadBot(result.botConfigId);
    return c.json({ botConfigs: results, serverExecutionAvailable: false, reason: HANDOFF_UNAVAILABLE });
  } catch (error) {
    if (error instanceof DeploymentBoundaryError) return c.json({ error: error.message }, error.status);
    throw error;
  }
});

// ─── Unregister server-side agents ──────────────────────────────

app.post('/unregister', async (c) => {
  const user = c.get('user' as never) as { id: string };
  const parsed = z.object({ investigationId: z.string().min(1).optional(), deploymentIds: z.array(z.string().min(1)).min(1).max(50).optional() })
    .safeParse(await c.req.json().catch(() => null));
  if (!parsed.success || (!parsed.data.investigationId && !parsed.data.deploymentIds)) return c.json({ error: 'Investigation or deployment IDs required' }, 400);
  const body = parsed.data;
  if (body.investigationId && !await checkInvestigationAccess(user.id, body.investigationId, 'editor')) return c.json({ error: 'No access to this investigation' }, 403);
  try {
    const removed = await db.transaction(async tx => {
      const snapshot = await tx.select().from(botConfigs).where(eq(botConfigs.sourceType, 'caddy-agent'));
      const identities = body.deploymentIds ?? snapshot.filter(bot => bot.createdBy === user.id
        && Array.isArray(bot.scopeFolderIds) && (bot.scopeFolderIds as string[]).includes(body.investigationId!))
        .map(bot => bot.sourceDeploymentId).filter((id): id is string => !!id);
      for (const id of [...new Set(identities)].sort()) {
        await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${'caddy-agent:' + id}, 0))`);
      }
      const current = await tx.select().from(botConfigs).where(eq(botConfigs.sourceType, 'caddy-agent'));
      const matching = current.filter(bot => identities.includes(bot.sourceDeploymentId ?? '')
        && (body.deploymentIds || (Array.isArray(bot.scopeFolderIds) && (bot.scopeFolderIds as string[]).includes(body.investigationId!))));
      for (const bot of matching) await authorizeDeployment(user.id, bot, tx);
      for (const bot of matching) await tx.delete(botConfigs).where(and(eq(botConfigs.id, bot.id), eq(botConfigs.createdBy, user.id)));
      return matching.map(bot => bot.id);
    });
    for (const id of removed) await botManager.unloadBot(id);
    return c.json({ ok: true });
  } catch (error) {
    if (error instanceof DeploymentBoundaryError) return c.json({ error: error.message }, error.status);
    throw error;
  }
});

// ─── Heartbeat ──────────────────────────────────────────────────

app.post('/heartbeat', async (c) => {
  const user = c.get('user' as never) as { id: string };
  const body = await c.req.json<{ investigationId: string }>().catch(() => null);
  if (!body || typeof body.investigationId !== 'string') return c.json({ error: 'investigationId required' }, 400);
  if (!await checkInvestigationAccess(user.id, body.investigationId, 'editor')) return c.json({ error: 'No access to this investigation' }, 403);
  return c.json({ error: HANDOFF_UNAVAILABLE, serverExecutionAvailable: false }, 503);
});

// ─── Status ─────────────────────────────────────────────────────

app.get('/status/:investigationId', async (c) => {
  const user = c.get('user' as never) as { id: string };
  const folderId = c.req.param('investigationId');
  if (!await checkInvestigationAccess(user.id, folderId)) {
    return c.json({ error: 'No access to this investigation' }, 403);
  }

  const bots = await db.select()
    .from(botConfigs)
    .where(eq(botConfigs.sourceType, 'caddy-agent'));
  const matchingBots = bots.filter(b =>
    Array.isArray(b.scopeFolderIds) && (b.scopeFolderIds as string[]).includes(folderId)
  );

  const heartbeat = await db.select()
    .from(agentHeartbeats)
    .where(eq(agentHeartbeats.folderId, folderId))
    .limit(1);

  const isStale = heartbeat.length > 0 && heartbeat[0].serverTakeoverAt < new Date();

  return c.json({
    registered: matchingBots.length > 0,
    serverRunning: false,
    serverExecutionAvailable: false,
    reason: HANDOFF_UNAVAILABLE,
    heartbeatStale: isStale,
    botCount: matchingBots.length,
    lastHeartbeat: heartbeat[0]?.lastBeat ?? null,
  });
});

// ─── Actions ────────────────────────────────────────────────────

app.get('/actions/:investigationId', async (c) => {
  const user = c.get('user' as never) as { id: string };
  const folderId = c.req.param('investigationId');
  if (!await checkInvestigationAccess(user.id, folderId)) {
    return c.json({ error: 'No access to this investigation' }, 403);
  }
  const since = c.req.query('since');
  const rawLimit = parseInt(c.req.query('limit') || '', 10);
  const limit = Math.min(isFinite(rawLimit) && rawLimit > 0 ? rawLimit : 50, 200);

  const query = db.select().from(agentActions)
    .where(eq(agentActions.investigationId, folderId))
    .orderBy(desc(agentActions.createdAt))
    .limit(limit);

  const actions = await query;

  // Filter by since timestamp if provided (validate date before using)
  const sinceDate = since ? new Date(since) : null;
  const filtered = sinceDate && !isNaN(sinceDate.getTime())
    ? actions.filter(a => a.createdAt > sinceDate)
    : actions;

  return c.json({ actions: filtered.map(action => ({ ...action, toolInput: redactConfigSecrets(action.toolInput as Record<string, unknown>) })) });
});

app.post('/actions/:actionId/approve', async (c) => {
  const user = c.get('user' as never) as { id: string };
  const actionId = c.req.param('actionId');
  // Verify user has access to the action's investigation
  const [action] = await db.select({ investigationId: agentActions.investigationId })
    .from(agentActions).where(eq(agentActions.id, actionId)).limit(1);
  if (!action || !await checkInvestigationAccess(user.id, action.investigationId, 'editor')) {
    return c.json({ error: 'No access to this action' }, 403);
  }
  await db.update(agentActions)
    .set({ status: 'approved', reviewedAt: new Date(), updatedAt: new Date() })
    .where(eq(agentActions.id, actionId));
  return c.json({ ok: true, serverExecutionAvailable: false });
});

app.post('/actions/:actionId/reject', async (c) => {
  const user = c.get('user' as never) as { id: string };
  const actionId = c.req.param('actionId');
  const [action] = await db.select({ investigationId: agentActions.investigationId })
    .from(agentActions).where(eq(agentActions.id, actionId)).limit(1);
  if (!action || !await checkInvestigationAccess(user.id, action.investigationId, 'editor')) {
    return c.json({ error: 'No access to this action' }, 403);
  }
  await db.update(agentActions)
    .set({ status: 'rejected', reviewedAt: new Date(), updatedAt: new Date() })
    .where(eq(agentActions.id, actionId));
  return c.json({ ok: true, serverExecutionAvailable: false, executionPerformed: false });
});

// ─── Webhook trigger ────────────────────────────────────────────

app.post('/trigger/:investigationId', async (c) => {
  const user = c.get('user' as never) as { id: string };
  const folderId = c.req.param('investigationId');
  if (!await checkInvestigationAccess(user.id, folderId, 'editor')) {
    return c.json({ error: 'No access to this investigation' }, 403);
  }
  return c.json({ error: HANDOFF_UNAVAILABLE, triggered: 0, serverExecutionAvailable: false }, 503);
});

export default app;
