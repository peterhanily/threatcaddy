import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getAllLoops, parseInterval, startLoop, stopLoop } from '../lib/chat-loop';
import { sendDirectToLocal, sendViaServer, type LLMRouteCallbacks } from '../lib/llm-router';
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
    startLoop({ ...opts, useServerProxy: true });
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

  it('bounds user supplied intervals', () => {
    expect(parseInterval('1s')).toBe(30_000);
    expect(parseInterval('9'.repeat(400) + 'h')).toBe(86_400_000);
    expect(parseInterval('invalid')).toBe(600_000);
  });
});
