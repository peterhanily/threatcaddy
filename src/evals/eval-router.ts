/**
 * Lets an eval choose the model an agent cycle talks to. In the file that runs
 * the eval:
 *
 *   vi.mock('../lib/llm-router', async orig => (await import('../evals/eval-router')).evalRouter(await orig()));
 *
 * Every route then goes to the send function runAgentEval was given, and to
 * nothing when none is set. Like helpers/scripted-llm, this module imports no
 * app code, so the mocked router can load it.
 */
import type { LLMRouteCallbacks, LLMRouteRequest } from '../lib/llm-router';

/** The router's own send shape: answer through the callbacks, return a request id. */
export type EvalSend = (request: LLMRouteRequest, callbacks: LLMRouteCallbacks, signal?: AbortSignal) => string;

let active: EvalSend | undefined;
export const setEvalSend = (send: EvalSend | undefined) => { active = send; };

const send: EvalSend = (request, callbacks, signal) => {
  if (active) return active(request, callbacks, signal);
  callbacks.onError('No eval model is set.');
  return 'agent-eval';
};

export function evalRouter<T extends object>(original: T): T {
  return { ...original, sendViaServer: send, sendViaExtension: send, sendDirectToLocal: send };
}
