/**
 * Execute the complete shipped scripts in isolated contexts. These are source
 * tests with controlled browser APIs, not installed-extension integration tests.
 * Never copy a production function here: a source regression must affect tests.
 */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { URL } from 'node:url'
import { createContext, Script } from 'node:vm'
import { beforeEach, describe, it, expect, vi } from 'vitest'

const NOW = Date.parse('2026-09-07T12:00:00Z')

class FixedDate extends Date {
  static now() { return NOW }
}

function eventHook() {
  const listeners = []
  return {
    listeners,
    addListener: vi.fn((listener) => listeners.push(listener)),
    removeListener: vi.fn((listener) => {
      const index = listeners.indexOf(listener)
      if (index !== -1) listeners.splice(index, 1)
    }),
  }
}

function chromeStub() {
  return {
    i18n: {
      // Deliberately different from English to catch hardcoded translations.
      getMessage: vi.fn((key, substitutions = []) => [key, ...substitutions].join(':')),
    },
    runtime: {
      id: 'test-extension',
      onInstalled: eventHook(), onMessage: eventHook(), onConnect: eventHook(),
      sendMessage: vi.fn().mockResolvedValue({ loaded: true }),
      getURL: vi.fn(path => 'chrome-extension://test-extension/' + path.replace(/^\//, '')),
    },
    storage: {
      local: { get: vi.fn().mockResolvedValue({}), set: vi.fn().mockResolvedValue(), remove: vi.fn().mockResolvedValue() },
      onChanged: eventHook(),
    },
    tabs: { onUpdated: eventHook(), create: vi.fn() },
    commands: { onCommand: eventHook() },
    contextMenus: { onClicked: eventHook(), create: vi.fn() },
    scripting: {
      getRegisteredContentScripts: vi.fn().mockResolvedValue([]),
      registerContentScripts: vi.fn().mockResolvedValue(),
      updateContentScripts: vi.fn().mockResolvedValue(),
      unregisterContentScripts: vi.fn().mockResolvedValue(),
    },
    permissions: {
      contains: vi.fn((_permissions, callback) => {
        callback?.(false)
        return Promise.resolve(false)
      }),
      request: vi.fn().mockResolvedValue(false),
      remove: vi.fn().mockResolvedValue(true),
    },
    extension: { isAllowedFileSchemeAccess: vi.fn((callback) => callback(false)) },
  }
}

function executeSource(filename, globals = {}) {
  const sourcePath = resolve(import.meta.dirname, '..', filename)
  const context = createContext({
    chrome: chromeStub(), URL, Date: FixedDate,
    console: { error: vi.fn(), warn: vi.fn() },
    ...globals,
  })
  new Script(readFileSync(sourcePath, 'utf8'), { filename: sourcePath }).runInContext(context)
  return context
}

function loadPopup() {
  // Script elements inserted through innerHTML are inert. Execute popup.js only
  // through the VM while exercising the actual popup markup and DOM operations.
  const popupDocument = document.implementation.createHTMLDocument('Popup test')
  popupDocument.documentElement.innerHTML = readFileSync(resolve(import.meta.dirname, '../popup.html'), 'utf8')
  return executeSource('popup.js', {
    document: popupDocument, navigator: { platform: 'Linux' }, window: { close: vi.fn() },
  })
}

function loadBridge(url = 'https://threatcaddy.com/') {
  const messageListeners = []
  const bridgeDocument = document.implementation.createHTMLDocument('Bridge test')
  const bridgeWindow = {
    location: new URL(url), postMessage: vi.fn(),
    addEventListener: vi.fn((type, listener) => {
      if (type === 'message') messageListeners.push(listener)
    }),
  }
  const context = executeSource('bridge.js', { document: bridgeDocument, window: bridgeWindow })
  return { context, messageListeners }
}

describe('background.js targetUrlToMatchPattern', () => {
  let background
  beforeEach(() => { background = executeSource('background.js') })

  it.each(['', null, undefined])('returns null for empty input %s', (input) => {
    expect(background.targetUrlToMatchPattern(input)).toBeNull()
  })

  it.each([
    'https://threatcaddy.com', 'https://www.threatcaddy.com', 'https://threatcaddy.com/foo',
  ])('produces a hosted app pattern only for later explicit registration: %s', (url) => {
    expect(background.targetUrlToMatchPattern(url)).toBe(new URL(url).origin + '/*')
  })

  it.each([
    ['https://my-instance.example.com', 'https://my-instance.example.com/*'],
    ['https://localhost:3000', 'https://localhost/*'],
    ['http://localhost:8080', 'http://localhost/*'],
    ['http://192.168.1.100', 'http://192.168.1.100/*'],
  ])('returns the expected custom origin pattern for %s', (url, pattern) => {
    expect(background.targetUrlToMatchPattern(url)).toBe(pattern)
  })

  it.each([
    'file:///Users/me/threatcaddy.html', 'ftp://example.com', 'ws://example.com',
    'not a url', '://missing-protocol',
  ])('does not register an unsupported or invalid URL %s', (url) => {
    expect(background.targetUrlToMatchPattern(url)).toBeNull()
  })

  it('executes service-worker startup and registers the actual event handlers', async () => {
    await vi.waitFor(() => expect(background.chrome.scripting.unregisterContentScripts)
      .toHaveBeenCalledWith({ ids: ['dynamic-bridge'] }))
    expect(background.chrome.storage.onChanged.addListener).toHaveBeenCalledOnce()
    expect(background.chrome.runtime.onMessage.addListener).toHaveBeenCalledOnce()
    expect(background.chrome.runtime.onConnect.addListener).toHaveBeenCalledOnce()
    expect(background.console.error).not.toHaveBeenCalled()
    expect(background.console.warn).not.toHaveBeenCalled()
  })
})

describe('popup.js utilities and bootstrap', () => {
  let popup
  beforeEach(() => { popup = loadPopup() })

  it.each([
    [30_000, 'justNow', []], [60_000, 'minutesAgo', ['1']],
    [5 * 60_000, 'minutesAgo', ['5']], [60 * 60_000, 'hoursAgo', ['1']],
    [3 * 3_600_000, 'hoursAgo', ['3']], [24 * 3_600_000, 'daysAgo', ['1']],
    [2 * 86_400_000, 'daysAgo', ['2']],
  ])('uses the browser translation for an age of %s ms', (age, key, substitutions) => {
    popup.chrome.i18n.getMessage.mockClear()
    expect(popup.formatRelativeTime(new Date(NOW - age))).toBe([key, ...substitutions].join(':'))
    if (substitutions.length) {
      expect(popup.chrome.i18n.getMessage).toHaveBeenCalledWith(key, substitutions)
    } else {
      expect(popup.chrome.i18n.getMessage).toHaveBeenCalledWith(key)
    }
  })

  it.each([7, 10])('uses the locale date at %s days', (days) => {
    const date = new Date(NOW - days * 86_400_000)
    popup.chrome.i18n.getMessage.mockClear()
    expect(popup.formatRelativeTime(date)).toBe(date.toLocaleDateString())
    expect(popup.chrome.i18n.getMessage).not.toHaveBeenCalled()
  })

  it.each([
    ['<b>Analyst note</b>', '&lt;b&gt;Analyst note&lt;/b&gt;'],
    ['foo & bar', 'foo &amp; bar'], ['"hello"', '"hello"'],
    ['Hello World', 'Hello World'], ['', ''],
  ])('escapes text for an HTML text node: %s', (input, expected) => {
    expect(popup.escapeHtml(input)).toBe(expected)
  })

  it('loads the real popup DOM, localizes it, and displays empty capture stats', async () => {
    await vi.waitFor(() => {
      expect(popup.document.getElementById('recent-list').textContent).toBe('noCaptures')
      expect(popup.document.getElementById('settings-target-url').value).toBe('https://threatcaddy.com')
    })
    expect(popup.document.getElementById('total-captures').textContent).toBe('0')
    expect(popup.document.getElementById('shortcut-kbd').textContent).toBe('Alt+Shift+X')
    expect(popup.chrome.permissions.contains).toHaveBeenCalledTimes(4)
    expect(popup.console.error).not.toHaveBeenCalled()
  })

  it('renders capture text literally through the actual rendering function', async () => {
    // Let the startup read finish before replacing its initial empty rendering.
    await vi.waitFor(() => expect(popup.document.getElementById('recent-list').textContent).toBe('noCaptures'))
    popup.renderRecentCaptures([{
      title: '<b>Analyst note</b>', content: 'A & B',
      sourceUrl: 'https://example.com/report', createdAt: NOW - 5 * 60_000,
    }])
    expect(popup.document.querySelector('.recent-title').textContent).toBe('<b>Analyst note</b>')
    expect(popup.document.querySelector('.recent-title b')).toBeNull()
    expect(popup.document.querySelector('.recent-preview').textContent).toBe('A & B')
    expect(popup.document.querySelector('.recent-source').textContent).toBe('example.com')
    expect(popup.document.querySelector('.recent-meta').textContent).toContain('minutesAgo:5')
  })
})

describe('bridge.js protocol and extension validity', () => {
  let bridge
  beforeEach(async () => {
    bridge = loadBridge()
    await vi.waitFor(() => expect(bridge.context.window.postMessage).toHaveBeenCalled())
  })

  it('announces the actual versioned protocol and capabilities at startup', () => {
    const payload = bridge.context.readyPayload()
    expect(payload).toEqual({
      type: 'TC_EXTENSION_READY', protocolVersion: 1,
      capabilities: ['llm_streaming', 'fetch_url', 'clip_import', 'proxy_fetch', 'notification_ack'],
    })
    expect(Number.isInteger(payload.protocolVersion)).toBe(true)
    expect(payload.protocolVersion).toBeGreaterThan(0)
    expect(bridge.context.window.postMessage).toHaveBeenCalledWith(payload, 'https://threatcaddy.com')
    expect(bridge.context.document.documentElement.dataset.tcBridgeCaps).toBe(payload.capabilities.join(','))
  })

  it('returns a fresh payload object for each announcement', () => {
    const a = bridge.context.readyPayload()
    const b = bridge.context.readyPayload()
    expect(a).toEqual(b)
    expect(a).not.toBe(b)
  })

  it('responds to a same-window, same-origin readiness ping', () => {
    bridge.context.window.postMessage.mockClear()
    for (const listener of bridge.messageListeners) {
      listener({
        source: bridge.context.window, origin: 'https://threatcaddy.com',
        data: { type: 'TC_EXTENSION_PING' },
      })
    }
    expect(bridge.context.window.postMessage).toHaveBeenCalledOnce()
    expect(bridge.context.window.postMessage).toHaveBeenCalledWith(
      bridge.context.readyPayload(), 'https://threatcaddy.com',
    )
  })

  it('uses the file-origin delivery mode for standalone pages', async () => {
    const standalone = loadBridge('file:///tmp/threatcaddy.html').context
    await vi.waitFor(() => expect(standalone.window.postMessage).toHaveBeenCalledWith(standalone.readyPayload(), '*'))
  })

  it('reports a valid extension context', () => {
    expect(bridge.context.isExtensionValid()).toBe(true)
  })

  it.each([
    undefined, { runtime: undefined }, { runtime: { id: '' } }, { runtime: { id: null } },
  ])('detects an unavailable runtime: %s', (chrome) => {
    bridge.context.chrome = chrome
    expect(bridge.context.isExtensionValid()).toBe(false)
  })

  it('handles an invalidated runtime that throws on access', () => {
    bridge.context.chrome = new Proxy({}, {
      get() { throw new Error('context invalidated') },
    })
    expect(bridge.context.isExtensionValid()).toBe(false)
  })

  it('handles removal of the chrome global', () => {
    delete bridge.context.chrome
    expect(bridge.context.isExtensionValid()).toBe(false)
  })
})
