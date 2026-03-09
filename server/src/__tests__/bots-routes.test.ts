import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Hono } from 'hono';
import { createHmac } from 'node:crypto';

// ── Hoisted mocks (must be declared via vi.hoisted to survive vi.mock hoisting) ──

const { mockUser, mockBotManager, mockBotService, mockLogger } = vi.hoisted(() => {
  const mockUser = { current: { id: 'user-1', email: 'admin@test.com', role: 'admin' } as { id: string; email: string; role: string } | null };
  const mockBotManager = {
    getWebhookSecret: vi.fn(),
    executeBot: vi.fn(),
  };
  const mockBotService = {
    validateBotCreate: vi.fn(),
    validateBotUpdate: vi.fn(),
    createBot: vi.fn(),
    updateBot: vi.fn(),
    enableBot: vi.fn(),
    disableBot: vi.fn(),
    triggerBot: vi.fn(),
    deleteBot: vi.fn(),
    listBots: vi.fn(),
    getBot: vi.fn(),
    getBotRuns: vi.fn(),
    getBotRunDetail: vi.fn(),
    auditBotAction: vi.fn(),
  };
  const mockLogger = {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  };
  return { mockUser, mockBotManager, mockBotService, mockLogger };
});

// ── vi.mock calls (factories can only reference vi.hoisted variables) ──

vi.mock('../middleware/auth.js', async () => {
  const { createMiddleware } = await import('hono/factory');
  return {
    requireAuth: createMiddleware(async (c, next) => {
      if (!mockUser.current) return c.json({ error: 'Unauthorized' }, 401);
      c.set('user' as never, mockUser.current as never);
      await next();
    }),
    requireRole: (...roles: string[]) =>
      createMiddleware(async (c, next) => {
        const user = c.get('user' as never) as { role: string };
        if (!roles.includes(user.role)) {
          return c.json({ error: 'Insufficient permissions' }, 403);
        }
        await next();
      }),
  };
});

vi.mock('../bots/bot-manager.js', () => ({
  botManager: mockBotManager,
}));

vi.mock('../services/bot-service.js', () => mockBotService);

vi.mock('../lib/logger.js', () => ({
  logger: mockLogger,
}));

// ── Import the route module (after mocks) ──

import botsRoute from '../routes/bots.js';

// ── Helpers ──

function buildApp() {
  const a = new Hono();
  a.route('/api/bots', botsRoute);
  return a;
}

let app: Hono;

function req(method: string, path: string, body?: unknown, headers?: Record<string, string>) {
  const init: RequestInit = { method, headers: { ...headers } };
  if (body !== undefined) {
    (init.headers as Record<string, string>)['Content-Type'] = 'application/json';
    init.body = JSON.stringify(body);
  }
  return app.request(path, init);
}

function rawReq(method: string, path: string, rawBody: string, headers?: Record<string, string>) {
  return app.request(path, {
    method,
    headers: { 'Content-Type': 'application/json', ...headers },
    body: rawBody,
  });
}

// ── Tests ──

describe('Bot routes — /api/bots', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUser.current = { id: 'user-1', email: 'admin@test.com', role: 'admin' };
    mockBotService.auditBotAction.mockResolvedValue(undefined);
    app = buildApp();
  });

  // ═══════════════════════════════════════════════════════════════
  // 1. Auth — 401 when unauthenticated (all routes except webhook)
  // ═══════════════════════════════════════════════════════════════
  describe('Auth requirements', () => {
    it('should 401 on GET /api/bots when not authenticated', async () => {
      mockUser.current = null;
      expect((await req('GET', '/api/bots')).status).toBe(401);
    });

    it('should 401 on GET /api/bots/:id when not authenticated', async () => {
      mockUser.current = null;
      expect((await req('GET', '/api/bots/b1')).status).toBe(401);
    });

    it('should 401 on POST /api/bots when not authenticated', async () => {
      mockUser.current = null;
      expect((await req('POST', '/api/bots', { name: 'x' })).status).toBe(401);
    });

    it('should 401 on PATCH /api/bots/:id when not authenticated', async () => {
      mockUser.current = null;
      expect((await req('PATCH', '/api/bots/b1', { name: 'x' })).status).toBe(401);
    });

    it('should 401 on DELETE /api/bots/:id when not authenticated', async () => {
      mockUser.current = null;
      expect((await req('DELETE', '/api/bots/b1')).status).toBe(401);
    });

    it('should NOT require auth on POST /api/bots/:id/webhook', async () => {
      mockUser.current = null;
      const secret = 'wh-secret';
      mockBotManager.getWebhookSecret.mockReturnValue(secret);
      mockBotManager.executeBot.mockResolvedValue({ success: true });

      const body = JSON.stringify({ event: 'push' });
      const sig = createHmac('sha256', secret).update(body).digest('hex');
      const res = await rawReq('POST', '/api/bots/b1/webhook', body, {
        'X-Webhook-Signature': `sha256=${sig}`,
      });
      expect(res.status).toBe(200);
    });
  });

  // ═══════════════════════════════════════════════════════════════
  // 2. Role requirements
  // ═══════════════════════════════════════════════════════════════
  describe('Role requirements', () => {
    it('should 403 for viewer on POST /api/bots (admin-only)', async () => {
      mockUser.current = { id: 'u2', email: 'v@t.com', role: 'viewer' };
      expect((await req('POST', '/api/bots', { name: 'x' })).status).toBe(403);
    });

    it('should 403 for viewer on PATCH /api/bots/:id', async () => {
      mockUser.current = { id: 'u2', email: 'v@t.com', role: 'viewer' };
      expect((await req('PATCH', '/api/bots/b1', { name: 'x' })).status).toBe(403);
    });

    it('should 403 for viewer on POST /api/bots/:id/enable', async () => {
      mockUser.current = { id: 'u2', email: 'v@t.com', role: 'viewer' };
      expect((await req('POST', '/api/bots/b1/enable')).status).toBe(403);
    });

    it('should 403 for viewer on POST /api/bots/:id/disable', async () => {
      mockUser.current = { id: 'u2', email: 'v@t.com', role: 'viewer' };
      expect((await req('POST', '/api/bots/b1/disable')).status).toBe(403);
    });

    it('should 403 for viewer on POST /api/bots/:id/trigger', async () => {
      mockUser.current = { id: 'u2', email: 'v@t.com', role: 'viewer' };
      expect((await req('POST', '/api/bots/b1/trigger')).status).toBe(403);
    });

    it('should 403 for viewer on DELETE /api/bots/:id', async () => {
      mockUser.current = { id: 'u2', email: 'v@t.com', role: 'viewer' };
      expect((await req('DELETE', '/api/bots/b1')).status).toBe(403);
    });

    it('should 403 for analyst on POST /api/bots (admin-only create)', async () => {
      mockUser.current = { id: 'u3', email: 'a@t.com', role: 'analyst' };
      expect((await req('POST', '/api/bots', { name: 'x' })).status).toBe(403);
    });

    it('should allow analyst to GET /api/bots (list)', async () => {
      mockUser.current = { id: 'u3', email: 'a@t.com', role: 'analyst' };
      mockBotService.listBots.mockResolvedValue([]);
      expect((await req('GET', '/api/bots')).status).toBe(200);
    });

    it('should allow analyst to GET /api/bots/:id', async () => {
      mockUser.current = { id: 'u3', email: 'a@t.com', role: 'analyst' };
      mockBotService.getBot.mockResolvedValue({ id: 'b1', name: 'Bot' });
      expect((await req('GET', '/api/bots/b1')).status).toBe(200);
    });

    it('should allow analyst to GET /api/bots/:id/runs', async () => {
      mockUser.current = { id: 'u3', email: 'a@t.com', role: 'analyst' };
      mockBotService.getBotRuns.mockResolvedValue([]);
      expect((await req('GET', '/api/bots/b1/runs')).status).toBe(200);
    });
  });

  // ═══════════════════════════════════════════════════════════════
  // 3. List bots / get single bot
  // ═══════════════════════════════════════════════════════════════
  describe('GET /api/bots — list', () => {
    it('should return list of bots', async () => {
      const bots = [{ id: 'b1', name: 'Bot 1' }, { id: 'b2', name: 'Bot 2' }];
      mockBotService.listBots.mockResolvedValue(bots);
      const res = await req('GET', '/api/bots');
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ bots });
    });
  });

  describe('GET /api/bots/:id — get single', () => {
    it('should return a single bot', async () => {
      const bot = { id: 'b1', name: 'Bot 1' };
      mockBotService.getBot.mockResolvedValue(bot);
      const res = await req('GET', '/api/bots/b1');
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ bot });
    });

    it('should 404 when bot not found', async () => {
      mockBotService.getBot.mockResolvedValue(null);
      const res = await req('GET', '/api/bots/missing');
      expect(res.status).toBe(404);
    });
  });

  // ═══════════════════════════════════════════════════════════════
  // 4. Create bot
  // ═══════════════════════════════════════════════════════════════
  describe('POST /api/bots — create', () => {
    it('should create a bot and return 201', async () => {
      const bot = { id: 'b-new', name: 'New Bot', type: 'scheduled' };
      mockBotService.validateBotCreate.mockReturnValue(null); // no error
      mockBotService.createBot.mockResolvedValue(bot);
      const res = await req('POST', '/api/bots', { name: 'New Bot', type: 'scheduled' });
      expect(res.status).toBe(201);
      expect(await res.json()).toEqual({ bot });
      expect(mockBotService.auditBotAction).toHaveBeenCalledWith(
        'user-1', 'create', 'New Bot', expect.stringContaining('New Bot'), 'b-new',
      );
    });

    it('should 400 on invalid JSON body', async () => {
      const res = await rawReq('POST', '/api/bots', '{bad!!', {});
      expect(res.status).toBe(400);
      expect(await res.json()).toEqual({ error: 'Invalid JSON body' });
    });

    it('should 400 on validation error', async () => {
      mockBotService.validateBotCreate.mockReturnValue('name is required');
      const res = await req('POST', '/api/bots', {});
      expect(res.status).toBe(400);
      expect(await res.json()).toEqual({ error: 'name is required' });
    });
  });

  // ═══════════════════════════════════════════════════════════════
  // 5. Update bot
  // ═══════════════════════════════════════════════════════════════
  describe('PATCH /api/bots/:id — update', () => {
    it('should update and return ok', async () => {
      mockBotService.validateBotUpdate.mockReturnValue({ updates: { name: 'Updated' } });
      mockBotService.updateBot.mockResolvedValue({ id: 'b1', name: 'Updated' });
      const res = await req('PATCH', '/api/bots/b1', { name: 'Updated' });
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ bot: { id: 'b1', name: 'Updated' } });
    });

    it('should 404 when bot not found', async () => {
      mockBotService.validateBotUpdate.mockReturnValue({ updates: { name: 'x' } });
      mockBotService.updateBot.mockResolvedValue(null);
      const res = await req('PATCH', '/api/bots/missing', { name: 'x' });
      expect(res.status).toBe(404);
    });

    it('should 400 on validation error', async () => {
      mockBotService.validateBotUpdate.mockReturnValue({ error: 'invalid field' });
      const res = await req('PATCH', '/api/bots/b1', { bad: true });
      expect(res.status).toBe(400);
      expect(await res.json()).toEqual({ error: 'invalid field' });
    });

    it('should 400 on invalid JSON body', async () => {
      const res = await rawReq('PATCH', '/api/bots/b1', 'not json', {});
      expect(res.status).toBe(400);
      expect(await res.json()).toEqual({ error: 'Invalid JSON body' });
    });
  });

  // ═══════════════════════════════════════════════════════════════
  // 6. Enable / disable
  // ═══════════════════════════════════════════════════════════════
  describe('POST /api/bots/:id/enable', () => {
    it('should enable a bot', async () => {
      mockBotService.enableBot.mockResolvedValue({ id: 'b1', name: 'Bot 1' });
      const res = await req('POST', '/api/bots/b1/enable');
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ ok: true, enabled: true });
    });

    it('should 404 when bot not found', async () => {
      mockBotService.enableBot.mockResolvedValue(null);
      const res = await req('POST', '/api/bots/missing/enable');
      expect(res.status).toBe(404);
    });
  });

  describe('POST /api/bots/:id/disable', () => {
    it('should disable a bot', async () => {
      mockBotService.disableBot.mockResolvedValue({ id: 'b1', name: 'Bot 1' });
      const res = await req('POST', '/api/bots/b1/disable');
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ ok: true, enabled: false });
    });

    it('should 404 when bot not found', async () => {
      mockBotService.disableBot.mockResolvedValue(null);
      const res = await req('POST', '/api/bots/missing/disable');
      expect(res.status).toBe(404);
    });
  });

  // ═══════════════════════════════════════════════════════════════
  // 7. Manual trigger
  // ═══════════════════════════════════════════════════════════════
  describe('POST /api/bots/:id/trigger', () => {
    it('should trigger a bot successfully', async () => {
      mockBotService.triggerBot.mockResolvedValue({ name: 'Bot 1' });
      const res = await req('POST', '/api/bots/b1/trigger');
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ ok: true, message: 'Bot triggered' });
    });

    it('should 404 when bot not found', async () => {
      mockBotService.triggerBot.mockResolvedValue(null);
      const res = await req('POST', '/api/bots/missing/trigger');
      expect(res.status).toBe(404);
    });

    it('should 400 when trigger returns error', async () => {
      mockBotService.triggerBot.mockResolvedValue({ error: 'Bot is disabled' });
      const res = await req('POST', '/api/bots/b1/trigger');
      expect(res.status).toBe(400);
      expect(await res.json()).toEqual({ error: 'Bot is disabled' });
    });
  });

  // ═══════════════════════════════════════════════════════════════
  // 8. Webhook
  // ═══════════════════════════════════════════════════════════════
  describe('POST /api/bots/:id/webhook', () => {
    const secret = 'webhook-secret-abc';

    it('should authenticate via HMAC signature and return 200', async () => {
      mockBotManager.getWebhookSecret.mockReturnValue(secret);
      mockBotManager.executeBot.mockResolvedValue({ ok: true });

      const body = JSON.stringify({ event: 'push', ref: 'main' });
      const sig = createHmac('sha256', secret).update(body).digest('hex');
      const res = await rawReq('POST', '/api/bots/b1/webhook', body, {
        'X-Webhook-Signature': `sha256=${sig}`,
      });
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ ok: true, message: 'Webhook received' });
      expect(mockBotManager.executeBot).toHaveBeenCalledWith(
        'b1', 'webhook', undefined, { event: 'push', ref: 'main' },
      );
    });

    it('should authenticate via raw secret header and return 200', async () => {
      mockBotManager.getWebhookSecret.mockReturnValue(secret);
      mockBotManager.executeBot.mockResolvedValue({ ok: true });

      const body = JSON.stringify({ event: 'issue' });
      const res = await rawReq('POST', '/api/bots/b1/webhook', body, {
        'X-Webhook-Secret': secret,
      });
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ ok: true, message: 'Webhook received' });
    });

    it('should 401 with invalid HMAC signature', async () => {
      mockBotManager.getWebhookSecret.mockReturnValue(secret);

      const body = JSON.stringify({ event: 'push' });
      const res = await rawReq('POST', '/api/bots/b1/webhook', body, {
        'X-Webhook-Signature': 'sha256=0000000000000000000000000000000000000000000000000000000000000000',
      });
      expect(res.status).toBe(401);
    });

    it('should 401 with wrong raw secret', async () => {
      mockBotManager.getWebhookSecret.mockReturnValue(secret);

      const body = JSON.stringify({ event: 'push' });
      const res = await rawReq('POST', '/api/bots/b1/webhook', body, {
        'X-Webhook-Secret': 'wrong-secret-xxx',
      });
      expect(res.status).toBe(401);
    });

    it('should 401 when no auth headers provided at all', async () => {
      mockBotManager.getWebhookSecret.mockReturnValue(secret);

      const body = JSON.stringify({ event: 'push' });
      const res = await rawReq('POST', '/api/bots/b1/webhook', body, {});
      expect(res.status).toBe(401);
    });

    it('should 404 when bot has no webhook secret configured', async () => {
      mockBotManager.getWebhookSecret.mockReturnValue(null);

      const body = JSON.stringify({ event: 'push' });
      const res = await rawReq('POST', '/api/bots/b1/webhook', body, {
        'X-Webhook-Secret': 'anything',
      });
      expect(res.status).toBe(404);
    });
  });

  // ═══════════════════════════════════════════════════════════════
  // 9. Delete
  // ═══════════════════════════════════════════════════════════════
  describe('DELETE /api/bots/:id', () => {
    it('should delete a bot successfully', async () => {
      mockBotService.deleteBot.mockResolvedValue({ id: 'b1', name: 'Bot' });
      const res = await req('DELETE', '/api/bots/b1');
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ ok: true });
      expect(mockBotService.auditBotAction).toHaveBeenCalled();
    });

    it('should 404 when bot not found', async () => {
      mockBotService.deleteBot.mockResolvedValue(null);
      const res = await req('DELETE', '/api/bots/missing');
      expect(res.status).toBe(404);
    });
  });

  // ═══════════════════════════════════════════════════════════════
  // 10. Run history
  // ═══════════════════════════════════════════════════════════════
  describe('GET /api/bots/:id/runs — run history', () => {
    it('should return runs list', async () => {
      const runs = [
        { id: 'r1', botConfigId: 'b1', status: 'success' },
        { id: 'r2', botConfigId: 'b1', status: 'failed' },
      ];
      mockBotService.getBotRuns.mockResolvedValue(runs);
      const res = await req('GET', '/api/bots/b1/runs');
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ runs });
    });

    it('should pass parsed limit query param to service', async () => {
      mockBotService.getBotRuns.mockResolvedValue([]);
      await req('GET', '/api/bots/b1/runs?limit=10');
      expect(mockBotService.getBotRuns).toHaveBeenCalledWith('b1', 10);
    });

    it('should clamp limit to max 100', async () => {
      mockBotService.getBotRuns.mockResolvedValue([]);
      await req('GET', '/api/bots/b1/runs?limit=999');
      expect(mockBotService.getBotRuns).toHaveBeenCalledWith('b1', 100);
    });

    it('should default limit to 50 when not specified', async () => {
      mockBotService.getBotRuns.mockResolvedValue([]);
      await req('GET', '/api/bots/b1/runs');
      expect(mockBotService.getBotRuns).toHaveBeenCalledWith('b1', 50);
    });
  });

  describe('GET /api/bots/:id/runs/:runId — run detail', () => {
    it('should return a single run', async () => {
      const run = { id: 'r1', botConfigId: 'b1', status: 'success', output: {} };
      mockBotService.getBotRunDetail.mockResolvedValue(run);
      const res = await req('GET', '/api/bots/b1/runs/r1');
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ run });
    });

    it('should 404 when run not found', async () => {
      mockBotService.getBotRunDetail.mockResolvedValue(null);
      const res = await req('GET', '/api/bots/b1/runs/missing');
      expect(res.status).toBe(404);
    });

    it('should 404 when run belongs to a different bot', async () => {
      const run = { id: 'r1', botConfigId: 'other-bot', status: 'success' };
      mockBotService.getBotRunDetail.mockResolvedValue(run);
      const res = await req('GET', '/api/bots/b1/runs/r1');
      expect(res.status).toBe(404);
    });
  });
});
