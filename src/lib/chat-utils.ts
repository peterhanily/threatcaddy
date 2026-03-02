import { nanoid } from 'nanoid';
import type { LLMProvider, ContentBlock } from '../types';

const TITLE_TIMEOUT_MS = 5000;

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
      },
    }, '*');
  });
}
