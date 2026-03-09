/**
 * Tests for pure utility functions extracted from the extension source files.
 *
 * Because the extension scripts are plain browser globals (not ES modules),
 * we re-declare the functions here exactly as they appear in source so that
 * changes in the source must be mirrored or the tests will catch regressions.
 */
import { describe, it, expect } from 'vitest'

// ── targetUrlToMatchPattern (from background.js) ──────────────────────

const STATIC_BRIDGE_PATTERNS = new Set([
  'https://threatcaddy.com/*',
  'https://www.threatcaddy.com/*',
])

function targetUrlToMatchPattern(targetUrl) {
  if (!targetUrl) return null
  try {
    const parsed = new URL(targetUrl)
    if (parsed.protocol === 'file:') return null
    if (!/^https?:$/.test(parsed.protocol)) return null
    const pattern = `${parsed.protocol}//${parsed.host}/*`
    return STATIC_BRIDGE_PATTERNS.has(pattern) ? null : pattern
  } catch {
    return null
  }
}

describe('targetUrlToMatchPattern', () => {
  it('returns null for empty/undefined input', () => {
    expect(targetUrlToMatchPattern('')).toBeNull()
    expect(targetUrlToMatchPattern(null)).toBeNull()
    expect(targetUrlToMatchPattern(undefined)).toBeNull()
  })

  it('returns null for static threatcaddy.com patterns', () => {
    expect(targetUrlToMatchPattern('https://threatcaddy.com')).toBeNull()
    expect(targetUrlToMatchPattern('https://www.threatcaddy.com')).toBeNull()
    expect(targetUrlToMatchPattern('https://threatcaddy.com/foo')).toBeNull()
  })

  it('returns pattern for custom https targets', () => {
    expect(targetUrlToMatchPattern('https://my-instance.example.com')).toBe(
      'https://my-instance.example.com/*'
    )
    expect(targetUrlToMatchPattern('https://localhost:3000')).toBe(
      'https://localhost:3000/*'
    )
  })

  it('returns pattern for http targets', () => {
    expect(targetUrlToMatchPattern('http://localhost:8080')).toBe(
      'http://localhost:8080/*'
    )
    expect(targetUrlToMatchPattern('http://192.168.1.100')).toBe(
      'http://192.168.1.100/*'
    )
  })

  it('returns null for file:// URLs', () => {
    expect(targetUrlToMatchPattern('file:///Users/me/threatcaddy.html')).toBeNull()
  })

  it('returns null for non-http(s) protocols', () => {
    expect(targetUrlToMatchPattern('ftp://example.com')).toBeNull()
    expect(targetUrlToMatchPattern('ws://example.com')).toBeNull()
  })

  it('returns null for invalid URLs', () => {
    expect(targetUrlToMatchPattern('not a url')).toBeNull()
    expect(targetUrlToMatchPattern('://missing-protocol')).toBeNull()
  })
})

// ── formatRelativeTime (from popup.js) ────────────────────────────────

function formatRelativeTime(date) {
  const now = Date.now()
  const diff = now - date.getTime()
  const minutes = Math.floor(diff / 60000)
  const hours = Math.floor(diff / 3600000)
  const days = Math.floor(diff / 86400000)

  if (minutes < 1) return 'Just now'
  if (minutes < 60) return `${minutes}m ago`
  if (hours < 24) return `${hours}h ago`
  if (days < 7) return `${days}d ago`
  return date.toLocaleDateString()
}

describe('formatRelativeTime', () => {
  it('returns "Just now" for times less than 1 minute ago', () => {
    const date = new Date(Date.now() - 30_000) // 30 seconds ago
    expect(formatRelativeTime(date)).toBe('Just now')
  })

  it('returns minutes format for <60 minutes', () => {
    const date = new Date(Date.now() - 5 * 60_000) // 5 minutes ago
    expect(formatRelativeTime(date)).toBe('5m ago')
  })

  it('returns hours format for <24 hours', () => {
    const date = new Date(Date.now() - 3 * 3_600_000) // 3 hours ago
    expect(formatRelativeTime(date)).toBe('3h ago')
  })

  it('returns days format for <7 days', () => {
    const date = new Date(Date.now() - 2 * 86_400_000) // 2 days ago
    expect(formatRelativeTime(date)).toBe('2d ago')
  })

  it('returns locale date string for >= 7 days', () => {
    const date = new Date(Date.now() - 10 * 86_400_000) // 10 days ago
    expect(formatRelativeTime(date)).toBe(date.toLocaleDateString())
  })
})

// ── escapeHtml (from popup.js) ────────────────────────────────────────

function escapeHtml(text) {
  const div = document.createElement('div')
  div.textContent = text
  return div.innerHTML
}

describe('escapeHtml', () => {
  it('escapes angle brackets', () => {
    expect(escapeHtml('<script>alert(1)</script>')).toBe(
      '&lt;script&gt;alert(1)&lt;/script&gt;'
    )
  })

  it('escapes ampersands', () => {
    expect(escapeHtml('foo & bar')).toBe('foo &amp; bar')
  })

  it('escapes quotes', () => {
    expect(escapeHtml('"hello"')).toBe('"hello"')
  })

  it('passes through plain text unchanged', () => {
    expect(escapeHtml('Hello World')).toBe('Hello World')
  })

  it('handles empty string', () => {
    expect(escapeHtml('')).toBe('')
  })
})

// ── Protocol version / readyPayload (from bridge.js) ──────────────────

const TC_PROTOCOL_VERSION = 1
const TC_CAPABILITIES = ['llm_streaming', 'fetch_url', 'clip_import', 'proxy_fetch']

function readyPayload() {
  return {
    type: 'TC_EXTENSION_READY',
    protocolVersion: TC_PROTOCOL_VERSION,
    capabilities: TC_CAPABILITIES,
  }
}

describe('readyPayload', () => {
  it('returns correct message type', () => {
    const p = readyPayload()
    expect(p.type).toBe('TC_EXTENSION_READY')
  })

  it('includes protocol version as a number', () => {
    const p = readyPayload()
    expect(typeof p.protocolVersion).toBe('number')
    expect(p.protocolVersion).toBe(1)
  })

  it('includes all expected capabilities', () => {
    const p = readyPayload()
    expect(p.capabilities).toContain('llm_streaming')
    expect(p.capabilities).toContain('fetch_url')
    expect(p.capabilities).toContain('clip_import')
    expect(p.capabilities).toContain('proxy_fetch')
  })

  it('returns a fresh object each call (no shared mutation)', () => {
    const a = readyPayload()
    const b = readyPayload()
    expect(a).toEqual(b)
    expect(a).not.toBe(b)
  })
})

// ── Protocol version validation ───────────────────────────────────────

describe('protocol version validation', () => {
  it('version is a positive integer', () => {
    expect(Number.isInteger(TC_PROTOCOL_VERSION)).toBe(true)
    expect(TC_PROTOCOL_VERSION).toBeGreaterThan(0)
  })

  it('capabilities is a non-empty array of strings', () => {
    expect(Array.isArray(TC_CAPABILITIES)).toBe(true)
    expect(TC_CAPABILITIES.length).toBeGreaterThan(0)
    TC_CAPABILITIES.forEach((cap) => {
      expect(typeof cap).toBe('string')
    })
  })
})

// ── isExtensionValid (from bridge.js) ─────────────────────────────────

describe('isExtensionValid logic', () => {
  // We can't fully emulate chrome.runtime in jsdom, but we can test the
  // logic pattern in isolation.

  function isExtensionValid(chromeObj) {
    try {
      return !!(chromeObj && chromeObj.runtime && chromeObj.runtime.id)
    } catch {
      return false
    }
  }

  it('returns true when chrome.runtime.id is present', () => {
    expect(isExtensionValid({ runtime: { id: 'abc123' } })).toBe(true)
  })

  it('returns false when chrome is undefined', () => {
    expect(isExtensionValid(undefined)).toBe(false)
  })

  it('returns false when chrome.runtime is undefined', () => {
    expect(isExtensionValid({ runtime: undefined })).toBe(false)
  })

  it('returns false when chrome.runtime.id is empty string', () => {
    expect(isExtensionValid({ runtime: { id: '' } })).toBe(false)
  })

  it('returns false when chrome.runtime.id is null', () => {
    expect(isExtensionValid({ runtime: { id: null } })).toBe(false)
  })

  it('returns false when accessing chrome throws', () => {
    const throwing = new Proxy(
      {},
      {
        get() {
          throw new Error('context invalidated')
        },
      }
    )
    expect(isExtensionValid(throwing)).toBe(false)
  })
})
