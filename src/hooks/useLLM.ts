import { useState, useEffect, useCallback, useRef } from 'react';
import type { LLMProvider, ContentBlock, ToolUseBlock, ToolCallRecord } from '../types';
import { isWriteTool } from '../lib/llm-tool-defs';
import { sendViaServer, sendDirectToLocal } from '../lib/llm-router';
import { nanoid } from 'nanoid';
import { postMessageOrigin } from '../lib/utils';

interface ToolDef {
  name: string;
  description: string;
  input_schema: Record<string, unknown>;
}

interface SendRequestOptions {
  provider: LLMProvider;
  model: string;
  messages: { role: 'user' | 'assistant'; content: string | ContentBlock[] }[];
  apiKey: string;
  systemPrompt?: string;
  tools?: ToolDef[];
  endpoint?: string;
  /** Route through team server instead of extension bridge */
  useServerProxy?: boolean;
}

export interface ToolActivity {
  id: string;
  name: string;
  input: Record<string, unknown>;
  status: 'running' | 'done' | 'error';
  result?: string;
}

export interface TokenUsage {
  input: number;
  output: number;
}

interface AgentResult {
  content: string;
  toolCalls: ToolCallRecord[];
  usage?: TokenUsage;
  error?: string;
}

const MAX_TOOL_TURNS = 8;
/** Hard cap on streaming content buffer to prevent unbounded memory growth on very long responses */
const MAX_STREAMING_CHARS = 200_000;

export interface ExtensionInfo {
  protocolVersion: number;
  capabilities: string[];
}

/** Dispatch an LLM request via extension bridge or server proxy */
function dispatchLLMRequest(
  requestId: string,
  opts: SendRequestOptions,
  messages: SendRequestOptions['messages'],
  signal: AbortSignal,
) {
  if (signal.aborted) return;
  if (opts.useServerProxy) {
    // Route through server — the server response events will be picked up by
    // the existing message listener because sendViaServer posts TC_LLM_* events
    sendViaServer(
      { provider: opts.provider, model: opts.model, messages, systemPrompt: opts.systemPrompt, tools: opts.tools },
      {
        onChunk: (content) => window.postMessage({ type: 'TC_LLM_CHUNK', requestId, content }, postMessageOrigin()),
        onDone: (stopReason, contentBlocks, usage) =>
          window.postMessage({ type: 'TC_LLM_DONE', requestId, stopReason, contentBlocks, usage: usage || null }, postMessageOrigin()),
        onError: (error) => window.postMessage({ type: 'TC_LLM_ERROR', requestId, error }, postMessageOrigin()),
      },
      signal,
    );
  } else if (opts.provider === 'local' && opts.endpoint) {
    // Local LLMs can be called directly without the extension
    sendDirectToLocal(
      { provider: opts.provider, model: opts.model, messages, systemPrompt: opts.systemPrompt, tools: opts.tools, endpoint: opts.endpoint, apiKey: opts.apiKey },
      {
        onChunk: (content) => window.postMessage({ type: 'TC_LLM_CHUNK', requestId, content }, postMessageOrigin()),
        onDone: (stopReason, contentBlocks, usage) =>
          window.postMessage({ type: 'TC_LLM_DONE', requestId, stopReason, contentBlocks, usage: usage || null }, postMessageOrigin()),
        onError: (error) => window.postMessage({ type: 'TC_LLM_ERROR', requestId, error }, postMessageOrigin()),
      },
      signal,
    );
  } else {
    const abort = () => window.postMessage({ type: 'TC_LLM_ABORT', requestId }, postMessageOrigin());
    const complete = (event: MessageEvent) => {
      if (event.source === window && event.data?.requestId === requestId && ['TC_LLM_DONE', 'TC_LLM_ERROR'].includes(event.data.type)) cleanup();
    };
    const cleanup = () => { signal.removeEventListener('abort', abort); window.removeEventListener('message', complete); };
    signal.addEventListener('abort', abort, { once: true });
    signal.addEventListener('abort', cleanup, { once: true });
    window.addEventListener('message', complete);
    window.postMessage({
      type: 'TC_LLM_REQUEST',
      requestId,
      payload: {
        provider: opts.provider,
        model: opts.model,
        messages,
        apiKey: opts.apiKey,
        systemPrompt: opts.systemPrompt,
        tools: opts.tools,
        endpoint: opts.endpoint,
      },
    }, postMessageOrigin());
  }
}

/** Provides LLM chat capabilities -- streaming requests, multi-turn agentic tool loops, and extension bridge detection. */
export function useLLM() {
  const [extensionAvailable, setExtensionAvailable] = useState(false);
  const [extensionInfo, setExtensionInfo] = useState<ExtensionInfo | null>(null);
  const [streamingContent, setStreamingContent] = useState('');
  const [activeRequestId, setActiveRequestId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [toolActivity, setToolActivity] = useState<ToolActivity[]>([]);

  // Refs for managing the agentic loop
  const onCompleteRef = useRef<((result: AgentResult) => void) | null>(null);
  const accumulatedRef = useRef('');
  const requestIdRef = useRef<string | null>(null);
  const controllerRef = useRef<AbortController | null>(null);
  const rafRef = useRef<number | null>(null);
  const agentStateRef = useRef<{
    opts: SendRequestOptions;
    messages: SendRequestOptions['messages'];
    allToolCalls: ToolCallRecord[];
    totalUsage: TokenUsage;
    turn: number;
    aborted: boolean;
    signal: AbortSignal;
    pendingTools: number;
    completeCancelled?: () => void;
    toolExecutor?: (toolUse: ToolUseBlock, signal: AbortSignal) => Promise<{ result: string; isError: boolean }>;
  } | null>(null);

  const cancelCurrent = useCallback((updateUI = true) => {
    const rid = requestIdRef.current;
    const state = agentStateRef.current;
    if (!rid && !state) return;
    if (state) state.aborted = true;
    controllerRef.current?.abort();
    window.postMessage({ type: 'TC_LLM_ABORT', requestId: rid }, postMessageOrigin());
    if (rafRef.current) { cancelAnimationFrame(rafRef.current); rafRef.current = null; }
    const content = accumulatedRef.current;
    const onComplete = onCompleteRef.current;
    requestIdRef.current = null;
    accumulatedRef.current = '';
    agentStateRef.current = null;
    onCompleteRef.current = null;
    if (updateUI) { setActiveRequestId(null); setStreamingContent(''); }
    // Replacement, Stop, and unmount share one finalizer. Capture this request's
    // callback before a successor can replace it; wait for actual tool outcomes.
    const completeCancelled = () => {
      const toolCalls = state?.allToolCalls ?? [];
      if (content || toolCalls.length) {
        try {
          void Promise.resolve(onComplete?.({ content, toolCalls: [...toolCalls], error: 'Request cancelled.' }))
            .catch(error => console.error('Unable to persist cancelled chat result:', error));
        } catch (error) { console.error('Unable to persist cancelled chat result:', error); }
      }
    };
    if (state?.pendingTools) state.completeCancelled = completeCancelled;
    else completeCancelled();
  }, []);

  // Keep handleDone in a ref so the event listener always calls the latest version
  const handleDoneRef = useRef<((stopReason: string, contentBlocks: ContentBlock[], eventUsage?: TokenUsage) => void) | undefined>(undefined);

  // eslint-disable-next-line react-hooks/refs -- intentional: keep latest closure for event listener
  handleDoneRef.current = async (stopReason: string, contentBlocks: ContentBlock[], eventUsage?: TokenUsage) => {
    const state = agentStateRef.current;
    try {
      if (!state) {
        // No agentic state — simple completion
        const finalContent = accumulatedRef.current;
        setActiveRequestId(null);
        requestIdRef.current = null;
        onCompleteRef.current?.({ content: finalContent, toolCalls: [], usage: eventUsage });
        onCompleteRef.current = null;
        return;
      }

      // Accumulate token usage across turns
      if (eventUsage) {
        state.totalUsage.input += eventUsage.input;
        state.totalUsage.output += eventUsage.output;
      }

      // Check if there are tool_use blocks to handle
      const toolUseBlocks = contentBlocks.filter(
        (b): b is ToolUseBlock => b.type === 'tool_use' && !!b.id && !!b.name && typeof b.input === 'object'
      );
      const shouldContinue = stopReason === 'tool_use' && toolUseBlocks.length > 0;

      if (!shouldContinue || state.turn >= MAX_TOOL_TURNS || state.aborted) {
        // Done — no more tool calls needed
        const finalContent = accumulatedRef.current;
        setActiveRequestId(null);
        requestIdRef.current = null;
        const result = { content: finalContent, toolCalls: [...state.allToolCalls], usage: state.totalUsage.input > 0 ? { ...state.totalUsage } : undefined };
        agentStateRef.current = null;
        onCompleteRef.current?.(result);
        onCompleteRef.current = null;
        return;
      }

      // Execute tool calls — read tools in parallel, write tools sequentially
      const toolResults: ContentBlock[] = [];

      const executeSingleTool = async (toolUse: ToolUseBlock): Promise<ContentBlock> => {
        if (state.aborted || state.signal.aborted) return { type: 'tool_result', tool_use_id: toolUse.id, content: 'Cancelled', is_error: true };
        const activity: ToolActivity = {
          id: toolUse.id,
          name: toolUse.name,
          input: toolUse.input as Record<string, unknown>,
          status: 'running',
        };
        setToolActivity(prev => [...prev, activity]);

        let result: { result: string; isError: boolean };
        state.pendingTools++;
        try {
          result = state.toolExecutor ? await state.toolExecutor(toolUse, state.signal)
            : { result: JSON.stringify({ error: 'No tool executor configured' }), isError: true };
        } catch (error) { result = { result: JSON.stringify({ error: error instanceof Error ? error.message : 'Tool execution failed.' }), isError: true }; }

        state.allToolCalls.push({
          id: toolUse.id,
          name: toolUse.name,
          input: toolUse.input as Record<string, unknown>,
          result: result.result,
          isError: result.isError,
        });

        state.pendingTools--;
        if (state.aborted && state.pendingTools === 0) {
          state.completeCancelled?.();
          state.completeCancelled = undefined;
        }
        if (!state.aborted) setToolActivity(prev =>
          prev.map(a => a.id === toolUse.id ? { ...a, status: result.isError ? 'error' : 'done', result: result.result } : a)
        );

        return {
          type: 'tool_result',
          tool_use_id: toolUse.id,
          content: result.result,
          is_error: result.isError,
        };
      };

      // Partition into read and write tool batches (preserving order for writes)
      let i = 0;
      while (i < toolUseBlocks.length) {
        if (state.aborted) return;

        // Collect consecutive read tools into a parallel batch
        const readBatch: ToolUseBlock[] = [];
        while (i < toolUseBlocks.length && !isWriteTool(toolUseBlocks[i].name)) {
          readBatch.push(toolUseBlocks[i]);
          i++;
        }

        // Execute read batch in parallel
        if (readBatch.length > 0) {
          const results = await Promise.all(readBatch.map(executeSingleTool));
          toolResults.push(...results);
        }

        // Execute next write tool sequentially (if any)
        if (i < toolUseBlocks.length && isWriteTool(toolUseBlocks[i].name)) {
          if (state.aborted) return;
          const result = await executeSingleTool(toolUseBlocks[i]);
          toolResults.push(result);
          i++;
        }
      }

      if (state.aborted) return;

      // Build the assistant message with the content blocks we received
      const assistantContent: ContentBlock[] = [];
      for (const block of contentBlocks) {
        if (block.type === 'text' || block.type === 'tool_use') {
          assistantContent.push(block);
        }
      }

      // Append assistant + tool_result messages and send next turn
      state.messages = [
        ...state.messages,
        { role: 'assistant' as const, content: assistantContent },
        { role: 'user' as const, content: toolResults },
      ];
      state.turn++;

      // Keep accumulated text across turns — add separator if there's existing content
      if (accumulatedRef.current && !accumulatedRef.current.endsWith('\n')) {
        accumulatedRef.current += '\n\n';
      }

      // Send next request
      const requestId = nanoid();
      requestIdRef.current = requestId;
      setActiveRequestId(requestId);

      dispatchLLMRequest(requestId, state.opts, state.messages, state.signal);
    } catch (err) {
      if (state?.aborted || (state && agentStateRef.current !== state)) return;
      console.error('useLLM: handleDone error', err);
      // Ensure we always clean up on error so the UI doesn't freeze
      setActiveRequestId(null);
      requestIdRef.current = null;
      setError(String((err as Error).message || err));
      const finalContent = accumulatedRef.current;
      agentStateRef.current = null;
      // Deliver whatever we have
      onCompleteRef.current?.({ content: finalContent, toolCalls: state?.allToolCalls || [], usage: state?.totalUsage.input ? { ...state.totalUsage } : undefined });
      onCompleteRef.current = null;
    }
  };

  useEffect(() => {
    const handler = (event: MessageEvent) => {
      if (event.source !== window || !event.data) return;

      if (event.data.type === 'TC_EXTENSION_READY') {
        setExtensionAvailable(true);
        setExtensionInfo({
          protocolVersion: event.data.protocolVersion || 1,
          capabilities: event.data.capabilities || [],
        });
        return;
      }

      if (event.data.type === 'TC_LLM_CHUNK') {
        if (!requestIdRef.current || event.data.requestId !== requestIdRef.current) return;
        if (accumulatedRef.current.length < MAX_STREAMING_CHARS) {
          accumulatedRef.current += event.data.content;
        }
        // Batch rendering to once per animation frame to avoid thrashing
        if (!rafRef.current) {
          rafRef.current = requestAnimationFrame(() => {
            rafRef.current = null;
            setStreamingContent(accumulatedRef.current);
          });
        }
        return;
      }

      if (event.data.type === 'TC_LLM_DONE') {
        if (!requestIdRef.current || event.data.requestId !== requestIdRef.current) return;
        requestIdRef.current = null; // Accept each completion only once.
        // Flush any pending RAF so final content is rendered
        if (rafRef.current) {
          cancelAnimationFrame(rafRef.current);
          rafRef.current = null;
          setStreamingContent(accumulatedRef.current);
        }
        const stopReason: string = event.data.stopReason || 'end_turn';
        const contentBlocks: ContentBlock[] = event.data.contentBlocks || [];
        const eventUsage: TokenUsage | undefined = event.data.usage ? { input: event.data.usage.input || 0, output: event.data.usage.output || 0 } : undefined;
        handleDoneRef.current?.(stopReason, contentBlocks, eventUsage);
        return;
      }

      if (event.data.type === 'TC_LLM_ERROR') {
        if (!requestIdRef.current || event.data.requestId !== requestIdRef.current) return;
        if (rafRef.current) { cancelAnimationFrame(rafRef.current); rafRef.current = null; }
        setError(event.data.error);
        setActiveRequestId(null);
        requestIdRef.current = null;
        setStreamingContent('');
        // Deliver any partial content to the caller rather than silently dropping it
        const partialContent = accumulatedRef.current;
        accumulatedRef.current = '';
        const agentState = agentStateRef.current;
        agentStateRef.current = null;
        onCompleteRef.current?.({
          content: partialContent,
          toolCalls: agentState?.allToolCalls ?? [],
          usage: agentState?.totalUsage.input ? agentState.totalUsage : undefined,
          error: event.data.error,
        });
        onCompleteRef.current = null;
        return;
      }
    };

    window.addEventListener('message', handler);
    window.postMessage({ type: 'TC_EXTENSION_PING' }, postMessageOrigin());
    return () => {
      window.removeEventListener('message', handler);
      cancelCurrent(false);
    };
  }, [cancelCurrent]);

  const sendAgentRequest = useCallback((
    opts: SendRequestOptions,
    toolExecutor: (toolUse: ToolUseBlock, signal: AbortSignal) => Promise<{ result: string; isError: boolean }>,
    onComplete: (result: AgentResult) => void,
  ): string => {
    const requestId = nanoid();
    cancelCurrent();
    const controller = new AbortController();
    controllerRef.current = controller;
    setError(null);
    setStreamingContent('');
    setToolActivity([]);
    accumulatedRef.current = '';
    requestIdRef.current = requestId;
    setActiveRequestId(requestId);
    onCompleteRef.current = onComplete;

    // Initialize agentic state
    agentStateRef.current = {
      opts,
      messages: [...opts.messages],
      allToolCalls: [],
      totalUsage: { input: 0, output: 0 },
      turn: 0,
      aborted: false,
      signal: controller.signal,
      pendingTools: 0,
      toolExecutor,
    };

    dispatchLLMRequest(requestId, opts, opts.messages, controller.signal);

    return requestId;
  }, [cancelCurrent]);

  const abort = useCallback(() => cancelCurrent(), [cancelCurrent]);

  useEffect(() => {
    window.addEventListener('workspace-will-switch', abort);
    return () => window.removeEventListener('workspace-will-switch', abort);
  }, [abort]);

  return {
    extensionAvailable,
    extensionInfo,
    streamingContent,
    activeRequestId,
    error,
    toolActivity,
    sendAgentRequest,
    abort,
    isStreaming: activeRequestId !== null,
  };
}
