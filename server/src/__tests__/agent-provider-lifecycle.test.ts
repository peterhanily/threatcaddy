import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import type { BotConfig, BotContext } from '../bots/types.js';

const mocks = vi.hoisted(() => ({ execute: vi.fn(), audit: vi.fn(), log: vi.fn() }));
vi.mock('../bots/bot-context.js', () => ({ BotExecutionContext: class {
  constructor(private ctx: BotContext) {}
  getConfig() { return this.ctx.botConfig.config; }
  get signal() { return this.ctx.signal; }
  checkAborted() { this.ctx.signal.throwIfAborted(); }
  audit = mocks.audit;
  addLogEntry = mocks.log;
} }));
vi.mock('../bots/bot-tools.js', () => ({
  getToolsForCapabilities: () => [{ name: 'read_summary', execute: mocks.execute }],
  toOpenAITools: () => [], toAnthropicTools: () => [],
}));
vi.mock('../lib/logger.js', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
import { AgentBot } from '../bots/implementations/agent-bot.js';

function fixture(provider = 'openai') {
  const controller = new AbortController();
  const config = { id: 'agent', name: 'Reader', type: 'ai-agent', description: '', capabilities: ['read_entities'],
    userId: 'bot-user', enabled: true, triggers: {}, allowedDomains: [], rateLimitPerHour: 10, rateLimitPerDay: 50,
    lastRunAt: null, lastError: null, runCount: 0, errorCount: 0, createdBy: 'admin', createdAt: new Date(), updatedAt: new Date(),
    scopeType: 'investigation', scopeFolderIds: ['case-one'], config: { llmProvider: provider, llmModel: 'fixture-model' } } satisfies BotConfig;
  const ctx = { botConfig: config, signal: controller.signal, log: [] } as unknown as BotContext;
  return { bot: new AgentBot(config), ctx, controller };
}
beforeEach(() => {
  vi.clearAllMocks();
  for (const name of ['OPENAI_API_KEY', 'ANTHROPIC_API_KEY', 'GEMINI_API_KEY', 'MISTRAL_API_KEY']) vi.stubEnv(name, 'synthetic-test-key');
  mocks.execute.mockResolvedValue({ summary: 'Ordinary investigation summary' });
  mocks.audit.mockResolvedValue(undefined);
});
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

describe('agent provider conversation and cancellation', () => {
  it('preserves validated Anthropic tool-call identities and results on the next turn', async () => {
    const content = [{ type: 'tool_use', id: 'call-one', name: 'read_summary', input: {} }];
    const fetch = vi.fn().mockResolvedValueOnce(Response.json({ content, stop_reason: 'tool_use' }))
      .mockResolvedValueOnce(Response.json({ content: [{ type: 'text', text: 'Complete.' }], stop_reason: 'end_turn' }));
    vi.stubGlobal('fetch', fetch);
    const { bot, ctx } = fixture('anthropic');
    await bot.onManual(ctx);
    const body = JSON.parse(fetch.mock.calls[1][1].body as string);
    expect(body.messages).toContainEqual({ role: 'assistant', content });
    expect(body.messages).toContainEqual({ role: 'user', content: [{
      type: 'tool_result', tool_use_id: 'call-one', content: JSON.stringify({ summary: 'Ordinary investigation summary' }),
    }] });
    expect(mocks.execute).toHaveBeenCalledTimes(1);
  });

  it.each([
    { type: 'tool_use', name: 'read_summary', input: {} },
    { type: 'tool_use', id: 'call-two', name: 'read_summary', input: [] },
    { type: 'tool_use', id: 'call-one', name: 'read_summary', input: {} },
  ])('rejects an incomplete Anthropic batch before any tool executes %#', async incomplete => {
    const fetch = vi.fn().mockResolvedValue(Response.json({
      content: [{ type: 'tool_use', id: 'call-one', name: 'read_summary', input: {} }, incomplete],
      stop_reason: 'tool_use',
    }));
    vi.stubGlobal('fetch', fetch);
    const { bot, ctx } = fixture('anthropic');
    await expect(bot.onManual(ctx)).rejects.toThrow('Malformed Anthropic response');
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(mocks.execute).not.toHaveBeenCalled();
  });

  it('preserves assistant tool-call records and matching results on the next OpenAI turn', async () => {
    const calls = [{ id: 'call-one', type: 'function', function: { name: 'read_summary', arguments: '{}' } }];
    const fetch = vi.fn().mockResolvedValueOnce(Response.json({ choices: [{ message: { role: 'assistant', content: 'I will read the summary.', tool_calls: calls }, finish_reason: 'tool_calls' }] }))
      .mockResolvedValueOnce(Response.json({ choices: [{ message: { role: 'assistant', content: 'Complete.' }, finish_reason: 'stop' }] }));
    vi.stubGlobal('fetch', fetch);
    const { bot, ctx } = fixture();
    await bot.onManual(ctx);
    const body = JSON.parse(fetch.mock.calls[1][1].body as string);
    expect(body.messages).toContainEqual({ role: 'assistant', content: 'I will read the summary.', tool_calls: calls });
    expect(body.messages).toContainEqual({ role: 'tool', content: JSON.stringify({ summary: 'Ordinary investigation summary' }), tool_call_id: 'call-one' });
    expect(mocks.execute).toHaveBeenCalledTimes(1);
  });

  it.each(['openai', 'anthropic', 'gemini', 'mistral'])('aborts an in-flight %s provider request when the bot stops', async provider => {
    const fetch = vi.fn().mockImplementation((_url, options: RequestInit) => new Promise((_resolve, reject) => {
      options.signal?.addEventListener('abort', () => reject(options.signal?.reason), { once: true });
    }));
    vi.stubGlobal('fetch', fetch);
    const { bot, ctx, controller } = fixture(provider);
    const work = bot.onManual(ctx);
    const stopped = expect(work).rejects.toThrow('Operator stopped the bot');
    await vi.waitFor(() => expect(fetch).toHaveBeenCalledTimes(1));
    controller.abort(new Error('Operator stopped the bot'));
    await stopped;
    expect(fetch.mock.calls[0][1].signal.aborted).toBe(true);
    expect(mocks.execute).not.toHaveBeenCalled();
  });

  it('does not turn cancellation during a tool into another billable provider turn', async () => {
    const calls = ['one', 'two'].map(id => ({ id, type: 'function', function: { name: 'read_summary', arguments: '{}' } }));
    const fetch = vi.fn().mockResolvedValue(Response.json({ choices: [{ message: { role: 'assistant', content: '', tool_calls: calls }, finish_reason: 'tool_calls' }] }));
    vi.stubGlobal('fetch', fetch);
    const { bot, ctx, controller } = fixture();
    mocks.execute.mockImplementationOnce(async () => {
      controller.abort(new Error('Operator stopped the bot'));
      throw controller.signal.reason;
    });
    await expect(bot.onManual(ctx)).rejects.toThrow('Operator stopped the bot');
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(mocks.execute).toHaveBeenCalledTimes(1);
  });
});
