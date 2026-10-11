import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createContext, Script } from 'node:vm';
import { webcrypto } from 'node:crypto';
import { afterEach, describe, expect, it, vi } from 'vitest';

function hook() {
  const listeners = new Set();
  return { listeners, addListener: fn => listeners.add(fn), removeListener: fn => listeners.delete(fn),
    emit: (...args) => [...listeners].map(fn => fn(...args)) };
}
function deferred() { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; }
const cleanups = [];
afterEach(() => { cleanups.splice(0).forEach(cleanup => cleanup()); vi.restoreAllMocks(); });
function harness(script = 'background.js', storage = {}) {
  const timers = new Set(); cleanups.push(() => timers.forEach(clearTimeout));
  const schedule = (fn, ms) => { const timer = setTimeout(fn, ms); timers.add(timer); return timer; };
  const page = document.implementation.createHTMLDocument('Synthetic extension fixture');
  if (script.includes('popup') || script.includes('pages/')) page.documentElement.innerHTML = readFileSync(resolve(import.meta.dirname, '..', script.replace('.js', '.html')), 'utf8');
  const messages = hook();
  const window = { location: new URL('https://app.example.test/'), postMessage: vi.fn(), close: vi.fn(),
    addEventListener: (type, fn) => { if (type === 'message') messages.addListener(fn); } };
  const chrome = {
    runtime: { id: 'fixture', getURL: path => 'chrome-extension://fixture/' + path.replace(/^\//, ''),
      onMessage: hook(), onConnect: hook(), onInstalled: hook(), sendMessage: vi.fn().mockResolvedValue({ loaded: true, success: true }) },
    storage: { local: { get: vi.fn(async keys => Object.fromEntries(keys.map(key => [key, storage[key]]))),
      set: vi.fn(async values => { Object.assign(storage, values); chrome.storage.onChanged.emit(Object.fromEntries(Object.entries(values).map(([key, newValue]) => [key, { newValue }])), 'local'); }),
      remove: vi.fn(async key => { delete storage[key]; }) }, onChanged: hook() },
    permissions: { contains: vi.fn((_permission, callback) => { callback?.(true); return Promise.resolve(true); }),
      request: vi.fn().mockResolvedValue(true), remove: vi.fn().mockResolvedValue(true), onAdded: hook(), onRemoved: hook() },
    extension: { isAllowedFileSchemeAccess: callback => callback(true) },
    scripting: { registerContentScripts: vi.fn().mockResolvedValue(), unregisterContentScripts: vi.fn().mockResolvedValue() },
    tabs: { onUpdated: hook(), create: vi.fn() }, contextMenus: { onClicked: hook(), create: vi.fn() }, commands: { onCommand: hook() },
    i18n: { getMessage: key => key },
  };
  const fetch = vi.fn().mockResolvedValue(new Response('data: [DONE]\n\n'));
  const context = createContext({ chrome, crypto: webcrypto, document: page, window, navigator: { platform: 'Linux' },
    URL, console, fetch, AbortController, TextEncoder, TextDecoder, setTimeout: schedule, clearTimeout });
  new Script(readFileSync(resolve(import.meta.dirname, '..', script), 'utf8')).runInContext(context);
  const sender = (tab = 1, doc = 'document-one') => ({ id: 'fixture', frameId: 0, documentId: doc,
    url: window.location.href, tab: { id: tab, url: window.location.href } });
  const internal = { id: 'fixture', url: chrome.runtime.getURL('popup.html') };
  const message = (payload, from = sender()) => new Promise(done => [...chrome.runtime.onMessage.listeners][0](payload, from, done));
  const approve = async () => {
    const result = await message({ type: 'APPROVE_APP', targetUrl: window.location.origin }, internal);
    expect(result).toEqual({ success: true });
  };
  function port() {
    const value = { name: 'llm-synthetic', sender: sender(), onMessage: hook(), onDisconnect: hook(), postMessage: vi.fn() };
    value.disconnect = vi.fn(() => value.onDisconnect.emit()); return value;
  }
  function stream() { const value = port(); chrome.runtime.onConnect.emit(value); const receive = [...value.onMessage.listeners][0]; return { port: value, send: payload => receive(payload) }; }
  const emit = data => messages.emit({ data, source: window, origin: window.location.origin });
  return { chrome, storage, fetch, context, page, window, sender, message, approve, internal, stream, port, emit, get: id => page.getElementById(id) };
}
const payload = { provider: 'openai', model: 'synthetic-model', messages: [], apiKey: 'fixture-only' };
const proxy = { type: 'PROXY_FETCH', requestId: 'synthetic-request', documentToken: 'synthetic-document', url: 'https://example.com/data' };

describe('background request cancellation and terminal cleanup', () => {
  it.each(['success', 'denial', 'provider-error', 'send-error'])('cleans every listener and port after %s', async mode => {
    const h = harness(); await h.approve(); const before = h.chrome.storage.onChanged.listeners.size;
    const stream = h.stream();
    if (mode === 'denial') h.chrome.permissions.contains.mockResolvedValue(false);
    if (mode === 'provider-error') h.fetch.mockRejectedValue(new Error('Synthetic provider failure'));
    if (mode === 'send-error') stream.port.postMessage.mockImplementation(() => { throw new Error('Closed port'); });
    await stream.send(payload);
    expect(h.chrome.storage.onChanged.listeners.size).toBe(before);
    expect(stream.port.onMessage.listeners.size).toBe(0); expect(stream.port.onDisconnect.listeners.size).toBe(0);
    expect(stream.port.disconnect).toHaveBeenCalledOnce();
    await stream.send(payload); expect(stream.port.disconnect).toHaveBeenCalledOnce();
  });
  it.each(['disconnect', 'approval-change'])('aborts a pending stream on %s and suppresses late success', async mode => {
    const h = harness(); await h.approve(); const before = h.chrome.storage.onChanged.listeners.size;
    const permission = deferred(); h.chrome.permissions.contains.mockReturnValue(permission.promise);
    const stream = h.stream(); const run = stream.send(payload);
    await vi.waitFor(() => expect(h.chrome.permissions.contains).toHaveBeenCalled());
    if (mode === 'disconnect') stream.port.onDisconnect.emit();
    else h.chrome.storage.onChanged.emit({ approvedAppsV1: { newValue: {} } }, 'local');
    permission.resolve(true); await run;
    expect(h.fetch).not.toHaveBeenCalled(); expect(stream.port.postMessage).not.toHaveBeenCalled();
    expect(h.chrome.storage.onChanged.listeners.size).toBe(before);
    expect(stream.port.onMessage.listeners.size).toBe(0);
  });
  it('binds proxy abort to the requesting tab and document and tears down an active fetch', async () => {
    const h = harness(); await h.approve(); await h.message({ type: 'SET_PROXY_DOMAINS', domains: ['example.com'] });
    h.fetch.mockImplementation((_url, options) => new Promise((_resolve, reject) => options.signal.addEventListener('abort', () => reject(options.signal.reason))));
    const run = h.message(proxy); await vi.waitFor(() => expect(h.fetch).toHaveBeenCalledOnce());
    const signal = h.fetch.mock.calls[0][1].signal;
    await h.message({ ...proxy, type: 'PROXY_ABORT' }, h.sender(2)); expect(signal.aborted).toBe(false);
    await h.message({ ...proxy, type: 'PROXY_ABORT' }, h.sender(1, 'document-two')); expect(signal.aborted).toBe(false);
    await h.message({ ...proxy, type: 'PROXY_ABORT' }); expect(signal.aborted).toBe(true);
    expect((await run).success).toBe(false);
  });
  it('honors an early abort during permission lookup without starting a request', async () => {
    const h = harness(); await h.approve(); await h.message({ type: 'SET_PROXY_DOMAINS', domains: ['example.com'] });
    const permission = deferred(); h.chrome.permissions.contains.mockReturnValue(permission.promise);
    const run = h.message(proxy); await vi.waitFor(() => expect(h.chrome.permissions.contains).toHaveBeenCalled());
    await h.message({ ...proxy, type: 'PROXY_ABORT' }); permission.resolve(true);
    expect((await run).success).toBe(false); expect(h.fetch).not.toHaveBeenCalled();
  });
  it('rechecks approval generation after permission lookup and never fetches after revocation', async () => {
    const h = harness(); await h.approve(); await h.message({ type: 'SET_PROXY_DOMAINS', domains: ['example.com'] });
    const permission = deferred(); h.chrome.permissions.contains.mockReturnValue(permission.promise);
    const run = h.message(proxy); await vi.waitFor(() => expect(h.chrome.permissions.contains).toHaveBeenCalled());
    await h.message({ type: 'REVOKE_APPS' }, h.internal); permission.resolve(true);
    expect((await run).success).toBe(false); expect(h.fetch).not.toHaveBeenCalled();
  });
});

describe('bridge streaming ownership', () => {
  it.each(['done', 'error', 'disconnect', 'abort'])('finishes %s once and removes terminal listeners', async terminal => {
    const h = harness('bridge.js'); const port = h.port(); h.chrome.runtime.connect = vi.fn(() => port);
    await vi.waitFor(() => expect(h.page.documentElement.dataset.tcBridgeCaps).toContain('llm_streaming'));
    h.emit({ type: 'TC_LLM_REQUEST', requestId: 'one', payload });
    if (terminal === 'abort') h.emit({ type: 'TC_LLM_ABORT', requestId: 'one' });
    else if (terminal === 'disconnect') port.onDisconnect.emit();
    else port.onMessage.emit({ type: terminal, error: 'Synthetic failure' });
    expect(h.context.ports.size).toBe(0); expect(port.onMessage.listeners.size).toBe(0); expect(port.onDisconnect.listeners.size).toBe(0);
    port.onDisconnect.emit();
    const results = h.window.postMessage.mock.calls.filter(([data]) => ['TC_LLM_DONE', 'TC_LLM_ERROR'].includes(data.type));
    expect(results).toHaveLength(terminal === 'abort' ? 0 : 1);
    if (terminal === 'disconnect') expect(results[0][0].type).toBe('TC_LLM_ERROR');
    expect(port.disconnect).toHaveBeenCalledOnce();
  });
  it('forwards matching proxy request and cancellation document identity', async () => {
    const h = harness('bridge.js'); await vi.waitFor(() => expect(h.page.documentElement.dataset.tcBridgeCaps).toContain('proxy_fetch_abort'));
    h.emit({ type: 'TC_PROXY_FETCH', requestId: 'one', url: proxy.url }); h.emit({ type: 'TC_PROXY_ABORT', requestId: 'one' });
    const sent = h.chrome.runtime.sendMessage.mock.calls.map(([message]) => message);
    const request = sent.find(message => message.type === 'PROXY_FETCH');
    expect(sent).toContainEqual({ type: 'PROXY_ABORT', requestId: 'one', documentToken: request.documentToken });
    expect(typeof request.documentToken).toBe('string');
  });
});

describe('explicit per-app local AI approval', () => {
  it.each(['http://localhost:11434', 'http://[::1]:11434'])('uses native hostname-only checks but preserves exact local origin %s', async endpointOrigin => {
    const h = harness(); await h.approve();
    const endpoint = new URL(endpointOrigin);
    const pattern = endpoint.protocol + '//' + endpoint.hostname + '/*';
    // Model Firefox's actual grant: a port-bearing contains query is false.
    h.chrome.permissions.contains.mockImplementation(async permission => permission.origins?.every(origin => origin === pattern) ?? false);
    const update = { type: 'UPDATE_LOCAL_LLM_APPROVAL', targetUrl: 'https://app.example.test', localLLMUrl: endpointOrigin + '/v1' };
    expect((await h.message(update, h.internal)).success).toBe(true);
    expect(h.chrome.permissions.contains).toHaveBeenCalledWith({ origins: [pattern] });
    expect(h.storage.approvedAppsV1[update.targetUrl].localLLMOrigin).toBe(endpointOrigin);
    const accepted = h.stream();
    await accepted.send({ ...payload, provider: 'local', endpoint: update.localLLMUrl });
    expect(h.fetch).toHaveBeenCalledOnce();
    expect(h.fetch.mock.calls[0][0]).toBe(endpointOrigin + '/v1/chat/completions');
    expect(h.chrome.permissions.contains.mock.calls.every(([permission]) => permission.origins?.[0] === pattern)).toBe(true);
    h.fetch.mockClear();
    const denied = h.stream(); endpoint.port = '11435';
    await denied.send({ ...payload, provider: 'local', endpoint: endpoint.origin + '/v1' });
    expect(h.fetch).not.toHaveBeenCalled();
    expect(denied.port.postMessage).toHaveBeenCalledWith(expect.objectContaining({ type: 'error', error: expect.stringContaining('Approve this local AI endpoint') }));
    expect(h.chrome.permissions.request).not.toHaveBeenCalled();
  });
  it.each(['popup.js', 'pages/clips.js'])('requests a hostname-only native grant from %s and sends the unchanged exact URL for approval', async script => {
    const target = 'https://app.example.test';
    const h = harness(script, { settings: { targetUrl: target }, approvedAppsV1: { [target]: { approvedAt: 1 } } });
    const popup = script === 'popup.js';
    const input = h.get(popup ? 'settings-local-ai-url' : 'local-ai-url');
    await vi.waitFor(() => expect(h.get(popup ? 'settings-local-ai-status' : 'local-ai-status').textContent).toContain('No local AI'));
    const localLLMUrl = 'http://localhost:11434/v1';
    input.value = localLLMUrl;
    h.get(popup ? 'settings-save-local-ai' : 'save-local-ai-btn').click();
    await vi.waitFor(() => expect(h.chrome.runtime.sendMessage).toHaveBeenCalledWith({ type: 'UPDATE_LOCAL_LLM_APPROVAL', targetUrl: target, localLLMUrl }));
    expect(h.chrome.permissions.request).toHaveBeenCalledExactlyOnceWith({ origins: ['http://localhost/*'] });
  });
  it('preserves omitted local approval, rotates generations on explicit update/removal, and isolates other apps', async () => {
    const h = harness(); await h.approve();
    const update = { type: 'UPDATE_LOCAL_LLM_APPROVAL', targetUrl: 'https://app.example.test', localLLMUrl: 'http://localhost:11434/v1' };
    expect((await h.message(update, h.internal)).success).toBe(true);
    const first = { ...h.storage.approvedAppsV1[update.targetUrl] };
    await h.approve(); expect(h.storage.approvedAppsV1[update.targetUrl].localLLMOrigin).toBe(first.localLLMOrigin);
    expect(h.storage.approvedAppsV1[update.targetUrl].generation).not.toBe(first.generation);
    await h.message({ type: 'APPROVE_APP', targetUrl: update.targetUrl, localLLMUrl: undefined }, h.internal);
    expect(h.storage.approvedAppsV1[update.targetUrl].localLLMOrigin).toBe(first.localLLMOrigin);
    await h.message({ type: 'APPROVE_APP', targetUrl: 'https://other.example.test', localLLMUrl: 'http://localhost:11435' }, h.internal);
    expect((await h.message({ ...update, localLLMUrl: '' }, h.internal)).success).toBe(true);
    expect(h.storage.approvedAppsV1[update.targetUrl].localLLMOrigin).toBeUndefined();
    expect(h.storage.approvedAppsV1['https://other.example.test'].localLLMOrigin).toBe('http://localhost:11435');
    expect(h.chrome.permissions.request).not.toHaveBeenCalled();
    expect((await h.message(update)).success).toBe(false);
  });
  it.each(['popup.js', 'pages/clips.js'])('restores %s saved origin without requests; app-only save omits it and explicit remove does not grant', async script => {
    const target = 'https://app.example.test';
    const h = harness(script, { settings: { targetUrl: target }, approvedAppsV1: { [target]: { localLLMOrigin: 'http://localhost:11434' } } });
    const popup = script === 'popup.js'; const input = h.get(popup ? 'settings-local-ai-url' : 'local-ai-url');
    await vi.waitFor(() => expect(input.value).toBe('http://localhost:11434'));
    expect(h.chrome.permissions.request).not.toHaveBeenCalled();
    h.get(popup ? 'settings-save-url' : 'save-settings-btn').click();
    await vi.waitFor(() => expect(h.chrome.runtime.sendMessage).toHaveBeenCalledWith({ type: 'APPROVE_APP', targetUrl: target }));
    h.chrome.permissions.request.mockClear();
    h.get(popup ? 'settings-remove-local-ai' : 'remove-local-ai-btn').click();
    await vi.waitFor(() => expect(h.chrome.runtime.sendMessage).toHaveBeenCalledWith({ type: 'UPDATE_LOCAL_LLM_APPROVAL', targetUrl: target, localLLMUrl: '' }));
    expect(h.chrome.permissions.request).not.toHaveBeenCalled();
  });
  it('retains saved approval on a denied explicit local host grant', async () => {
    const target = 'https://app.example.test'; const h = harness('popup.js', { settings: { targetUrl: target }, approvedAppsV1: { [target]: { localLLMOrigin: 'http://localhost:11434' } } });
    await vi.waitFor(() => expect(h.get('settings-local-ai-url').value).toBe('http://localhost:11434'));
    h.get('settings-local-ai-url').value = 'http://localhost:11435'; h.chrome.permissions.request.mockResolvedValue(false);
    h.get('settings-save-local-ai').click();
    await vi.waitFor(() => expect(h.get('settings-local-ai-status').textContent).toContain('unchanged'));
    expect(h.chrome.runtime.sendMessage.mock.calls.some(([message]) => message.type === 'UPDATE_LOCAL_LLM_APPROVAL')).toBe(false);
    expect(h.storage.approvedAppsV1[target].localLLMOrigin).toBe('http://localhost:11434');
  });
  it('updates current approval feedback on external revocation without erasing an unsaved endpoint draft', async () => {
    const target = 'https://app.example.test'; const h = harness('popup.js', { settings: { targetUrl: target }, approvedAppsV1: { [target]: { localLLMOrigin: 'http://localhost:11434' } } });
    await vi.waitFor(() => expect(h.get('settings-local-ai-url').value).toBe('http://localhost:11434'));
    h.get('settings-local-ai-url').value = 'http://localhost:11435'; h.get('settings-local-ai-url').dispatchEvent(new Event('input'));
    h.storage.approvedAppsV1 = {}; h.chrome.storage.onChanged.emit({ approvedAppsV1: { newValue: {} } }, 'local');
    await vi.waitFor(() => expect(h.get('settings-local-ai-status').textContent).toContain('Approve this app before'));
    expect(h.get('settings-local-ai-url').value).toBe('http://localhost:11435'); expect(h.chrome.permissions.request).not.toHaveBeenCalled();
  });
});
