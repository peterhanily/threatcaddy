import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Hono } from 'hono';

// --- Hoisted mock state ---

const { mockLlmService, mockAdminSecret } = vi.hoisted(() => {
  const mockLlmService = {
    getAvailableProviders: vi.fn(),
  };
  const mockAdminSecret = {
    getAiSettings: vi.fn(),
    setAiSettings: vi.fn(),
  };
  return { mockLlmService, mockAdminSecret };
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

vi.mock('../services/llm-service.js', () => mockLlmService);

vi.mock('../services/admin-secret.js', () => mockAdminSecret);

vi.mock('../services/admin-ai-service.js', () => ({
  getAnthropicTools: vi.fn(() => []),
  getOpenAITools: vi.fn(() => []),
  getGeminiTools: vi.fn(() => []),
  getToolByName: vi.fn(),
  ADMIN_AI_SYSTEM_PROMPT: 'You are an admin assistant.',
}));

vi.mock('../lib/logger.js', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

// --- Imports ---

import { signAdminToken } from '../middleware/admin-auth.js';
import aiRoutes from '../routes/admin/ai.js';

function createApp() {
  const app = new Hono();
  app.route('/admin', aiRoutes);
  return app;
}

describe('Admin AI Routes', () => {
  let app: Hono;
  let adminToken: string;

  beforeEach(async () => {
    vi.clearAllMocks();
    app = createApp();
    adminToken = await signAdminToken('admin-1', 'admin');

    // Default mock return values
    mockLlmService.getAvailableProviders.mockReturnValue([]);
    mockAdminSecret.getAiSettings.mockResolvedValue({});
    mockAdminSecret.setAiSettings.mockResolvedValue(undefined);
  });

  // ---- Auth required ----

  it('GET /admin/api/ai/providers returns 401 without auth', async () => {
    const res = await app.request('/admin/api/ai/providers');
    expect(res.status).toBe(401);
  });

  it('GET /admin/api/ai/settings returns 401 without auth', async () => {
    const res = await app.request('/admin/api/ai/settings');
    expect(res.status).toBe(401);
  });

  it('PATCH /admin/api/ai/settings returns 401 without auth', async () => {
    const res = await app.request('/admin/api/ai/settings', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(401);
  });

  it('POST /admin/api/ai/chat returns 401 without auth', async () => {
    const res = await app.request('/admin/api/ai/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ messages: [{ role: 'user', content: 'hi' }] }),
    });
    expect(res.status).toBe(401);
  });

  // ---- GET /api/ai/providers ----

  it('GET /admin/api/ai/providers returns configured providers', async () => {
    mockLlmService.getAvailableProviders.mockReturnValue([
      { provider: 'anthropic', models: ['claude-3-opus'] },
      { provider: 'openai', models: ['gpt-4'] },
    ]);
    mockAdminSecret.getAiSettings.mockResolvedValue({});

    const res = await app.request('/admin/api/ai/providers', {
      headers: { Authorization: `Bearer ${adminToken}` },
    });

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.providers).toHaveLength(2);
    expect(mockLlmService.getAvailableProviders).toHaveBeenCalled();
  });

  it('GET /admin/api/ai/providers includes local provider when endpoint is set', async () => {
    mockLlmService.getAvailableProviders.mockReturnValue([]);
    mockAdminSecret.getAiSettings.mockResolvedValue({ localEndpoint: 'http://localhost:11434' });

    const res = await app.request('/admin/api/ai/providers', {
      headers: { Authorization: `Bearer ${adminToken}` },
    });

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.providers).toHaveLength(1);
    expect(json.providers[0].provider).toBe('local');
  });

  // ---- GET /api/ai/settings ----

  it('GET /admin/api/ai/settings returns settings with masked API key', async () => {
    mockAdminSecret.getAiSettings.mockResolvedValue({
      localEndpoint: 'http://localhost:11434',
      localApiKey: 'sk-secret-key-12345',
      temperature: 0.7,
    });

    const res = await app.request('/admin/api/ai/settings', {
      headers: { Authorization: `Bearer ${adminToken}` },
    });

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.localApiKey).toBe('***configured***');
    expect(json.localApiKey).not.toBe('sk-secret-key-12345');
    expect(json.localEndpoint).toBe('http://localhost:11434');
  });

  it('GET /admin/api/ai/settings returns empty string for API key when none set', async () => {
    mockAdminSecret.getAiSettings.mockResolvedValue({
      temperature: 1.0,
    });

    const res = await app.request('/admin/api/ai/settings', {
      headers: { Authorization: `Bearer ${adminToken}` },
    });

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.localApiKey).toBe('');
  });

  // ---- PATCH /api/ai/settings ----

  it('PATCH /admin/api/ai/settings updates endpoint with valid http URL', async () => {
    const res = await app.request('/admin/api/ai/settings', {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${adminToken}`,
      },
      body: JSON.stringify({ localEndpoint: 'http://localhost:11434' }),
    });

    expect(res.status).toBe(200);
    expect(mockAdminSecret.setAiSettings).toHaveBeenCalled();
  });

  it('PATCH /admin/api/ai/settings updates endpoint with valid https URL', async () => {
    const res = await app.request('/admin/api/ai/settings', {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${adminToken}`,
      },
      body: JSON.stringify({ localEndpoint: 'https://api.example.com' }),
    });

    expect(res.status).toBe(200);
    expect(mockAdminSecret.setAiSettings).toHaveBeenCalled();
  });

  it('PATCH /admin/api/ai/settings rejects invalid endpoint URL scheme', async () => {
    const res = await app.request('/admin/api/ai/settings', {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${adminToken}`,
      },
      body: JSON.stringify({ localEndpoint: 'ftp://badscheme.com' }),
    });

    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toMatch(/http/i);
  });

  it('PATCH /admin/api/ai/settings updates temperature within valid range', async () => {
    const res = await app.request('/admin/api/ai/settings', {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${adminToken}`,
      },
      body: JSON.stringify({ temperature: 1.5 }),
    });

    expect(res.status).toBe(200);
    expect(mockAdminSecret.setAiSettings).toHaveBeenCalledWith(expect.objectContaining({ temperature: 1.5 }));
  });

  it('PATCH /admin/api/ai/settings rejects temperature above 2', async () => {
    const res = await app.request('/admin/api/ai/settings', {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${adminToken}`,
      },
      body: JSON.stringify({ temperature: 2.5 }),
    });

    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toMatch(/[Tt]emperature/);
  });

  it('PATCH /admin/api/ai/settings rejects temperature below 0', async () => {
    const res = await app.request('/admin/api/ai/settings', {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${adminToken}`,
      },
      body: JSON.stringify({ temperature: -0.5 }),
    });

    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toMatch(/[Tt]emperature/);
  });

  it('PATCH /admin/api/ai/settings skips masked API key (does not overwrite)', async () => {
    mockAdminSecret.getAiSettings.mockResolvedValue({ localApiKey: 'sk-real-key' });

    const res = await app.request('/admin/api/ai/settings', {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${adminToken}`,
      },
      body: JSON.stringify({ localApiKey: '***configured***' }),
    });

    expect(res.status).toBe(200);
    // The masked value should NOT be passed to setAiSettings
    const callArgs = mockAdminSecret.setAiSettings.mock.calls[0][0];
    expect(callArgs).not.toHaveProperty('localApiKey');
  });

  it('PATCH /admin/api/ai/settings updates custom system prompt', async () => {
    const res = await app.request('/admin/api/ai/settings', {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${adminToken}`,
      },
      body: JSON.stringify({ customSystemPrompt: 'You are a security analyst.' }),
    });

    expect(res.status).toBe(200);
    expect(mockAdminSecret.setAiSettings).toHaveBeenCalledWith(
      expect.objectContaining({ customSystemPrompt: 'You are a security analyst.' }),
    );
  });

  // ---- POST /api/ai/chat ----

  it('POST /admin/api/ai/chat returns 400 when messages are missing', async () => {
    const res = await app.request('/admin/api/ai/chat', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${adminToken}`,
      },
      body: JSON.stringify({}),
    });

    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toMatch(/[Mm]essages/);
  });

  it('POST /admin/api/ai/chat returns 400 when too many messages', async () => {
    const messages = Array.from({ length: 51 }, (_, i) => ({
      role: 'user',
      content: `Message ${i}`,
    }));

    const res = await app.request('/admin/api/ai/chat', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${adminToken}`,
      },
      body: JSON.stringify({ messages }),
    });

    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toMatch(/[Tt]oo many/);
  });

  it('POST /admin/api/ai/chat returns 503 when no providers are configured', async () => {
    mockLlmService.getAvailableProviders.mockReturnValue([]);
    mockAdminSecret.getAiSettings.mockResolvedValue({});

    const res = await app.request('/admin/api/ai/chat', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${adminToken}`,
      },
      body: JSON.stringify({ messages: [{ role: 'user', content: 'Hello' }] }),
    });

    expect(res.status).toBe(503);
    const json = await res.json();
    expect(json.error).toMatch(/provider/i);
  });
});
