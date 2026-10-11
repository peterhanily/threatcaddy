import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createContext, Script } from 'node:vm';
import { webcrypto } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import { englishMessage, loadUI } from './ui-fixture.js';

function hook() {
  const listeners = [];
  return { listeners, addListener: listener => listeners.push(listener), removeListener: vi.fn() };
}
function pageHarness(script = 'popup.js', storage = {}) {
  const page = document.implementation.createHTMLDocument('Synthetic extension');
  page.documentElement.innerHTML = readFileSync(resolve(import.meta.dirname, '..', script.replace(/\.js$/, '.html')), 'utf8');
  const chrome = {
    runtime: { id: 'fixture', getURL: path => 'chrome-extension://fixture/' + path,
      sendMessage: vi.fn().mockResolvedValue({ loaded: false, success: false, error: 'Synthetic save refusal' }) },
    storage: { local: { get: vi.fn(async () => structuredClone(storage)), set: vi.fn() }, onChanged: hook() },
    permissions: { contains: vi.fn().mockResolvedValue(false), request: vi.fn().mockResolvedValue(false), onAdded: hook(), onRemoved: hook() },
    extension: { isAllowedFileSchemeAccess: callback => callback(false) },
    i18n: { getMessage: englishMessage }, tabs: { create: vi.fn() },
  };
  const context = createContext({ chrome, crypto: webcrypto, document: page, window: { close: vi.fn() },
    navigator: { platform: 'Linux' }, console, URL, setTimeout, clearTimeout });
  loadUI(context);
  new Script(readFileSync(resolve(import.meta.dirname, '..', script), 'utf8')).runInContext(context);
  return { chrome, page, context, get: id => page.getElementById(id) };
}

describe('capture save feedback', () => {
  it('preserves the popup title/content on an explicit failed save response', async () => {
    const h = pageHarness(); h.get('capture-title').value = 'My draft'; h.get('capture-text').value = 'Harmless content';
    h.get('save-btn').click();
    await vi.waitFor(() => expect(h.get('save-error').textContent).toBe('Synthetic save refusal'));
    expect(h.get('capture-title').value).toBe('My draft');
    expect(h.get('capture-text').value).toBe('Harmless content');
    expect(h.get('save-success').classList.contains('show')).toBe(false);
  });
  it('prevents duplicate pending saves and preserves newer typing after a successful snapshot', async () => {
    const h = pageHarness(); let finish;
    h.chrome.runtime.sendMessage.mockImplementation(message => message.type === 'SAVE_NOTE'
      ? new Promise(resolve => { finish = resolve; }) : Promise.resolve({ loaded: false }));
    h.get('capture-title').value = 'First'; h.get('capture-text').value = 'First content';
    h.get('save-btn').click(); h.get('save-btn').click();
    h.get('capture-title').value = 'New title'; h.get('capture-text').value = 'New content';
    finish({ success: true });
    await vi.waitFor(() => expect(h.get('save-btn').disabled).toBe(false));
    expect(h.chrome.runtime.sendMessage.mock.calls.filter(([message]) => message.type === 'SAVE_NOTE')).toHaveLength(1);
    expect(h.get('capture-title').value).toBe('New title');
    expect(h.get('capture-text').value).toBe('New content');
  });
  it('shows a failed background capture when the popup opens', async () => {
    const h = pageHarness('popup.js', { captures: [], captureErrorV1: 'Capture storage is full (500). Nothing was removed.' });
    await vi.waitFor(() => expect(h.get('save-error').classList.contains('show')).toBe(true));
    expect(h.get('save-error').textContent).toContain('500');
  });
});

describe('clips review confirmation', () => {
  it('does not count historical sent flags as verified imports', async () => {
    const h = pageHarness('pages/clips.js', { captures: [
      { id: 'legacy', createdAt: 1, title: '', content: 'old', sent: true },
      { id: 'verified', revision: 2, createdAt: 2, title: '', content: 'current', sent: true, delivery: { status: 'confirmed', revision: 2 } },
    ] });
    await vi.waitFor(() => expect(h.get('stat-unsent').textContent).toBe('1'));
    expect(h.get('captures-list').textContent).toContain('Sent (legacy, unverified)');
    expect(h.get('captures-list').textContent).toContain('Import confirmed');
    expect(h.chrome.storage.local.set).not.toHaveBeenCalled();
  });
  it('requires actual-workspace confirmation before sending and never rewrites captures from the page', async () => {
    const h = pageHarness('pages/clips.js', { captures: [{ id: 'one', revision: 1, createdAt: 1, content: 'Synthetic' }] });
    h.chrome.runtime.sendMessage.mockImplementation(async message => message.type === 'PREPARE_CLIP_DELIVERY'
      ? { success: true, sessionId: 'prepared', workspaceId: 'default', workspaceLabel: 'Local fixture' }
      : { success: false, confirmed: 0, error: 'Database confirmation pending' });
    h.get('send-all-btn').click();
    await vi.waitFor(() => expect(h.get('modal-message').textContent).toContain('Local fixture'));
    expect(h.chrome.runtime.sendMessage.mock.calls.some(([message]) => message.type === 'SEND_TO_TARGET')).toBe(false);
    h.get('modal-confirm').click();
    await vi.waitFor(() => expect(h.chrome.runtime.sendMessage).toHaveBeenCalledWith({ type: 'SEND_TO_TARGET', sessionId: 'prepared', clips: [{ id: 'one', revision: 1 }] }));
    expect(h.chrome.storage.local.set).not.toHaveBeenCalled();
    expect(h.chrome.permissions.request).not.toHaveBeenCalled();
  });
});

describe('clip bridge acknowledgement boundary', () => {
  it('probes the app document, forwards late commit ACKs, and distinguishes posting from commit', async () => {
    const messages = hook();
    const page = document.implementation.createHTMLDocument('App fixture');
    const window = { location: new URL('https://paired.example.test/app'), postMessage: vi.fn(),
      addEventListener: (type, listener) => { if (type === 'message') messages.addListener(listener); } };
    const runtime = { id: 'fixture', onMessage: hook(), sendMessage: vi.fn().mockResolvedValue({ loaded: true }) };
    const context = createContext({ chrome: { runtime, storage: { onChanged: hook() } }, crypto: webcrypto,
      document: page, window, setTimeout, clearTimeout, console });
    new Script(readFileSync(resolve(import.meta.dirname, '../bridge.js'), 'utf8')).runInContext(context);
    await vi.waitFor(() => expect(page.documentElement.dataset.tcBridgeCaps).toContain('clip_import_ack_v2'));
    const respond = vi.fn();
    runtime.onMessage.listeners[0]({ type: 'GET_CLIP_IMPORT_TARGET' }, { id: 'fixture' }, respond);
    const probe = window.postMessage.mock.calls.find(([data]) => data.type === 'TC_CLIP_IMPORT_PROBE')[0];
    const emit = data => messages.listeners.forEach(fn => fn({ source: window, origin: window.location.origin, data }));
    emit({ type: 'TC_CLIP_IMPORT_READY', requestId: probe.requestId, protocol: 2, ready: true, workspaceId: 'default', workspaceLabel: 'Fixture' });
    const ready = respond.mock.calls[0][0]; expect(ready.ready).toBe(true);
    const delivered = vi.fn(); const envelope = { type: 'THREATCADDY_IMPORT_CLIPS', protocol: 2, clips: [] };
    runtime.onMessage.listeners[0]({ type: 'INJECT_CLIPS_TO_PAGE', documentToken: ready.documentToken, envelope }, { id: 'fixture' }, delivered);
    expect(delivered).toHaveBeenCalledWith({ delivered: true, confirmed: false });
    const result = { type: 'THREATCADDY_CLIP_IMPORT_RESULT', protocol: 2, attemptId: 'attempt', results: [] };
    emit(result);
    expect(runtime.sendMessage).toHaveBeenCalledWith({ type: 'CLIP_IMPORT_RESULT', result: { ...result, documentToken: ready.documentToken } });
    const rejected = vi.fn();
    runtime.onMessage.listeners[0]({ type: 'INJECT_CLIPS_TO_PAGE', documentToken: 'older-document', envelope }, { id: 'fixture' }, rejected);
    expect(rejected.mock.calls[0][0].delivered).toBe(false);
  });
});
