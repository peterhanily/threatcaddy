import { describe, it, expect, vi, beforeEach, afterEach, type MockInstance } from 'vitest';
import { generateChatTitle } from '../lib/chat-utils';
import { answerBridgeCheck, publishBridgeCaps } from './helpers/paired-bridge';

describe('generateChatTitle', () => {
  // A paired 1.1.3+ bridge; the app sends titles to no other.
  let postMessageSpy: MockInstance<typeof window.postMessage>;
  beforeEach(() => {
    vi.useFakeTimers();
    publishBridgeCaps();
    postMessageSpy = vi.spyOn(window, 'postMessage').mockImplementation(message => { answerBridgeCheck(message); });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    delete document.documentElement.dataset.tcBridgeCaps;
  });

  /** The title request, once the bridge has answered as paired. */
  async function titleRequest() {
    // The ping, its answer and its end marker each take a message hop; fake timers delay a hop
    // scheduled during another by 1 ms.
    for (let hop = 0; hop < 5; hop++) {
      await vi.advanceTimersByTimeAsync(1);
      const call = postMessageSpy.mock.calls.find(([message]) => message?.type === 'TC_LLM_REQUEST');
      if (call) return call;
    }
    throw new Error('No title request was posted');
  }

  it('posts TC_LLM_REQUEST with correct payload', async () => {
    const promise = generateChatTitle('Hello', 'Hi there', 'anthropic', 'claude-sonnet-4-6', 'sk-test');

    const call = await titleRequest();
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
    const promise = generateChatTitle('Hello', 'Hi there', 'anthropic', 'claude-sonnet-4-6', 'sk-test');

    // Extract requestId from posted message
    const requestId = (await titleRequest())[0].requestId;

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
    const promise = generateChatTitle('Hello', 'Hi', 'local', 'llama3', 'key', 'http://localhost:11434/v1');

    const call = await titleRequest();
    expect(call[0].payload.endpoint).toBe('http://localhost:11434/v1');

    await vi.advanceTimersByTimeAsync(6000);
    await promise;
  });

  it('truncates long messages in the prompt', async () => {
    const longMessage = 'A'.repeat(1000);

    const promise = generateChatTitle(longMessage, longMessage, 'anthropic', 'claude-sonnet-4-6', 'key');

    const call = await titleRequest();
    const content = call[0].payload.messages[0].content;
    // Each part truncated to 300 chars
    expect(content.length).toBeLessThan(1000);

    await vi.advanceTimersByTimeAsync(6000);
    await promise;
  });

  it('resolves title from TC_LLM_DONE text block', async () => {
    const promise = generateChatTitle('Hello', 'Hi there', 'anthropic', 'claude-sonnet-4-6', 'sk-test');

    // Extract requestId
    const requestId = (await titleRequest())[0].requestId;

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
