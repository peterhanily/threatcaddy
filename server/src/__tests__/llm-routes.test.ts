import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Hono } from 'hono';

// ─── Hoisted mock state ────────────────────────────────────────

const { mockStreamLLM, mockGetAvailableProviders, currentUser } = vi.hoisted(() => {
  const mockStreamLLM = vi.fn();
  const mockGetAvailableProviders = vi.fn();
  const currentUser = {
    role: 'admin' as string,
    authenticated: true,
  };
  return { mockStreamLLM, mockGetAvailableProviders, currentUser };
});

// ─── Mocks ─────────────────────────────────────────────────────

vi.mock('../services/llm-service.js', () => ({
  streamLLM: mockStreamLLM,
  getAvailableProviders: mockGetAvailableProviders,
}));

vi.mock('../lib/logger.js', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

vi.mock('../middleware/auth.js', () => {
  const { createMiddleware } = require('hono/factory');
  return {
    requireAuth: createMiddleware(async (c: any, next: any) => {
      if (!currentUser.authenticated) {
        return c.json({ error: 'Missing authorization header' }, 401);
      }
      c.set('user', { id: 'user-1', email: 'test@example.com', role: currentUser.role, displayName: 'Test' });
      return next();
    }),
    requireRole: (...roles: string[]) =>
      createMiddleware(async (c: any, next: any) => {
        const user = c.get('user');
        if (!roles.includes(user.role)) {
          return c.json({ error: 'Insufficient permissions' }, 403);
        }
        return next();
      }),
  };
});

// ─── Import under test ─────────────────────────────────────────

import llmRoutes from '../routes/llm.js';

// ─── Helpers ───────────────────────────────────────────────────

function buildApp() {
  const app = new Hono();
  app.route('/api/llm', llmRoutes);
  return app;
}

// ─── Tests ─────────────────────────────────────────────────────

let app: Hono;

beforeEach(() => {
  vi.clearAllMocks();
  currentUser.role = 'admin';
  currentUser.authenticated = true;
  app = buildApp();
});

// ═══════════════════════════════════════════════════════════════
// 1. Auth required
// ═══════════════════════════════════════════════════════════════

describe('Authentication', () => {
  it('POST /api/llm/chat returns 401 without auth', async () => {
    currentUser.authenticated = false;
    const res = await app.request('/api/llm/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ provider: 'openai', model: 'gpt-4', messages: [{ role: 'user', content: 'hi' }] }),
    });
    expect(res.status).toBe(401);
  });

  it('GET /api/llm/config returns 401 without auth', async () => {
    currentUser.authenticated = false;
    const res = await app.request('/api/llm/config');
    expect(res.status).toBe(401);
  });
});

// ═══════════════════════════════════════════════════════════════
// 2. Role-based access
// ═══════════════════════════════════════════════════════════════

describe('Role-based access', () => {
  it('denies viewer role from POST /api/llm/chat', async () => {
    currentUser.role = 'viewer';
    const res = await app.request('/api/llm/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ provider: 'openai', model: 'gpt-4', messages: [{ role: 'user', content: 'hi' }] }),
    });
    expect(res.status).toBe(403);
  });

  it('allows admin role to POST /api/llm/chat', async () => {
    currentUser.role = 'admin';
    mockStreamLLM.mockImplementation(async (_body: any, callbacks: any) => {
      callbacks.onChunk('Hello');
      callbacks.onDone('end_turn');
    });
    const res = await app.request('/api/llm/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ provider: 'openai', model: 'gpt-4', messages: [{ role: 'user', content: 'hi' }] }),
    });
    expect(res.status).toBe(200);
  });

  it('allows analyst role to POST /api/llm/chat', async () => {
    currentUser.role = 'analyst';
    mockStreamLLM.mockImplementation(async (_body: any, callbacks: any) => {
      callbacks.onChunk('Hello');
      callbacks.onDone('end_turn');
    });
    const res = await app.request('/api/llm/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ provider: 'openai', model: 'gpt-4', messages: [{ role: 'user', content: 'hi' }] }),
    });
    expect(res.status).toBe(200);
  });

  it('allows viewer role to GET /api/llm/config', async () => {
    currentUser.role = 'viewer';
    mockGetAvailableProviders.mockReturnValue([
      { provider: 'openai', models: ['gpt-4'] },
    ]);
    const res = await app.request('/api/llm/config');
    expect(res.status).toBe(200);
  });
});

// ═══════════════════════════════════════════════════════════════
// 3. POST /chat validation
// ═══════════════════════════════════════════════════════════════

describe('POST /api/llm/chat validation', () => {
  it('returns 400 when provider is missing', async () => {
    const res = await app.request('/api/llm/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: 'gpt-4', messages: [{ role: 'user', content: 'hi' }] }),
    });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toContain('provider');
  });

  it('returns 400 when model is missing', async () => {
    const res = await app.request('/api/llm/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ provider: 'openai', messages: [{ role: 'user', content: 'hi' }] }),
    });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toContain('model');
  });

  it('returns 400 when messages is missing', async () => {
    const res = await app.request('/api/llm/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ provider: 'openai', model: 'gpt-4' }),
    });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toContain('messages');
  });
});

// ═══════════════════════════════════════════════════════════════
// 4. SSE streaming
// ═══════════════════════════════════════════════════════════════

describe('POST /api/llm/chat SSE streaming', () => {
  it('streams SSE chunks from streamLLM', async () => {
    mockStreamLLM.mockImplementation(async (_body: any, callbacks: any) => {
      await callbacks.onChunk('Hello');
      await callbacks.onChunk(' world');
      await callbacks.onDone('end_turn');
    });

    const res = await app.request('/api/llm/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ provider: 'openai', model: 'gpt-4', messages: [{ role: 'user', content: 'hi' }] }),
    });

    expect(res.status).toBe(200);
    const text = await res.text();
    expect(text).toContain('Hello');
    expect(text).toContain(' world');
    expect(text).toContain('end_turn');
  });

  it('calls streamLLM with the correct body and callbacks', async () => {
    mockStreamLLM.mockImplementation(async (_body: any, callbacks: any) => {
      callbacks.onChunk('test');
      callbacks.onDone('end_turn');
    });

    const body = { provider: 'openai', model: 'gpt-4', messages: [{ role: 'user', content: 'hello' }] };

    await app.request('/api/llm/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

    expect(mockStreamLLM).toHaveBeenCalledTimes(1);
    const callArgs = mockStreamLLM.mock.calls[0];
    expect(callArgs[0]).toMatchObject({ provider: 'openai', model: 'gpt-4', messages: [{ role: 'user', content: 'hello' }] });
    expect(callArgs[1]).toHaveProperty('onChunk');
    expect(callArgs[1]).toHaveProperty('onDone');
    expect(callArgs[1]).toHaveProperty('onError');
  });
});

// ═══════════════════════════════════════════════════════════════
// 5. GET /config
// ═══════════════════════════════════════════════════════════════

describe('GET /api/llm/config', () => {
  it('returns available providers list', async () => {
    const providers = [
      { provider: 'openai', models: ['gpt-4', 'gpt-3.5-turbo'] },
      { provider: 'anthropic', models: ['claude-3-opus'] },
    ];
    mockGetAvailableProviders.mockReturnValue(providers);

    const res = await app.request('/api/llm/config');
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.providers).toEqual(providers);
  });
});
