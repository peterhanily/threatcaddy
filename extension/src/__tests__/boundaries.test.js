import { readFileSync } from 'node:fs';
import { createContext, Script } from 'node:vm';
import { resolve } from 'node:path';
import { URL } from 'node:url';
import { describe, expect, it, vi } from 'vitest';

function hook() {
  const listeners = [];
  return { listeners, addListener: fn => listeners.push(fn), removeListener: fn => { const i = listeners.indexOf(fn); if (i >= 0) listeners.splice(i, 1); } };
}
function harness() {
  const storage = {};
  const chrome = {
    runtime: { id: 'extension', getURL: path => 'chrome-extension://extension/' + path.replace(/^\//, ''), onMessage: hook(), onConnect: hook(), onInstalled: hook() },
    storage: { local: {
      get: async keys => keys === null ? { ...storage } : Object.fromEntries(keys.map(key => [key, storage[key]])),
      set: async values => Object.assign(storage, values), remove: async key => { delete storage[key]; },
    }, onChanged: hook() },
    scripting: { registerContentScripts: vi.fn().mockResolvedValue(), unregisterContentScripts: vi.fn().mockResolvedValue(), executeScript: vi.fn().mockResolvedValue() },
    tabs: { onUpdated: hook(), create: vi.fn().mockResolvedValue({}) },
    contextMenus: { onClicked: hook(), create: vi.fn() }, commands: { onCommand: hook() },
    permissions: { contains: vi.fn().mockResolvedValue(true), request: vi.fn().mockResolvedValue(true) },
    notifications: { create: vi.fn().mockResolvedValue('accepted-notification') },
    i18n: { getMessage: key => key },
  };
  const fetch = vi.fn().mockImplementation(async () => new Response('{"fixture":true}', { headers: { 'content-type': 'application/json' } }));
  const context = createContext({ chrome, URL, console, TextEncoder, TextDecoder, AbortController, setTimeout, clearTimeout, fetch });
  new Script(readFileSync(resolve(import.meta.dirname, '../background.js'), 'utf8')).runInContext(context);
  const sender = (url = 'http://localhost:4173', frameId = 0) => ({ id: 'extension', url, frameId, tab: { id: 1, url } });
  const message = (data, from = sender()) => new Promise(resolve => chrome.runtime.onMessage.listeners[0](data, from, resolve));
  const approve = async (url, localLLMUrl) => {
    const result = await message({ type: 'APPROVE_APP', targetUrl: url, localLLMUrl }, { id: 'extension', url: 'chrome-extension://extension/popup.html' });
    expect(result.success).toBe(true);
  };
  const stream = (from = sender()) => {
    const port = { name: 'llm-fixture', sender: from, onMessage: hook(), onDisconnect: hook(), postMessage: vi.fn() };
    port.disconnect = vi.fn(() => port.onDisconnect.listeners.forEach(fn => fn()));
    chrome.runtime.onConnect.listeners[0](port);
    return { port, send: payload => port.onMessage.listeners[0](payload) };
  };
  return { context, chrome, storage, fetch, sender, message, approve, stream };
}

describe('approved extension boundaries', () => {
  it('denies unpaired and non-top-level app requests without invoking privileged APIs', async () => {
    const h = harness();
    expect((await h.message({ type: 'PING' })).loaded).toBe(false);
    await h.approve('http://localhost:4173');
    expect((await h.message({ type: 'PING' })).loaded).toBe(true);
    expect((await h.message({ type: 'PING' }, h.sender('http://localhost:4174'))).loaded).toBe(false);
    expect((await h.message({ type: 'SEND_NOTIFICATION' }, h.sender('http://localhost:4173', 1))).success).toBe(false);
    expect(h.chrome.notifications.create).not.toHaveBeenCalled();
    expect(h.fetch).not.toHaveBeenCalled();
  });
  it('does not let a paired web app approve another origin or impersonate an extension page', async () => {
    const h = harness(); await h.approve('http://localhost:4173');
    expect((await h.message({ type: 'APPROVE_APP', targetUrl: 'http://localhost:4174' })).success).toBe(false);
    expect((await h.message({ type: 'PING' }, { ...h.sender(), id: 'different-extension' })).loaded).toBe(false);
    expect((await h.message({ type: 'PING' }, { ...h.sender(), tab: { id: 1, url: 'http://localhost:4174' } })).loaded).toBe(false);
  });
  it('binds standalone approval to an exact file rather than a path prefix', async () => {
    const h = harness(); await h.approve('file:///tmp/app.html');
    expect((await h.message({ type: 'PING' }, h.sender('file:///tmp/app.html#notes'))).loaded).toBe(true);
    expect((await h.message({ type: 'PING' }, h.sender('file:///tmp/app.html.backup'))).loaded).toBe(false);
  });
  it('isolates two app proxy policies and denies empty, absent and stale configurations', async () => {
    const h = harness(); await h.approve('http://localhost:4173'); await h.approve('http://localhost:4174');
    const request = { type: 'PROXY_FETCH', url: 'https://one.example.test/data' };
    expect((await h.message(request)).success).toBe(false);
    await h.message({ type: 'SET_PROXY_DOMAINS', domains: ['one.example.test'] });
    await h.message({ type: 'SET_PROXY_DOMAINS', domains: ['two.example.test'] }, h.sender('http://localhost:4174'));
    expect((await h.message(request)).success).toBe(true);
    expect((await h.message(request, h.sender('http://localhost:4174'))).success).toBe(false);
    expect(h.fetch.mock.calls[0][1]).toMatchObject({ redirect: 'error', credentials: 'omit' });
    h.storage['proxyPolicyV1:http://localhost:4173'].updatedAt = 1;
    expect((await h.message(request)).success).toBe(false);
    await h.message({ type: 'SET_PROXY_DOMAINS', domains: [] });
    expect((await h.message(request)).success).toBe(false);
  });
  it('shares explicit public URL restrictions and checks browser permissions separately', async () => {
    const h = harness(); await h.approve('http://localhost:4173');
    for (const url of ['http://localhost:8000/data', 'http://192.168.1.10/data', 'file:///tmp/report.txt']) {
      expect((await h.message({ type: 'FETCH_URL', url })).success).toBe(false);
      expect((await h.message({ type: 'PROXY_FETCH', url })).success).toBe(false);
    }
    h.chrome.permissions.contains.mockResolvedValue(false);
    expect((await h.message({ type: 'FETCH_URL', url: 'https://public.example.test/report' })).success).toBe(false);
    expect(h.fetch).not.toHaveBeenCalled();
  });
  it('reports granted, denied and rejected notification API results truthfully', async () => {
    const h = harness(); await h.approve('http://localhost:4173');
    const payload = { type: 'SEND_NOTIFICATION', title: 'Test', message: 'Harmless fixture' };
    expect(await h.message(payload)).toMatchObject({ success: true, accepted: true, notificationId: 'accepted-notification' });
    expect(h.chrome.notifications.create.mock.calls[0][0].iconUrl).toBe('chrome-extension://extension/assets/icon-128.png');
    h.chrome.permissions.contains.mockResolvedValue(false);
    expect((await h.message(payload)).success).toBe(false);
    h.chrome.permissions.contains.mockResolvedValue(true);
    h.chrome.notifications.create.mockRejectedValueOnce(new Error('OS unavailable'));
    expect(await h.message(payload)).toMatchObject({ success: false, error: 'OS unavailable' });
  });
  it('rejects oversized response bodies instead of returning truncated successful data', async () => {
    const h = harness(); await h.approve('http://localhost:4173');
    h.fetch.mockResolvedValueOnce(new Response('small', { headers: { 'content-length': String(6 * 1024 * 1024) } }));
    expect(await h.message({ type: 'FETCH_URL', url: 'https://public.example.test/report' })).toMatchObject({ success: false, error: 'Response exceeds the 5 MiB limit' });
  });
  it('revokes existing sender authorization immediately', async () => {
    const h = harness(); await h.approve('http://localhost:4173');
    await h.message({ type: 'REVOKE_APPS' }, { id: 'extension', url: 'chrome-extension://extension/popup.html' });
    expect((await h.message({ type: 'PING' })).loaded).toBe(false);
  });
  it('requires separate app, local-endpoint and browser permission approvals for streaming', async () => {
    const h = harness();
    const payload = { provider: 'local', endpoint: 'http://localhost:11434/v1', model: 'fixture', messages: [] };
    const unpaired = h.stream();
    await unpaired.send(payload);
    expect(unpaired.port.postMessage).toHaveBeenCalledWith(expect.objectContaining({ type: 'error' }));
    expect(h.fetch).not.toHaveBeenCalled();
    await h.approve('http://localhost:4173');
    const missingEndpoint = h.stream();
    await missingEndpoint.send(payload);
    expect(missingEndpoint.port.postMessage).toHaveBeenCalledWith(expect.objectContaining({ error: expect.stringContaining('Approve this local AI endpoint') }));
    await h.approve('http://localhost:4173', 'http://localhost:11434');
    const approved = h.stream();
    h.chrome.permissions.contains.mockResolvedValue(false);
    await approved.send(payload);
    expect(h.fetch).not.toHaveBeenCalled();
    h.chrome.permissions.contains.mockResolvedValue(true);
    await approved.send(payload);
    expect(h.fetch).toHaveBeenCalledWith('http://localhost:11434/v1/chat/completions', expect.objectContaining({ redirect: 'error', credentials: 'omit' }));
    const wrongEndpoint = h.stream();
    await wrongEndpoint.send({ ...payload, endpoint: 'http://localhost:11435/v1' });
    expect(h.fetch).toHaveBeenCalledTimes(1);
    h.chrome.storage.onChanged.listeners.forEach(fn => fn({ approvedAppsV1: { newValue: {} } }, 'local'));
    expect(approved.port.disconnect).toHaveBeenCalled();
    expect(h.fetch.mock.calls[0][1].signal.aborted).toBe(true);
  });
  it('keeps a running stream locked when additional requests are rejected', async () => {
    const h = harness(); await h.approve('http://localhost:4173');
    let finish;
    h.fetch.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    const stream = h.stream();
    const payload = { provider: 'openai', model: 'fixture', messages: [], apiKey: 'synthetic-fixture-only' };
    const pending = stream.send(payload);
    await vi.waitFor(() => expect(h.fetch).toHaveBeenCalledTimes(1));
    await stream.send(payload);
    await stream.send(payload);
    expect(h.fetch).toHaveBeenCalledTimes(1);
    expect(stream.port.postMessage.mock.calls.filter(([message]) => message.type === 'error')).toHaveLength(2);
    finish(new Response('data: [DONE]\n\n'));
    await pending;
  });
});
