import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Hono } from 'hono';

// --- Hoisted mock state ---

const { mockBotService } = vi.hoisted(() => {
  const mockBotService = {
    validateBotCreate: vi.fn(),
    validateBotUpdate: vi.fn(),
    createBot: vi.fn(),
    updateBot: vi.fn(),
    enableBot: vi.fn(),
    disableBot: vi.fn(),
    triggerBot: vi.fn(),
    deleteBot: vi.fn(),
    listBotsWithCreator: vi.fn(),
    getBotDetail: vi.fn(),
    getBotRuns: vi.fn(),
    getBotRunDetail: vi.fn(),
  };
  return { mockBotService };
});

// --- Mocks ---

vi.mock('../routes/admin/shared.js', async () => {
  const { initAdminKey: _initAdminKey, requireAdminAuth: _requireAdminAuth } = await import('../middleware/admin-auth.js');
  _initAdminKey();
  return {
    requireAdminAuth: _requireAdminAuth,
    logAdminAction: () => Promise.resolve(undefined),
    getAdminId: () => 'admin-1',
    ADMIN_SYSTEM_USER_ID: 'system',
  };
});

vi.mock('../services/bot-service.js', () => mockBotService);

vi.mock('../lib/logger.js', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

// --- Imports ---

import { signAdminToken } from '../middleware/admin-auth.js';
import botsRoutes from '../routes/admin/bots.js';

function createApp() {
  const app = new Hono();
  app.route('/admin', botsRoutes);
  return app;
}

describe('Admin Bots Routes', () => {
  let app: Hono;
  let adminToken: string;

  beforeEach(async () => {
    vi.clearAllMocks();
    app = createApp();
    adminToken = await signAdminToken('admin-1', 'admin');

    // Default mock return values
    mockBotService.validateBotCreate.mockReturnValue(null);
    mockBotService.validateBotUpdate.mockReturnValue({ updates: {} });
    mockBotService.listBotsWithCreator.mockResolvedValue([]);
    mockBotService.getBotDetail.mockResolvedValue(null);
    mockBotService.getBotRuns.mockResolvedValue([]);
    mockBotService.getBotRunDetail.mockResolvedValue(null);
  });

  // ---- Auth required ----

  it('GET /admin/api/bots returns 401 without auth', async () => {
    const res = await app.request('/admin/api/bots');
    expect(res.status).toBe(401);
  });

  it('POST /admin/api/bots returns 401 without auth', async () => {
    const res = await app.request('/admin/api/bots', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'test' }),
    });
    expect(res.status).toBe(401);
  });

  // ---- GET /api/bots ----

  it('GET /admin/api/bots lists all bots with creator info', async () => {
    const bots = [
      { id: 'bot-1', name: 'Bot One', createdBy: 'admin-1' },
      { id: 'bot-2', name: 'Bot Two', createdBy: 'admin-2' },
    ];
    mockBotService.listBotsWithCreator.mockResolvedValue(bots);

    const res = await app.request('/admin/api/bots', {
      headers: { Authorization: `Bearer ${adminToken}` },
    });

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.bots).toHaveLength(2);
    expect(mockBotService.listBotsWithCreator).toHaveBeenCalled();
  });

  // ---- POST /api/bots ----

  it('POST /admin/api/bots creates a new bot and returns 201', async () => {
    const newBot = { id: 'bot-new', name: 'New Bot', type: 'digest' };
    mockBotService.createBot.mockResolvedValue(newBot);

    const res = await app.request('/admin/api/bots', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${adminToken}`,
      },
      body: JSON.stringify({ name: 'New Bot', schedule: '0 * * * *', type: 'digest' }),
    });

    expect(res.status).toBe(201);
    const json = await res.json();
    expect(json.ok).toBe(true);
    expect(json.bot.id).toBe('bot-new');
    expect(mockBotService.createBot).toHaveBeenCalled();
  });

  it('POST /admin/api/bots returns 400 when validation fails', async () => {
    mockBotService.validateBotCreate.mockReturnValue('Name is required');

    const res = await app.request('/admin/api/bots', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${adminToken}`,
      },
      body: JSON.stringify({}),
    });

    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toBe('Name is required');
  });

  // ---- GET /api/bots/:id ----

  it('GET /admin/api/bots/:id returns bot detail', async () => {
    const bot = { id: 'bot-1', name: 'Bot One', enabled: true };
    mockBotService.getBotDetail.mockResolvedValue(bot);

    const res = await app.request('/admin/api/bots/bot-1', {
      headers: { Authorization: `Bearer ${adminToken}` },
    });

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.id).toBe('bot-1');
    expect(mockBotService.getBotDetail).toHaveBeenCalledWith('bot-1');
  });

  it('GET /admin/api/bots/:id returns 404 when not found', async () => {
    mockBotService.getBotDetail.mockResolvedValue(null);

    const res = await app.request('/admin/api/bots/nonexistent', {
      headers: { Authorization: `Bearer ${adminToken}` },
    });

    expect(res.status).toBe(404);
  });

  // ---- PATCH /api/bots/:id ----

  it('PATCH /admin/api/bots/:id updates a bot', async () => {
    mockBotService.validateBotUpdate.mockReturnValue({ updates: { name: 'Updated Bot' } });
    mockBotService.updateBot.mockResolvedValue({ id: 'bot-1', name: 'Updated Bot' });

    const res = await app.request('/admin/api/bots/bot-1', {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${adminToken}`,
      },
      body: JSON.stringify({ name: 'Updated Bot' }),
    });

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.ok).toBe(true);
  });

  it('PATCH /admin/api/bots/:id returns 404 when bot not found', async () => {
    mockBotService.validateBotUpdate.mockReturnValue({ updates: { name: 'No Bot' } });
    mockBotService.updateBot.mockResolvedValue(null);

    const res = await app.request('/admin/api/bots/nonexistent', {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${adminToken}`,
      },
      body: JSON.stringify({ name: 'No Bot' }),
    });

    expect(res.status).toBe(404);
  });

  it('PATCH /admin/api/bots/:id returns 400 when validation fails', async () => {
    mockBotService.validateBotUpdate.mockReturnValue({ error: 'Invalid schedule' });

    const res = await app.request('/admin/api/bots/bot-1', {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${adminToken}`,
      },
      body: JSON.stringify({ schedule: 'bad' }),
    });

    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toBe('Invalid schedule');
  });

  // ---- POST /api/bots/:id/enable ----

  it('POST /admin/api/bots/:id/enable enables a bot', async () => {
    mockBotService.enableBot.mockResolvedValue({ id: 'bot-1', name: 'Bot One', enabled: true });

    const res = await app.request('/admin/api/bots/bot-1/enable', {
      method: 'POST',
      headers: { Authorization: `Bearer ${adminToken}` },
    });

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.ok).toBe(true);
    expect(json.enabled).toBe(true);
    expect(mockBotService.enableBot).toHaveBeenCalledWith('bot-1');
  });

  it('POST /admin/api/bots/:id/enable returns 404 when bot not found', async () => {
    mockBotService.enableBot.mockResolvedValue(null);

    const res = await app.request('/admin/api/bots/nonexistent/enable', {
      method: 'POST',
      headers: { Authorization: `Bearer ${adminToken}` },
    });

    expect(res.status).toBe(404);
  });

  // ---- POST /api/bots/:id/disable ----

  it('POST /admin/api/bots/:id/disable disables a bot', async () => {
    mockBotService.disableBot.mockResolvedValue({ id: 'bot-1', name: 'Bot One', enabled: false });

    const res = await app.request('/admin/api/bots/bot-1/disable', {
      method: 'POST',
      headers: { Authorization: `Bearer ${adminToken}` },
    });

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.ok).toBe(true);
    expect(json.enabled).toBe(false);
    expect(mockBotService.disableBot).toHaveBeenCalledWith('bot-1');
  });

  // ---- POST /api/bots/:id/trigger ----

  it('POST /admin/api/bots/:id/trigger triggers a bot manually', async () => {
    mockBotService.triggerBot.mockResolvedValue({ name: 'Bot One', runId: 'run-1' });

    const res = await app.request('/admin/api/bots/bot-1/trigger', {
      method: 'POST',
      headers: { Authorization: `Bearer ${adminToken}` },
    });

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.ok).toBe(true);
    expect(mockBotService.triggerBot).toHaveBeenCalledWith('bot-1');
  });

  it('POST /admin/api/bots/:id/trigger returns 404 when bot not found', async () => {
    mockBotService.triggerBot.mockResolvedValue(null);

    const res = await app.request('/admin/api/bots/nonexistent/trigger', {
      method: 'POST',
      headers: { Authorization: `Bearer ${adminToken}` },
    });

    expect(res.status).toBe(404);
  });

  it('POST /admin/api/bots/:id/trigger returns 400 when trigger returns error', async () => {
    mockBotService.triggerBot.mockResolvedValue({ error: 'Bot is disabled' });

    const res = await app.request('/admin/api/bots/bot-1/trigger', {
      method: 'POST',
      headers: { Authorization: `Bearer ${adminToken}` },
    });

    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toBe('Bot is disabled');
  });

  // ---- DELETE /api/bots/:id ----

  it('DELETE /admin/api/bots/:id deletes a bot', async () => {
    mockBotService.deleteBot.mockResolvedValue({ id: 'bot-1', name: 'Bot One' });

    const res = await app.request('/admin/api/bots/bot-1', {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${adminToken}` },
    });

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.ok).toBe(true);
    expect(mockBotService.deleteBot).toHaveBeenCalledWith('bot-1');
  });

  it('DELETE /admin/api/bots/:id returns 404 when bot not found', async () => {
    mockBotService.deleteBot.mockResolvedValue(null);

    const res = await app.request('/admin/api/bots/nonexistent', {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${adminToken}` },
    });

    expect(res.status).toBe(404);
  });

  // ---- GET /api/bots/:id/runs ----

  it('GET /admin/api/bots/:id/runs returns run history', async () => {
    const runs = [
      { id: 'run-1', botConfigId: 'bot-1', status: 'completed' },
      { id: 'run-2', botConfigId: 'bot-1', status: 'failed' },
    ];
    mockBotService.getBotRuns.mockResolvedValue(runs);

    const res = await app.request('/admin/api/bots/bot-1/runs', {
      headers: { Authorization: `Bearer ${adminToken}` },
    });

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.runs).toHaveLength(2);
    expect(mockBotService.getBotRuns).toHaveBeenCalled();
  });

  it('GET /admin/api/bots/:id/runs caps limit at 200', async () => {
    mockBotService.getBotRuns.mockResolvedValue([]);

    const res = await app.request('/admin/api/bots/bot-1/runs?limit=500', {
      headers: { Authorization: `Bearer ${adminToken}` },
    });

    expect(res.status).toBe(200);
    // Verify the limit passed to getBotRuns is capped at 200
    const callArgs = mockBotService.getBotRuns.mock.calls[0];
    expect(callArgs[1]).toBeLessThanOrEqual(200);
  });

  // ---- GET /api/bots/:id/runs/:runId ----

  it('GET /admin/api/bots/:id/runs/:runId returns run detail', async () => {
    const run = { id: 'run-1', botConfigId: 'bot-1', status: 'completed', output: 'done' };
    mockBotService.getBotRunDetail.mockResolvedValue(run);

    const res = await app.request('/admin/api/bots/bot-1/runs/run-1', {
      headers: { Authorization: `Bearer ${adminToken}` },
    });

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.run.id).toBe('run-1');
  });

  it('GET /admin/api/bots/:id/runs/:runId returns 404 when run not found', async () => {
    mockBotService.getBotRunDetail.mockResolvedValue(null);

    const res = await app.request('/admin/api/bots/bot-1/runs/nonexistent', {
      headers: { Authorization: `Bearer ${adminToken}` },
    });

    expect(res.status).toBe(404);
  });

  it('GET /admin/api/bots/:id/runs/:runId returns 404 when botConfigId mismatch', async () => {
    const run = { id: 'run-1', botConfigId: 'bot-OTHER', status: 'completed' };
    mockBotService.getBotRunDetail.mockResolvedValue(run);

    const res = await app.request('/admin/api/bots/bot-1/runs/run-1', {
      headers: { Authorization: `Bearer ${adminToken}` },
    });

    expect(res.status).toBe(404);
  });
});
