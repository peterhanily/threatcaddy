import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { configureServerApi, streamLLMChat } from '../lib/server-api';

const mockFetch = vi.fn();

function sse(done: Record<string, unknown>): Response {
  return new Response(`data: ${JSON.stringify({ type: 'chunk', content: 'ok' })}\n\ndata: ${JSON.stringify({ type: 'done', stopReason: 'end_turn', ...done })}\n\n`, {
    status: 200, headers: { 'Content-Type': 'text/event-stream' },
  });
}

async function usageFor(done: Record<string, unknown>) {
  mockFetch.mockResolvedValueOnce(sse(done));
  const onDone = vi.fn();
  const onError = vi.fn();
  await streamLLMChat({ provider: 'anthropic', model: 'model', messages: [] }, () => {}, onDone, onError);
  expect(onError).not.toHaveBeenCalled();
  expect(onDone).toHaveBeenCalledOnce();
  return onDone.mock.calls[0][2];
}

describe('team-server LLM proxy usage', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', mockFetch);
    mockFetch.mockReset();
    configureServerApi('https://team.example', async () => 'token', () => {});
  });
  afterEach(() => { vi.unstubAllGlobals(); });

  it('accepts the server service shape {inputTokens, outputTokens}', async () => {
    expect(await usageFor({ usage: { inputTokens: 12, outputTokens: 34 } })).toEqual({ input: 12, output: 34 });
  });

  it('keeps the documented {input, output} shape', async () => {
    expect(await usageFor({ usage: { input: 5, output: 6 } })).toEqual({ input: 5, output: 6 });
  });

  it('never yields non-finite or negative counts', async () => {
    expect(await usageFor({ usage: { input: 'many', outputTokens: -3 } })).toEqual({ input: 0, output: 0 });
    expect(await usageFor({ usage: { input: null, output: 'NaN' } })).toEqual({ input: 0, output: 0 });
  });

  it('keeps usage absent when the server sends none', async () => {
    expect(await usageFor({})).toBeUndefined();
    expect(await usageFor({ usage: null })).toBeUndefined();
    expect(await usageFor({ usage: 'unknown' })).toBeUndefined();
  });
});
