import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Hono } from 'hono';
import { createHmac, timingSafeEqual } from 'node:crypto';

// ─── Constants ──────────────────────────────────────────────────────────────

const WEBHOOK_SECRET = 'test-webhook-secret-12345';
const BOT_ID = 'bot-test-123';
const UNKNOWN_BOT_ID = 'bot-nonexistent';

// ─── Mock bot manager ───────────────────────────────────────────────────────

const mockBotManager = {
  getWebhookSecret: vi.fn(),
  executeBot: vi.fn().mockResolvedValue(undefined),
};

const mockLogger = {
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
};

// ─── Build a minimal Hono app replicating the webhook route logic ───────────

function createWebhookApp() {
  const app = new Hono();

  app.post('/:id/webhook', async (c) => {
    const id = c.req.param('id');
    const webhookSecret = mockBotManager.getWebhookSecret(id);
    if (!webhookSecret) {
      return c.json({ error: 'Not found' }, 404);
    }

    const signatureHeader = c.req.header('X-Webhook-Signature') || '';
    const secretHeader = c.req.header('X-Webhook-Secret') || '';
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

    mockBotManager.executeBot(id, 'webhook', undefined, payload).catch((err: unknown) => {
      mockLogger.error('Webhook bot execution failed', { botId: id, error: String(err) });
    });
    return c.json({ ok: true, message: 'Webhook received' });
  });

  return app;
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function signPayload(secret: string, body: string): string {
  return 'sha256=' + createHmac('sha256', secret).update(body).digest('hex');
}

function webhookRequest(
  app: Hono,
  botId: string,
  body: string,
  headers: Record<string, string> = {},
) {
  return app.request(`/${botId}/webhook`, {
    method: 'POST',
    body,
    headers: {
      'Content-Type': 'application/json',
      ...headers,
    },
  });
}

// ─── Tests ──────────────────────────────────────────────────────────────────

describe('Webhook HMAC-SHA256 authentication', () => {
  let app: Hono;

  beforeEach(() => {
    vi.clearAllMocks();
    app = createWebhookApp();

    // Default: known bot returns its secret; unknown bot returns undefined
    mockBotManager.getWebhookSecret.mockImplementation((id: string) => {
      if (id === BOT_ID) return WEBHOOK_SECRET;
      return undefined;
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // HMAC-SHA256 signature auth (X-Webhook-Signature header)
  // ═══════════════════════════════════════════════════════════════════════════

  describe('HMAC-SHA256 signature auth', () => {
    it('accepts a valid HMAC-SHA256 signature', async () => {
      const body = JSON.stringify({ event: 'alert.created', id: '1' });
      const signature = signPayload(WEBHOOK_SECRET, body);

      const res = await webhookRequest(app, BOT_ID, body, {
        'X-Webhook-Signature': signature,
      });

      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json).toEqual({ ok: true, message: 'Webhook received' });
    });

    it('rejects an invalid HMAC-SHA256 signature (wrong hex)', async () => {
      const body = JSON.stringify({ event: 'alert.created' });
      // Construct a signature with correct length but wrong content
      const validSig = signPayload(WEBHOOK_SECRET, body);
      const corruptedHex = validSig.slice(0, -4) + 'dead';

      const res = await webhookRequest(app, BOT_ID, body, {
        'X-Webhook-Signature': corruptedHex,
      });

      expect(res.status).toBe(401);
      const json = await res.json();
      expect(json.error).toBe('Invalid webhook secret');
    });

    it('rejects an empty sha256= signature value', async () => {
      const body = JSON.stringify({ event: 'test' });

      const res = await webhookRequest(app, BOT_ID, body, {
        'X-Webhook-Signature': 'sha256=',
      });

      expect(res.status).toBe(401);
    });

    it('rejects a signature computed with the wrong key', async () => {
      const body = JSON.stringify({ event: 'test' });
      const wrongKeySignature = signPayload('completely-wrong-key', body);

      const res = await webhookRequest(app, BOT_ID, body, {
        'X-Webhook-Signature': wrongKeySignature,
      });

      expect(res.status).toBe(401);
    });

    it('rejects a signature computed over a different body', async () => {
      const body = JSON.stringify({ event: 'real-payload' });
      const tamperedBody = JSON.stringify({ event: 'tampered-payload' });
      const signature = signPayload(WEBHOOK_SECRET, tamperedBody);

      const res = await webhookRequest(app, BOT_ID, body, {
        'X-Webhook-Signature': signature,
      });

      expect(res.status).toBe(401);
    });

    it('rejects a truncated signature (wrong length)', async () => {
      const body = JSON.stringify({ event: 'test' });
      const validSig = signPayload(WEBHOOK_SECRET, body);
      const truncated = validSig.slice(0, 20); // sha256= + partial hex

      const res = await webhookRequest(app, BOT_ID, body, {
        'X-Webhook-Signature': truncated,
      });

      expect(res.status).toBe(401);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // Raw secret comparison auth (X-Webhook-Secret header)
  // ═══════════════════════════════════════════════════════════════════════════

  describe('Raw secret comparison auth', () => {
    it('accepts a valid raw secret', async () => {
      const body = JSON.stringify({ event: 'alert.created' });

      const res = await webhookRequest(app, BOT_ID, body, {
        'X-Webhook-Secret': WEBHOOK_SECRET,
      });

      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json).toEqual({ ok: true, message: 'Webhook received' });
    });

    it('rejects an incorrect raw secret', async () => {
      const body = JSON.stringify({ event: 'test' });

      const res = await webhookRequest(app, BOT_ID, body, {
        'X-Webhook-Secret': 'wrong-secret-value',
      });

      expect(res.status).toBe(401);
    });

    it('rejects a raw secret with wrong length (shorter)', async () => {
      const body = JSON.stringify({ event: 'test' });

      const res = await webhookRequest(app, BOT_ID, body, {
        'X-Webhook-Secret': 'short',
      });

      expect(res.status).toBe(401);
    });

    it('rejects a raw secret with wrong length (longer)', async () => {
      const body = JSON.stringify({ event: 'test' });

      const res = await webhookRequest(app, BOT_ID, body, {
        'X-Webhook-Secret': WEBHOOK_SECRET + '-extra-padding-data',
      });

      expect(res.status).toBe(401);
    });

    it('rejects a same-length but different raw secret', async () => {
      const body = JSON.stringify({ event: 'test' });
      // Same length as WEBHOOK_SECRET but different characters
      const sameLength = 'x'.repeat(WEBHOOK_SECRET.length);
      expect(sameLength.length).toBe(WEBHOOK_SECRET.length);

      const res = await webhookRequest(app, BOT_ID, body, {
        'X-Webhook-Secret': sameLength,
      });

      expect(res.status).toBe(401);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // Edge cases
  // ═══════════════════════════════════════════════════════════════════════════

  describe('Edge cases', () => {
    it('returns 401 when no auth headers are provided', async () => {
      const body = JSON.stringify({ event: 'test' });

      const res = await webhookRequest(app, BOT_ID, body);

      expect(res.status).toBe(401);
      const json = await res.json();
      expect(json.error).toBe('Invalid webhook secret');
    });

    it('returns 404 when the bot does not exist (no webhook secret)', async () => {
      const body = JSON.stringify({ event: 'test' });

      const res = await webhookRequest(app, UNKNOWN_BOT_ID, body, {
        'X-Webhook-Secret': WEBHOOK_SECRET,
      });

      expect(res.status).toBe(404);
      const json = await res.json();
      expect(json.error).toBe('Not found');
    });

    it('returns 400 for invalid JSON body with valid HMAC auth', async () => {
      const invalidJson = 'this is not valid JSON {{{';
      const signature = signPayload(WEBHOOK_SECRET, invalidJson);

      const res = await webhookRequest(app, BOT_ID, invalidJson, {
        'X-Webhook-Signature': signature,
      });

      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.error).toBe('Invalid JSON body');
    });

    it('returns 400 for invalid JSON body with valid raw secret auth', async () => {
      const invalidJson = '<<<not json>>>';

      const res = await webhookRequest(app, BOT_ID, invalidJson, {
        'X-Webhook-Secret': WEBHOOK_SECRET,
      });

      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.error).toBe('Invalid JSON body');
    });

    it('triggers bot execution on successful authentication', async () => {
      const payload = { event: 'alert.created', alertId: 'a-42' };
      const body = JSON.stringify(payload);
      const signature = signPayload(WEBHOOK_SECRET, body);

      const res = await webhookRequest(app, BOT_ID, body, {
        'X-Webhook-Signature': signature,
      });

      expect(res.status).toBe(200);
      expect(mockBotManager.executeBot).toHaveBeenCalledOnce();
      expect(mockBotManager.executeBot).toHaveBeenCalledWith(
        BOT_ID, 'webhook', undefined, payload,
      );
    });

    it('does not trigger bot execution on failed authentication', async () => {
      const body = JSON.stringify({ event: 'test' });

      const res = await webhookRequest(app, BOT_ID, body, {
        'X-Webhook-Secret': 'wrong',
      });

      expect(res.status).toBe(401);
      expect(mockBotManager.executeBot).not.toHaveBeenCalled();
    });

    it('prefers HMAC signature auth over raw secret when both headers present', async () => {
      const body = JSON.stringify({ event: 'test' });
      const signature = signPayload(WEBHOOK_SECRET, body);

      // Both headers present; valid HMAC should win
      const res = await webhookRequest(app, BOT_ID, body, {
        'X-Webhook-Signature': signature,
        'X-Webhook-Secret': 'wrong-secret',
      });

      expect(res.status).toBe(200);
    });

    it('falls through to raw secret when X-Webhook-Signature does not start with sha256=', async () => {
      const body = JSON.stringify({ event: 'test' });

      // Signature header present but not in sha256= format, so raw secret is checked
      const res = await webhookRequest(app, BOT_ID, body, {
        'X-Webhook-Signature': 'md5=abc123',
        'X-Webhook-Secret': WEBHOOK_SECRET,
      });

      expect(res.status).toBe(200);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // Auth priority and header combinations
  // ═══════════════════════════════════════════════════════════════════════════

  describe('Auth header priority', () => {
    it('rejects when HMAC signature is valid but for wrong bot (different secret)', async () => {
      const otherSecret = 'other-bot-secret-67890';
      const body = JSON.stringify({ event: 'test' });
      const signature = signPayload(otherSecret, body);

      const res = await webhookRequest(app, BOT_ID, body, {
        'X-Webhook-Signature': signature,
      });

      expect(res.status).toBe(401);
    });

    it('calls getWebhookSecret with the correct bot ID', async () => {
      const body = JSON.stringify({ event: 'test' });

      await webhookRequest(app, BOT_ID, body, {
        'X-Webhook-Secret': WEBHOOK_SECRET,
      });

      expect(mockBotManager.getWebhookSecret).toHaveBeenCalledWith(BOT_ID);
    });

    it('returns 404 before checking auth headers when bot has no secret', async () => {
      const body = JSON.stringify({ event: 'test' });
      const signature = signPayload('any-secret', body);

      const res = await webhookRequest(app, UNKNOWN_BOT_ID, body, {
        'X-Webhook-Signature': signature,
        'X-Webhook-Secret': 'any-secret',
      });

      expect(res.status).toBe(404);
      // executeBot should never be called
      expect(mockBotManager.executeBot).not.toHaveBeenCalled();
    });
  });
});
