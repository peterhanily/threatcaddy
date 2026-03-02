import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { generateChatTitle } from '../lib/chat-utils';

describe('generateChatTitle', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('posts TC_LLM_REQUEST with correct payload', async () => {
    const postMessageSpy = vi.spyOn(window, 'postMessage');

    const promise = generateChatTitle('Hello', 'Hi there', 'anthropic', 'claude-sonnet-4-6', 'sk-test');

    // Advance microtasks so postMessage fires
    await vi.advanceTimersByTimeAsync(0);

    expect(postMessageSpy).toHaveBeenCalled();
    const call = postMessageSpy.mock.calls[0];
    expect(call[0].type).toBe('TC_LLM_REQUEST');
    expect(call[0].payload.provider).toBe('anthropic');
    expect(call[0].payload.model).toBe('claude-sonnet-4-6');
    expect(call[0].payload.apiKey).toBe('sk-test');
    expect(call[0].payload.systemPrompt).toContain('title');

    // Let it time out
    await vi.advanceTimersByTimeAsync(6000);
    await promise;
  });

  it('resolves null on timeout', async () => {
    const promise = generateChatTitle('Hello', 'Hi there', 'anthropic', 'claude-sonnet-4-6', 'sk-test');
    await vi.advanceTimersByTimeAsync(6000);
    const result = await promise;
    expect(result).toBeNull();
  });

  it('resolves null on TC_LLM_ERROR', async () => {
    const postMessageSpy = vi.spyOn(window, 'postMessage');
    const promise = generateChatTitle('Hello', 'Hi there', 'anthropic', 'claude-sonnet-4-6', 'sk-test');

    await vi.advanceTimersByTimeAsync(0);

    // Extract requestId from posted message
    const requestId = postMessageSpy.mock.calls[0][0].requestId;

    // Simulate an error response
    const event = new MessageEvent('message', {
      data: { type: 'TC_LLM_ERROR', requestId, error: 'API error' },
      source: window,
    });
    window.dispatchEvent(event);

    const result = await promise;
    expect(result).toBeNull();
  });

  it('includes endpoint for local provider', async () => {
    const postMessageSpy = vi.spyOn(window, 'postMessage');

    const promise = generateChatTitle('Hello', 'Hi', 'local', 'llama3', 'key', 'http://localhost:11434/v1');

    await vi.advanceTimersByTimeAsync(0);

    const call = postMessageSpy.mock.calls[0];
    expect(call[0].payload.endpoint).toBe('http://localhost:11434/v1');

    await vi.advanceTimersByTimeAsync(6000);
    await promise;
  });

  it('truncates long messages in the prompt', async () => {
    const postMessageSpy = vi.spyOn(window, 'postMessage');
    const longMessage = 'A'.repeat(1000);

    const promise = generateChatTitle(longMessage, longMessage, 'anthropic', 'claude-sonnet-4-6', 'key');

    await vi.advanceTimersByTimeAsync(0);

    const call = postMessageSpy.mock.calls[0];
    const content = call[0].payload.messages[0].content;
    // Each part truncated to 300 chars
    expect(content.length).toBeLessThan(1000);

    await vi.advanceTimersByTimeAsync(6000);
    await promise;
  });

  it('resolves title from TC_LLM_DONE text block', async () => {
    const postMessageSpy = vi.spyOn(window, 'postMessage');
    const promise = generateChatTitle('Hello', 'Hi there', 'anthropic', 'claude-sonnet-4-6', 'sk-test');

    await vi.advanceTimersByTimeAsync(0);

    // Extract requestId
    const requestId = postMessageSpy.mock.calls[0][0].requestId;

    // Simulate a successful response
    const event = new MessageEvent('message', {
      data: {
        type: 'TC_LLM_DONE',
        requestId,
        contentBlocks: [{ type: 'text', text: 'Chat Summary Title' }],
      },
      source: window,
    });
    window.dispatchEvent(event);

    const result = await promise;
    expect(result).toBe('Chat Summary Title');
  });
});
