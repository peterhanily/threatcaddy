import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Hono } from 'hono';

// HTTP handlers mock current identity lookup; real PostgreSQL account invalidation is covered by integration tests.
vi.mock('../services/admin-session-service.js', () => ({
  adminSessionVersion: () => '',
  revokeAdminSessions: vi.fn(),
  getActiveAdmin: vi.fn(async (id: string) => ({ id, username: 'testadmin', passwordHash: 'fixture-admin-hash' })),
}));


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
import { getToolByName } from '../services/admin-ai-service.js';
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
    adminToken = await signAdminToken('admin-1', 'admin', 'fixture-admin-hash');

    // Default mock return values
    mockLlmService.getAvailableProviders.mockReturnValue([]);
    mockAdminSecret.getAiSettings.mockResolvedValue({});
    mockAdminSecret.setAiSettings.mockResolvedValue(undefined);
    vi.mocked(getToolByName).mockReturnValue(undefined);
  });

  afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

  function configureProvider(provider: string) {
    mockLlmService.getAvailableProviders.mockReturnValue(provider === 'local' ? [] : [{ provider, models: ['fixture-model'] }]);
    mockAdminSecret.getAiSettings.mockResolvedValue({
      temperature: 0.7,
      ...(provider === 'local' ? { localEndpoint: 'http://127.0.0.1:12345/v1' } : {}),
    });
    if (provider !== 'local') vi.stubEnv(`${provider.toUpperCase()}_API_KEY`, 'synthetic-test-key');
  }

  function chatRequest(signal?: AbortSignal) {
    return new Request('http://localhost/admin/api/ai/chat', {
      method: 'POST', signal,
      headers: { Authorization: `Bearer ${adminToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ messages: [{ role: 'user', content: 'Read the ordinary summary.' }] }),
    });
  }

  it.each(['anthropic', 'openai', 'mistral', 'gemini', 'local'])('cancels a pending %s response body on request abort', async provider => {
    configureProvider(provider);
    const cancel = vi.fn();
    const upstream = new Response(new ReadableStream({ cancel }));
    const fetch = vi.fn().mockResolvedValue(upstream);
    vi.stubGlobal('fetch', fetch);
    const controller = new AbortController();
    const response = await app.request(chatRequest(controller.signal));
    const reading = response.text();
    await vi.waitFor(() => expect(upstream.body?.locked).toBe(true));
    controller.abort();
    await reading;
    expect(cancel).toHaveBeenCalledOnce();
    expect(fetch.mock.calls[0][1].signal.aborted).toBe(true);
    expect(getToolByName).not.toHaveBeenCalled();
  });

  it('cancels provider work when the SSE response consumer disconnects', async () => {
    configureProvider('anthropic');
    const cancel = vi.fn();
    const upstream = new Response(new ReadableStream({ cancel }));
    const fetch = vi.fn().mockResolvedValue(upstream);
    vi.stubGlobal('fetch', fetch);
    const response = await app.request(chatRequest());
    const reader = response.body!.getReader();
    await reader.read();
    await vi.waitFor(() => expect(upstream.body?.locked).toBe(true));
    await reader.cancel();
    await vi.waitFor(() => expect(cancel).toHaveBeenCalledOnce());
    expect(fetch.mock.calls[0][1].signal.aborted).toBe(true);
    expect(getToolByName).not.toHaveBeenCalled();
  });

  it('keeps the provider deadline active after headers until the body completes', async () => {
    vi.useFakeTimers();
    configureProvider('anthropic');
    const cancel = vi.fn();
    const upstream = new Response(new ReadableStream({ cancel }));
    const fetch = vi.fn().mockResolvedValue(upstream);
    vi.stubGlobal('fetch', fetch);
    const response = await app.request(chatRequest());
    const reading = response.text();
    await vi.waitFor(() => expect(upstream.body?.locked).toBe(true));
    await vi.advanceTimersByTimeAsync(60_000);
    expect(await reading).toContain('Admin AI provider deadline exceeded');
    expect(cancel).toHaveBeenCalledOnce();
    expect(fetch.mock.calls[0][1].signal.aborted).toBe(true);
    expect(getToolByName).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });

  it.each([200, 503])('bounds the entire provider body for HTTP %s before parsing or dispatch', async status => {
    configureProvider('anthropic');
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(new Uint8Array(2 * 1024 * 1024 + 1), { status })));
    const response = await app.request(chatRequest());
    expect(await response.text()).toContain('HTTP body exceeds');
    expect(getToolByName).not.toHaveBeenCalled();
  });

  it('does not dispatch another tool or write a result after cancellation during an existing tool', async () => {
    configureProvider('anthropic');
    const controller = new AbortController();
    const execute = vi.fn(async () => { controller.abort(); return { summary: 'Ordinary summary.' }; });
    vi.mocked(getToolByName).mockReturnValue({
      name: 'read_summary', description: 'Read a summary.', requiresConfirm: false, input_schema: { type: 'object' }, execute,
    });
    const fetch = vi.fn().mockResolvedValue(Response.json({
      content: ['one', 'two'].map(id => ({ type: 'tool_use', id, name: 'read_summary', input: {} })), stop_reason: 'tool_use',
    }));
    vi.stubGlobal('fetch', fetch);
    const response = await app.request(chatRequest(controller.signal));
    const text = await response.text();
    expect(execute).toHaveBeenCalledOnce();
    expect(getToolByName).toHaveBeenCalledOnce();
    expect(fetch).toHaveBeenCalledOnce();
    expect(text).not.toContain('"type":"tool_result"');
    expect(text).not.toContain('"type":"tool_error"');
  });

  it.each([
    { batches: [20], executed: 20 },
    { batches: [21], executed: 0 },
    { batches: [19, 2], executed: 19 },
  ])('enforces the remaining tool budget before dispatching a batch: $batches', async ({ batches, executed }) => {
    mockLlmService.getAvailableProviders.mockReturnValue([{ provider: 'anthropic', models: ['fixture-model'] }]);
    vi.stubEnv('ANTHROPIC_API_KEY', 'synthetic-test-key');
    const execute = vi.fn().mockResolvedValue({ summary: 'Ordinary summary.' });
    vi.mocked(getToolByName).mockReturnValue({
      name: 'read_summary', description: 'Read the ordinary summary.', input_schema: { type: 'object' },
      requiresConfirm: false, execute,
    });
    const fetch = vi.fn();
    for (const [batch, size] of batches.entries()) {
      fetch.mockResolvedValueOnce(Response.json({
        content: Array.from({ length: size }, (_, index) => ({
          type: 'tool_use', id: `call-${batch}-${index}`, name: 'read_summary', input: {},
        })), stop_reason: 'tool_use',
      }));
    }
    vi.stubGlobal('fetch', fetch);
    const res = await app.request('/admin/api/ai/chat', {
      method: 'POST',
      headers: { Authorization: `Bearer ${adminToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ messages: [{ role: 'user', content: 'Read the ordinary summaries.' }] }),
    });
    expect(res.status).toBe(200);
    expect(await res.text()).toContain('Tool call limit reached');
    expect(execute).toHaveBeenCalledTimes(executed);
    expect(getToolByName).toHaveBeenCalledTimes(executed);
    expect(fetch).toHaveBeenCalledTimes(batches.length);
  });

  it.each([
    { provider: 'anthropic', key: 'ANTHROPIC_API_KEY', response: {
      content: [
        { type: 'tool_use', id: 'call-one', name: 'read_summary', input: {} },
        { type: 'tool_use', name: 'read_summary', input: {} },
      ], stop_reason: 'tool_use',
    } },
    { provider: 'gemini', key: 'GEMINI_API_KEY', response: {
      candidates: [{ content: { parts: [
        { functionCall: { name: 'read_summary', args: {} } },
        { functionCall: { args: {} } },
      ] }, finishReason: 'STOP' }],
    } },
  ])('rejects an incomplete $provider batch before looking up any tool', async ({ provider, key, response }) => {
    mockLlmService.getAvailableProviders.mockReturnValue([{ provider, models: ['fixture-model'] }]);
    vi.stubEnv(key, 'synthetic-test-key');
    const fetch = vi.fn().mockResolvedValue(Response.json(response));
    vi.stubGlobal('fetch', fetch);
    const res = await app.request('/admin/api/ai/chat', {
      method: 'POST',
      headers: { Authorization: `Bearer ${adminToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ messages: [{ role: 'user', content: 'Read the ordinary summary.' }] }),
    });
    expect(res.status).toBe(200);
    const stream = await res.text();
    expect(stream).toContain('Malformed');
    expect(stream).toContain('"type":"error"');
    expect(stream).not.toContain('"type":"tool_call"');
    expect(getToolByName).not.toHaveBeenCalled();
    expect(fetch).toHaveBeenCalledTimes(1);
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
