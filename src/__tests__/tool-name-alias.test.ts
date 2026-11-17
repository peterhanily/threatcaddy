import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { db } from '../db';
import { DEFAULT_AGENT_POLICY, DEFAULT_SETTINGS, type AgentProfile, type Folder, type Settings } from '../types';
import { decodeBlocks, encodeRequest } from '../lib/tool-name-alias';
import { getHostToolDefinitions } from '../lib/agent-hosts';
import { TOOL_DEFINITIONS } from '../lib/llm-tool-defs';
import { sendDirectToLocal, sendViaExtension, sendViaServer, type LLMRouteRequest } from '../lib/llm-router';
import { useLLM } from '../hooks/useLLM';
import { runAgentCycle } from '../lib/caddy-agent';
import { runSupervisorCycle } from '../lib/caddy-agent-supervisor';

const server = vi.hoisted(() => ({ stream: vi.fn() }));
vi.mock('../lib/server-api', async (importOriginal) => ({ ...await importOriginal<typeof import('../lib/server-api')>(), streamLLMChat: server.stream }));

// Anthropic, OpenAI and Mistral accept only this shape of tool name.
const PROVIDER_SAFE = /^[a-zA-Z0-9_-]{1,64}$/;
const LONG = 's'.repeat(80);
const skill = (name: string) => ({ name, description: `Synthetic ${name}`, parameters: { type: 'object' as const, properties: {}, required: [] } });
const settings: Settings = {
  ...DEFAULT_SETTINGS,
  llmDefaultProvider: 'anthropic', llmAnthropicApiKey: 'synthetic-key',
  llmLocalEndpoint: 'http://localhost:11434/v1', llmLocalSkills: [skill('triage'), skill(LONG)],
  agentHosts: [
    { id: 'h1', name: 'soc1', displayName: 'SOC One', url: 'https://soc1.example', enabled: true, skills: [skill('isolate')] },
    { id: 'h2', name: 'soc-2', displayName: 'SOC Two', url: 'https://soc2.example', enabled: true, skills: [skill('scan'), skill(LONG)] },
  ],
};
const folder: Folder = { id: 'case', name: 'Synthetic case', order: 0, createdAt: 1, status: 'active' };

type Payload = { tools?: { name: string; description?: string }[]; messages: { role: string; content: unknown }[] };
const toolUses = (payload: Payload) => payload.messages.flatMap(message => Array.isArray(message.content)
  ? (message.content as { type: string; name?: string }[]).filter(block => block.type === 'tool_use') : []);
const outgoingNames = (payload: Payload) => [...(payload.tools ?? []).map(tool => tool.name), ...toolUses(payload).map(block => block.name)];
const aliasOf = (payload: Payload, description: string) => payload.tools?.find(tool => tool.description === description)?.name ?? `missing tool: ${description}`;

// Extension double: records every TC_LLM_REQUEST and answers it with the next scripted turn.
type Reply = (payload: Payload) => { stopReason: string; contentBlocks: unknown[] };
let requests: { requestId: string; payload: Payload }[] = [];
let replies: Reply[] = [];
function installExtension() {
  vi.spyOn(window, 'postMessage').mockImplementation(((message: { type?: string; requestId: string; payload: Payload }) => {
    if (message?.type !== 'TC_LLM_REQUEST') return;
    requests.push(message);
    const reply = (replies.shift() ?? (() => ({ stopReason: 'end_turn', contentBlocks: [{ type: 'text', text: 'Done.' }] })))(message.payload);
    setTimeout(() => window.dispatchEvent(new MessageEvent('message', { source: window, data: { type: 'TC_LLM_DONE', requestId: message.requestId, ...reply } })), 0);
  }) as typeof window.postMessage);
}

beforeEach(async () => {
  requests = []; replies = [];
  server.stream.mockReset();
  await Promise.all(db.tables.map(table => table.clear()));
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe('D-NAMES-2 alias round trip', () => {
  it('maps dynamic names to readable aliases and restores the internal names', () => {
    const request = { messages: [], tools: [{ name: 'read_note' }, { name: 'local:triage' }, { name: 'host:soc1:isolate' }] };
    const { req, decode } = encodeRequest(request);
    expect(req.tools.map(tool => tool.name)).toEqual(['read_note', 'local__triage', 'host__soc1__isolate']);
    expect(request.tools[1].name).toBe('local:triage');
    expect(decodeBlocks([{ type: 'text', text: 'local__triage' }, { type: 'tool_use', id: 'a', name: 'host__soc1__isolate', input: {} }, { type: 'tool_use', id: 'b', name: 'read_note', input: {} }], decode))
      .toEqual([{ type: 'text', text: 'local__triage' }, { type: 'tool_use', id: 'a', name: 'host:soc1:isolate', input: {} }, { type: 'tool_use', id: 'b', name: 'read_note', input: {} }]);
  });

  it('gives an 80-char skill a deterministic short alias that decodes', () => {
    const internal = `local:${LONG}`;
    const first = encodeRequest({ messages: [], tools: [{ name: internal }] });
    const alias = first.req.tools[0].name;
    expect(alias).toMatch(/^dyn_[0-9a-f]{16}$/);
    expect(encodeRequest({ messages: [], tools: [{ name: internal }] }).req.tools[0].name).toBe(alias);
    expect(first.decode(alias)).toBe(internal);
    expect(first.decode('unknown_tool')).toBe('unknown_tool');
  });

  it('hashes ambiguous readable aliases instead of decoding one name as another', () => {
    const { req, decode } = encodeRequest({ messages: [{ role: 'assistant', content: [{ type: 'tool_use', id: 'x', name: 'local__x', input: {} }] }],
      tools: [{ name: 'host:a__b:c' }, { name: 'host:a:b__c' }, { name: 'local:x' }] });
    const names = req.tools.map(tool => tool.name);
    expect(new Set(names).size).toBe(3);
    for (const name of names) expect(name).toMatch(/^dyn_[0-9a-f]{16}$/);
    expect(names.map(decode)).toEqual(['host:a__b:c', 'host:a:b__c', 'local:x']);
    expect(decode('local__x')).toBe('local__x');
  });

  it('refuses an alias that collides with a name sent unchanged', () => {
    const internal = `local:${LONG}`;
    const alias = encodeRequest({ messages: [], tools: [{ name: internal }] }).req.tools[0].name;
    expect(() => encodeRequest({ messages: [{ role: 'assistant', content: [{ type: 'tool_use', id: 'x', name: alias, input: {} }] }], tools: [{ name: internal }] }))
      .toThrow(/collides/);
  });
});

describe('D-NAMES-1 and D-NAMES-3 at every transport', () => {
  it('useLLM sends only provider-safe names, decodes calls before the executor and encodes replayed history', async () => {
    installExtension();
    const tools = [...TOOL_DEFINITIONS.slice(0, 2), ...getHostToolDefinitions(settings)];
    replies = [payload => ({ stopReason: 'tool_use', contentBlocks: [{ type: 'tool_use', id: 'call-1', name: aliasOf(payload, `[SOC Two] Synthetic ${LONG}`), input: { q: 1 } }] })];
    const executor = vi.fn().mockResolvedValue({ result: 'ok', isError: false });
    const complete = vi.fn();
    const { result } = renderHook(() => useLLM());
    act(() => { result.current.sendAgentRequest({ provider: 'anthropic', model: 'fixture', apiKey: 'synthetic-key', messages: [{ role: 'user', content: 'Check the host.' }], tools }, executor, complete); });
    await vi.waitFor(() => expect(complete).toHaveBeenCalled());
    expect(executor).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ name: `host:soc-2:${LONG}` }), expect.anything());
    expect(requests).toHaveLength(2);
    for (const { payload } of requests) {
      expect(payload.tools).toHaveLength(tools.length);
      for (const name of outgoingNames(payload)) expect(name).toMatch(PROVIDER_SAFE);
    }
    expect(toolUses(requests[1].payload).map(block => block.name)).toEqual([aliasOf(requests[1].payload, `[SOC Two] Synthetic ${LONG}`)]);
  });

  it('an agent cycle sends provider-safe names and decodes a skill call before the allowlist and the queue', async () => {
    installExtension();
    await db.folders.add(folder);
    const profile: AgentProfile = { id: 'synthetic-profile', name: 'Synthetic analyst', role: 'specialist', systemPrompt: 'Review.', policy: DEFAULT_AGENT_POLICY, source: 'user', createdAt: 1, updatedAt: 1 };
    await db.agentProfiles.add(profile);
    replies = [payload => ({ stopReason: 'tool_use', contentBlocks: [
      { type: 'tool_use', id: 'call-1', name: 'get_investigation_summary', input: {} },
      { type: 'tool_use', id: 'call-2', name: aliasOf(payload, '[Local Agent] Synthetic triage'), input: { target: 'host-1' } },
    ] })];
    await runAgentCycle(folder, settings, true, undefined, profile);
    expect(requests).toHaveLength(2);
    for (const { payload } of requests) for (const name of outgoingNames(payload)) expect(name).toMatch(PROVIDER_SAFE);
    expect(toolUses(requests[1].payload).map(block => block.name)).toEqual(['get_investigation_summary', aliasOf(requests[1].payload, '[Local Agent] Synthetic triage')]);
    expect(await db.agentActions.where('status').equals('pending').toArray()).toEqual([expect.objectContaining({ toolName: 'local:triage', toolInput: { target: 'host-1' } })]);
  });

  it('the supervisor sends provider-safe names', async () => {
    installExtension();
    await db.folders.bulkAdd([folder, { ...folder, id: 'case-2', name: 'Second synthetic case' }]);
    await runSupervisorCycle(settings, true);
    expect(requests.length).toBeGreaterThan(0);
    for (const { payload } of requests) for (const name of outgoingNames(payload)) expect(name).toMatch(PROVIDER_SAFE);
  });

  const replayed: LLMRouteRequest = {
    provider: 'anthropic', model: 'fixture', apiKey: 'synthetic-key', endpoint: 'http://localhost:11434/v1',
    tools: getHostToolDefinitions(settings),
    messages: [{ role: 'user', content: 'Scan.' }, { role: 'assistant', content: [{ type: 'tool_use', id: 'old', name: 'host:soc1:isolate', input: {} }] },
      { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'old', content: 'done' }] }],
  };
  const capture = (send: typeof sendViaServer) => new Promise<unknown[]>((resolve, reject) => { send(replayed, { onChunk: () => {}, onDone: (_reason, blocks) => resolve(blocks), onError: reject }); });

  it('sendViaExtension encodes the request and decodes the response', async () => {
    installExtension();
    replies = [payload => ({ stopReason: 'tool_use', contentBlocks: [{ type: 'tool_use', id: 'n', name: aliasOf(payload, '[SOC One] Synthetic isolate'), input: {} }] })];
    const blocks = await capture(sendViaExtension);
    for (const name of outgoingNames(requests[0].payload)) expect(name).toMatch(PROVIDER_SAFE);
    expect(toolUses(requests[0].payload).map(block => block.name)).toEqual(['host__soc1__isolate']);
    expect(blocks).toEqual([{ type: 'tool_use', id: 'n', name: 'host:soc1:isolate', input: {} }]);
  });

  it('sendViaServer encodes the request and decodes the response', async () => {
    server.stream.mockImplementation(async (data: Payload, _chunk: unknown, onDone: (reason: string, blocks: unknown[]) => void) => {
      onDone('tool_use', [{ type: 'tool_use', id: 'n', name: aliasOf(data, `[Local Agent] Synthetic ${LONG}`), input: {} }]);
    });
    const blocks = await capture(sendViaServer);
    const data = server.stream.mock.calls[0][0] as Payload;
    for (const name of outgoingNames(data)) expect(name).toMatch(PROVIDER_SAFE);
    expect(toolUses(data).map(block => block.name)).toEqual(['host__soc1__isolate']);
    expect(blocks).toEqual([{ type: 'tool_use', id: 'n', name: `local:${LONG}`, input: {} }]);
  });

  it('sendDirectToLocal encodes the request and decodes the response', async () => {
    const bodies: { tools: { function: { name: string } }[]; messages: { tool_calls?: { function: { name: string } }[] }[] }[] = [];
    vi.stubGlobal('fetch', vi.fn(async (_url: string, init: RequestInit) => {
      const body = JSON.parse(String(init.body));
      bodies.push(body);
      const name = body.tools.find((tool: { function: { description: string } }) => tool.function.description === '[SOC Two] Synthetic scan').function.name;
      const event = { choices: [{ delta: { tool_calls: [{ index: 0, id: 'n', function: { name, arguments: '{}' } }] }, finish_reason: 'tool_calls' }] };
      return new Response(`data: ${JSON.stringify(event)}\n\ndata: [DONE]\n\n`);
    }));
    const blocks = await capture(sendDirectToLocal);
    for (const name of [...bodies[0].tools.map(tool => tool.function.name), ...bodies[0].messages.flatMap(message => message.tool_calls ?? []).map(call => call.function.name)]) expect(name).toMatch(PROVIDER_SAFE);
    expect(bodies[0].messages.flatMap(message => message.tool_calls ?? []).map(call => call.function.name)).toEqual(['host__soc1__isolate']);
    expect(blocks).toEqual([{ type: 'tool_use', id: 'n', name: 'host:soc-2:scan', input: {} }]);
  });
});
