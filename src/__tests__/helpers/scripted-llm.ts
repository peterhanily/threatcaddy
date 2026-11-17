/**
 * A scripted model for deterministic chain tests. Each send records the request,
 * takes the next scripted turn and finishes it. In a test file:
 *
 *   import { scriptedLLM } from './helpers/scripted-llm';
 *   vi.mock('../lib/llm-router', async orig => (await import('./helpers/scripted-llm')).scriptedRouter(await orig()));
 *   scriptedLLM.script({ toolCalls: [{ name: 'fetch_url', input: { url } }] }, { text: 'Done.' });
 *
 * The mocked module and the test share this module instance, so they share the script.
 */
import type { LLMRouteCallbacks, LLMRouteRequest } from '../../lib/llm-router';

export interface ScriptedToolCall { id?: string; name: string; input: Record<string, unknown> }
export interface ScriptedTurn { text?: string; toolCalls?: ScriptedToolCall[] }

let callCount = 0;

export const scriptedLLM = {
  turns: [] as ScriptedTurn[],
  requests: [] as LLMRouteRequest[],
  /** Replace the script; later sends get an empty end_turn reply. */
  script(...turns: ScriptedTurn[]) { scriptedLLM.turns = [...turns]; },
  reset() { scriptedLLM.turns = []; scriptedLLM.requests = []; callCount = 0; },
  /** Tool names offered in a recorded request (the first one by default). */
  toolNames(request?: LLMRouteRequest): string[] {
    return (((request ?? scriptedLLM.requests[0])?.tools ?? []) as Array<{ name: string }>).map(tool => tool.name);
  },
};

function send(request: LLMRouteRequest, callbacks: LLMRouteCallbacks): string {
  scriptedLLM.requests.push(request);
  const turn = scriptedLLM.turns.shift() ?? { text: '' };
  const blocks: unknown[] = [];
  if (turn.text) blocks.push({ type: 'text', text: turn.text });
  for (const call of turn.toolCalls ?? []) {
    blocks.push({ type: 'tool_use', id: call.id ?? `scripted_${++callCount}`, name: call.name, input: call.input });
  }
  if (turn.text) callbacks.onChunk(turn.text);
  callbacks.onDone(turn.toolCalls?.length ? 'tool_use' : 'end_turn', blocks, { input: 1, output: 1 });
  return `scripted-${scriptedLLM.requests.length}`;
}

export function scriptedRouter<T extends object>(original: T): T {
  return { ...original, sendViaServer: send, sendViaExtension: send, sendDirectToLocal: send };
}
