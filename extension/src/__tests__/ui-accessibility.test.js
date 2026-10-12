import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createContext, Script } from 'node:vm';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { englishMessage, loadUI } from './ui-fixture.js';

const timers = new Set();
afterEach(() => { timers.forEach(clearTimeout); timers.clear(); document.body.innerHTML = ''; });
function harness(script = 'pages/clips.js', language = 'en', captures = [{ id: 'fictional-one', revision: 1,
  title: 'Fictional café', content: 'Harmless local note', createdAt: 1, folderName: 'Fictional "café"' }]) {
  document.documentElement.innerHTML = readFileSync(resolve(import.meta.dirname, '..', script.replace('.js', '.html')), 'utf8');
  const storage = { captures, settings: { targetUrl: 'https://app.example.test' } };
  const hook = () => ({ addListener: vi.fn(), removeListener: vi.fn() });
  const chrome = {
    i18n: { getUILanguage: () => language, getMessage: (key, args) => key === '@@bidi_dir' ? '' : englishMessage(key, args) },
    runtime: { getManifest: () => ({ version: '7.8.9' }), sendMessage: vi.fn().mockResolvedValue({ success: false, error: 'Synthetic refusal; draft retained.' }) },
    storage: { local: { get: vi.fn(async () => structuredClone(storage)) }, onChanged: hook() },
    permissions: { contains: vi.fn((_value, callback) => { callback?.(false); return Promise.resolve(false); }),
      request: vi.fn(), remove: vi.fn(), onAdded: hook(), onRemoved: hook() },
    extension: { isAllowedFileSchemeAccess: callback => callback(false) }, tabs: { create: vi.fn() },
  };
  const context = createContext({ document, chrome, navigator: { platform: 'Linux' }, window: { close: vi.fn() }, URL, console,
    setTimeout: (callback, milliseconds) => { const timer = setTimeout(callback, milliseconds); timers.add(timer); return timer; }, clearTimeout });
  loadUI(context);
  new Script(readFileSync(resolve(import.meta.dirname, '..', script), 'utf8')).runInContext(context);
  const get = id => document.getElementById(id);
  const key = (value, shiftKey = false) => document.activeElement.dispatchEvent(new KeyboardEvent('keydown', { key: value, shiftKey, bubbles: true, cancelable: true }));
  return { get, key, chrome, storage, context };
}

describe('extension language and accessible controls', () => {
  it.each(['manifest.json', 'manifest.firefox.json'])('displays the installed version from %s, not a catalog constant', manifestName => {
    const h = harness('popup.js');
    const manifest = JSON.parse(readFileSync(resolve(import.meta.dirname, '..', manifestName), 'utf8'));
    h.chrome.runtime.getManifest = () => manifest;
    h.context.TC_UI.localize();
    expect(document.querySelector('[data-runtime-version]').textContent).toBe(englishMessage('version', [manifest.version]));
    expect(document.querySelector('[data-runtime-version]').textContent).toContain(manifest.version);
  });

  it.each([['en', 'ltr'], ['ar', 'rtl'], ['fa-IR', 'rtl'], ['he', 'rtl'], ['pt_BR', 'ltr']])('sets document language/direction for %s', async (language, direction) => {
    const h = harness('pages/clips.js', language);
    await vi.waitFor(() => expect(h.get('captures-list').querySelector('.capture-card')).not.toBeNull());
    expect(document.documentElement.lang).toBe(language.replace('_', '-'));
    expect(document.documentElement.dir).toBe(direction);
    expect(document.title).toBe(englishMessage('clipReviewTitle'));
    expect(h.get('send-all-btn').textContent).toBe(englishMessage('sendAll'));
    expect(h.chrome.permissions.request).not.toHaveBeenCalled();
  });

  it('names popup controls, exposes options state and restores focus after Settings', () => {
    const h = harness('popup.js');
    expect(document.querySelector('[data-runtime-version]').textContent).toBe('v7.8.9');
    for (const id of ['capture-title', 'capture-text', 'settings-btn', 'settings-back', 'settings-target-url', 'ai-perm-toggle', 'url-perm-toggle', 'settings-ai-toggle', 'settings-url-toggle']) {
      expect(h.get(id).getAttribute('aria-label')).toBeTruthy();
    }
    h.get('options-toggle').click(); expect(h.get('options-toggle').getAttribute('aria-expanded')).toBe('true');
    h.get('options-toggle').click(); expect(h.get('options-toggle').getAttribute('aria-expanded')).toBe('false');
    h.get('settings-btn').click(); expect(document.activeElement).toBe(h.get('settings-back'));
    h.get('settings-back').click(); expect(document.activeElement).toBe(h.get('settings-btn'));
    expect(h.chrome.permissions.request).not.toHaveBeenCalled();
  });

  it('keeps quoted metadata and a refused edit draft intact without direct storage writes', async () => {
    const h = harness();
    await vi.waitFor(() => expect(document.querySelector('button.meta-badge')).not.toBeNull());
    const toggle = document.querySelector('button.meta-badge'); toggle.click();
    expect(toggle.getAttribute('aria-expanded')).toBe('true');
    expect(document.activeElement.getAttribute('aria-label')).toBe('Save as');
    const input = document.querySelector('.meta-inline-edit input');
    expect(input.value).toBe('Fictional "café"');
    input.value = 'New unsaved investigation'; input.dispatchEvent(new Event('blur'));
    await vi.waitFor(() => expect(document.querySelector('[role="alert"]')?.textContent).toContain('Synthetic refusal'));
    expect(input.isConnected).toBe(true); expect(input.value).toBe('New unsaved investigation');
    expect(h.chrome.runtime.sendMessage).toHaveBeenCalledWith({ type: 'UPDATE_CAPTURES', clips: [{ id: 'fictional-one', revision: 1 }], values: { folderName: 'New unsaved investigation' } });
  });

  it('retains newer metadata typing after a deferred successful snapshot and serializes overlapping changes', async () => {
    const h = harness();
    await vi.waitFor(() => expect(document.querySelector('button.meta-badge')).not.toBeNull());
    document.querySelector('button.meta-badge').click();
    let complete;
    h.chrome.runtime.sendMessage.mockImplementation(() => new Promise(resolve => { complete = resolve; }));
    const select = document.querySelector('[data-field="entityType"]');
    select.value = 'task'; select.dispatchEvent(new Event('change'));
    const folder = document.querySelector('.meta-inline-edit input'); folder.focus();
    folder.value = 'Newer draft while task save is pending'; folder.dispatchEvent(new Event('input')); folder.dispatchEvent(new Event('blur'));
    expect(h.chrome.runtime.sendMessage).toHaveBeenCalledTimes(1);
    h.storage.captures[0] = { ...h.storage.captures[0], entityType: 'task', revision: 2 };
    complete({ success: true });
    await vi.waitFor(() => expect(document.querySelector('.meta-inline-edit').dataset.revision).toBe('2'));
    expect(document.querySelector('.meta-inline-edit input').value).toBe('Newer draft while task save is pending');
    expect(document.activeElement).toBe(document.querySelector('.meta-inline-edit input'));
    h.chrome.runtime.sendMessage.mockResolvedValue({ success: false, error: 'Synthetic retry refusal' });
    document.querySelector('.meta-inline-edit input').dispatchEvent(new Event('blur'));
    await vi.waitFor(() => expect(h.chrome.runtime.sendMessage).toHaveBeenCalledTimes(2));
    expect(h.chrome.runtime.sendMessage.mock.calls[1][0]).toEqual({ type: 'UPDATE_CAPTURES', clips: [{ id: 'fictional-one', revision: 2 }], values: { folderName: 'Newer draft while task save is pending' } });
    expect(document.querySelector('.meta-inline-edit input').value).toBe('Newer draft while task save is pending');
  });

  it('preserves a draft and old revision across an external update, so retries cannot silently overwrite it', async () => {
    const h = harness();
    await vi.waitFor(() => expect(document.querySelector('button.meta-badge')).not.toBeNull());
    document.querySelector('button.meta-badge').click();
    const folder = document.querySelector('.meta-inline-edit input');
    folder.value = 'Unsent local draft'; folder.dispatchEvent(new Event('input'));
    h.storage.captures[0] = { ...h.storage.captures[0], folderName: 'Saved elsewhere', revision: 2 };
    h.get('refresh-btn').click();
    await vi.waitFor(() => expect(document.querySelector('.folder-badge').textContent).toBe('Saved elsewhere'));
    expect(document.querySelector('.meta-inline-edit input').value).toBe('Unsent local draft');
    expect(document.querySelector('.meta-inline-edit').dataset.revision).toBe('1');
  });

  it('requires explicit discard to recover a conflicted metadata draft without writing saved metadata', async () => {
    const h = harness();
    await vi.waitFor(() => expect(document.querySelector('button.meta-badge')).not.toBeNull());
    document.querySelector('button.meta-badge').click();
    const folder = document.querySelector('.meta-inline-edit input'); folder.focus();
    folder.value = 'Unsent local draft'; folder.dispatchEvent(new Event('input'));
    h.storage.captures[0] = { ...h.storage.captures[0], folderName: 'Saved elsewhere', revision: 2 };
    folder.dispatchEvent(new Event('blur'));
    await vi.waitFor(() => expect(document.querySelector('[role="alert"]')?.textContent).toContain('Synthetic refusal'));
    const discard = document.querySelector('.discard-metadata-draft');
    discard.click();
    expect(document.activeElement).toBe(h.get('modal-cancel'));
    expect(h.chrome.runtime.sendMessage).toHaveBeenCalledTimes(1);
    h.get('modal-cancel').click();
    await Promise.resolve();
    expect(folder.value).toBe('Unsent local draft');
    expect(folder.closest('.meta-inline-edit').dataset.revision).toBe('1');
    discard.click(); h.get('modal-confirm').click();
    await vi.waitFor(() => expect(document.querySelector('.meta-inline-edit').dataset.revision).toBe('2'));
    expect(document.querySelector('.meta-inline-edit input').value).toBe('Saved elsewhere');
    expect(document.querySelector('.discard-metadata-draft').hidden).toBe(true);
    expect(document.activeElement).toBe(document.querySelector('button.meta-badge'));
    expect(h.chrome.runtime.sendMessage).toHaveBeenCalledTimes(1);
    document.querySelector('button.meta-badge').click();
    const current = document.querySelector('.meta-inline-edit input');
    current.value = 'Reviewed new edit'; current.dispatchEvent(new Event('blur'));
    await vi.waitFor(() => expect(h.chrome.runtime.sendMessage).toHaveBeenCalledTimes(2));
    expect(h.chrome.runtime.sendMessage.mock.calls[1][0].clips).toEqual([{ id: 'fictional-one', revision: 2 }]);
  });

  it('blocks discard while a metadata write is pending and retains drafts if authoritative reload fails', async () => {
    const h = harness();
    await vi.waitFor(() => expect(document.querySelector('button.meta-badge')).not.toBeNull());
    document.querySelector('button.meta-badge').click();
    const folder = document.querySelector('.meta-inline-edit input');
    folder.value = 'Draft to keep'; folder.dispatchEvent(new Event('input'));
    let complete;
    h.chrome.runtime.sendMessage.mockImplementation(() => new Promise(resolve => { complete = resolve; }));
    folder.dispatchEvent(new Event('blur'));
    const discard = document.querySelector('.discard-metadata-draft');
    expect(discard.disabled).toBe(true); discard.click();
    expect(h.get('modal-overlay').classList.contains('hidden')).toBe(true);
    complete({ success: false, error: 'Synthetic conflict' });
    await vi.waitFor(() => expect(discard.disabled).toBe(false));
    discard.click(); h.chrome.storage.local.get.mockRejectedValueOnce(new Error('Synthetic read failure'));
    h.get('modal-confirm').click();
    await vi.waitFor(() => expect(document.querySelector('[role="alert"]')?.textContent).toContain('Unable to load captures'));
    expect(folder.value).toBe('Draft to keep');
    expect(folder.closest('.meta-inline-edit').dataset.revision).toBe('1');
    expect(h.chrome.runtime.sendMessage).toHaveBeenCalledTimes(1);
  });
});

describe('extension confirmation lifecycle', () => {
  it('focuses Cancel for deletion, traps both Tab directions, cancels with Escape and restores the opener', async () => {
    const h = harness();
    await vi.waitFor(() => expect(document.querySelector('.capture-delete-btn')).not.toBeNull());
    const opener = document.querySelector('.capture-delete-btn'); opener.focus(); opener.click();
    expect(document.querySelector('[role="dialog"]').getAttribute('aria-labelledby')).toBe('modal-title');
    expect(document.activeElement).toBe(h.get('modal-cancel'));
    expect(document.querySelector('.container').inert).toBe(true);
    expect(document.querySelector('.container').getAttribute('aria-hidden')).toBe('true');
    h.key('Tab', true); expect(document.activeElement).toBe(h.get('modal-confirm'));
    h.key('Tab'); expect(document.activeElement).toBe(h.get('modal-cancel'));
    h.get('refresh-btn').focus(); expect(document.activeElement).toBe(h.get('modal-cancel'));
    h.key('Escape');
    expect(h.get('modal-overlay').classList.contains('hidden')).toBe(true);
    expect(document.activeElement).toBe(opener);
    expect(document.querySelector('.container').inert).toBe(false);
    expect(document.querySelector('.container').hasAttribute('aria-hidden')).toBe(false);
    expect(h.chrome.runtime.sendMessage).not.toHaveBeenCalled();
    expect(h.chrome.permissions.request).not.toHaveBeenCalled();
  });

  it('does not replace an existing confirmation and retains the original captured revision', async () => {
    const h = harness();
    await vi.waitFor(() => expect(document.querySelector('.capture-delete-btn')).not.toBeNull());
    const opener = document.querySelector('.capture-delete-btn'); opener.focus(); opener.click();
    const competing = new Script("showModal('Another action', 'Must not replace the pending scope', 'Continue', true)").runInContext(h.context);
    await expect(competing).resolves.toBe(false);
    expect(h.get('modal-title').textContent).toBe('Delete Capture');
    h.storage.captures.push({ id: 'fictional-newer', revision: 1, content: 'New capture', createdAt: 2 });
    h.chrome.runtime.sendMessage.mockResolvedValue({ success: true });
    h.get('modal-confirm').click();
    await vi.waitFor(() => expect(h.chrome.runtime.sendMessage).toHaveBeenCalledExactlyOnceWith({ type: 'DELETE_CAPTURES', clips: [{ id: 'fictional-one', revision: 1 }] }));
    await vi.waitFor(() => expect(document.activeElement).toBe(h.get('refresh-btn')));
  });

  it('restores pre-existing inert/aria state and resolves each confirmation once', async () => {
    const h = harness();
    document.querySelector('.container').inert = true;
    document.querySelector('.container').setAttribute('aria-hidden', 'true');
    const promise = new Script("showModal('Fictional check', 'Fictional body', 'Proceed', true)").runInContext(h.context);
    h.get('modal-cancel').click(); h.get('modal-confirm').click();
    await expect(promise).resolves.toBe(false);
    expect(document.querySelector('.container').inert).toBe(true);
    expect(document.querySelector('.container').getAttribute('aria-hidden')).toBe('true');
  });

  it('retains the actual prepared workspace and sends nothing when keyboard-cancelled', async () => {
    const h = harness();
    h.chrome.runtime.sendMessage.mockResolvedValue({ success: true, sessionId: 'fixture-session', workspaceId: 'default', workspaceLabel: 'Fictional café workspace' });
    h.get('send-all-btn').click();
    await vi.waitFor(() => expect(h.get('modal-message').textContent).toContain('Fictional café workspace'));
    expect(document.activeElement).toBe(h.get('modal-confirm'));
    h.key('Escape');
    await vi.waitFor(() => expect(h.get('send-all-btn').disabled).toBe(false));
    expect(h.chrome.runtime.sendMessage).toHaveBeenCalledExactlyOnceWith({ type: 'PREPARE_CLIP_DELIVERY', targetUrl: 'https://app.example.test' });
    expect(h.chrome.permissions.request).not.toHaveBeenCalled();
  });

  it('requires explicit confirmation before revocation without adding permission requests', async () => {
    const h = harness('popup.js'); h.get('settings-btn').click();
    const opener = h.get('settings-revoke-apps'); opener.focus(); opener.click();
    expect(document.activeElement).toBe(h.get('modal-cancel'));
    h.key('Escape'); expect(document.activeElement).toBe(opener);
    expect(h.chrome.runtime.sendMessage).not.toHaveBeenCalled();
    opener.click(); h.chrome.runtime.sendMessage.mockResolvedValue({ success: true });
    h.get('modal-confirm').click();
    await vi.waitFor(() => expect(h.get('settings-approval-status').textContent).toBe('All app connections revoked.'));
    expect(h.chrome.runtime.sendMessage).toHaveBeenCalledExactlyOnceWith({ type: 'REVOKE_APPS' });
    expect(h.chrome.permissions.request).not.toHaveBeenCalled();
  });
});
