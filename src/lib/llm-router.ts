/**
 * LLM request routing — routes requests to either the extension bridge or
 * the team server proxy based on the configured routing mode.
 */
import { nanoid } from 'nanoid';
import { postMessageOrigin } from './utils';
import { streamLLMChat } from './server-api';

export type LLMRoutingMode = 'extension' | 'server' | 'auto';

export interface LLMRouteRequest {
  provider: string;
  model: string;
  messages: unknown[];
  apiKey?: string;
  systemPrompt?: string;
  tools?: unknown[];
  endpoint?: string;
}

export interface LLMRouteCallbacks {
  onChunk: (content: string) => void;
  onDone: (stopReason: string, contentBlocks: unknown[], usage?: { input: number; output: number }) => void;
  onError: (error: string) => void;
}

/**
 * Determine the effective routing mode based on settings and availability.
 */
export function resolveRoutingMode(
  mode: LLMRoutingMode | undefined,
  extensionAvailable: boolean,
  serverConnected: boolean,
): 'extension' | 'server' {
  if (mode === 'server') return serverConnected ? 'server' : 'extension';
  if (mode === 'extension') return extensionAvailable ? 'extension' : 'server';
  // auto: prefer server when connected, fallback to extension
  if (serverConnected) return 'server';
  return 'extension';
}

/**
 * Send an LLM request via the extension bridge (postMessage protocol).
 */
export function sendViaExtension(
  request: LLMRouteRequest,
  callbacks: LLMRouteCallbacks,
  signal?: AbortSignal,
): string {
  const requestId = nanoid();

  function handler(event: MessageEvent) {
    if (event.source !== window || !event.data) return;
    if (event.data.requestId !== requestId) return;

    if (event.data.type === 'TC_LLM_CHUNK') {
      callbacks.onChunk(event.data.content);
    } else if (event.data.type === 'TC_LLM_DONE') {
      window.removeEventListener('message', handler);
      callbacks.onDone(
        event.data.stopReason || 'end_turn',
        event.data.contentBlocks || [],
        event.data.usage ? { input: event.data.usage.input || 0, output: event.data.usage.output || 0 } : undefined,
      );
    } else if (event.data.type === 'TC_LLM_ERROR') {
      window.removeEventListener('message', handler);
      callbacks.onError(event.data.error);
    }
  }

  window.addEventListener('message', handler);

  if (signal) {
    signal.addEventListener('abort', () => {
      window.removeEventListener('message', handler);
      window.postMessage({ type: 'TC_LLM_ABORT', requestId }, postMessageOrigin());
    }, { once: true });
  }

  window.postMessage({
    type: 'TC_LLM_REQUEST',
    requestId,
    payload: {
      provider: request.provider,
      model: request.model,
      messages: request.messages,
      apiKey: request.apiKey,
      systemPrompt: request.systemPrompt,
      tools: request.tools,
      endpoint: request.endpoint,
    },
  }, postMessageOrigin());

  return requestId;
}

/**
 * Send an LLM request via the team server proxy (SSE).
 * The server uses its own API keys, so the client doesn't send them.
 */
export function sendViaServer(
  request: LLMRouteRequest,
  callbacks: LLMRouteCallbacks,
  signal?: AbortSignal,
): string {
  const requestId = nanoid();

  // Accumulate text content to build contentBlocks on done
  let accumulatedText = '';

  streamLLMChat(
    {
      provider: request.provider,
      model: request.model,
      messages: request.messages as { role: string; content: string }[],
      systemPrompt: request.systemPrompt,
      tools: request.tools,
    },
    (text) => {
      accumulatedText += text;
      callbacks.onChunk(text);
    },
    (stopReason, contentBlocks, usage) => {
      // If server sends contentBlocks, use them; otherwise synthesize from accumulated text
      const blocks = contentBlocks && contentBlocks.length > 0
        ? contentBlocks
        : accumulatedText ? [{ type: 'text', text: accumulatedText }] : [];
      callbacks.onDone(stopReason, blocks, usage);
    },
    (error) => callbacks.onError(error),
    signal,
  );

  return requestId;
}
