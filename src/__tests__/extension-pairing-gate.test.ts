/** The Chrome Web Store's extension 1.1.1 has no app pairing, follows redirects and has no private-address
 * filter. The app uses none of the extension's features (AI, integration proxy, web fetch) unless the bridge
 * that owns the page advertises the 1.1.3+ pairing capability, and says which version it needs and where. */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { sendViaExtension } from '../lib/llm-router';
import { generateChatTitle, summarizeConversation } from '../lib/chat-utils';
import { IntegrationExecutor } from '../lib/integration-executor';
import { executeFetchUrl } from '../lib/llm-tools-analysis';
import { useLLM } from '../hooks/useLLM';
import type { IntegrationTemplate, InstalledIntegration } from '../types/integration-types';

// Store 1.1.1 (66ec58f4 bridge.js:6), the 1.1.3 download (aa4646ad bridge.js:6) and 1.1.4 (bridge.js:6).
const STORE_1_1_1_CAPS = ['llm_streaming', 'fetch_url', 'clip_import', 'proxy_fetch'];
const CAPS_1_1_3 = ['llm_streaming', 'fetch_url', 'clip_import', 'clip_import_ack_v2', 'proxy_fetch', 'proxy_fetch_abort', 'notification_ack'];
const CAPS_1_1_4 = ['llm_streaming', 'fetch_url', 'fetch_url_public_v1', 'clip_import', 'clip_import_ack_v2', 'proxy_fetch', 'proxy_fetch_abort', 'notification_ack'];

/** Every message the page posted, in order. */
let posts: Array<Record<string, unknown>>;
/** The capabilities the bridge that owns the page's listeners answers a ping with. */
let owner: string[] | undefined;
const posted = (type: string) => posts.filter(message => message.type === type);
/** As in a browser, a posted message reaches the window's listeners on a later task, in posting order. */
const deliver = (data: unknown) => setTimeout(() => window.dispatchEvent(new MessageEvent('message', { source: window, data })), 0);
/** One installed bridge: it publishes `published` on the page and answers pings and proxy fetches as `owner`. */
function installBridge(published: string[] | undefined, answering: string[] | undefined = published) {
  owner = answering;
  if (published) document.documentElement.dataset.tcBridgeCaps = published.join(',');
}
const flush = () => new Promise(resolve => setTimeout(resolve, 20));

beforeEach(() => {
  posts = [];
  owner = undefined;
  vi.spyOn(window, 'postMessage').mockImplementation((message: unknown) => {
    const data = message as Record<string, unknown>;
    posts.push(data);
    deliver(data);
    if (data.type === 'TC_EXTENSION_PING' && owner) deliver({ type: 'TC_EXTENSION_READY', protocolVersion: 1, capabilities: owner });
    if (data.type === 'TC_PROXY_FETCH' && owner) deliver({ type: 'TC_PROXY_FETCH_RESULT', requestId: data.requestId, success: true, status: 200, statusText: 'OK', data: { relayed: true }, headers: {} });
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
    installBridge(CAPS_1_1_3, STORE_1_1_1_CAPS);
    const onError = vi.fn();
    sendViaExtension(request, { onChunk: vi.fn(), onDone: vi.fn(), onError });
    await vi.waitFor(() => expect(onError).toHaveBeenCalledOnce());
    await flush();
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

  it('refuses the proxy when a 1.1.3 copy published its capabilities but store 1.1.1 owns the page', async () => {
    installBridge(CAPS_1_1_3, STORE_1_1_1_CAPS);
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

describe('web fetch through the extension', () => {
  it('store 1.1.1 gets no fetch', async () => {
    installBridge(STORE_1_1_1_CAPS);
    expect(JSON.parse(await executeFetchUrl({ url: 'https://nvd.nist.gov/vuln/detail/CVE-2024-3094' })).error).toContain('1.1.3');
    expect(posted('TC_FETCH_URL')).toHaveLength(0);
  });
});
