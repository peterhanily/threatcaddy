import { readFileSync } from 'node:fs';
import { createContext, Script } from 'node:vm';
import { resolve } from 'node:path';
import { URL } from 'node:url';
import { webcrypto } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';

const manifest = name => JSON.parse(readFileSync(resolve(import.meta.dirname, '..', name), 'utf8'));

function hook() {
  const listeners = [];
  return { listeners, addListener: fn => listeners.push(fn), removeListener: fn => { const i = listeners.indexOf(fn); if (i >= 0) listeners.splice(i, 1); } };
}
/** The background worker without the `tabs` permission: a tab object carries url and title only for a tab the
 *  extension has host access to, or one activeTab was granted for (a context-menu click or the shortcut). */
function harness(currentTab) {
  const storage = {};
  const chrome = {
    runtime: { id: 'extension', getURL: path => 'chrome-extension://extension/' + path.replace(/^\//, ''), onMessage: hook(), onConnect: hook(), onInstalled: hook() },
    storage: { local: {
      get: async keys => keys === null ? { ...storage } : Object.fromEntries(keys.map(key => [key, storage[key]])),
      set: async values => Object.assign(storage, values), remove: async key => { delete storage[key]; },
    }, onChanged: hook() },
    scripting: { registerContentScripts: vi.fn().mockResolvedValue(), unregisterContentScripts: vi.fn().mockResolvedValue(),
      executeScript: vi.fn().mockResolvedValue([{ result: 'Selected **fixture** text' }]) },
    tabs: { onUpdated: hook(), create: vi.fn().mockResolvedValue({}), sendMessage: vi.fn().mockResolvedValue({ loaded: true }),
      get: vi.fn(async () => { if (!currentTab) throw new Error('No tab with id: 7'); return currentTab; }),
      query: vi.fn(async () => [currentTab]) },
    contextMenus: { onClicked: hook(), create: vi.fn() }, commands: { onCommand: hook() },
    permissions: { contains: vi.fn().mockResolvedValue(true), request: vi.fn().mockResolvedValue(true) },
    i18n: { getMessage: key => key },
  };
  const context = createContext({ chrome, crypto: webcrypto, URL, console, TextEncoder, TextDecoder, AbortController, setTimeout, clearTimeout, fetch: vi.fn() });
  new Script(readFileSync(resolve(import.meta.dirname, '../background.js'), 'utf8')).runInContext(context);
  const saved = () => vi.waitFor(() => { expect(storage.captures).toHaveLength(1); return storage.captures[0]; });
  return { chrome, saved };
}

const page = { url: 'https://news.example.test/advisory', title: 'Fixture advisory' };
const click = { menuItemId: 'save-to-threatcaddy', selectionText: 'Selected fixture text', pageUrl: page.url };

describe('extension permissions', () => {
  it.each(['manifest.json', 'manifest.firefox.json'])('%s does not ask to read every tab (no tabs permission)', name => {
    const { permissions } = manifest(name);
    expect(permissions).not.toContain('tabs');
    expect(permissions).toEqual(expect.arrayContaining(['activeTab', 'scripting', 'contextMenus', 'storage']));
  });

  // Chromium builds the click's tab object before it grants activeTab, so without `tabs` it can lack url and title.
  it('a context-menu capture reads its source after activeTab is granted', async () => {
    const h = harness({ id: 7, ...page });
    await h.chrome.contextMenus.onClicked.listeners[0](click, { id: 7 });
    expect(await h.saved()).toMatchObject({ sourceUrl: page.url, sourceTitle: page.title });
    expect(h.chrome.tabs.get).toHaveBeenCalledWith(7);
  });

  it('keeps the clicked page address when the tab can no longer be read', async () => {
    const h = harness(undefined);
    await h.chrome.contextMenus.onClicked.listeners[0](click, { id: 7 });
    expect(await h.saved()).toMatchObject({ sourceUrl: page.url, sourceTitle: '' });
  });

  it('a keyboard-shortcut capture reads its source from the active tab activeTab was granted for', async () => {
    const h = harness({ id: 7, ...page });
    await h.chrome.commands.onCommand.listeners[0]('capture-selection');
    expect(await h.saved()).toMatchObject({ sourceUrl: page.url, sourceTitle: page.title });
  });
});
