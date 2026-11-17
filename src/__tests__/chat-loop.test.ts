import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getAllLoops, parseInterval, startLoop, stopLoop, type LoopTransport } from '../lib/chat-loop';
import { sendDirectToLocal, sendViaExtension, sendViaServer, type LLMRouteCallbacks } from '../lib/llm-router';
vi.mock('../lib/llm-router', () => ({ sendDirectToLocal: vi.fn(), sendViaServer: vi.fn(), sendViaExtension: vi.fn() }));
const opts = { threadId: 'thread', prompt: 'Summarize', intervalMs: 30_000, model: 'fixture', provider: 'local' as const, apiKey: 'local', systemPrompt: '', endpoint: 'http://localhost:11434/v1', onMessage: vi.fn().mockResolvedValue(undefined) };
beforeEach(() => { vi.useFakeTimers(); vi.clearAllMocks(); });
afterEach(() => { for (const loop of getAllLoops()) stopLoop(loop.id); vi.useRealTimers(); });
const localCall = () => vi.mocked(sendDirectToLocal).mock.calls.at(-1)!;

describe('bounded serialized chat schedules', () => {
  it('uses the chosen route and never overlaps a slow request or persistence write', async () => {
    let saved!: () => void;
    startLoop({ ...opts, onMessage: () => new Promise<void>(resolve => { saved = resolve; }) });
    await vi.advanceTimersByTimeAsync(30_000);
    expect(sendDirectToLocal).toHaveBeenCalledTimes(1);
    localCall()[1].onDone('end_turn', [{ type: 'text', text: 'Summary' }]);
    await vi.advanceTimersByTimeAsync(40_000);
    expect(sendDirectToLocal).toHaveBeenCalledTimes(1);
    saved();
    await vi.advanceTimersByTimeAsync(30_000);
    expect(sendDirectToLocal).toHaveBeenCalledTimes(2);
  });

  it('routes server schedules through the server without requiring an extension', () => {
    startLoop({ ...opts, provider: 'anthropic', endpoint: undefined, useServerProxy: true });
    expect(sendViaServer).toHaveBeenCalledOnce();
    expect(sendDirectToLocal).not.toHaveBeenCalled();
  });

  it('aborts an in-flight request on stop and ignores late completion', async () => {
    const id = startLoop(opts);
    const [, callbacks, signal] = localCall();
    stopLoop(id);
    expect(signal?.aborted).toBe(true);
    callbacks.onDone('end_turn', [{ type: 'text', text: 'Late' }]);
    await vi.advanceTimersByTimeAsync(300_000);
    expect(opts.onMessage).not.toHaveBeenCalled();
    expect(sendDirectToLocal).toHaveBeenCalledTimes(1);
  });

  it('catches failed persistence, exposes the failure, and backs off', async () => {
    startLoop({ ...opts, onMessage: async () => { throw new Error('Storage full'); } });
    (localCall()[1] as LLMRouteCallbacks).onDone('end_turn', [{ type: 'text', text: 'Summary' }]);
    await vi.advanceTimersByTimeAsync(30_000);
    expect(getAllLoops()[0]).toMatchObject({ runCount: 0, error: 'Storage full' });
    expect(sendDirectToLocal).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(30_000);
    expect(sendDirectToLocal).toHaveBeenCalledTimes(2);
  });

  it('resolves its route before every run, and sends nothing while no route is available', async () => {
    const transport = vi.fn<() => Promise<LoopTransport>>()
      .mockResolvedValueOnce({ useServerProxy: false, apiKey: 'synthetic-key' })
      .mockResolvedValueOnce({ error: 'No AI route is available.' })
      .mockResolvedValueOnce({ useServerProxy: true, apiKey: 'server-proxy' });
    startLoop({ ...opts, provider: 'anthropic', apiKey: 'synthetic-key', endpoint: undefined, transport });
    await vi.advanceTimersByTimeAsync(0);
    expect(sendViaExtension).toHaveBeenCalledOnce();
    expect(vi.mocked(sendViaExtension).mock.calls[0][0]).toMatchObject({ apiKey: 'synthetic-key' });
    (vi.mocked(sendViaExtension).mock.calls[0][1] as LLMRouteCallbacks).onDone('end_turn', [{ type: 'text', text: 'First' }]);
    await vi.advanceTimersByTimeAsync(30_000);
    expect(getAllLoops()[0]).toMatchObject({ runCount: 1, error: 'No AI route is available.' });
    expect(sendViaExtension).toHaveBeenCalledOnce();
    expect(sendViaServer).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(transport).toHaveBeenCalledTimes(3);
    expect(sendViaServer).toHaveBeenCalledOnce();
    expect(sendViaExtension).toHaveBeenCalledOnce();
  });

  it('a run with no route does not back off: the next run is one interval later, so it resumes once a route returns', async () => {
    const hourly = 3_600_000;
    const transport = vi.fn<() => Promise<LoopTransport>>().mockResolvedValue({ error: 'No AI route is available.' });
    startLoop({ ...opts, provider: 'anthropic', apiKey: 'synthetic-key', endpoint: undefined, intervalMs: hourly, transport });
    await vi.advanceTimersByTimeAsync(4 * hourly);
    expect(transport).toHaveBeenCalledTimes(5);
    expect(getAllLoops()[0]).toMatchObject({ runCount: 0, error: 'No AI route is available.' });
    transport.mockResolvedValue({ useServerProxy: false, apiKey: 'synthetic-key' });
    await vi.advanceTimersByTimeAsync(hourly);
    expect(sendViaExtension).toHaveBeenCalledOnce();
  });

  it('a run with no route clears the backoff of an earlier failed model request', async () => {
    const transport = vi.fn<() => Promise<LoopTransport>>()
      .mockResolvedValueOnce({ useServerProxy: false, apiKey: 'local', endpoint: opts.endpoint })
      .mockResolvedValueOnce({ error: 'No AI route is available.' })
      .mockResolvedValue({ useServerProxy: false, apiKey: 'local', endpoint: opts.endpoint });
    startLoop({ ...opts, transport });
    await vi.advanceTimersByTimeAsync(0);
    localCall()[1].onError('Provider unavailable');
    await vi.advanceTimersByTimeAsync(30_000);
    expect(transport).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(30_000);
    expect(transport).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(30_000);
    expect(transport).toHaveBeenCalledTimes(3);
    expect(sendDirectToLocal).toHaveBeenCalledTimes(2);
  });

  it('a run with a failed model request still backs off', async () => {
    startLoop(opts);
    localCall()[1].onError('Provider unavailable');
    await vi.advanceTimersByTimeAsync(30_000);
    expect(sendDirectToLocal).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(30_000);
    expect(sendDirectToLocal).toHaveBeenCalledTimes(2);
  });

  it('each run uses the local endpoint resolved for it, not the one the loop started with', async () => {
    const moved = 'http://localhost:11435/v1';
    const transport = vi.fn<() => Promise<LoopTransport>>()
      .mockResolvedValueOnce({ useServerProxy: false, apiKey: 'local', endpoint: opts.endpoint })
      .mockResolvedValueOnce({ useServerProxy: false, apiKey: 'local', endpoint: moved });
    startLoop({ ...opts, transport });
    await vi.advanceTimersByTimeAsync(0);
    expect(localCall()[0]).toMatchObject({ endpoint: opts.endpoint });
    localCall()[1].onDone('end_turn', [{ type: 'text', text: 'First' }]);
    await vi.advanceTimersByTimeAsync(30_000);
    expect(sendDirectToLocal).toHaveBeenCalledTimes(2);
    expect(localCall()[0]).toMatchObject({ endpoint: moved });
  });

  it('a loop stopped while its route resolves sends nothing', async () => {
    let resolve!: (transport: LoopTransport) => void;
    const id = startLoop({ ...opts, transport: () => new Promise(done => { resolve = done; }) });
    stopLoop(id);
    resolve({ useServerProxy: false, apiKey: 'local', endpoint: opts.endpoint });
    await vi.advanceTimersByTimeAsync(300_000);
    expect(sendDirectToLocal).not.toHaveBeenCalled();
    expect(getAllLoops()).toEqual([]);
  });

  it('bounds user supplied intervals', () => {
    expect(parseInterval('1s')).toBe(30_000);
    expect(parseInterval('9'.repeat(400) + 'h')).toBe(86_400_000);
    expect(parseInterval('invalid')).toBe(600_000);
  });
});
