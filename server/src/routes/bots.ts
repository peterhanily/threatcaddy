import { Hono } from 'hono';
import { timingSafeEqual, createHmac } from 'node:crypto';
import { requireAuth, requireRole } from '../middleware/auth.js';
import { botManager } from '../bots/bot-manager.js';
import { logger } from '../lib/logger.js';
import {
  validateBotCreate, validateBotUpdate,
  createBot, updateBot, enableBot, disableBot, triggerBot, deleteBot,
  listBots, getBot, getBotRuns, getBotRunDetail, auditBotAction,
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

  return c.json({ bot });
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

  // Authenticate FIRST — avoid leaking bot state to unauthenticated callers.
  // Uses cached decrypted config from BotManager (no DB query or decryption per request).
  const webhookSecret = botManager.getWebhookSecret(id);
  if (!webhookSecret) {
    return c.json({ error: 'Not found' }, 404);
  }

  // Support two auth modes: HMAC-SHA256 signature or raw secret comparison
  const signatureHeader = c.req.header('X-Webhook-Signature') || '';
  const secretHeader = c.req.header('X-Webhook-Secret') || '';

  // We need the raw body for HMAC verification and JSON parsing
  const rawBody = await c.req.text();
  let authenticated = false;

  if (signatureHeader.startsWith('sha256=')) {
    const expected = createHmac('sha256', webhookSecret).update(rawBody).digest('hex');
    const providedHex = signatureHeader.slice(7);
    const expectedBuf = Buffer.from(expected);
    const providedBuf = Buffer.from(providedHex);
    if (expectedBuf.length === providedBuf.length && timingSafeEqual(expectedBuf, providedBuf)) {
      authenticated = true;
    }
  } else if (secretHeader) {
    const secretBuf = Buffer.from(webhookSecret);
    const headerBuf = Buffer.from(secretHeader);
    if (secretBuf.length === headerBuf.length && timingSafeEqual(secretBuf, headerBuf)) {
      authenticated = true;
    }
  }

  if (!authenticated) {
    return c.json({ error: 'Invalid webhook secret' }, 401);
  }

  let payload: Record<string, unknown>;
  try { payload = JSON.parse(rawBody); } catch { return c.json({ error: 'Invalid JSON body' }, 400); }

  botManager.executeBot(id, 'webhook', undefined, payload).catch(err => {
    logger.error('Webhook bot execution failed', { botId: id, error: String(err) });
  });
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
  const limit = Math.min(Math.max(1, parseInt(c.req.query('limit') || '50', 10) || 50), 100);
  const runs = await getBotRuns(c.req.param('id'), limit);
  return c.json({ runs });
});

app.get('/:id/runs/:runId', requireRole('admin', 'analyst'), async (c) => {
  const run = await getBotRunDetail(c.req.param('runId'));
  if (!run || run.botConfigId !== c.req.param('id')) {
    return c.json({ error: 'Run not found' }, 404);
  }
  return c.json({ run });
});

export default app;
