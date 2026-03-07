import { Hono } from 'hono';
import { requireAdminAuth, logAdminAction, ADMIN_SYSTEM_USER_ID } from './shared.js';
import {
  validateBotCreate, validateBotUpdate,
  createBot, updateBot, enableBot, disableBot, triggerBot, deleteBot,
  listBotsWithCreator, getBotDetail, getBotRuns,
} from '../../services/bot-service.js';

const app = new Hono();

// GET /admin/api/bots — list all bots with creator info
app.get('/api/bots', requireAdminAuth, async (c) => {
  return c.json({ bots: await listBotsWithCreator() });
});

// POST /admin/api/bots — create a new bot
app.post('/api/bots', requireAdminAuth, async (c) => {
  let body;
  try { body = await c.req.json(); } catch { return c.json({ error: 'Invalid JSON body' }, 400); }

  const error = validateBotCreate(body);
  if (error) return c.json({ error }, 400);

  const bot = await createBot(body, ADMIN_SYSTEM_USER_ID);

  await logAdminAction('bot.create', `Created bot "${bot.name}" (${bot.type})`, { itemId: bot.id });
  return c.json({ ok: true, bot }, 201);
});

// GET /admin/api/bots/:id — bot detail with runs and memberships
app.get('/api/bots/:id', requireAdminAuth, async (c) => {
  const detail = await getBotDetail(c.req.param('id'));
  if (!detail) return c.json({ error: 'Bot not found' }, 404);
  return c.json(detail);
});

// PATCH /admin/api/bots/:id — update bot config
app.patch('/api/bots/:id', requireAdminAuth, async (c) => {
  let body;
  try { body = await c.req.json(); } catch { return c.json({ error: 'Invalid JSON body' }, 400); }

  const result = validateBotUpdate(body);
  if ('error' in result) return c.json({ error: result.error }, 400);

  const bot = await updateBot(c.req.param('id'), result.updates);
  if (!bot) return c.json({ error: 'Bot not found' }, 404);

  await logAdminAction('bot.update', `Updated bot "${bot.name}"`, { itemId: c.req.param('id') });
  return c.json({ ok: true });
});

// POST /admin/api/bots/:id/enable
app.post('/api/bots/:id/enable', requireAdminAuth, async (c) => {
  const bot = await enableBot(c.req.param('id'));
  if (!bot) return c.json({ error: 'Bot not found' }, 404);

  await logAdminAction('bot.enable', `Enabled bot "${bot.name}"`, { itemId: c.req.param('id') });
  return c.json({ ok: true, enabled: true });
});

// POST /admin/api/bots/:id/disable
app.post('/api/bots/:id/disable', requireAdminAuth, async (c) => {
  const bot = await disableBot(c.req.param('id'));
  if (!bot) return c.json({ error: 'Bot not found' }, 404);

  await logAdminAction('bot.disable', `Disabled bot "${bot.name}"`, { itemId: c.req.param('id') });
  return c.json({ ok: true, enabled: false });
});

// POST /admin/api/bots/:id/trigger — manual trigger
app.post('/api/bots/:id/trigger', requireAdminAuth, async (c) => {
  const result = await triggerBot(c.req.param('id'));
  if (!result) return c.json({ error: 'Bot not found' }, 404);
  if ('error' in result) return c.json({ error: result.error }, 400);

  await logAdminAction('bot.trigger', `Manually triggered bot "${result.name}"`, { itemId: c.req.param('id') });
  return c.json({ ok: true });
});

// DELETE /admin/api/bots/:id — delete bot
app.delete('/api/bots/:id', requireAdminAuth, async (c) => {
  const bot = await deleteBot(c.req.param('id'));
  if (!bot) return c.json({ error: 'Bot not found' }, 404);

  await logAdminAction('bot.delete', `Deleted bot "${bot.name}"`, { itemId: c.req.param('id') });
  return c.json({ ok: true });
});

// GET /admin/api/bots/:id/runs — run history
app.get('/api/bots/:id/runs', requireAdminAuth, async (c) => {
  const limit = Math.min(200, Math.max(1, parseInt(c.req.query('limit') || '50', 10) || 50));
  const runs = await getBotRuns(c.req.param('id'), limit);
  return c.json({ runs });
});

export default app;
