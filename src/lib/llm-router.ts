/** Provider routing shares correlation, cancellation and bounded response rules. */
import { nanoid } from 'nanoid';
import { postMessageOrigin } from './utils';
import { streamLLMChat } from './server-api';
import { assertConfiguredConnection } from './connection-policy';
import { cancellableRequest } from './request-cancellation';

export type LLMRoutingMode = 'extension' | 'server' | 'auto';
export interface LLMRouteRequest {
  provider: string; model: string; messages: unknown[]; apiKey?: string;
  systemPrompt?: string; tools?: unknown[]; endpoint?: string;
}
export interface LLMRouteCallbacks {
  onChunk: (content: string) => void;
  onDone: (stopReason: string, contentBlocks: unknown[], usage?: { input: number; output: number }) => void;
  onError: (error: string) => void;
}
const MAX_RESPONSE_BYTES = 2_000_000;
const MAX_TOOL_ARGUMENTS = 200_000;

/** Preserve structured calls/results and their IDs instead of stringifying the
 * internal transcript into user prose. Text that resembles a tool is just text. */
export function toOpenAIMessages(request: LLMRouteRequest): Record<string, unknown>[] {
  const messages: Record<string, unknown>[] = [];
  if (request.systemPrompt) messages.push({ role: 'system', content: request.systemPrompt });
  for (const message of request.messages as { role: string; content: unknown }[]) {
    if (typeof message.content === 'string') { messages.push({ role: message.role, content: message.content }); continue; }
    if (!Array.isArray(message.content)) throw new Error('Unsupported message content.');
    const content: Record<string, unknown>[] = [];
    const calls: Record<string, unknown>[] = [];
    const results: Record<string, unknown>[] = [];
    for (const block of message.content) {
      if (block.type === 'text') content.push({ type: 'text', text: block.text });
      else if (block.type === 'image' && block.source?.type === 'base64') {
        content.push({ type: 'image_url', image_url: { url: `data:${block.source.media_type};base64,${block.source.data}` } });
      } else if (block.type === 'tool_use') {
        if (message.role !== 'assistant' || !block.id || !block.name) throw new Error('Invalid assistant tool call.');
        calls.push({ id: block.id, type: 'function', function: { name: block.name, arguments: JSON.stringify(block.input) } });
      } else if (block.type === 'tool_result') {
        if (!block.tool_use_id) throw new Error('Tool result has no call ID.');
        results.push({ role: 'tool', tool_call_id: block.tool_use_id, content: typeof block.content === 'string' ? block.content : JSON.stringify(block.content) });
      } else throw new Error('Unsupported message content block.');
    }
    if (content.length || calls.length) messages.push({ role: message.role, content: content.length ? content : null, ...(calls.length ? { tool_calls: calls } : {}) });
    messages.push(...results);
  }
  return messages;
}

export function sendDirectToLocal(request: LLMRouteRequest, callbacks: LLMRouteCallbacks, signal?: AbortSignal): string {
  const requestId = nanoid();
  const lifecycle = cancellableRequest(signal);
  void (async () => {
    let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
    try {
      if (lifecycle.signal.aborted) return;
      const endpoint = new URL((request.endpoint || 'http://localhost:11434/v1').replace(/\/+$/, '') + '/chat/completions');
      if (!['http:', 'https:'].includes(endpoint.protocol)) throw new Error('Local endpoint must use http or https');
      assertConfiguredConnection(endpoint.href);
      const body: Record<string, unknown> = { model: request.model, stream: true, messages: toOpenAIMessages(request) };
      if (request.tools?.length) body.tools = (request.tools as { name: string; description: string; input_schema: unknown }[]).map(tool => ({ type: 'function', function: { name: tool.name, description: tool.description, parameters: tool.input_schema } }));
      const headers: Record<string, string> = { 'Content-Type': 'application/json' };
      if (request.apiKey && request.apiKey !== 'local') headers.Authorization = `Bearer ${request.apiKey}`;
      const response = await fetch(endpoint.href, { method: 'POST', headers, body: JSON.stringify(body), signal: lifecycle.signal });
      if (!response.ok) throw new Error(`Local LLM returned HTTP ${response.status}.`);
      reader = response.body?.getReader();
      if (!reader) throw new Error('No response body');
      const decoder = new TextDecoder();
      let buffer = '', fullText = '', stopReason = '';
      let bytes = 0;
      let ended = false;
      let usage: { input: number; output: number } | undefined;
      const calls = new Map<number, { id: string; name: string; arguments: string }>();
      const processEvent = (event: string) => {
        const data = event.split('\n').filter(line => line.startsWith('data:')).map(line => line.slice(5).trimStart()).join('\n').trim();
        if (!data) return;
        if (data === '[DONE]') { ended = true; return; }
        const parsed = JSON.parse(data);
        if (parsed.error) throw new Error(typeof parsed.error.message === 'string' ? parsed.error.message : 'Provider returned an error.');
        if (parsed.usage) usage = { input: parsed.usage.prompt_tokens ?? 0, output: parsed.usage.completion_tokens ?? 0 };
        const choice = parsed.choices?.[0];
        if (!choice) return;
        if (typeof choice.delta?.content === 'string') { fullText += choice.delta.content; callbacks.onChunk(choice.delta.content); }
        for (const item of choice.delta?.tool_calls ?? []) {
          if (!Number.isInteger(item.index) || item.index < 0 || item.index >= 64) throw new Error('Invalid tool call index.');
          const call = calls.get(item.index) ?? { id: '', name: '', arguments: '' };
          if (item.id) { if (call.id && call.id !== item.id) throw new Error('Tool call identity changed.'); call.id = item.id; }
          if (item.function?.name) call.name += item.function.name;
          if (item.function?.arguments) call.arguments += item.function.arguments;
          if (call.arguments.length > MAX_TOOL_ARGUMENTS) throw new Error('Tool arguments exceeded the response limit.');
          calls.set(item.index, call);
        }
        if (choice.finish_reason) stopReason = choice.finish_reason;
      };
      while (!ended) {
        const chunk = await reader.read();
        if (lifecycle.signal.aborted) return;
        if (chunk.done) { buffer += decoder.decode(); break; }
        bytes += chunk.value.byteLength;
        if (bytes > MAX_RESPONSE_BYTES) throw new Error('Local LLM response exceeded the size limit.');
        buffer += decoder.decode(chunk.value, { stream: true });
        buffer = buffer.replace(/\r\n/g, '\n');
        let boundary: number;
        while ((boundary = buffer.indexOf('\n\n')) >= 0) {
          processEvent(buffer.slice(0, boundary));
          buffer = buffer.slice(boundary + 2);
          if (ended) break;
        }
      }
      if (!ended && buffer.trim()) processEvent(buffer);
      if (!stopReason) throw new Error('Local LLM stream ended before a completion marker.');
      const blocks: unknown[] = fullText ? [{ type: 'text', text: fullText }] : [];
      if (calls.size) {
        if (stopReason !== 'tool_calls') throw new Error('Tool call stream was incomplete; no tools were executed.');
        const ids = new Set<string>();
        for (const [, call] of [...calls].sort(([a], [b]) => a - b)) {
          const input = JSON.parse(call.arguments);
          if (!call.id || ids.has(call.id) || !call.name || !input || typeof input !== 'object' || Array.isArray(input)) throw new Error('Incomplete or invalid tool call.');
          ids.add(call.id);
          blocks.push({ type: 'tool_use', id: call.id, name: call.name, input });
        }
      }
      if (!lifecycle.signal.aborted) callbacks.onDone(stopReason === 'tool_calls' ? 'tool_use' : stopReason === 'stop' ? 'end_turn' : stopReason, blocks, usage);
    } catch (error) {
      if (!lifecycle.signal.aborted) callbacks.onError(error instanceof Error ? error.message : 'Local LLM request failed');
    } finally {
      await reader?.cancel().catch(() => {});
      lifecycle.dispose();
    }
  })();
  return requestId;
}

export function resolveRoutingMode(mode: LLMRoutingMode | undefined, extensionAvailable: boolean, serverConnected: boolean): 'extension' | 'server' {
  if (mode === 'server') return serverConnected ? 'server' : 'extension';
  if (mode === 'extension') return extensionAvailable ? 'extension' : 'server';
  return serverConnected ? 'server' : 'extension';
}

export function sendViaExtension(request: LLMRouteRequest, callbacks: LLMRouteCallbacks, signal?: AbortSignal): string {
  const requestId = nanoid();
  const lifecycle = cancellableRequest(signal);
  const cleanup = () => { window.removeEventListener('message', handler); lifecycle.signal.removeEventListener('abort', abort); lifecycle.dispose(); };
  const abort = () => { cleanup(); window.postMessage({ type: 'TC_LLM_ABORT', requestId }, postMessageOrigin()); };
  let chars = 0;
  function handler(event: MessageEvent) {
    if (event.source !== window || !event.data || event.data.requestId !== requestId) return;
    if (event.data.type === 'TC_LLM_CHUNK') {
      if (typeof event.data.content !== 'string') return;
      chars += event.data.content.length;
      if (chars > MAX_RESPONSE_BYTES) { lifecycle.controller.abort(); callbacks.onError('Provider response exceeded the size limit.'); return; }
      callbacks.onChunk(event.data.content);
    } else if (event.data.type === 'TC_LLM_DONE') {
      cleanup(); callbacks.onDone(event.data.stopReason || 'end_turn', event.data.contentBlocks || [], event.data.usage);
    } else if (event.data.type === 'TC_LLM_ERROR') { cleanup(); callbacks.onError(event.data.error); }
  }
  if (lifecycle.signal.aborted) { cleanup(); return requestId; }
  window.addEventListener('message', handler);
  lifecycle.signal.addEventListener('abort', abort, { once: true });
  window.postMessage({ type: 'TC_LLM_REQUEST', requestId, payload: request }, postMessageOrigin());
  return requestId;
}

export function sendViaServer(request: LLMRouteRequest, callbacks: LLMRouteCallbacks, signal?: AbortSignal): string {
  const requestId = nanoid();
  const lifecycle = cancellableRequest(signal);
  let text = '';
  if (lifecycle.signal.aborted) { lifecycle.dispose(); return requestId; }
  streamLLMChat({ provider: request.provider, model: request.model, messages: request.messages as { role: string; content: string }[], systemPrompt: request.systemPrompt, tools: request.tools },
    chunk => {
      if (lifecycle.signal.aborted) return;
      text += chunk;
      if (text.length > MAX_RESPONSE_BYTES) { lifecycle.controller.abort(); lifecycle.dispose(); callbacks.onError('Provider response exceeded the size limit.'); return; }
      callbacks.onChunk(chunk);
    },
    (reason, blocks, usage) => { lifecycle.dispose(); if (!lifecycle.signal.aborted) callbacks.onDone(reason, blocks?.length ? blocks : text ? [{ type: 'text', text }] : [], usage); },
    error => { lifecycle.dispose(); if (!lifecycle.signal.aborted) callbacks.onError(error); }, lifecycle.signal);
  lifecycle.signal.addEventListener('abort', lifecycle.dispose, { once: true });
  return requestId;
}
