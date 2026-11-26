/**
 * `pnpm eval:agents`: the agent eval against a real model. Opt-in and never part
 * of `pnpm test:run` or CI (vitest.eval.config.ts). Without ANTHROPIC_API_KEY it
 * is skipped and no request is made. See docs/agent-evals.md.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { db } from '../db';
import { DEFAULT_MODEL } from '../lib/models';
import { runAgentEval } from './agent-eval';
import type { EvalSend } from './eval-router';

vi.mock('../lib/llm-router', async orig => (await import('./eval-router')).evalRouter(await orig()));

const apiKey = process.env.ANTHROPIC_API_KEY;
const model = process.env.AGENT_EVAL_MODEL || DEFAULT_MODEL;
const cycles = Number(process.env.AGENT_EVAL_CYCLES) || 2;
const profiles = (process.env.AGENT_EVAL_PROFILES || '').split(',').map(id => id.trim()).filter(Boolean);

interface MessagesResponse {
  content?: Array<{ type: string; text?: string }>;
  stop_reason?: string;
  usage?: { input_tokens: number; output_tokens: number };
  error?: { message?: string };
}

/** One Messages API request per model turn. The cycle's messages and tool definitions are already in that API's shape. */
const anthropicSend: EvalSend = (request, callbacks, signal) => {
  void (async () => {
    try {
      const response = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        signal,
        headers: { 'content-type': 'application/json', 'x-api-key': apiKey ?? '', 'anthropic-version': '2023-06-01' },
        body: JSON.stringify({ model: request.model, max_tokens: 16000, system: request.systemPrompt, messages: request.messages, tools: request.tools }),
      });
      const body = await response.json() as MessagesResponse;
      if (!response.ok || !body.content) {
        callbacks.onError(body.error?.message || `HTTP ${response.status}`);
        return;
      }
      for (const block of body.content) if (block.type === 'text' && block.text) callbacks.onChunk(block.text);
      callbacks.onDone(body.stop_reason ?? 'end_turn', body.content, { input: body.usage?.input_tokens ?? 0, output: body.usage?.output_tokens ?? 0 });
    } catch (error) {
      callbacks.onError(error instanceof Error ? error.message : String(error));
    }
  })();
  return 'agent-eval';
};

beforeEach(async () => {
  for (const table of db.tables) await table.clear();
  localStorage.clear();
});

describe.skipIf(!apiKey)(`agent eval, ${model}, ${cycles} cycle(s)`, () => {
  it.each([undefined, ...profiles])('profile %s', async profileId => {
    const score = await runAgentEval({ send: anthropicSend, model, cycles, profileId });
    console.warn(JSON.stringify({ model, profile: profileId ?? 'legacy', ...score }, null, 2));
    // The numbers are the result. Only a run that could not reach the model fails.
    expect(score.errors).toEqual([]);
  });
});
