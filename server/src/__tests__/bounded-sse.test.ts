import { afterEach, describe, expect, it, vi } from 'vitest';
import { createBoundedSSE } from '../lib/bounded-sse.js';
import { withAbort } from '../lib/bounded-http.js';

afterEach(() => { vi.useRealTimers(); });
const signal = () => new AbortController().signal;

describe('bounded JSON event stream', () => {
  it('observes an already-started promise when the cancellation signal was already aborted', async () => {
    const controller = new AbortController(); controller.abort(new Error('Cancelled fixture'));
    const work = Promise.reject(new Error('Late fixture failure'));
    const consume = vi.spyOn(work, 'catch');
    await expect(withAbort(work, controller.signal)).rejects.toThrow('Cancelled fixture');
    expect(consume).toHaveBeenCalledOnce();
  });
  it('frames JSON safely and emits a single explicit terminal result', async () => {
    const response = createBoundedSSE(signal(), async ({ send }) => {
      await send({ type: 'text', text: 'Fictional\nsummary ☘' });
      await send({ type: 'done' });
    });
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(await response.text()).toBe('data: {"type":"text","text":"Fictional\\nsummary ☘"}\n\ndata: {"type":"done"}\n\n');
  });

  it('does not start work for an already cancelled request', async () => {
    const controller = new AbortController(); controller.abort();
    const run = vi.fn();
    expect(await createBoundedSSE(controller.signal, run).text()).toBe('');
    expect(run).not.toHaveBeenCalled();
  });

  it('awaits downstream consumption before continuing work', async () => {
    const continued = vi.fn();
    const response = createBoundedSSE(signal(), async ({ send }) => {
      await send({ type: 'provider', provider: 'fixture' });
      continued();
    });
    await Promise.resolve(); await Promise.resolve();
    expect(continued).not.toHaveBeenCalled();
    expect(await response.text()).toContain('"type":"done"');
    expect(continued).toHaveBeenCalledOnce();
  });

  it('aborts work and clears deadlines when the reader disconnects', async () => {
    vi.useFakeTimers();
    let producerSignal: AbortSignal | undefined;
    const response = createBoundedSSE(signal(), async ({ signal: runSignal, send }) => {
      producerSignal = runSignal;
      await send({ type: 'provider', provider: 'fixture' });
      await new Promise<void>(() => {});
    });
    const reader = response.body!.getReader();
    await reader.read(); await reader.cancel();
    await vi.advanceTimersByTimeAsync(0);
    expect(producerSignal?.aborted).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('bounds an unread backpressured response without continuing work', async () => {
    vi.useFakeTimers();
    const continued = vi.fn();
    const response = createBoundedSSE(signal(), async ({ send }) => {
      await send({ type: 'text', text: 'Fixture' }); continued();
    }, { writeDeadlineMs: 20 });
    await vi.advanceTimersByTimeAsync(20);
    expect(await response.text()).toBe('');
    expect(continued).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('bounds producer lifetime even if an inert read ignores cancellation', async () => {
    vi.useFakeTimers();
    let producerSignal: AbortSignal | undefined;
    const response = createBoundedSSE(signal(), async ({ signal: runSignal, send }) => {
      producerSignal = runSignal;
      await send({ type: 'provider' });
      await new Promise<void>(() => {});
    }, { deadlineMs: 30 });
    const read = response.text();
    await vi.advanceTimersByTimeAsync(30);
    expect(await read).toContain('"type":"provider"');
    expect(producerSignal?.aborted).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('reports one safe error without leaking thrown values', async () => {
    const error = new Error('Synthetic private detail');
    const reported = vi.fn();
    const response = createBoundedSSE(signal(), async () => { throw error; }, { onError: reported });
    expect(await response.text()).toBe('data: {"type":"error","error":"Admin AI request failed"}\n\n');
    expect(reported).toHaveBeenCalledWith(error);
  });

  it('does not append a second outcome after confirmation or an explicit error', async () => {
    const response = createBoundedSSE(signal(), async ({ send }) => {
      await send({ type: 'confirmation_required', approvalId: 'fictional' });
      throw new Error('Later handler bug');
    });
    expect(await response.text()).toBe('data: {"type":"confirmation_required","approvalId":"fictional"}\n\n');
  });

  it.each(['event', 'total'])('limits UTF-8 %s bytes and stops later work', async mode => {
    const continued = vi.fn();
    const response = createBoundedSSE(signal(), async ({ send }) => {
      await send({ type: 'text', text: '☘'.repeat(60) }); continued();
    }, mode === 'event' ? { maxEventBytes: 150 } : { maxOutputBytes: 150 });
    expect(await response.text()).toContain('"type":"error"');
    expect(continued).not.toHaveBeenCalled();
  });
});
