import { afterEach, describe, expect, it, vi } from 'vitest';
import { cancelServerRequests, fetchServerResponse } from '../lib/server-response';
const options = { current: () => true, maxBytes: 32, timeoutMs: 1000 };
afterEach(() => { cancelServerRequests(); vi.unstubAllGlobals(); vi.useRealTimers(); });

describe('server body lifecycle', () => {
  it('returns a complete bounded response unchanged', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{"value":"é"}', { headers: { 'Content-Type': 'application/json' } })));
    const response = await fetchServerResponse('https://fixture.invalid', {}, options);
    expect(await response.json()).toEqual({ value: 'é' });
  });
  it('counts bytes across chunks and cancels an oversized body', async () => {
    const cancelled = vi.fn();
    vi.stubGlobal('fetch', vi.fn(async () => new Response(new ReadableStream({ start(c) {
      c.enqueue(new TextEncoder().encode('é'.repeat(10)));
      c.enqueue(new TextEncoder().encode('é'.repeat(10)));
    }, cancel: cancelled }))));
    const response = await fetchServerResponse('https://fixture.invalid', {}, options);
    await expect(response.text()).rejects.toThrow('size limit');
    expect(cancelled).toHaveBeenCalled();
  });
  it('keeps its deadline active while the body is stalled after headers', async () => {
    vi.useFakeTimers();
    const cancelled = vi.fn();
    vi.stubGlobal('fetch', vi.fn(async () => new Response(new ReadableStream({ cancel: cancelled }))));
    const response = await fetchServerResponse('https://fixture.invalid', {}, options);
    const check = expect(response.text()).rejects.toThrow('deadline');
    await vi.advanceTimersByTimeAsync(1000);
    await check;
    expect(cancelled).toHaveBeenCalled();
  });
  it('connection replacement cancels a pending body before delivering stale content', async () => {
    const cancelled = vi.fn();
    vi.stubGlobal('fetch', vi.fn(async () => new Response(new ReadableStream({ cancel: cancelled }))));
    const response = await fetchServerResponse('https://fixture.invalid', {}, options);
    const check = expect(response.text()).rejects.toThrow('connection changed');
    cancelServerRequests(); await check;
    expect(cancelled).toHaveBeenCalled();
  });
  it('fencing at response headers also aborts and cancels the unread body', async () => {
    let current = true;
    const cancelled = vi.fn();
    let signal: AbortSignal;
    vi.stubGlobal('fetch', vi.fn(async (_url, init) => {
      signal = init.signal; current = false;
      return new Response(new ReadableStream({ cancel: cancelled }));
    }));
    await expect(fetchServerResponse('https://fixture.invalid', {}, { ...options, current: () => current })).rejects.toThrow('connection changed');
    expect(signal!.aborted).toBe(true);
    expect(cancelled).toHaveBeenCalled();
  });
  it('does not wait for a stuck cancellation promise when declared size exceeds the bound', async () => {
    const cancelled = vi.fn(() => new Promise<void>(() => {}));
    vi.stubGlobal('fetch', vi.fn(async () => new Response(new ReadableStream({ cancel: cancelled }), { headers: { 'Content-Length': '33' } })));
    await expect(fetchServerResponse('https://fixture.invalid', {}, options)).rejects.toThrow('size limit');
    expect(cancelled).toHaveBeenCalled();
  });
  it('caller abort reaches body reading after headers', async () => {
    const abort = new AbortController();
    const cancelled = vi.fn();
    vi.stubGlobal('fetch', vi.fn(async () => new Response(new ReadableStream({ cancel: cancelled }))));
    const response = await fetchServerResponse('https://fixture.invalid', { signal: abort.signal }, options);
    const check = expect(response.text()).rejects.toThrow(); abort.abort(); await check;
    expect(cancelled).toHaveBeenCalled();
  });
});
