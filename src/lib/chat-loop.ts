import { nanoid } from 'nanoid';
import type { LLMProvider, ChatMessage } from '../types';
import { sendDirectToLocal, sendViaExtension, sendViaServer } from './llm-router';

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
  useServerProxy?: boolean;
  status: 'running' | 'stopped';
  lastRunAt?: number;
  runCount: number;
  error?: string;
  failures?: number;
  inFlight?: boolean;
  controller?: AbortController;
  timerId?: ReturnType<typeof setTimeout>;
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
  error?: string;
}

const MIN_INTERVAL_MS = 30_000; // 30 seconds minimum
const MAX_INTERVAL_MS = 86_400_000; // one day, below browser timer overflow
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
    error: loop.error,
  };
}

/** Send a one-shot LLM request and collect the full text response (no tools, no streaming UI). */
function executeLoopPrompt(loop: ChatLoop): Promise<string> {
  return new Promise((resolve, reject) => {
    let settled = false;
    let accumulated = '';
    const controller = loop.controller!;
    const finish = (error?: string, content?: string) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      controller.signal.removeEventListener('abort', abort);
      if (error) reject(new Error(error)); else resolve(content || accumulated || '(No response)');
    };
    const abort = () => finish('Loop request was cancelled or timed out.');
    const timer = setTimeout(() => controller.abort(), LOOP_TIMEOUT_MS);
    controller.signal.addEventListener('abort', abort, { once: true });
    const send = loop.useServerProxy ? sendViaServer : loop.provider === 'local' && loop.endpoint ? sendDirectToLocal : sendViaExtension;
    send({ provider: loop.provider, model: loop.model, messages: [{ role: 'user', content: loop.prompt }], apiKey: loop.apiKey, systemPrompt: loop.systemPrompt, endpoint: loop.endpoint }, {
      onChunk: content => { accumulated += content; if (accumulated.length > 200_000) controller.abort(); },
      onDone: (_reason, blocks) => finish(undefined, blocks.filter((block): block is { type: 'text'; text: string } => !!block && typeof block === 'object' && 'type' in block && block.type === 'text' && 'text' in block && typeof block.text === 'string').map(block => block.text).join('\n\n')),
      onError: error => finish(error),
    }, controller.signal);
  });
}

async function runOnce(loop: ChatLoop): Promise<void> {
  if (loop.status === 'stopped' || loop.inFlight) return;
  loop.inFlight = true;
  loop.controller = new AbortController();
  try {
    const content = await executeLoopPrompt(loop);
    if (loop.status !== 'running' || loop.controller.signal.aborted) return;
    const msg: ChatMessage = {
      id: nanoid(),
      role: 'assistant',
      content: `**[Loop ${loop.runCount + 1}]** ${content}`,
      createdAt: Date.now(),
    };
    await loop.onMessage(loop.threadId, msg);
    loop.lastRunAt = Date.now();
    loop.runCount++;
    loop.failures = 0;
    loop.error = undefined;
  } catch (error) {
    if (loop.status === 'running') {
      loop.error = error instanceof Error ? error.message : 'Loop request failed.';
      loop.failures = (loop.failures ?? 0) + 1;
    }
  } finally {
    loop.inFlight = false;
    loop.controller = undefined;
    revision++;
    if (loop.status === 'running') {
      const delay = Math.min(MAX_INTERVAL_MS, loop.intervalMs * 2 ** Math.min(loop.failures ?? 0, 5));
      loop.timerId = setTimeout(() => { void runOnce(loop); }, delay);
    }
  }
}

export function parseInterval(str: string): number {
  const match = str.match(/^(\d+)([smh])$/i);
  if (!match) return 600_000; // default 10 minutes
  const [, n, unit] = match;
  const multipliers: Record<string, number> = { s: 1000, m: 60_000, h: 3_600_000 };
  return Math.min(MAX_INTERVAL_MS, Math.max(MIN_INTERVAL_MS, Number(n) * (multipliers[unit.toLowerCase()] || 60_000)));
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
  useServerProxy?: boolean;
  onMessage: (threadId: string, message: ChatMessage) => Promise<void>;
}): string {
  const id = nanoid(8);
  const loop: ChatLoop = {
    id,
    threadId: opts.threadId,
    prompt: opts.prompt,
    intervalMs: Number.isFinite(opts.intervalMs) ? Math.min(MAX_INTERVAL_MS, Math.max(MIN_INTERVAL_MS, opts.intervalMs)) : 600_000,
    model: opts.model,
    provider: opts.provider,
    apiKey: opts.apiKey,
    systemPrompt: opts.systemPrompt,
    endpoint: opts.endpoint,
    useServerProxy: opts.useServerProxy,
    status: 'running',
    runCount: 0,
    onMessage: opts.onMessage,
  };

  activeLoops.set(id, loop);
  revision++;
  void runOnce(loop);
  return id;
}

export function stopLoop(loopId: string): boolean {
  const loop = activeLoops.get(loopId);
  if (!loop) return false;
  loop.status = 'stopped';
  if (loop.timerId) clearTimeout(loop.timerId);
  loop.controller?.abort();
  activeLoops.delete(loopId);
  revision++;
  return true;
}

export function stopLoopsForThread(threadId: string): number {
  let count = 0;
  for (const [id, loop] of activeLoops) {
    if (loop.threadId === threadId) {
      stopLoop(id);
      count++;
    }
  }
  if (count > 0) revision++;
  return count;
}

if (typeof window !== 'undefined') window.addEventListener('workspace-will-switch', () => {
  for (const id of activeLoops.keys()) stopLoop(id);
});

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
