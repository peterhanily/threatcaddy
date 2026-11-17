import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { db } from '../db';
import { DEFAULT_SETTINGS, type AgentDeployment, type Folder, type Settings } from '../types';
import { hasServerSession, resolveRoute, sendDirectToLocal, sendViaExtension, sendViaServer, type LLMRouteCallbacks } from '../lib/llm-router';
import { useLLM } from '../hooks/useLLM';
import { getAllLoops, startLoop, stopLoop } from '../lib/chat-loop';
import { runAgentMeeting } from '../lib/caddy-agent-meeting';
import { workspaceStorageKey } from '../lib/workspace-profiles';

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

  it('counts a server session only with a server URL and a stored signed-in user', () => {
    expect(hasServerSession({ ...DEFAULT_SETTINGS, serverUrl: 'https://team.example' })).toBe(false);
    signIn();
    expect(hasServerSession({ ...DEFAULT_SETTINGS, serverUrl: 'https://team.example' })).toBe(true);
    expect(hasServerSession({ ...DEFAULT_SETTINGS })).toBe(false);
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
});
