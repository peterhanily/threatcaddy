import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Hono } from 'hono';
import { DrizzleQueryError } from 'drizzle-orm';

const { usageInsert, providerFetch } = vi.hoisted(() => ({
  usageInsert: vi.fn(async () => undefined),
  providerFetch: vi.fn(),
}));

vi.mock('../db/index.js', () => ({
  db: {
    select: () => ({ from: () => ({ where: async () => [] }) }),
    insert: () => ({ values: usageInsert }),
  },
}));
vi.mock('../middleware/auth.js', async () => {
  const { createMiddleware } = await import('hono/factory');
  return {
    requireAuth: createMiddleware(async (c, next) => { c.set('user', { id: 'user-1', role: 'analyst' }); await next(); }),
    requireRole: () => createMiddleware(async (_c, next) => { await next(); }),
  };
});
vi.mock('../lib/logger.js', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
vi.stubGlobal('fetch', providerFetch);

// The production route over the real Anthropic adapter; only the provider HTTP call is faked.
import llmRoutes from '../routes/llm.js';
import { logger } from '../lib/logger.js';

const app = new Hono();
app.route('/api/llm', llmRoutes);

function anthropicStream(inputTokens: unknown, outputTokens: unknown): Response {
  return new Response([
    { type: 'message_start', message: { usage: { input_tokens: inputTokens } } },
    { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } },
    { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'hello' } },
    { type: 'content_block_stop', index: 0 },
    { type: 'message_delta', delta: { stop_reason: 'end_turn' }, usage: { output_tokens: outputTokens } },
  ].map(event => `data: ${JSON.stringify(event)}\n`).join(''));
}

async function doneFrame(): Promise<Record<string, unknown>> {
  const response = await app.request('/api/llm/chat', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ provider: 'anthropic', model: 'claude-sonnet-4-6', messages: [{ role: 'user', content: 'hi' }] }),
  });
  const frames = (await response.text()).split('\n').filter(line => line.startsWith('data:')).map(line => JSON.parse(line.slice(5)));
  return frames.find(frame => frame.type === 'done');
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv('ANTHROPIC_API_KEY', 'fixture-key');
});
afterEach(() => vi.unstubAllEnvs());
afterAll(() => vi.unstubAllGlobals());

describe('LLM proxy done frame', () => {
  it('reports usage in the shape the client reads ({ input, output }) and records it server-side', async () => {
    providerFetch.mockResolvedValue(anthropicStream(12, 3));
    expect(await doneFrame()).toEqual({
      type: 'done', stopReason: 'end_turn', contentBlocks: [{ type: 'text', text: 'hello' }], usage: { input: 12, output: 3 },
    });
    expect(usageInsert).toHaveBeenCalledWith(expect.objectContaining({ inputTokens: 12, outputTokens: 3 }));
  });

  it('never reports a non-numeric token count', async () => {
    providerFetch.mockResolvedValue(anthropicStream(12, 'many'));
    expect((await doneFrame()).usage).toEqual({ input: 12, output: 0 });
    expect(usageInsert).toHaveBeenCalledWith(expect.objectContaining({ inputTokens: 12, outputTokens: 0 }));
  });

  it('sends null usage when the provider reported none', async () => {
    providerFetch.mockResolvedValue(anthropicStream(0, 0));
    expect((await doneFrame()).usage).toBeNull();
  });

  it('logs a failed usage insert without the query or its parameters', async () => {
    const cause = Object.assign(new Error('relation "llm_usage" does not exist'), { code: '42P01' });
    usageInsert.mockRejectedValueOnce(new DrizzleQueryError('insert into "llm_usage" values ($1, $2)', ['user-1', 'private-model-name'], cause));
    providerFetch.mockResolvedValue(anthropicStream(12, 3));
    await doneFrame();
    await vi.waitFor(() => expect(logger.error).toHaveBeenCalled());
    const [message, fields] = vi.mocked(logger.error).mock.calls[0];
    expect(message).toBe('Failed to log LLM usage');
    expect(fields).toMatchObject({ errorName: 'DrizzleQueryError', sqlState: '42P01', error: 'relation "llm_usage" does not exist' });
    expect(JSON.stringify(fields)).not.toMatch(/private-model-name|insert into/);
  });
});
