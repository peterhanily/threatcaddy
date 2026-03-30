import { nanoid } from 'nanoid';
import type { LLMProvider, ContentBlock, ChatMessage } from '../types';
import { postMessageOrigin } from './utils';

export interface ChatLoop {
  id: string;
  threadId: string;
  prompt: string;
  intervalMs: number;
  model: string;
  provider: LLMProvider;
  apiKey: string;
  systemPrompt: string;
  endpoint?: string;
  status: 'running' | 'stopped';
  lastRunAt?: number;
  runCount: number;
  timerId?: ReturnType<typeof setInterval>;
  onMessage: (threadId: string, message: ChatMessage) => Promise<void>;
}

/** Serializable loop info for the UI (no callbacks/timers) */
export interface ChatLoopInfo {
  id: string;
  threadId: string;
  prompt: string;
  intervalMs: number;
  status: 'running' | 'stopped';
  lastRunAt?: number;
  runCount: number;
}

const MIN_INTERVAL_MS = 30_000; // 30 seconds minimum
const LOOP_TIMEOUT_MS = 60_000; // 60 seconds per execution

const activeLoops = new Map<string, ChatLoop>();
let revision = 0; // bumped on every mutation so React can detect changes

export function getLoopRevision(): number {
  return revision;
}

function toInfo(loop: ChatLoop): ChatLoopInfo {
  return {
    id: loop.id,
    threadId: loop.threadId,
    prompt: loop.prompt,
    intervalMs: loop.intervalMs,
    status: loop.status,
    lastRunAt: loop.lastRunAt,
    runCount: loop.runCount,
  };
}

/** Send a one-shot LLM request and collect the full text response (no tools, no streaming UI). */
function executeLoopPrompt(loop: ChatLoop): Promise<string> {
  return new Promise((resolve) => {
    const requestId = nanoid();
    let settled = false;
    let accumulated = '';

    const timer = setTimeout(() => {
      if (!settled) {
        settled = true;
        window.removeEventListener('message', handler);
        resolve(accumulated || '(Loop execution timed out)');
      }
    }, LOOP_TIMEOUT_MS);

    function handler(event: MessageEvent) {
      if (event.source !== window || !event.data) return;
      if (event.data.requestId !== requestId) return;

      if (event.data.type === 'TC_LLM_CHUNK') {
        accumulated += event.data.content;
        return;
      }

      if (event.data.type === 'TC_LLM_DONE') {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        window.removeEventListener('message', handler);
        // Extract text from content blocks if available, fall back to accumulated
        const blocks: ContentBlock[] = event.data.contentBlocks || [];
        const text = blocks
          .filter((b): b is { type: 'text'; text: string } => b.type === 'text')
          .map(b => b.text)
          .join('\n\n');
        resolve(text || accumulated || '(No response)');
        return;
      }

      if (event.data.type === 'TC_LLM_ERROR') {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        window.removeEventListener('message', handler);
        resolve(`Loop error: ${event.data.error || 'Unknown error'}`);
        return;
      }
    }

    window.addEventListener('message', handler);

    window.postMessage({
      type: 'TC_LLM_REQUEST',
      requestId,
      payload: {
        provider: loop.provider,
        model: loop.model,
        messages: [{ role: 'user' as const, content: loop.prompt }],
        apiKey: loop.apiKey,
        systemPrompt: loop.systemPrompt,
        endpoint: loop.endpoint,
      },
    }, postMessageOrigin());
  });
}

async function runOnce(loop: ChatLoop): Promise<void> {
  if (loop.status === 'stopped') return;

  const content = await executeLoopPrompt(loop);
  loop.lastRunAt = Date.now();
  loop.runCount++;
  revision++;

  // Only post if loop is still running (could have been stopped during execution)
  if (loop.status === 'running') {
    const msg: ChatMessage = {
      id: nanoid(),
      role: 'assistant',
      content: `**[Loop ${loop.runCount}]** ${content}`,
      createdAt: Date.now(),
    };
    await loop.onMessage(loop.threadId, msg);
  }
}

export function parseInterval(str: string): number {
  const match = str.match(/^(\d+)([smh])$/i);
  if (!match) return 600_000; // default 10 minutes
  const [, n, unit] = match;
  const multipliers: Record<string, number> = { s: 1000, m: 60_000, h: 3_600_000 };
  return Math.max(MIN_INTERVAL_MS, parseInt(n) * (multipliers[unit.toLowerCase()] || 60_000));
}

export function formatInterval(ms: number): string {
  if (ms >= 3_600_000) return `${ms / 3_600_000}h`;
  if (ms >= 60_000) return `${ms / 60_000}m`;
  return `${ms / 1000}s`;
}

export function startLoop(opts: {
  threadId: string;
  prompt: string;
  intervalMs: number;
  model: string;
  provider: LLMProvider;
  apiKey: string;
  systemPrompt: string;
  endpoint?: string;
  onMessage: (threadId: string, message: ChatMessage) => Promise<void>;
}): string {
  const id = nanoid(8);
  const loop: ChatLoop = {
    id,
    threadId: opts.threadId,
    prompt: opts.prompt,
    intervalMs: opts.intervalMs,
    model: opts.model,
    provider: opts.provider,
    apiKey: opts.apiKey,
    systemPrompt: opts.systemPrompt,
    endpoint: opts.endpoint,
    status: 'running',
    runCount: 0,
    onMessage: opts.onMessage,
  };

  // Run immediately, then on interval
  runOnce(loop);
  loop.timerId = setInterval(() => runOnce(loop), opts.intervalMs);

  activeLoops.set(id, loop);
  revision++;
  return id;
}

export function stopLoop(loopId: string): boolean {
  const loop = activeLoops.get(loopId);
  if (!loop) return false;
  loop.status = 'stopped';
  if (loop.timerId) clearInterval(loop.timerId);
  activeLoops.delete(loopId);
  revision++;
  return true;
}

export function stopLoopsForThread(threadId: string): number {
  let count = 0;
  for (const [id, loop] of activeLoops) {
    if (loop.threadId === threadId) {
      loop.status = 'stopped';
      if (loop.timerId) clearInterval(loop.timerId);
      activeLoops.delete(id);
      count++;
    }
  }
  if (count > 0) revision++;
  return count;
}

export function getLoopsForThread(threadId: string): ChatLoopInfo[] {
  const result: ChatLoopInfo[] = [];
  for (const loop of activeLoops.values()) {
    if (loop.threadId === threadId) result.push(toInfo(loop));
  }
  return result;
}

export function getAllLoops(): ChatLoopInfo[] {
  return Array.from(activeLoops.values()).map(toInfo);
}

export function hasLoopsForThread(threadId: string): boolean {
  for (const loop of activeLoops.values()) {
    if (loop.threadId === threadId && loop.status === 'running') return true;
  }
  return false;
}
