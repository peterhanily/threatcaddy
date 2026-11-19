/** The Chrome Web Store's extension 1.1.1 has no app pairing, follows redirects and has no private-address
 * filter. The app uses none of the extension's features (AI, integration proxy, web fetch) unless the bridge
 * that owns the page advertises the 1.1.3+ pairing capability, and says which version it needs and where. */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { sendViaExtension, unavailableRouteError } from '../lib/llm-router';
import { generateChatTitle, summarizeConversation } from '../lib/chat-utils';
import { IntegrationExecutor } from '../lib/integration-executor';
import { executeFetchUrl } from '../lib/llm-tools-analysis';
import { useLLM } from '../hooks/useLLM';
import { isPairedBridgeCaps } from '../lib/extension-bridge';
import type { IntegrationTemplate, InstalledIntegration } from '../types/integration-types';
import enCommon from '../../public/locales/en/common.json';
import enSettings from '../../public/locales/en/settings.json';

// Store 1.1.1 (66ec58f4 bridge.js:6), the 1.1.3 download (aa4646ad bridge.js:6) and 1.1.4 (bridge.js:6).
const STORE_1_1_1_CAPS = ['llm_streaming', 'fetch_url', 'clip_import', 'proxy_fetch'];
const CAPS_1_1_3 = ['llm_streaming', 'fetch_url', 'clip_import', 'clip_import_ack_v2', 'proxy_fetch', 'proxy_fetch_abort', 'notification_ack'];
const CAPS_1_1_4 = ['llm_streaming', 'fetch_url', 'fetch_url_public_v1', 'clip_import', 'clip_import_ack_v2', 'proxy_fetch', 'proxy_fetch_abort', 'notification_ack'];

/** Every message the page posted, in order. */
let posts: Array<Record<string, unknown>>;
/** The capabilities each bridge listening on the page answers a ping with. */
let owners: string[][];
const posted = (type: string) => posts.filter(message => message.type === type);
/** As in a browser, a posted message reaches the window's listeners on a later task, in posting order. */
const deliver = (data: unknown) => setTimeout(() => window.dispatchEvent(new MessageEvent('message', { source: window, data })), 0);
/** Installed bridges: `published` is on the page, and each of `answering` answers pings and proxy fetches. None
 *  answers in a tab left open while its extension was updated or reloaded. */
function installBridge(published: string[] | undefined, answering: string[][] = published ? [published] : []) {
  owners = answering;
  if (published) document.documentElement.dataset.tcBridgeCaps = published.join(',');
}
const flush = () => new Promise(resolve => setTimeout(resolve, 20));
const UPDATE_REQUIRED = enCommon['extension.updateRequired'];
const RELOAD_REQUIRED = (enCommon as Record<string, string>)['extension.reloadRequired'];

beforeEach(() => {
  posts = [];
  owners = [];
  vi.spyOn(window, 'postMessage').mockImplementation((message: unknown) => {
    const data = message as Record<string, unknown>;
    posts.push(data);
    deliver(data);
    if (data.type === 'TC_EXTENSION_PING') for (const caps of owners) deliver({ type: 'TC_EXTENSION_READY', protocolVersion: 1, capabilities: caps });
    if (data.type === 'TC_PROXY_FETCH' && owners.length) deliver({ type: 'TC_PROXY_FETCH_RESULT', requestId: data.requestId, success: true, status: 200, statusText: 'OK', data: { relayed: true }, headers: {} });
  });
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  delete document.documentElement.dataset.tcBridgeCaps;
});

const request = { provider: 'anthropic', model: 'fixture-model', messages: [{ role: 'user', content: 'Summarise the case' }], apiKey: 'synthetic-key' };

describe('AI requests through the extension', () => {
  it('store 1.1.1 gets no request, and the analyst is told the version and where to get it', async () => {
    installBridge(STORE_1_1_1_CAPS);
    const onError = vi.fn();
    sendViaExtension(request, { onChunk: vi.fn(), onDone: vi.fn(), onError });
    await vi.waitFor(() => expect(onError).toHaveBeenCalledOnce());
    expect(onError.mock.calls[0][0]).toContain('1.1.3');
    expect(onError.mock.calls[0][0]).toContain('GitHub');
    await flush();
    expect(posted('TC_LLM_REQUEST')).toHaveLength(0);
  });

  it('refuses when a 1.1.3 copy published its capabilities but store 1.1.1 owns the page', async () => {
    installBridge(CAPS_1_1_3, [STORE_1_1_1_CAPS]);
    const onError = vi.fn();
    sendViaExtension(request, { onChunk: vi.fn(), onDone: vi.fn(), onError });
    await vi.waitFor(() => expect(onError).toHaveBeenCalledOnce());
    await flush();
    expect(posted('TC_LLM_REQUEST')).toHaveLength(0);
  });

  it('refuses when one of two answering bridges is store 1.1.1', async () => {
    installBridge(CAPS_1_1_4, [CAPS_1_1_4, STORE_1_1_1_CAPS]);
    const onError = vi.fn();
    sendViaExtension(request, { onChunk: vi.fn(), onDone: vi.fn(), onError });
    await vi.waitFor(() => expect(onError).toHaveBeenCalledOnce());
    expect(onError.mock.calls[0][0]).toBe(UPDATE_REQUIRED);
    await flush();
    expect(posted('TC_LLM_REQUEST')).toHaveLength(0);
  });

  // After an extension update or reload, an open tab keeps the old bridge's capabilities, but that bridge
  // no longer answers: the page needs a reload, not another install.
  it('asks for a page reload when the published bridge no longer answers', async () => {
    installBridge(CAPS_1_1_4, []);
    const onError = vi.fn();
    sendViaExtension(request, { onChunk: vi.fn(), onDone: vi.fn(), onError });
    await vi.waitFor(() => expect(onError).toHaveBeenCalledOnce());
    expect(RELOAD_REQUIRED).toBeTruthy();
    expect(onError.mock.calls[0][0]).toBe(RELOAD_REQUIRED);
    expect(posted('TC_LLM_REQUEST')).toHaveLength(0);
  });

  it('a chat request to a bridge that no longer answers asks for a page reload', async () => {
    installBridge(CAPS_1_1_4, []);
    const { result } = renderHook(() => useLLM());
    const complete = vi.fn();
    act(() => { result.current.sendAgentRequest({ ...request, provider: 'anthropic', messages: [{ role: 'user', content: 'Summarise the case' }] }, vi.fn(), complete); });
    await act(async () => { await vi.waitFor(() => expect(complete).toHaveBeenCalledOnce()); });
    expect(RELOAD_REQUIRED).toBeTruthy();
    expect(complete.mock.calls[0][0].error).toBe(RELOAD_REQUIRED);
    expect(posted('TC_LLM_REQUEST')).toHaveLength(0);
  });

  it.each([['1.1.3', CAPS_1_1_3], ['1.1.4', CAPS_1_1_4]])('a paired %s bridge gets the request', async (_version, caps) => {
    installBridge(caps);
    const onError = vi.fn();
    sendViaExtension(request, { onChunk: vi.fn(), onDone: vi.fn(), onError });
    await vi.waitFor(() => expect(posted('TC_LLM_REQUEST')).toHaveLength(1));
    expect(onError).not.toHaveBeenCalled();
  });

  it('does not post the request when cancelled while the bridge is checked', async () => {
    installBridge(CAPS_1_1_4);
    const controller = new AbortController();
    const callbacks = { onChunk: vi.fn(), onDone: vi.fn(), onError: vi.fn() };
    sendViaExtension(request, callbacks, controller.signal);
    controller.abort();
    await flush();
    expect(posted('TC_LLM_REQUEST')).toHaveLength(0);
    expect(callbacks.onError).not.toHaveBeenCalled();
  });

  it('chat counts only a paired bridge as available', async () => {
    const { result } = renderHook(() => useLLM());
    await act(async () => { deliver({ type: 'TC_EXTENSION_READY', protocolVersion: 1, capabilities: STORE_1_1_1_CAPS }); await flush(); });
    expect(result.current.extensionAvailable).toBe(false);
    await act(async () => { deliver({ type: 'TC_EXTENSION_READY', protocolVersion: 1, capabilities: CAPS_1_1_4 }); await flush(); });
    expect(result.current.extensionAvailable).toBe(true);
    await act(async () => { deliver({ type: 'TC_EXTENSION_READY', protocolVersion: 1 }); await flush(); });
    expect(result.current.extensionAvailable).toBe(false);
  });

  it('chat tells store 1.1.1 apart from no extension', async () => {
    const { result } = renderHook(() => useLLM());
    expect(result.current.extensionOutdated).toBe(false);
    await act(async () => { deliver({ type: 'TC_EXTENSION_READY', protocolVersion: 1, capabilities: STORE_1_1_1_CAPS }); await flush(); });
    expect(result.current.extensionOutdated).toBe(true);
    await act(async () => { deliver({ type: 'TC_EXTENSION_READY', protocolVersion: 1, capabilities: CAPS_1_1_4 }); await flush(); });
    expect(result.current.extensionOutdated).toBe(false);
  });

  // With the GitHub build and store 1.1.1 both installed, the GitHub build owns the page and publishes its
  // capabilities, and 1.1.1's second injection announces itself once more, possibly last.
  it('a store 1.1.1 announcement after the paired bridge’s does not turn chat off', async () => {
    installBridge(CAPS_1_1_4);
    const { result } = renderHook(() => useLLM());
    await act(async () => { deliver({ type: 'TC_EXTENSION_READY', protocolVersion: 1, capabilities: CAPS_1_1_4 }); await flush(); });
    await act(async () => { deliver({ type: 'TC_EXTENSION_READY', protocolVersion: 1, capabilities: STORE_1_1_1_CAPS }); await flush(); });
    expect(result.current.extensionAvailable).toBe(true);
    expect(result.current.extensionOutdated).toBe(false);
  });

  it('a chat request posts nothing to store 1.1.1 and ends with the update message', async () => {
    installBridge(STORE_1_1_1_CAPS);
    const { result } = renderHook(() => useLLM());
    const complete = vi.fn();
    act(() => { result.current.sendAgentRequest({ ...request, provider: 'anthropic', messages: [{ role: 'user', content: 'Summarise the case' }] }, vi.fn(), complete); });
    await act(async () => { await vi.waitFor(() => expect(complete).toHaveBeenCalledOnce()); });
    expect(complete.mock.calls[0][0].error).toContain('1.1.3');
    expect(result.current.isStreaming).toBe(false);
    expect(posted('TC_LLM_REQUEST')).toHaveLength(0);
  });

  it('a chat request reaches a paired bridge', async () => {
    installBridge(CAPS_1_1_4);
    const { result } = renderHook(() => useLLM());
    act(() => { result.current.sendAgentRequest({ ...request, provider: 'anthropic', messages: [{ role: 'user', content: 'Summarise the case' }] }, vi.fn(), vi.fn()); });
    await act(async () => { await vi.waitFor(() => expect(posted('TC_LLM_REQUEST')).toHaveLength(1)); });
    expect(result.current.isStreaming).toBe(true);
  });

  it('chat titles and summaries never go to store 1.1.1', async () => {
    installBridge(STORE_1_1_1_CAPS);
    expect(await generateChatTitle('Hello', 'Hi there', 'anthropic', 'fixture-model', 'synthetic-key')).toBeNull();
    expect(await summarizeConversation([{ role: 'user', content: 'Earlier finding' }], 'anthropic', 'fixture-model', 'synthetic-key')).toBeNull();
    expect(posted('TC_LLM_REQUEST')).toHaveLength(0);
  });

  it('chat titles still go to a paired bridge', async () => {
    installBridge(CAPS_1_1_4);
    void generateChatTitle('Hello', 'Hi there', 'anthropic', 'fixture-model', 'synthetic-key');
    await vi.waitFor(() => expect(posted('TC_LLM_REQUEST')).toHaveLength(1));
  });
});

const template: IntegrationTemplate = {
  id: 'fixture-template', schemaVersion: '1.0', version: '1.0.0', name: 'Fixture lookup', description: 'Fixture', author: 'test',
  icon: 'search', color: '#000', category: 'enrichment', tags: [], triggers: [{ type: 'manual' }], configSchema: [],
  steps: [{ id: 'lookup', type: 'http', label: 'Lookup', method: 'GET', url: 'https://api.example.com/lookup' }],
  outputs: [], requiredDomains: ['api.example.com'], source: 'user', createdAt: 1, updatedAt: 1,
};
const installation: InstalledIntegration = {
  id: 'fixture-installation', templateId: 'fixture-template', name: 'Fixture lookup', enabled: true, config: {},
  scopeType: 'all', scopeFolderIds: [], runCount: 0, errorCount: 0, createdAt: 1, updatedAt: 1,
};
const runIntegration = () => new IntegrationExecutor().run(template, installation,
  { ioc: { id: 'ioc', value: '198.51.100.7', type: 'ipv4', confidence: 'high' } }, { onLog: vi.fn() });

describe('integration requests through the extension proxy', () => {
  it('store 1.1.1 advertises proxy_fetch but gets no request; the page fetches as without an extension', async () => {
    installBridge(STORE_1_1_1_CAPS);
    const fetch = vi.fn(async () => new Response('{"direct":true}', { status: 200, headers: { 'Content-Type': 'application/json' } }));
    vi.stubGlobal('fetch', fetch);
    expect((await runIntegration()).status).toBe('success');
    expect(posted('TC_PROXY_FETCH')).toHaveLength(0);
    expect(fetch).toHaveBeenCalledOnce();
  });

  it('names the extension update when the page cannot make the request store 1.1.1 was not given', async () => {
    installBridge(STORE_1_1_1_CAPS);
    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('Failed to fetch'); }));
    const run = await runIntegration();
    expect(run.status).toBe('error');
    expect(run.error).toContain('Failed to fetch');
    expect(run.error).toContain('1.1.3');
    expect(posted('TC_PROXY_FETCH')).toHaveLength(0);
  });

  it('keeps a bare network error when no extension is installed', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('Failed to fetch'); }));
    const run = await runIntegration();
    expect(run.error).toContain('Failed to fetch');
    expect(run.error).not.toContain('1.1.3');
  });

  it('asks for a page reload, not an install, when the published bridge no longer answers', async () => {
    installBridge(CAPS_1_1_4, []);
    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('Failed to fetch'); }));
    const run = await runIntegration();
    expect(RELOAD_REQUIRED).toBeTruthy();
    expect(run.error).toBe(`Failed to fetch. ${RELOAD_REQUIRED}`);
    expect(posted('TC_PROXY_FETCH')).toHaveLength(0);
  });

  it('refuses the proxy when a 1.1.3 copy published its capabilities but store 1.1.1 owns the page', async () => {
    installBridge(CAPS_1_1_3, [STORE_1_1_1_CAPS]);
    const fetch = vi.fn(async () => new Response('{}', { status: 200 }));
    vi.stubGlobal('fetch', fetch);
    await runIntegration();
    expect(posted('TC_PROXY_FETCH')).toHaveLength(0);
    expect(fetch).toHaveBeenCalledOnce();
  });

  it('a paired 1.1.4 bridge relays the request', async () => {
    installBridge(CAPS_1_1_4);
    const fetch = vi.fn();
    vi.stubGlobal('fetch', fetch);
    expect((await runIntegration()).status).toBe('success');
    expect(posted('TC_PROXY_FETCH')).toHaveLength(1);
    expect(fetch).not.toHaveBeenCalled();
  });
});

// Store 1.1.1 publishes its capabilities on every page: its users already have an extension installed and
// turned on, so the route errors of chat, agents, meetings and the supervisor say what to install instead.
describe('route errors with an extension older than 1.1.3', () => {
  it.each(['none', 'no-extension'] as const)('%s names the version and where to get it', async reason => {
    installBridge(STORE_1_1_1_CAPS);
    expect(await unavailableRouteError(reason)).toBe(UPDATE_REQUIRED);
  });

  it('keeps the other route errors', async () => {
    installBridge(STORE_1_1_1_CAPS);
    expect(await unavailableRouteError('no-server')).toBe(enSettings['ai.dataFlow.errorNoServer']);
    delete document.documentElement.dataset.tcBridgeCaps;
    expect(await unavailableRouteError('none')).toBe(enSettings['ai.dataFlow.errorNone']);
    expect(await unavailableRouteError('no-extension')).toBe(enSettings['ai.dataFlow.errorNoExtension']);
  });
});

describe('the extension this repository ships', () => {
  it('advertises the pairing capability the app requires', () => {
    const bridge = readFileSync(join(process.cwd(), 'extension', 'src', 'bridge.js'), 'utf8');
    const caps = JSON.parse(/var TC_CAPABILITIES = (\[[^\]]*\]);/.exec(bridge)?.[1].replace(/'/g, '"') ?? 'null');
    expect(isPairedBridgeCaps(caps)).toBe(true);
    expect(isPairedBridgeCaps(STORE_1_1_1_CAPS)).toBe(false);
  });
});

describe('web fetch through the extension', () => {
  it('store 1.1.1 gets no fetch', async () => {
    installBridge(STORE_1_1_1_CAPS);
    expect(JSON.parse(await executeFetchUrl({ url: 'https://nvd.nist.gov/vuln/detail/CVE-2024-3094' })).error).toContain('1.1.3');
    expect(posted('TC_FETCH_URL')).toHaveLength(0);
  });
});
