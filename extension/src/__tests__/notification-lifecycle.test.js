import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createContext, Script } from 'node:vm';
import { describe, expect, it, vi } from 'vitest';

// Execute shipped scripts against synthetic browser APIs, never user profiles.
function hook() {
  const listeners = [];
  return { listeners, addListener: listener => listeners.push(listener), removeListener: listener => {
    const index = listeners.indexOf(listener); if (index >= 0) listeners.splice(index, 1);
  }, emit: (...args) => listeners.forEach(listener => listener(...args)) };
}

function deferred() {
  let resolve, reject;
  const promise = new Promise((done, fail) => { resolve = done; reject = fail; });
  return { promise, resolve, reject };
}

function harness(script = 'popup.js') {
  const storage = {};
  const chrome = {
    runtime: { id: 'fixture-extension', getURL: path => 'chrome-extension://fixture-extension/' + path.replace(/^\//, ''),
      onMessage: hook(), onConnect: hook(), onInstalled: hook(), sendMessage: vi.fn().mockResolvedValue({ loaded: false }) },
    storage: { local: {
      get: vi.fn(async keys => Object.fromEntries(keys.map(key => [key, storage[key]]))),
      set: vi.fn(async values => { Object.assign(storage, values); }), remove: vi.fn(async key => { delete storage[key]; }),
    }, onChanged: hook() },
    permissions: { contains: vi.fn((_permission, callback) => { callback?.(false); return Promise.resolve(false); }),
      request: vi.fn().mockResolvedValue(false), remove: vi.fn().mockResolvedValue(true), onAdded: hook(), onRemoved: hook() },
    extension: { isAllowedFileSchemeAccess: callback => callback(false) },
    notifications: { create: vi.fn().mockResolvedValue('synthetic-notification') },
    scripting: { registerContentScripts: vi.fn().mockResolvedValue(), unregisterContentScripts: vi.fn().mockResolvedValue() },
    tabs: { onUpdated: hook(), create: vi.fn() }, contextMenus: { onClicked: hook(), create: vi.fn() }, commands: { onCommand: hook() },
    i18n: { getMessage: key => key },
  };
  const page = document.implementation.createHTMLDocument('Synthetic extension popup');
  if (script === 'popup.js') page.documentElement.innerHTML = readFileSync(resolve(import.meta.dirname, '../popup.html'), 'utf8');
  const window = { location: new URL('https://approved.example.test/app'), postMessage: vi.fn(), close: vi.fn(), addEventListener: vi.fn() };
  const context = createContext({ chrome, document: page, window, navigator: { platform: 'Linux' }, URL, console,
    AbortController, TextEncoder, TextDecoder, setTimeout, clearTimeout });
  const start = () => new Script(readFileSync(resolve(import.meta.dirname, '..', script), 'utf8')).runInContext(context);
  const sender = { id: chrome.runtime.id, url: 'https://approved.example.test/app', frameId: 0, tab: { id: 1, url: 'https://approved.example.test/app' } };
  const internal = { id: chrome.runtime.id, url: chrome.runtime.getURL('popup.html') };
  const message = (payload, source = sender) => new Promise(done => chrome.runtime.onMessage.listeners[0](payload, source, done));
  return { chrome, page, window, context, storage, start, message, internal, get: id => page.getElementById(id) };
}

describe('notification permission feedback', () => {
  it('checks current permission on settings open without requesting or overwriting app approval', async () => {
    const h = harness(); h.start();
    h.get('settings-approval-status').textContent = 'App approved.';
    h.get('settings-btn').click();
    await vi.waitFor(() => expect(h.get('settings-notification-status').textContent).toContain('are disabled'));
    expect(h.chrome.permissions.request).not.toHaveBeenCalled();
    expect(h.get('settings-approval-status').textContent).toBe('App approved.');
  });

  it('shows existing grants and refreshes after external revocation without making a native request', async () => {
    const h = harness();
    h.chrome.permissions.contains.mockImplementation((permission, callback) => {
      const granted = permission.permissions?.includes('notifications') === true;
      callback?.(granted); return Promise.resolve(granted);
    });
    h.start(); h.get('settings-btn').click();
    await vi.waitFor(() => expect(h.get('settings-notifications').disabled).toBe(true));
    expect(h.get('settings-notification-status').textContent).toContain('Operating system settings may still suppress display');
    h.chrome.permissions.contains.mockResolvedValue(false);
    h.chrome.permissions.onRemoved.emit({ permissions: ['notifications'] });
    await vi.waitFor(() => expect(h.get('settings-notifications').disabled).toBe(false));
    expect(h.get('settings-notification-status').textContent).toContain('are disabled');
    expect(h.chrome.permissions.request).not.toHaveBeenCalled();
  });

  it('invokes the request inside the click, shows pending feedback, and does not duplicate a pending request', async () => {
    const h = harness(); const request = deferred();
    h.chrome.permissions.request.mockReturnValue(request.promise); h.start();
    h.get('settings-notifications').click();
    expect(h.chrome.permissions.request).toHaveBeenCalledExactlyOnceWith({ permissions: ['notifications'] });
    expect(h.get('settings-notification-status').textContent).toContain('Waiting for the browser permission response');
    expect(h.get('settings-notifications').disabled).toBe(true);
    h.get('settings-notifications').click();
    expect(h.chrome.permissions.request).toHaveBeenCalledOnce();
    request.resolve(false);
    await vi.waitFor(() => expect(h.get('settings-notifications').disabled).toBe(false));
    expect(h.get('settings-notification-status').textContent).toContain('were not enabled; in-app alerts remain available');
    expect(h.get('settings-approval-status').textContent).toBe(h.get('settings-notification-status').textContent);
  });

  it('reports request API errors instead of silently treating them as a user denial', async () => {
    const h = harness();
    h.chrome.permissions.request.mockRejectedValue(new Error('Synthetic browser permission error'));
    h.start(); h.get('settings-notifications').click();
    await vi.waitFor(() => expect(h.get('settings-notification-status').textContent).toContain('Notification permission request failed: Synthetic browser permission error'));
    expect(h.get('settings-notifications').disabled).toBe(false);
  });

  it('verifies actual permission even when the request reports success', async () => {
    const h = harness(); h.chrome.permissions.request.mockResolvedValue(true);
    h.start(); h.get('settings-notifications').click();
    await vi.waitFor(() => expect(h.get('settings-notifications').disabled).toBe(false));
    expect(h.get('settings-notification-status').textContent).toContain('were not enabled');
  });

  it('discards an older settings read after the native request is accepted', async () => {
    const h = harness(); const beforeClick = deferred(); let notificationReads = 0;
    h.chrome.permissions.contains.mockImplementation((permission, callback) => {
      if (permission.permissions) return ++notificationReads === 1 ? beforeClick.promise : Promise.resolve(true);
      callback?.(false); return Promise.resolve(false);
    });
    h.chrome.permissions.request.mockResolvedValue(true);
    h.start(); h.get('settings-btn').click(); h.get('settings-notifications').click();
    await vi.waitFor(() => expect(h.get('settings-notification-status').textContent).toContain('Desktop notifications enabled'));
    beforeClick.resolve(false); await beforeClick.promise; await Promise.resolve();
    expect(h.get('settings-notifications').disabled).toBe(true);
    expect(h.get('settings-notification-status').textContent).toContain('Desktop notifications enabled');
  });
});

describe('approval refresh ownership', () => {
  it('cannot restore revoked readiness from an older successful approval response', async () => {
    const h = harness('bridge.js'); const first = deferred(); const revoked = deferred();
    h.chrome.runtime.sendMessage.mockReturnValueOnce(first.promise).mockReturnValueOnce(revoked.promise); h.start();
    h.chrome.storage.onChanged.emit({ approvedAppsV1: { newValue: {} } }, 'local');
    revoked.resolve({ loaded: false }); await revoked.promise;
    first.resolve({ loaded: true }); await first.promise; await Promise.resolve();
    expect(h.context.tcAppApproved).toBe(false);
    expect(h.page.documentElement.dataset.tcBridgeCaps).toBeUndefined();
    expect(h.window.postMessage).not.toHaveBeenCalled();
  });

  it('does not clear a newer approved response when an older check fails', async () => {
    const h = harness('bridge.js'); const first = deferred(); const approved = deferred();
    h.chrome.runtime.sendMessage.mockReturnValueOnce(first.promise).mockReturnValueOnce(approved.promise); h.start();
    const refresh = h.context.refreshAppApproval();
    approved.resolve({ loaded: true }); await refresh;
    first.reject(new Error('Synthetic superseded check')); await Promise.resolve(); await Promise.resolve();
    expect(h.context.tcAppApproved).toBe(true);
    expect(h.window.postMessage).toHaveBeenCalledOnce();
  });

  it('withdraws readiness immediately while a changed approval is being checked', async () => {
    const h = harness('bridge.js'); h.chrome.runtime.sendMessage.mockResolvedValueOnce({ loaded: true }); h.start();
    await vi.waitFor(() => expect(h.context.tcAppApproved).toBe(true));
    const check = deferred(); h.chrome.runtime.sendMessage.mockReturnValueOnce(check.promise);
    const pending = h.context.refreshAppApproval();
    expect(h.context.tcAppApproved).toBe(false);
    expect(h.page.documentElement.dataset.tcBridgeCaps).toBeUndefined();
    check.resolve({ loaded: false }); await pending;
  });
});

describe('notification approval at delivery', () => {
  it('does not deliver a notification after app revocation during its permission check', async () => {
    const h = harness('background.js'); h.start();
    expect(await h.message({ type: 'APPROVE_APP', targetUrl: 'https://approved.example.test' }, h.internal)).toMatchObject({ success: true });
    const permission = deferred(); h.chrome.permissions.contains.mockReturnValueOnce(permission.promise);
    const pending = h.message({ type: 'SEND_NOTIFICATION', title: 'Synthetic notice', message: 'Local fixture only' });
    await vi.waitFor(() => expect(h.chrome.permissions.contains).toHaveBeenCalledOnce());
    expect(await h.message({ type: 'REVOKE_APPS' }, h.internal)).toMatchObject({ success: true });
    permission.resolve(true);
    expect(await pending).toMatchObject({ success: false });
    expect(h.chrome.notifications.create).not.toHaveBeenCalled();
  });

  it('rejects a pending delivery belonging to a replaced approval', async () => {
    const h = harness('background.js'); h.start();
    await h.message({ type: 'APPROVE_APP', targetUrl: 'https://approved.example.test' }, h.internal);
    const permission = deferred(); h.chrome.permissions.contains.mockReturnValueOnce(permission.promise);
    const pending = h.message({ type: 'SEND_NOTIFICATION', title: 'Synthetic notice', message: 'Local fixture only' });
    await vi.waitFor(() => expect(h.chrome.permissions.contains).toHaveBeenCalledOnce());
    const old = h.storage.approvedAppsV1['https://approved.example.test'];
    h.storage.approvedAppsV1 = { 'https://approved.example.test': { ...old, approvedAt: old.approvedAt + 1 } };
    permission.resolve(true);
    expect(await pending).toMatchObject({ success: false, error: expect.stringContaining('App approval changed') });
    expect(h.chrome.notifications.create).not.toHaveBeenCalled();
  });

  it('retains explicit accepted acknowledgement for a current approval and granted permission', async () => {
    const h = harness('background.js'); h.start();
    await h.message({ type: 'APPROVE_APP', targetUrl: 'https://approved.example.test' }, h.internal);
    h.chrome.permissions.contains.mockResolvedValue(true);
    expect(await h.message({ type: 'SEND_NOTIFICATION', title: 'Synthetic notice', message: 'Local fixture only' }))
      .toMatchObject({ success: true, accepted: true, notificationId: 'synthetic-notification' });
    expect(h.chrome.notifications.create).toHaveBeenCalledOnce();
  });
});
