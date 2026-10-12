import { describe, expect, it, vi } from 'vitest';
import { readIntegrationResponse } from '../lib/integration-response';

describe('integration response limits', () => {
  it('decodes split UTF-8 chunks at the exact small byte limit', async () => {
    const bytes = new TextEncoder().encode('A€B');
    const response = new Response(new ReadableStream({ start(controller) {
      controller.enqueue(bytes.slice(0, 2)); controller.enqueue(bytes.slice(2)); controller.close();
    } }));
    expect(await readIntegrationResponse(response, new AbortController().signal, bytes.length)).toBe('A€B');
    expect(response.body?.locked).toBe(false);
  });
  it('rejects a declared oversized body without reading and cancels its source', async () => {
    const cancel = vi.fn();
    const response = new Response(new ReadableStream({ cancel }), { headers: { 'content-length': '9' } });
    await expect(readIntegrationResponse(response, new AbortController().signal, 8)).rejects.toThrow('size limit');
    expect(cancel).toHaveBeenCalledOnce();
    expect(response.body?.locked).toBe(false);
  });
  it('bounds bytes when content-length is absent', async () => {
    const cancel = vi.fn();
    const response = new Response(new ReadableStream({ start(controller) { controller.enqueue(new Uint8Array(9)); }, cancel }));
    await expect(readIntegrationResponse(response, new AbortController().signal, 8)).rejects.toThrow('size limit');
    expect(cancel).toHaveBeenCalledOnce();
  });
  it('settles a stalled reader on cancellation without waiting for its source', async () => {
    const cancel = vi.fn();
    const controller = new AbortController();
    const response = new Response(new ReadableStream({ cancel }));
    const pending = readIntegrationResponse(response, controller.signal, 8);
    controller.abort(new Error('Synthetic cancellation'));
    await expect(pending).rejects.toThrow('Synthetic cancellation');
    expect(cancel).toHaveBeenCalledOnce();
    expect(response.body?.locked).toBe(false);
  });
});
