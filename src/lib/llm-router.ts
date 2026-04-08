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
/**
 * Send an LLM request directly to a local endpoint (no extension needed).
 * Uses OpenAI-compatible /chat/completions format with SSE streaming.
 */
export function sendDirectToLocal(
  request: LLMRouteRequest,
  callbacks: LLMRouteCallbacks,
  signal?: AbortSignal,
): string {
  const requestId = nanoid();
  const rawEndpoint = (request.endpoint || 'http://localhost:11434/v1').replace(/\/+$/, '');
  // Validate endpoint is a safe http/https URL before using it
  let parsedEndpoint: URL;
  try {
    parsedEndpoint = new URL(rawEndpoint);
  } catch {
    callbacks.onError('Invalid local endpoint URL');
    return requestId;
  }
  if (parsedEndpoint.protocol !== 'http:' && parsedEndpoint.protocol !== 'https:') {
    callbacks.onError('Local endpoint must use http or https');
    return requestId;
  }
  const base = rawEndpoint;
  const url = `${base}/chat/completions`;

  // Build OpenAI-compatible messages
  const messages: { role: string; content: string }[] = [];
  if (request.systemPrompt) messages.push({ role: 'system', content: request.systemPrompt });
  for (const m of request.messages as { role: string; content: unknown }[]) {
    if (typeof m.content === 'string') messages.push({ role: m.role, content: m.content });
    else messages.push({ role: m.role, content: JSON.stringify(m.content) });
  }

  const body: Record<string, unknown> = { model: request.model, stream: true, messages };
  if (request.tools && (request.tools as unknown[]).length > 0) {
    body.tools = (request.tools as { name: string; description: string; input_schema: unknown }[]).map(t => ({
      type: 'function',
      function: { name: t.name, description: t.description, parameters: t.input_schema },
    }));
  }

  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (request.apiKey && request.apiKey !== 'local') headers['Authorization'] = `Bearer ${request.apiKey}`;

  (async () => {
    try {
      const resp = await fetch(url, { method: 'POST', headers, body: JSON.stringify(body), signal });
      if (!resp.ok) {
        callbacks.onError(`Local LLM ${resp.status}: ${await resp.text().catch(() => '')}`);
        return;
      }

      const reader = resp.body?.getReader();
      if (!reader) { callbacks.onError('No response body'); return; }

      const decoder = new TextDecoder();
      let buffer = '';
      let fullText = '';
      let stopReason: string | null = null;
      const toolCallAccum: Record<number, { id: string; name: string; arguments: string }> = {};

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          if (!line.startsWith('data: ')) continue;
          const data = line.slice(6).trim();
          if (data === '[DONE]') continue;
          try {
            const parsed = JSON.parse(data);
            const choice = parsed.choices?.[0];
            if (!choice) continue;

            // Stream text chunks
            const content = choice.delta?.content;
            if (content) { fullText += content; callbacks.onChunk(content); }

            // Accumulate tool_calls across deltas
            if (choice.delta?.tool_calls) {
              for (const tc of choice.delta.tool_calls) {
                const idx = tc.index ?? 0;
                if (!toolCallAccum[idx]) toolCallAccum[idx] = { id: '', name: '', arguments: '' };
                if (tc.id) toolCallAccum[idx].id = tc.id;
                if (tc.function?.name) toolCallAccum[idx].name = tc.function.name;
                if (tc.function?.arguments) toolCallAccum[idx].arguments += tc.function.arguments;
              }
            }

            if (choice.finish_reason) stopReason = choice.finish_reason;
          } catch { /* skip malformed SSE */ }
        }
      }

      // Build content blocks
      const contentBlocks: unknown[] = [];
      const toolEntries = Object.values(toolCallAccum);

      // Add tool_use blocks from structured tool_calls
      if (toolEntries.length > 0) {
        if (fullText) contentBlocks.push({ type: 'text', text: fullText });
        for (const tc of toolEntries) {
          let parsedArgs = {};
          try { parsedArgs = JSON.parse(tc.arguments); } catch { /* empty */ }
          contentBlocks.push({ type: 'tool_use', id: tc.id || `tc_${Date.now()}`, name: tc.name, input: parsedArgs });
        }
      } else if (fullText) {
        // Fallback: parse tool calls from text output (for models that don't support function calling)
        const toolNames = ((request.tools || []) as { name: string }[]).map(t => t.name);
        const textCalls = parseTextToolCalls(fullText, toolNames);
        if (textCalls.length > 0) {
          // Strip tool_call tags from displayed text
          const cleanText = fullText
            .replace(/<(?:tool_call|function_call)>\s*[\s\S]*?\s*<\/(?:tool_call|function_call)>/gi, '')
            .replace(/```json\s*\n?\s*\{\s*"name"\s*:\s*"[^"]+"\s*,\s*"arguments"\s*:[\s\S]*?\}\s*\n?\s*```/gi, '')
            .trim();
          if (cleanText) contentBlocks.push({ type: 'text', text: cleanText });
          for (const tc of textCalls) {
            contentBlocks.push(tc);
          }
          stopReason = 'tool_calls';
        } else {
          contentBlocks.push({ type: 'text', text: fullText });
        }
      }

      const normalizedStop = stopReason === 'tool_calls' ? 'tool_use'
        : stopReason === 'stop' ? 'end_turn'
        : stopReason || 'end_turn';

      callbacks.onDone(normalizedStop, contentBlocks);
    } catch (err) {
      if ((err as Error).name === 'AbortError') return;
      callbacks.onError((err as Error).message || 'Local LLM request failed');
    }
  })();

  return requestId;
}

/** Parse tool calls from text output for local LLMs that don't support structured function calling. */
function parseTextToolCalls(text: string, toolNames: string[]): { type: 'tool_use'; id: string; name: string; input: Record<string, unknown> }[] {
  const calls: { type: 'tool_use'; id: string; name: string; input: Record<string, unknown> }[] = [];
  const nameSet = new Set(toolNames);
  let idx = 0;

  // Pattern 1: <tool_call>JSON</tool_call>
  const tagPattern = /<(?:tool_call|function_call)>\s*([\s\S]*?)\s*<\/(?:tool_call|function_call)>/gi;
  let match;
  while ((match = tagPattern.exec(text)) !== null) {
    try {
      const obj = JSON.parse(match[1]);
      const name = obj.name || obj.function;
      const args = obj.arguments || obj.parameters || obj.input || {};
      if (name && nameSet.has(name)) {
        calls.push({ type: 'tool_use', id: `dtc_${Date.now()}_${idx++}`, name, input: typeof args === 'string' ? JSON.parse(args) : args });
      }
    } catch { /* skip */ }
  }
  if (calls.length > 0) return calls;

  // Pattern 2: ```json blocks
  const jsonPattern = /```(?:json)?\s*\n?([\s\S]*?)\n?```/gi;
  while ((match = jsonPattern.exec(text)) !== null) {
    try {
      const obj = JSON.parse(match[1]);
      const name = obj.name || obj.function;
      const args = obj.arguments || obj.parameters || obj.input || {};
      if (name && nameSet.has(name)) {
        calls.push({ type: 'tool_use', id: `dtc_${Date.now()}_${idx++}`, name, input: typeof args === 'string' ? JSON.parse(args) : args });
      }
    } catch { /* skip */ }
  }
  return calls;
}

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
