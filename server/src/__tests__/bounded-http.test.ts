import { describe, expect, it, vi } from 'vitest';
import { readBoundedBytes, readProviderJSON } from '../lib/bounded-http.js';

describe('bounded HTTP bodies', () => {
  it('reads an ordinary provider response', async () => {
    expect(await readProviderJSON(Response.json({ summary: 'complete' }), new AbortController().signal, 'Fixture'))
      .toEqual({ summary: 'complete' });
  });

  it('cancels an unfinished body when the bot is stopped', async () => {
    const controller = new AbortController();
    const cancel = vi.fn();
    const body = new ReadableStream<Uint8Array>({ cancel });
    const work = readBoundedBytes(body, 1024, controller.signal);
    const stopped = expect(work).rejects.toThrow('Stopped');
    controller.abort(new Error('Stopped'));
    await stopped;
    expect(cancel).toHaveBeenCalledTimes(1);
  });

  it('limits a body by consumed bytes and cancels the remainder', async () => {
    const cancel = vi.fn();
    const body = new ReadableStream<Uint8Array>({ start(stream) { stream.enqueue(new Uint8Array(11)); }, cancel });
    await expect(readBoundedBytes(body, 10, new AbortController().signal)).rejects.toThrow('exceeds 10 bytes');
    expect(cancel).toHaveBeenCalledTimes(1);
  });
});
