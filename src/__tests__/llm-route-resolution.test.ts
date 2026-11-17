import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { db } from '../db';
import { DEFAULT_AGENT_POLICY, DEFAULT_SETTINGS, type AgentDeployment, type Folder, type Settings } from '../types';
import { agentRefusal, hasServerSession, resolveRoute, sendDirectToLocal, sendViaExtension, sendViaServer, unavailableRouteError, type LLMRouteCallbacks } from '../lib/llm-router';
import { useLLM } from '../hooks/useLLM';
import { getAllLoops, startLoop, stopLoop } from '../lib/chat-loop';
import { runAgentMeeting } from '../lib/caddy-agent-meeting';
import { resolveAgentModel, runAgentCycle } from '../lib/caddy-agent';
import { runMultiAgentCycle } from '../lib/caddy-agent-manager';
import { runSupervisorCycle } from '../lib/caddy-agent-supervisor';
import { workspaceStorageKey } from '../lib/workspace-profiles';
import i18n from '../i18n';
import enSettings from '../../public/locales/en/settings.json';
import deSettings from '../../public/locales/de/settings.json';
import deAgent from '../../public/locales/de/agent.json';

// Real resolver, recorded transports. Each transport answers at once so a meeting completes.
const { answer } = vi.hoisted(() => ({
  answer: (_request: unknown, callbacks: LLMRouteCallbacks) => { callbacks.onChunk('Noted. [[confidence=5]]'); callbacks.onDone('end_turn', []); return 'request'; },
}));
vi.mock('../lib/llm-router', async (importOriginal) => ({
  ...await importOriginal<typeof import('../lib/llm-router')>(),
  sendViaServer: vi.fn(answer), sendViaExtension: vi.fn(answer), sendDirectToLocal: vi.fn(answer),
}));

const signIn = () => localStorage.setItem(workspaceStorageKey('threatcaddy-auth'), JSON.stringify({
  serverUrl: 'https://team.example', accessToken: 'synthetic-access', refreshToken: 'synthetic-refresh',
  user: { id: 'user-1', email: 'analyst@example.test', displayName: 'Analyst' },
}));
const local = { llmLocalEndpoint: 'http://localhost:11434/v1' };
const folder: Folder = { id: 'case', name: 'Synthetic case', order: 0, createdAt: 1, status: 'active' };
const deployments: AgentDeployment[] = ['ap-lead-analyst', 'ap-ioc-enricher'].map((profileId, order) => ({
  id: `d-${order}`, investigationId: folder.id, profileId, status: 'idle', order, createdAt: 1, updatedAt: 1,
}));
const meet = (settings: Partial<Settings>, extensionAvailable: boolean) =>
  runAgentMeeting(folder, deployments, { ...DEFAULT_SETTINGS, llmAnthropicApiKey: 'synthetic-key', ...settings }, extensionAvailable, 'Review the case');

beforeEach(async () => {
  vi.clearAllMocks();
  localStorage.clear();
  await Promise.all(db.tables.map(table => table.clear()));
  await db.folders.add(folder);
});
afterEach(() => { for (const loop of getAllLoops()) stopLoop(loop.id); });

describe('D-ROUTE-1 resolveRoute', () => {
  type Row = [Settings['llmRoutingMode'], boolean, boolean, ReturnType<typeof resolveRoute>];
  it.each<Row>([
    [undefined, true, true, { route: 'server' }],
    [undefined, true, false, { route: 'extension' }],
    [undefined, false, true, { route: 'server' }],
    [undefined, false, false, { route: 'unavailable', reason: 'none' }],
    ['auto', true, true, { route: 'server' }],
    ['auto', true, false, { route: 'extension' }],
    ['auto', false, true, { route: 'server' }],
    ['auto', false, false, { route: 'unavailable', reason: 'none' }],
    ['extension', true, true, { route: 'extension' }],
    ['extension', true, false, { route: 'extension' }],
    ['extension', false, true, { route: 'unavailable', reason: 'no-extension' }],
    ['extension', false, false, { route: 'unavailable', reason: 'no-extension' }],
    ['server', true, true, { route: 'server' }],
    ['server', true, false, { route: 'unavailable', reason: 'no-server' }],
    ['server', false, true, { route: 'server' }],
    ['server', false, false, { route: 'unavailable', reason: 'no-server' }],
  ])('mode %s, extension %s, session %s', (mode, extensionAvailable, serverSession, expected) => {
    const settings = { ...DEFAULT_SETTINGS, ...local, llmRoutingMode: mode };
    expect(resolveRoute(settings, { extensionAvailable, serverSession, provider: 'anthropic' })).toEqual(expected);
    // A local provider with an endpoint is always called directly, whatever the mode.
    expect(resolveRoute(settings, { extensionAvailable, serverSession, provider: 'local' })).toEqual({ route: 'local-direct' });
    // Without an endpoint the local provider follows the mode like any other.
    expect(resolveRoute({ ...settings, llmLocalEndpoint: undefined }, { extensionAvailable, serverSession, provider: 'local' })).toEqual(expected);
  });

  it('counts a server session only with a stored signed-in user, whose server the transport uses', () => {
    expect(hasServerSession()).toBe(false);
    signIn();
    // A first sign-in opens a new workspace whose settings start empty, so Settings has no server URL there.
    expect(hasServerSession()).toBe(true);
  });
});

describe('D-ROUTE-2 explicit modes are strict', () => {
  it('an explicit extension route with no extension is unavailable and never uses the server', async () => {
    signIn();
    const result = await meet({ serverUrl: 'https://team.example', llmRoutingMode: 'extension' }, false);
    expect(result.error).toMatch(/extension/i);
    expect(sendViaServer).not.toHaveBeenCalled();
    expect(sendViaExtension).not.toHaveBeenCalled();
  });

  it('an explicit server route without a session never falls back to the extension', async () => {
    const result = await meet({ serverUrl: 'https://team.example', llmRoutingMode: 'server' }, true);
    expect(result.error).toMatch(/server/i);
    expect(sendViaExtension).not.toHaveBeenCalled();
    expect(sendViaServer).not.toHaveBeenCalled();
  });
});

describe('D-ROUTE-3 local endpoint first', () => {
  const opts = { provider: 'local' as const, model: 'llama3', apiKey: 'local', endpoint: local.llmLocalEndpoint, useServerProxy: true, messages: [{ role: 'user' as const, content: 'Summarize.' }] };

  it('useLLM calls a local endpoint directly even with a server session', () => {
    const { result } = renderHook(() => useLLM());
    act(() => { result.current.sendAgentRequest(opts, vi.fn(), vi.fn()); });
    expect(sendDirectToLocal).toHaveBeenCalledOnce();
    expect(sendViaServer).not.toHaveBeenCalled();
  });

  it('a chat schedule calls a local endpoint directly even with a server session', () => {
    startLoop({ ...opts, threadId: 'thread', prompt: 'Summarize', intervalMs: 30_000, systemPrompt: '', onMessage: vi.fn().mockResolvedValue(undefined) });
    expect(sendDirectToLocal).toHaveBeenCalledOnce();
    expect(sendViaServer).not.toHaveBeenCalled();
  });

  it('a meeting calls a local endpoint directly even with a server session', async () => {
    signIn();
    const result = await meet({ serverUrl: 'https://team.example', llmDefaultProvider: 'local', llmLocalModelName: 'llama3', ...local }, true);
    expect(result.error).toBeUndefined();
    expect(sendDirectToLocal).toHaveBeenCalled();
    expect(sendViaServer).not.toHaveBeenCalled();
    expect(sendViaExtension).not.toHaveBeenCalled();
  });
});

describe('D-ROUTE-4 meetings need a signed-in server session', () => {
  it('a server URL with no stored user is not a server route', async () => {
    const result = await meet({ serverUrl: 'https://team.example' }, true);
    expect(result.error).toBeUndefined();
    expect(sendViaExtension).toHaveBeenCalled();
    expect(sendViaServer).not.toHaveBeenCalled();
  });

  it('a signed-in server session routes Auto through the server', async () => {
    signIn();
    const result = await meet({ serverUrl: 'https://team.example' }, true);
    expect(result.error).toBeUndefined();
    expect(sendViaServer).toHaveBeenCalled();
    expect(sendViaExtension).not.toHaveBeenCalled();
  });

  it('a signed-in session in a new workspace, whose settings have no server URL, still routes Auto through the server', async () => {
    signIn();
    const result = await meet({}, true);
    expect(result.error).toBeUndefined();
    expect(sendViaServer).toHaveBeenCalled();
    expect(sendViaExtension).not.toHaveBeenCalled();
  });
});

describe('D-ROUTE-5 agent cycles and the supervisor go where Settings says', () => {
  const base = { ...DEFAULT_SETTINGS, llmAnthropicApiKey: 'synthetic-key' };
  const cycle = (settings: Partial<Settings>, extensionAvailable: boolean) => runAgentCycle(folder, { ...base, ...settings }, extensionAvailable);
  // The supervisor compares investigations, so it needs two before it calls a model.
  const supervise = async (settings: Partial<Settings>, extensionAvailable: boolean) => {
    if (!await db.folders.get('case-2')) await db.folders.add({ ...folder, id: 'case-2', name: 'Second synthetic case' });
    return runSupervisorCycle({ ...base, ...settings }, extensionAvailable);
  };
  const noModelCall = () => {
    expect(sendViaServer).not.toHaveBeenCalled();
    expect(sendViaExtension).not.toHaveBeenCalled();
    expect(sendDirectToLocal).not.toHaveBeenCalled();
  };

  it('Auto with a server URL but no signed-in user: an agent cycle uses the extension, not the server', async () => {
    const result = await cycle({ serverUrl: 'https://team.example', llmRoutingMode: 'auto' }, true);
    expect(result.error).toBeUndefined();
    expect(sendViaExtension).toHaveBeenCalled();
    expect(sendViaServer).not.toHaveBeenCalled();
  });

  it('Auto with a server URL but no signed-in user: the supervisor uses the extension, not the server', async () => {
    const result = await supervise({ serverUrl: 'https://team.example', llmRoutingMode: 'auto' }, true);
    expect(result.error).toBeUndefined();
    expect(sendViaExtension).toHaveBeenCalled();
    expect(sendViaServer).not.toHaveBeenCalled();
  });

  it('a signed-in session in a new workspace, whose settings have no server URL: an agent cycle and the supervisor use the server', async () => {
    signIn();
    expect((await cycle({ llmRoutingMode: 'auto' }, true)).error).toBeUndefined();
    expect((await supervise({ llmRoutingMode: 'auto' }, true)).error).toBeUndefined();
    expect(vi.mocked(sendViaServer).mock.calls.length).toBeGreaterThanOrEqual(2);
    expect(sendViaExtension).not.toHaveBeenCalled();
  });

  it('an agent cycle refuses an explicit extension route with no extension, before any model call or audit thread', async () => {
    signIn();
    const result = await cycle({ serverUrl: 'https://team.example', llmRoutingMode: 'extension' }, false);
    expect(result.error).toBe(enSettings['ai.dataFlow.errorNoExtension']);
    noModelCall();
    expect(await db.chatThreads.count()).toBe(0);
  });

  it('the supervisor refuses an explicit server route while signed out, before any model call', async () => {
    const result = await supervise({ serverUrl: 'https://team.example', llmRoutingMode: 'server' }, true);
    expect(result.error).toBe(enSettings['ai.dataFlow.errorNoServer']);
    noModelCall();
  });

  it('a local model with an endpoint gets its own key, never the server placeholder', async () => {
    signIn();
    const settings: Partial<Settings> = { serverUrl: 'https://team.example', llmDefaultProvider: 'local', llmLocalModelName: 'llama3', llmLocalApiKey: 'synthetic-local-key', ...local };
    expect((await cycle(settings, true)).error).toBeUndefined();
    expect((await supervise(settings, true)).error).toBeUndefined();
    expect(vi.mocked(sendDirectToLocal).mock.calls.length).toBeGreaterThanOrEqual(2);
    for (const [request] of vi.mocked(sendDirectToLocal).mock.calls) expect(request.apiKey).toBe('synthetic-local-key');
    expect(sendViaServer).not.toHaveBeenCalled();
  });

  it('says why in the analyst’s language', async () => {
    for (const [namespace, values] of Object.entries(i18n.getDataByLanguage('en') ?? {})) i18n.addResourceBundle('de', namespace, values, true, false);
    i18n.addResourceBundle('de', 'settings', deSettings, true, true);
    await i18n.changeLanguage('de');
    try {
      expect((await cycle({ llmRoutingMode: 'auto' }, false)).error).toBe(deSettings['ai.dataFlow.errorNone']);
      expect((await supervise({ llmRoutingMode: 'auto' }, false)).error).toBe(deSettings['ai.dataFlow.errorNone']);
      expect((await meet({ llmRoutingMode: 'auto' }, false)).error).toBe(deSettings['ai.dataFlow.errorNone']);
      noModelCall();
    } finally { await i18n.changeLanguage('en'); }
  });

  it('says in the analyst’s language that a model has no key, or that a meeting has too few agents', async () => {
    for (const [namespace, values] of Object.entries(i18n.getDataByLanguage('en') ?? {})) i18n.addResourceBundle('de', namespace, values, true, false);
    i18n.addResourceBundle('de', 'agent', deAgent, true, true);
    await i18n.changeLanguage('de');
    const noKey = (provider: string) => deAgent['refusal.noApiKey'].replace('{{provider}}', provider);
    const keyless: Partial<Settings> = { llmAnthropicApiKey: undefined, llmRoutingMode: 'extension' };
    try {
      // The supervisor uses the default provider (Anthropic), which has no key here.
      expect((await supervise({ ...keyless, llmOpenAIApiKey: 'synthetic-openai-key' }, true)).error).toBe(noKey('anthropic'));
      expect((await meet(keyless, true)).error).toBe(noKey('anthropic'));
      expect((await cycle(keyless, true)).error).toBe(`${noKey('anthropic')} ${deAgent['panel.configureApiKeyDesc']}`);
      // The investigation's agent model is an OpenAI model, and only an Anthropic key is saved.
      await db.folders.update(folder.id, { agentPolicy: { ...DEFAULT_AGENT_POLICY, model: 'gpt-5.4' } });
      expect((await cycle({ llmRoutingMode: 'extension' }, true)).error)
        .toBe(`${noKey('openai')} ${deAgent['refusal.configuredProviders'].replace('{{providers}}', 'anthropic')}`);
      const alone = await runAgentMeeting(folder, deployments.slice(0, 1), { ...DEFAULT_SETTINGS, llmAnthropicApiKey: 'synthetic-key', llmRoutingMode: 'extension' }, true, 'Review the case');
      expect(alone.error).toBe(deAgent['meeting.deploy2Plus']);
      noModelCall();
    } finally { await i18n.changeLanguage('en'); }
  });

  it('says in the analyst’s language that no deployed agent is active', async () => {
    for (const [namespace, values] of Object.entries(i18n.getDataByLanguage('en') ?? {})) i18n.addResourceBundle('de', namespace, values, true, false);
    i18n.addResourceBundle('de', 'agent', deAgent, true, true);
    await i18n.changeLanguage('de');
    try {
      // Every deployed agent is paused or resting, and the analyst clicks Run.
      await db.agentDeployments.bulkAdd([{ ...deployments[0], status: 'paused' }, { ...deployments[1], shift: 'resting' }]);
      const result = await runMultiAgentCycle(folder, { ...base, llmRoutingMode: 'extension' }, true, undefined, undefined, { manual: true });
      expect(result.errors).toEqual([deAgent['refusal.noActiveDeployments']]);
      noModelCall();
    } finally { await i18n.changeLanguage('en'); }
  });

  it('an investigation whose agent model is the local model runs on it directly, signed out and with no extension', async () => {
    const settings: Partial<Settings> = { llmRoutingMode: 'auto', llmLocalModelName: 'llama3', ...local };
    await db.folders.update(folder.id, { agentPolicy: { ...DEFAULT_AGENT_POLICY, model: 'llama3' } });
    // The AgentCaddy panel resolves its readiness with the same helper.
    expect(resolveAgentModel({ ...base, ...settings }, 'llama3')).toEqual({ provider: 'local', model: 'llama3' });
    expect((await cycle(settings, false)).error).toBeUndefined();
    expect(sendDirectToLocal).toHaveBeenCalled();
    expect(sendViaExtension).not.toHaveBeenCalled();
  });
});

describe('translated refusals load their namespace first', () => {
  // The suite bundles every namespace, so only a spy sees a hosted build's lazy load go missing.
  it.each([
    ['agentRefusal', 'agent', () => agentRefusal('refusal.noApiKey', { provider: 'openai' }), 'refusal.noApiKey'],
    ['unavailableRouteError', 'settings', () => unavailableRouteError('none'), 'ai.dataFlow.errorNone'],
  ] as const)('%s waits for the %s namespace before it translates', async (_name, namespace, refuse, key) => {
    let loaded = () => {};
    const load = vi.spyOn(i18n, 'loadNamespaces').mockImplementation(() => new Promise<void>(resolve => { loaded = resolve; }));
    const translate = vi.spyOn(i18n, 't');
    try {
      const refusal = refuse();
      await new Promise(resolve => setTimeout(resolve, 0));
      expect(load).toHaveBeenCalledExactlyOnceWith(namespace);
      expect(translate).not.toHaveBeenCalled();
      loaded();
      await refusal;
      expect(translate).toHaveBeenCalledWith(key, expect.objectContaining({ ns: namespace }));
    } finally { load.mockRestore(); translate.mockRestore(); }
  });
});
