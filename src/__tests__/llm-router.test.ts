import { afterEach, describe, expect, it, vi } from 'vitest';
import { sendDirectToLocal, toOpenAIMessages, type LLMRouteRequest } from '../lib/llm-router';

const request: LLMRouteRequest = { provider: 'local', model: 'fixture', endpoint: 'http://localhost:11434/v1', messages: [{ role: 'user', content: 'Summarize the note.' }] };
function response(chunks: string[]) {
  const encoder = new TextEncoder();
  return new Response(new ReadableStream({ start(controller) { for (const chunk of chunks) controller.enqueue(encoder.encode(chunk)); controller.close(); } }));
}
function send(chunks: string[]) {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response(chunks)));
  return new Promise<{ blocks?: unknown[]; error?: string; reason?: string; usage?: unknown }>(resolve => {
    sendDirectToLocal(request, { onChunk: () => {}, onDone: (reason, blocks, usage) => resolve({ reason, blocks, usage }), onError: error => resolve({ error }) });
  });
}
afterEach(() => { vi.unstubAllGlobals(); });

describe('local provider protocol', () => {
  it('serializes call/result IDs and images using the provider protocol', () => {
    const messages = toOpenAIMessages({ ...request, messages: [
      { role: 'assistant', content: [{ type: 'text', text: 'Reading.' }, { type: 'tool_use', id: 'call-a', name: 'read_note', input: { id: 'note-a' } }] },
      { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'call-a', content: 'Note content' }] },
      { role: 'user', content: [{ type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'YWJj' } }] },
    ] });
    expect(messages[0]).toMatchObject({ role: 'assistant', tool_calls: [{ id: 'call-a', type: 'function', function: { name: 'read_note', arguments: '{"id":"note-a"}' } }] });
    expect(messages[1]).toEqual({ role: 'tool', tool_call_id: 'call-a', content: 'Note content' });
    expect(messages[2].content).toEqual([{ type: 'image_url', image_url: { url: 'data:image/png;base64,YWJj' } }]);
  });

  it('decodes fragmented SSE with multiple tool calls, usage and a final line without newline', async () => {
    const data = [
      { choices: [{ delta: { tool_calls: [{ index: 0, id: 'a', function: { name: 'read_note', arguments: '{"id":' } }, { index: 1, id: 'b', function: { name: 'read_task', arguments: '{"id":"task"}' } }] } }] },
      { choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: '"note"}' } }] }, finish_reason: 'tool_calls' }], usage: { prompt_tokens: 12, completion_tokens: 6 } },
    ].map(row => `data:${JSON.stringify(row)}\r\n\r\n`).join('') + 'data: [DONE]';
    const chunks = data.match(/.{1,7}|\n/g)!;
    // Split by character count while preserving newline/CR content.
    const result = await send(Array.from({ length: Math.ceil(data.length / 7) }, (_, i) => data.slice(i * 7, i * 7 + 7)));
    expect(chunks.length).toBeGreaterThan(1);
    expect(result).toMatchObject({ reason: 'tool_use', blocks: [
      { type: 'tool_use', id: 'a', name: 'read_note', input: { id: 'note' } },
      { type: 'tool_use', id: 'b', name: 'read_task', input: { id: 'task' } },
    ], usage: { input: 12, output: 6 } });
  });

  it('never promotes text examples into executable tool calls', async () => {
    const text = '<tool_call>{"name":"read_note","arguments":{"id":"example"}}</tool_call>';
    const result = await send([`data: ${JSON.stringify({ choices: [{ delta: { content: text }, finish_reason: 'stop' }] })}\n\n`]);
    expect(result.blocks).toEqual([{ type: 'text', text }]);
    expect(result.reason).toBe('end_turn');
  });

  it.each([
    { choices: [{ delta: { content: 'Partial text' } }] },
    { choices: [{ delta: { tool_calls: [{ index: 0, id: 'call', function: { name: 'read_note', arguments: '{' } }] }, finish_reason: 'tool_calls' }] },
    { choices: [{ delta: { tool_calls: [{ index: 0, id: 'call', function: { name: 'read_note', arguments: '{}' } }] }, finish_reason: 'length' }] },
    { error: { message: 'Provider unavailable' } },
  ])('rejects incomplete/error responses without emitting a tool: %j', async row => {
    const result = await send([`data: ${JSON.stringify(row)}\n\n`]);
    expect(result.error).toBeTruthy();
    expect(result.blocks).toBeUndefined();
  });

  it('bounds incoming response bytes before parsing an oversized event', async () => {
    expect((await send(['data: ' + 'a'.repeat(2_000_001)])).error).toContain('size limit');
  });

  it('propagates cancellation to fetch and never delivers a late result', async () => {
    let capturedSignal: AbortSignal | undefined;
    vi.stubGlobal('fetch', vi.fn((_url, init: RequestInit) => {
      capturedSignal = init.signal as AbortSignal;
      return new Promise((_resolve, reject) => capturedSignal!.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError'))));
    }));
    const controller = new AbortController();
    const callbacks = { onChunk: vi.fn(), onDone: vi.fn(), onError: vi.fn() };
    sendDirectToLocal(request, callbacks, controller.signal);
    controller.abort();
    await Promise.resolve();
    expect(capturedSignal?.aborted).toBe(true);
    expect(callbacks.onDone).not.toHaveBeenCalled();
    expect(callbacks.onError).not.toHaveBeenCalled();
  });
});
