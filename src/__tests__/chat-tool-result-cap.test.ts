/**
 * F4 (AI-2): chat sends the model each tool result capped as agents cap it (50,000 characters; a cut
 * JSON result stays valid JSON), since it is resent on every later turn of the request, and keeps
 * the whole result in the conversation for its sources and previews.
 */
import { describe, expect, it, vi } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import { useLLM } from '../hooks/useLLM';

type Turn = { messages: Array<{ role: string; content: unknown }> };
type Callbacks = { onDone: (stopReason: string, contentBlocks: unknown[], usage?: unknown) => void };
const sent = vi.hoisted(() => [] as Array<{ request: { messages: Array<{ role: string; content: unknown }> }; callbacks: { onDone: (stopReason: string, contentBlocks: unknown[], usage?: unknown) => void } }>);
vi.mock('../lib/llm-router', async original => ({ ...await original<typeof import('../lib/llm-router')>(),
  sendDirectToLocal: vi.fn((request: Turn, callbacks: Callbacks) => { sent.push({ request, callbacks }); }) }));

const flush = () => new Promise(resolve => setTimeout(resolve, 0));

describe('chat tool results sent to the model', () => {
  it('are capped and valid, while the conversation keeps the whole result', async () => {
    const big = JSON.stringify({ count: 3000, results: Array.from({ length: 3000 }, (_, i) => ({ id: `n${i}`, title: `Note ${i} ${'x'.repeat(40)}` })) });
    expect(big.length).toBeGreaterThan(150_000);
    // jsdom's postMessage sets no source; deliver the hook's own messages as the browser does.
    const post = vi.spyOn(window, 'postMessage').mockImplementation(((data: unknown) => {
      window.dispatchEvent(new MessageEvent('message', { data, source: window, origin: window.location.origin }));
    }) as never);
    const { result } = renderHook(() => useLLM());
    const completed = vi.fn();
    let id = '';
    act(() => { id = result.current.sendAgentRequest({ provider: 'local', endpoint: 'http://127.0.0.1:9/v1', model: 'fixture', apiKey: '', messages: [{ role: 'user', content: 'Search' }] },
      async () => ({ result: big, isError: false }), completed); });
    expect(id).not.toBe('');
    await act(async () => { sent[0].callbacks.onDone('tool_use', [{ type: 'tool_use', id: 'big', name: 'search_all', input: {} }]); await flush(); });
    await waitFor(() => expect(sent).toHaveLength(2));
    const blocks = (sent[1].request.messages.at(-1)?.content ?? []) as Array<{ type: string; content?: string }>;
    const toolResult = blocks.find(block => block.type === 'tool_result');
    expect(toolResult?.content?.length).toBeLessThan(50_500);
    expect(JSON.parse(toolResult?.content ?? '')).toMatchObject({ truncated: true });
    await act(async () => { sent[1].callbacks.onDone('end_turn', []); await flush(); });
    await waitFor(() => expect(completed).toHaveBeenCalled());
    expect(completed).toHaveBeenCalledWith(expect.objectContaining({ toolCalls: [expect.objectContaining({ id: 'big', result: big })] }));
    post.mockRestore();
  });
});
