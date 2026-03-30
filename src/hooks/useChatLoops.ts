import { useState, useEffect, useCallback } from 'react';
import {
  startLoop as _startLoop,
  stopLoop as _stopLoop,
  stopLoopsForThread as _stopLoopsForThread,
  getLoopsForThread,
  getAllLoops,
  getLoopRevision,
  parseInterval,
  formatInterval,
  type ChatLoopInfo,
} from '../lib/chat-loop';
import type { LLMProvider, ChatMessage } from '../types';

/**
 * React bridge for the module-level chat loop engine.
 * Polls the loop revision counter to detect state changes.
 */
export function useChatLoops(threadId?: string) {
  const [loops, setLoops] = useState<ChatLoopInfo[]>([]);
  const [allLoops, setAllLoops] = useState<ChatLoopInfo[]>([]);

  // Poll for changes every second
  useEffect(() => {
    let lastRevision = -1;
    const sync = () => {
      const rev = getLoopRevision();
      if (rev !== lastRevision) {
        lastRevision = rev;
        setLoops(threadId ? getLoopsForThread(threadId) : []);
        setAllLoops(getAllLoops());
      }
    };
    sync(); // initial
    const id = setInterval(sync, 1000);
    return () => clearInterval(id);
  }, [threadId]);

  const startLoop = useCallback((opts: {
    threadId: string;
    prompt: string;
    intervalStr: string;
    model: string;
    provider: LLMProvider;
    apiKey: string;
    systemPrompt: string;
    endpoint?: string;
    onMessage: (threadId: string, message: ChatMessage) => Promise<void>;
  }) => {
    const intervalMs = parseInterval(opts.intervalStr);
    const id = _startLoop({
      threadId: opts.threadId,
      prompt: opts.prompt,
      intervalMs,
      model: opts.model,
      provider: opts.provider,
      apiKey: opts.apiKey,
      systemPrompt: opts.systemPrompt,
      endpoint: opts.endpoint,
      onMessage: opts.onMessage,
    });
    return { id, intervalMs, formattedInterval: formatInterval(intervalMs) };
  }, []);

  const stopLoop = useCallback((loopId: string) => {
    return _stopLoop(loopId);
  }, []);

  const stopAllForThread = useCallback((tid: string) => {
    return _stopLoopsForThread(tid);
  }, []);

  return { loops, allLoops, startLoop, stopLoop, stopAllForThread };
}
