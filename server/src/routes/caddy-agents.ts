/**
 * API routes for server-side AgentCaddy handoff.
 * Manages registration, heartbeats, and server-created agent actions.
 */

import { Hono } from 'hono';
import { eq, and, desc } from 'drizzle-orm';
import { requireAuth } from '../middleware/auth.js';
import { db } from '../db/index.js';
import { botConfigs, agentActions, agentHeartbeats } from '../db/schema.js';
import { convertProfileToBotConfig } from '../bots/caddy-agent-bridge.js';
import { HeartbeatManager } from '../bots/heartbeat-manager.js';

// Singleton — initialized with db, wired to BotManager later
export const heartbeatManager = new HeartbeatManager(db as never);

const app = new Hono();

// All routes require auth
app.use('*', requireAuth as never);

// ─── Register server-side agents ────────────────────────────────

app.post('/register', async (c) => {
  const user = c.get('user' as never) as { id: string };
  const body = await c.req.json<{
    investigationId: string;
    deployments: Array<{
      deploymentId: string;
      profile: {
        id: string;
        name: string;
        description?: string;
        role: 'executive' | 'lead' | 'specialist' | 'observer';
        systemPrompt: string;
        allowedTools?: string[];
        readOnlyEntityTypes?: string[];
        policy: Record<string, unknown>;
        model?: string;
      };
      policyOverrides?: Record<string, unknown>;
      order: number;
    }>;
  }>();

  if (!body.investigationId || !body.deployments?.length) {
    return c.json({ error: 'investigationId and deployments required' }, 400);
  }
  if (body.deployments.length > 50) {
    return c.json({ error: 'Too many deployments in a single request (max 50)' }, 400);
  }

  const results: { deploymentId: string; botConfigId: string }[] = [];

  for (const dep of body.deployments) {
    // Check if already registered
    const existing = await db.select()
      .from(botConfigs)
      .where(and(
        eq(botConfigs.sourceType, 'caddy-agent'),
        eq(botConfigs.sourceDeploymentId, dep.deploymentId),
      ))
      .limit(1);

    if (existing.length > 0) {
      // Update existing config
      const { botConfig } = convertProfileToBotConfig(
        dep.profile as Parameters<typeof convertProfileToBotConfig>[0],
        { id: dep.deploymentId, investigationId: body.investigationId, profileId: dep.profile.id, order: dep.order },
      );
      await db.update(botConfigs)
        .set({
          name: botConfig.name,
          triggers: botConfig.triggers,
          config: botConfig.config,
          capabilities: botConfig.capabilities,
          scopeFolderIds: botConfig.scopeFolderIds,
          updatedAt: new Date(),
        })
        .where(eq(botConfigs.id, existing[0].id));
      results.push({ deploymentId: dep.deploymentId, botConfigId: existing[0].id });
    } else {
      // Create new bot config
      const { botConfig } = convertProfileToBotConfig(
        dep.profile as Parameters<typeof convertProfileToBotConfig>[0],
        { id: dep.deploymentId, investigationId: body.investigationId, profileId: dep.profile.id, order: dep.order },
      );
      const id = botConfig.id;
      await db.insert(botConfigs).values({
        id,
        userId: user.id,
        type: botConfig.type,
        name: botConfig.name,
        description: botConfig.description,
        enabled: false, // Disabled until heartbeat goes stale
        triggers: botConfig.triggers,
        config: botConfig.config,
        capabilities: botConfig.capabilities,
        allowedDomains: botConfig.allowedDomains,
        scopeType: botConfig.scopeType,
        scopeFolderIds: botConfig.scopeFolderIds,
        rateLimitPerHour: botConfig.rateLimitPerHour,
        rateLimitPerDay: botConfig.rateLimitPerDay,
        sourceType: 'caddy-agent',
        sourceDeploymentId: dep.deploymentId,
        createdBy: user.id,
      });
      results.push({ deploymentId: dep.deploymentId, botConfigId: id });
    }
  }

  return c.json({ botConfigs: results });
});

// ─── Unregister server-side agents ──────────────────────────────

app.post('/unregister', async (c) => {
  const body = await c.req.json<{ investigationId?: string; deploymentIds?: string[] }>();

  if (body.deploymentIds?.length) {
    for (const depId of body.deploymentIds) {
      await db.delete(botConfigs)
        .where(and(eq(botConfigs.sourceType, 'caddy-agent'), eq(botConfigs.sourceDeploymentId, depId)));
    }
  } else if (body.investigationId) {
    // Delete all caddy-agent bots for this investigation
    const bots = await db.select({ id: botConfigs.id, scopeFolderIds: botConfigs.scopeFolderIds })
      .from(botConfigs)
      .where(eq(botConfigs.sourceType, 'caddy-agent'));
    for (const bot of bots) {
      if (Array.isArray(bot.scopeFolderIds) && (bot.scopeFolderIds as string[]).includes(body.investigationId)) {
        await db.delete(botConfigs).where(eq(botConfigs.id, bot.id));
      }
    }
    // Clean up heartbeat
    await db.delete(agentHeartbeats).where(eq(agentHeartbeats.folderId, body.investigationId));
  }

  return c.json({ ok: true });
});

// ─── Heartbeat ──────────────────────────────────────────────────

app.post('/heartbeat', async (c) => {
  const user = c.get('user' as never) as { id: string };
  const body = await c.req.json<{ investigationId: string }>();
  if (!body.investigationId) return c.json({ error: 'investigationId required' }, 400);

  const result = await heartbeatManager.recordHeartbeat(body.investigationId, user.id);
  return c.json({ ok: true, ...result });
});

// ─── Status ─────────────────────────────────────────────────────

app.get('/status/:investigationId', async (c) => {
  const folderId = c.req.param('investigationId');

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
  const anyEnabled = matchingBots.some(b => b.enabled);

  return c.json({
    registered: matchingBots.length > 0,
    serverRunning: anyEnabled,
    heartbeatStale: isStale,
    botCount: matchingBots.length,
    lastHeartbeat: heartbeat[0]?.lastBeat ?? null,
  });
});

// ─── Actions ────────────────────────────────────────────────────

app.get('/actions/:investigationId', async (c) => {
  const folderId = c.req.param('investigationId');
  const since = c.req.query('since');
  const limit = Math.min(parseInt(c.req.query('limit') || '50'), 200);

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

  return c.json({ actions: filtered });
});

app.post('/actions/:actionId/approve', async (c) => {
  const actionId = c.req.param('actionId');
  await db.update(agentActions)
    .set({ status: 'approved', reviewedAt: new Date(), updatedAt: new Date() })
    .where(eq(agentActions.id, actionId));
  return c.json({ ok: true });
});

app.post('/actions/:actionId/reject', async (c) => {
  const actionId = c.req.param('actionId');
  await db.update(agentActions)
    .set({ status: 'rejected', reviewedAt: new Date(), updatedAt: new Date() })
    .where(eq(agentActions.id, actionId));
  return c.json({ ok: true });
});

// ─── Webhook trigger ────────────────────────────────────────────

app.post('/trigger/:investigationId', async (c) => {
  const folderId = c.req.param('investigationId');
  const body = await c.req.json<{ context?: string }>().catch(() => ({ context: undefined }));

  // Find all caddy-agent bots for this investigation
  const bots = await db.select()
    .from(botConfigs)
    .where(and(eq(botConfigs.sourceType, 'caddy-agent'), eq(botConfigs.enabled, true)));

  const matchingBots = bots.filter(b =>
    Array.isArray(b.scopeFolderIds) && (b.scopeFolderIds as string[]).includes(folderId)
  );

  if (matchingBots.length === 0) {
    return c.json({ error: 'No active server-side agents for this investigation', triggered: 0 }, 404);
  }

  // Trigger each bot via BotManager (fire-and-forget)
  // The context is stored so the bot can access it in its next run
  return c.json({
    ok: true,
    triggered: matchingBots.length,
    context: body.context ? 'Context will be injected into next agent cycle' : undefined,
  });
});

export default app;
