import { nanoid } from 'nanoid';
import type { LLMProvider, ContentBlock } from '../types';
import { postMessageOrigin } from './utils';

export const MAX_CONTEXT_MESSAGES = 40;

const TITLE_TIMEOUT_MS = 5000;
const SUMMARY_TIMEOUT_MS = 15000;

/**
 * Truncate conversation messages to fit within context window limits.
 * Always keeps the first 2 messages (for context) and the most recent messages.
 * Inserts a separator when truncation occurs.
 */
export function truncateConversation(
  messages: { role: 'user' | 'assistant'; content: string }[],
  maxMessages: number = MAX_CONTEXT_MESSAGES,
  existingSummary?: string,
): { role: 'user' | 'assistant'; content: string }[] {
  if (messages.length <= maxMessages) {
    return messages;
  }

  const keepFromStart = 2;
  const keepFromEnd = maxMessages - keepFromStart;

  const firstMessages = messages.slice(0, keepFromStart);
  const recentMessages = messages.slice(-keepFromEnd);

  const summaryText = existingSummary
    ? `[Context Summary from earlier conversation]\n${existingSummary}`
    : '[System: Earlier conversation truncated for context window]';

  return [
    ...firstMessages,
    { role: 'user' as const, content: summaryText },
    ...recentMessages,
  ];
}

/**
 * Summarize truncated messages via a one-shot LLM request.
 * Returns a concise summary preserving key IOCs, decisions, and findings.
 * Returns null on timeout or failure.
 */
export function summarizeConversation(
  truncatedMessages: { role: string; content: string }[],
  provider: LLMProvider,
  model: string,
  apiKey: string,
  endpoint?: string,
): Promise<string | null> {
  if (truncatedMessages.length === 0) return Promise.resolve(null);

  const conversationText = truncatedMessages
    .map(m => `${m.role === 'user' ? 'Analyst' : 'CaddyAI'}: ${m.content.slice(0, 500)}`)
    .join('\n\n');

  return new Promise((resolve) => {
    const requestId = nanoid();
    let settled = false;

    const timer = setTimeout(() => {
      if (!settled) {
        settled = true;
        window.removeEventListener('message', handler);
        resolve(null);
      }
    }, SUMMARY_TIMEOUT_MS);

    function handler(event: MessageEvent) {
      if (event.source !== window || !event.data) return;
      if (event.data.requestId !== requestId) return;

      if (event.data.type === 'TC_LLM_DONE') {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        window.removeEventListener('message', handler);
        const blocks: ContentBlock[] = event.data.contentBlocks || [];
        const textBlock = blocks.find((b): b is { type: 'text'; text: string } => b.type === 'text');
        resolve(textBlock?.text?.trim() || null);
        return;
      }

      if (event.data.type === 'TC_LLM_ERROR') {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        window.removeEventListener('message', handler);
        resolve(null);
        return;
      }
    }

    window.addEventListener('message', handler);

    window.postMessage({
      type: 'TC_LLM_REQUEST',
      requestId,
      payload: {
        provider,
        model,
        messages: [{
          role: 'user' as const,
          content: `Summarize this threat investigation conversation in 3-5 bullet points. Preserve:\n- All IOCs mentioned (IPs, domains, hashes, CVEs)\n- Key decisions and findings\n- Current investigation status\n- Any attribution or actor names\n\nConversation:\n${conversationText}`,
        }],
        apiKey,
        systemPrompt: 'You are a concise summarizer for threat investigation conversations. Output only the bullet-point summary, no preamble.',
        endpoint,
      },
    }, postMessageOrigin());
  });
}

/**
 * Generate a concise chat title via a one-shot LLM request through the extension bridge.
 * Returns null on timeout or failure so callers can silently fall back.
 */
export function generateChatTitle(
  userMessage: string,
  assistantReply: string,
  provider: LLMProvider,
  model: string,
  apiKey: string,
  endpoint?: string,
): Promise<string | null> {
  return new Promise((resolve) => {
    const requestId = nanoid();
    let settled = false;

    const timer = setTimeout(() => {
      if (!settled) {
        settled = true;
        window.removeEventListener('message', handler);
        resolve(null);
      }
    }, TITLE_TIMEOUT_MS);

    function handler(event: MessageEvent) {
      if (event.source !== window || !event.data) return;
      if (event.data.requestId !== requestId) return;

      if (event.data.type === 'TC_LLM_DONE') {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        window.removeEventListener('message', handler);

        const blocks: ContentBlock[] = event.data.contentBlocks || [];
        const textBlock = blocks.find((b): b is { type: 'text'; text: string } => b.type === 'text');
        const title = textBlock?.text?.trim();
        resolve(title || null);
        return;
      }

      if (event.data.type === 'TC_LLM_ERROR') {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        window.removeEventListener('message', handler);
        resolve(null);
        return;
      }
      // Ignore TC_LLM_CHUNK for this request — we only need the final result
    }

    window.addEventListener('message', handler);

    window.postMessage({
      type: 'TC_LLM_REQUEST',
      requestId,
      payload: {
        provider,
        model,
        messages: [
          {
            role: 'user' as const,
            content: `User: ${userMessage.slice(0, 300)}\n\nAssistant: ${assistantReply.slice(0, 300)}`,
          },
        ],
        apiKey,
        systemPrompt: 'Generate a concise 3-6 word title for this conversation. Reply with ONLY the title, no quotes or punctuation.',
        endpoint,
      },
    }, postMessageOrigin());
  });
}
