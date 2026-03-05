import { useState, useEffect, useCallback, useRef } from 'react';
import type { LLMProvider, ContentBlock, ToolUseBlock, ToolCallRecord } from '../types';
import { nanoid } from 'nanoid';

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
}

export interface ToolActivity {
  id: string;
  name: string;
  input: Record<string, unknown>;
  status: 'running' | 'done' | 'error';
  result?: string;
}

interface AgentResult {
  content: string;
  toolCalls: ToolCallRecord[];
}

const MAX_TOOL_TURNS = 8;

export function useLLM() {
  const [extensionAvailable, setExtensionAvailable] = useState(false);
  const [streamingContent, setStreamingContent] = useState('');
  const [activeRequestId, setActiveRequestId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [toolActivity, setToolActivity] = useState<ToolActivity[]>([]);

  // Refs for managing the agentic loop
  const onCompleteRef = useRef<((result: AgentResult) => void) | null>(null);
  const accumulatedRef = useRef('');
  const requestIdRef = useRef<string | null>(null);
  const rafRef = useRef<number | null>(null);
  const agentStateRef = useRef<{
    opts: SendRequestOptions;
    messages: SendRequestOptions['messages'];
    allToolCalls: ToolCallRecord[];
    turn: number;
    aborted: boolean;
    toolExecutor?: (toolUse: ToolUseBlock) => Promise<{ result: string; isError: boolean }>;
  } | null>(null);

  // Keep handleDone in a ref so the event listener always calls the latest version
  const handleDoneRef = useRef<((stopReason: string, contentBlocks: ContentBlock[]) => void) | undefined>(undefined);

  // eslint-disable-next-line react-hooks/refs -- intentional: keep latest closure for event listener
  handleDoneRef.current = async (stopReason: string, contentBlocks: ContentBlock[]) => {
    try {
      const state = agentStateRef.current;
      if (!state) {
        // No agentic state — simple completion
        const finalContent = accumulatedRef.current;
        setActiveRequestId(null);
        requestIdRef.current = null;
        onCompleteRef.current?.({ content: finalContent, toolCalls: [] });
        onCompleteRef.current = null;
        return;
      }

      // Check if there are tool_use blocks to handle
      // Include blocks from max_tokens truncation — completed tool calls should still execute
      const toolUseBlocks = contentBlocks.filter(
        (b): b is ToolUseBlock => b.type === 'tool_use' && !!b.id && !!b.name && typeof b.input === 'object'
      );
      const shouldContinue = (stopReason === 'tool_use' || stopReason === 'max_tokens') && toolUseBlocks.length > 0;

      if (!shouldContinue || state.turn >= MAX_TOOL_TURNS || state.aborted) {
        // Done — no more tool calls needed
        const finalContent = accumulatedRef.current;
        setActiveRequestId(null);
        requestIdRef.current = null;
        const result = { content: finalContent, toolCalls: [...state.allToolCalls] };
        agentStateRef.current = null;
        onCompleteRef.current?.(result);
        onCompleteRef.current = null;
        return;
      }

      // Execute tool calls
      const toolResults: ContentBlock[] = [];
      for (const toolUse of toolUseBlocks) {
        if (state.aborted) return;

        // Update tool activity UI
        const activity: ToolActivity = {
          id: toolUse.id,
          name: toolUse.name,
          input: toolUse.input as Record<string, unknown>,
          status: 'running',
        };
        setToolActivity(prev => [...prev, activity]);

        let result: { result: string; isError: boolean };
        if (state.toolExecutor) {
          result = await state.toolExecutor(toolUse);
        } else {
          result = { result: JSON.stringify({ error: 'No tool executor configured' }), isError: true };
        }

        // Record the tool call
        state.allToolCalls.push({
          id: toolUse.id,
          name: toolUse.name,
          input: toolUse.input as Record<string, unknown>,
          result: result.result,
          isError: result.isError,
        });

        // Update activity status
        setToolActivity(prev =>
          prev.map(a => a.id === toolUse.id ? { ...a, status: result.isError ? 'error' : 'done', result: result.result } : a)
        );

        toolResults.push({
          type: 'tool_result',
          tool_use_id: toolUse.id,
          content: result.result,
          is_error: result.isError,
        });
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

      window.postMessage({
        type: 'TC_LLM_REQUEST',
        requestId,
        payload: {
          provider: state.opts.provider,
          model: state.opts.model,
          messages: state.messages,
          apiKey: state.opts.apiKey,
          systemPrompt: state.opts.systemPrompt,
          tools: state.opts.tools,
          endpoint: state.opts.endpoint,
        },
      }, '*');
    } catch (err) {
      console.error('useLLM: handleDone error', err);
      // Ensure we always clean up on error so the UI doesn't freeze
      setActiveRequestId(null);
      requestIdRef.current = null;
      setError(String((err as Error).message || err));
      const state = agentStateRef.current;
      const finalContent = accumulatedRef.current;
      agentStateRef.current = null;
      // Deliver whatever we have
      onCompleteRef.current?.({ content: finalContent, toolCalls: state?.allToolCalls || [] });
      onCompleteRef.current = null;
    }
  };

  useEffect(() => {
    const handler = (event: MessageEvent) => {
      if (event.source !== window || !event.data) return;

      if (event.data.type === 'TC_EXTENSION_READY') {
        setExtensionAvailable(true);
        return;
      }

      if (event.data.type === 'TC_LLM_CHUNK') {
        if (event.data.requestId && event.data.requestId !== requestIdRef.current) return;
        accumulatedRef.current += event.data.content;
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
        if (event.data.requestId && event.data.requestId !== requestIdRef.current) return;
        // Flush any pending RAF so final content is rendered
        if (rafRef.current) {
          cancelAnimationFrame(rafRef.current);
          rafRef.current = null;
          setStreamingContent(accumulatedRef.current);
        }
        const stopReason: string = event.data.stopReason || 'end_turn';
        const contentBlocks: ContentBlock[] = event.data.contentBlocks || [];
        handleDoneRef.current?.(stopReason, contentBlocks);
        return;
      }

      if (event.data.type === 'TC_LLM_ERROR') {
        if (event.data.requestId && event.data.requestId !== requestIdRef.current) return;
        if (rafRef.current) { cancelAnimationFrame(rafRef.current); rafRef.current = null; }
        setError(event.data.error);
        setActiveRequestId(null);
        requestIdRef.current = null;
        setStreamingContent('');
        accumulatedRef.current = '';
        agentStateRef.current = null;
        onCompleteRef.current = null;
        return;
      }
    };

    window.addEventListener('message', handler);
    window.postMessage({ type: 'TC_EXTENSION_PING' }, '*');
    return () => window.removeEventListener('message', handler);
  }, []);

  const sendAgentRequest = useCallback((
    opts: SendRequestOptions,
    toolExecutor: (toolUse: ToolUseBlock) => Promise<{ result: string; isError: boolean }>,
    onComplete: (result: AgentResult) => void,
  ): string => {
    const requestId = nanoid();
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
      turn: 0,
      aborted: false,
      toolExecutor,
    };

    window.postMessage({
      type: 'TC_LLM_REQUEST',
      requestId,
      payload: {
        provider: opts.provider,
        model: opts.model,
        messages: opts.messages,
        apiKey: opts.apiKey,
        systemPrompt: opts.systemPrompt,
        tools: opts.tools,
        endpoint: opts.endpoint,
      },
    }, '*');

    return requestId;
  }, []);

  const abort = useCallback(() => {
    const rid = requestIdRef.current;
    if (rid) {
      window.postMessage({ type: 'TC_LLM_ABORT', requestId: rid }, '*');
      if (agentStateRef.current) {
        agentStateRef.current.aborted = true;
      }
      if (rafRef.current) { cancelAnimationFrame(rafRef.current); rafRef.current = null; }

      // Capture before clearing
      const content = accumulatedRef.current;
      const toolCalls = agentStateRef.current?.allToolCalls || [];

      setActiveRequestId(null);
      requestIdRef.current = null;
      setStreamingContent('');
      accumulatedRef.current = '';

      // Deliver whatever we have
      if (content || toolCalls.length > 0) {
        onCompleteRef.current?.({ content, toolCalls });
      }

      agentStateRef.current = null;
      onCompleteRef.current = null;
    }
  }, []);

  return {
    extensionAvailable,
    streamingContent,
    activeRequestId,
    error,
    toolActivity,
    sendAgentRequest,
    abort,
    isStreaming: activeRequestId !== null,
  };
}
