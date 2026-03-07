import { Hono } from 'hono';
import { timingSafeEqual } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { db } from '../db/index.js';
import * as schema from '../db/schema.js';
import { requireAuth, requireRole } from '../middleware/auth.js';
import { decryptConfigSecrets } from '../bots/secret-store.js';
import { botManager } from '../bots/bot-manager.js';
import {
  validateBotCreate, validateBotUpdate,
  createBot, updateBot, enableBot, disableBot, triggerBot, deleteBot,
  listBots, getBot, getBotRuns, auditBotAction,
} from '../services/bot-service.js';

const app = new Hono();

// All bot routes require auth, except webhook endpoint (uses its own secret)
app.use('*', async (c, next) => {
  if (c.req.path.match(/\/[^/]+\/webhook$/) && c.req.method === 'POST') {
    return next();
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (requireAuth as any)(c, next);
});

// ─── List all bot configs ───────────────────────────────────────

app.get('/', requireRole('admin', 'analyst'), async (c) => {
  return c.json({ bots: await listBots() });
});

// ─── Get a single bot config ────────────────────────────────────

app.get('/:id', requireRole('admin', 'analyst'), async (c) => {
  const bot = await getBot(c.req.param('id'));
  if (!bot) return c.json({ error: 'Bot not found' }, 404);
  return c.json({ bot });
});

// ─── Create a new bot ───────────────────────────────────────────

app.post('/', requireRole('admin'), async (c) => {
  const user = c.get('user' as never) as { id: string };
  let body;
  try { body = await c.req.json(); } catch { return c.json({ error: 'Invalid JSON body' }, 400); }

  const error = validateBotCreate(body);
  if (error) return c.json({ error }, 400);

  const bot = await createBot(body, user.id);

  await auditBotAction(user.id, 'create', bot.name, `Created bot "${bot.name}" (${bot.type})`, bot.id);

  return c.json({ bot }, 201);
});

// ─── Update a bot config ────────────────────────────────────────

app.patch('/:id', requireRole('admin'), async (c) => {
  const user = c.get('user' as never) as { id: string };
  let body;
  try { body = await c.req.json(); } catch { return c.json({ error: 'Invalid JSON body' }, 400); }

  const result = validateBotUpdate(body);
  if ('error' in result) return c.json({ error: result.error }, 400);

  const bot = await updateBot(c.req.param('id'), result.updates);
  if (!bot) return c.json({ error: 'Bot not found' }, 404);

  await auditBotAction(user.id, 'update', bot.name, `Updated bot "${bot.name}"`, c.req.param('id'));

  return c.json({ ok: true });
});

// ─── Enable/disable a bot ───────────────────────────────────────

app.post('/:id/enable', requireRole('admin'), async (c) => {
  const user = c.get('user' as never) as { id: string };
  const bot = await enableBot(c.req.param('id'));
  if (!bot) return c.json({ error: 'Bot not found' }, 404);

  await auditBotAction(user.id, 'enable', bot.name, `Enabled bot "${bot.name}"`, c.req.param('id'));
  return c.json({ ok: true, enabled: true });
});

app.post('/:id/disable', requireRole('admin'), async (c) => {
  const user = c.get('user' as never) as { id: string };
  const bot = await disableBot(c.req.param('id'));
  if (!bot) return c.json({ error: 'Bot not found' }, 404);

  await auditBotAction(user.id, 'disable', bot.name, `Disabled bot "${bot.name}"`, c.req.param('id'));
  return c.json({ ok: true, enabled: false });
});

// ─── Manual trigger ─────────────────────────────────────────────

app.post('/:id/trigger', requireRole('admin'), async (c) => {
  const user = c.get('user' as never) as { id: string };
  const result = await triggerBot(c.req.param('id'));
  if (!result) return c.json({ error: 'Bot not found' }, 404);
  if ('error' in result) return c.json({ error: result.error }, 400);

  await auditBotAction(user.id, 'trigger.manual', result.name, `Manually triggered bot "${result.name}"`, c.req.param('id'));
  return c.json({ ok: true, message: 'Bot triggered' });
});

// ─── Webhook endpoint (public, authenticated via bot ID + secret) ──

app.post('/:id/webhook', async (c) => {
  const id = c.req.param('id');
  const rows = await db.select().from(schema.botConfigs).where(eq(schema.botConfigs.id, id)).limit(1);
  if (rows.length === 0) return c.json({ error: 'Not found' }, 404);
  if (!rows[0].enabled) return c.json({ error: 'Bot is disabled' }, 400);

  const config = rows[0];
  const triggers = config.triggers as Record<string, unknown>;
  if (!triggers?.webhook) return c.json({ error: 'Webhooks not enabled for this bot' }, 400);

  const decryptedConfig = decryptConfigSecrets(config.config as Record<string, unknown>);
  const webhookSecret = decryptedConfig.webhookSecret as string | undefined;

  if (!webhookSecret) {
    return c.json({ error: 'Webhook secret not configured' }, 403);
  }
  const authHeader = c.req.header('X-Webhook-Secret') || '';
  const secretBuf = Buffer.from(webhookSecret);
  const headerBuf = Buffer.from(authHeader);
  if (secretBuf.length !== headerBuf.length || !timingSafeEqual(secretBuf, headerBuf)) {
    return c.json({ error: 'Invalid webhook secret' }, 401);
  }

  const payload = await c.req.json().catch(() => ({}));
  void botManager.executeBot(id, 'webhook', undefined, payload);
  return c.json({ ok: true, message: 'Webhook received' });
});

// ─── Delete a bot ───────────────────────────────────────────────

app.delete('/:id', requireRole('admin'), async (c) => {
  const user = c.get('user' as never) as { id: string };
  const bot = await deleteBot(c.req.param('id'));
  if (!bot) return c.json({ error: 'Bot not found' }, 404);

  await auditBotAction(user.id, 'delete', bot.name, `Deleted bot "${bot.name}"`, c.req.param('id'));
  return c.json({ ok: true });
});

// ─── Bot run history ────────────────────────────────────────────

app.get('/:id/runs', requireRole('admin', 'analyst'), async (c) => {
  const limit = Math.min(parseInt(c.req.query('limit') || '50', 10), 100);
  const runs = await getBotRuns(c.req.param('id'), limit);
  return c.json({ runs });
});

export default app;
