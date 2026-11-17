import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import i18n from '../i18n';
import deIntegrations from '../../public/locales/de/integrations.json';
import enIntegrations from '../../public/locales/en/integrations.json';
import { executeFetchUrl } from '../lib/llm-tools-analysis';
// The `/fetch` chat command calls the bridge through this re-export.
import { fetchViaExtensionBridge } from '../lib/llm-tools';

// Store 1.1.1 (66ec58f4 bridge.js:6), the 1.1.3 download (aa4646ad bridge.js:6) and 1.1.4 (bridge.js:6).
const STORE_1_1_1_CAPS = 'llm_streaming,fetch_url,clip_import,proxy_fetch';
const HEAD_CAPS = 'llm_streaming,fetch_url,clip_import,clip_import_ack_v2,proxy_fetch,proxy_fetch_abort,notification_ack';
const CAPS_1_1_4 = 'llm_streaming,fetch_url,fetch_url_public_v1,clip_import,clip_import_ack_v2,proxy_fetch,proxy_fetch_abort,notification_ack';

function bridgeFetches(post: ReturnType<typeof vi.spyOn>) {
  return post.mock.calls.filter(([message]: unknown[]) => (message as { type?: string })?.type === 'TC_FETCH_URL');
}
const postedTypes = (post: ReturnType<typeof vi.spyOn>) => post.mock.calls.map(([message]: unknown[]) => (message as { type?: string })?.type);

async function inGerman(run: (de: Record<string, string>) => Promise<void>) {
  for (const [namespace, values] of Object.entries(i18n.getDataByLanguage('en') ?? {})) i18n.addResourceBundle('de', namespace, values, true, false);
  i18n.addResourceBundle('de', 'integrations', deIntegrations, true, true);
  await i18n.changeLanguage('de');
  try { await run(deIntegrations as Record<string, string>); } finally { await i18n.changeLanguage('en'); }
}

/** The page's own posts. */
let post: ReturnType<typeof vi.spyOn>;
/** The capabilities each bridge answers TC_EXTENSION_PING with. Only a bridge that owns the page's
 * listeners answers, and that bridge is the one that would relay TC_FETCH_URL. */
let pingReplies: string[];
/** Readiness messages that do not come from this window, such as an embedded page's. */
let foreignReplies: string[];
let fetchAnswered: boolean;
/** A bridge that answers the ping but never the fetch. */
const answerPingOnly = () => { fetchAnswered = false; };
/** As in a browser, a posted message reaches the window's listeners on a later task, in posting order. */
const deliver = (data: unknown, source: Window | null = window, delayMs = 0) =>
  setTimeout(() => window.dispatchEvent(new MessageEvent('message', { source, data })), delayMs);
const ready = (caps: string) => ({ type: 'TC_EXTENSION_READY', protocolVersion: 1, capabilities: caps.split(',') });
/** The installed bridges, answering from their message listener as bridge.js does. */
function bridges(event: MessageEvent) {
  if (event.source !== window) return;
  const request = event.data as { type?: string; requestId?: string };
  if (request?.type === 'TC_EXTENSION_PING') {
    for (const caps of pingReplies) deliver(ready(caps));
    for (const caps of foreignReplies) deliver(ready(caps), null);
  } else if (request?.type === 'TC_FETCH_URL' && fetchAnswered) {
    deliver({ type: 'TC_FETCH_URL_RESULT', requestId: request.requestId, success: true, title: 'Fixture', content: 'Fixture page' });
  }
}
beforeEach(() => {
  pingReplies = [HEAD_CAPS];
  foreignReplies = [];
  fetchAnswered = true;
  post = vi.spyOn(window, 'postMessage').mockImplementation((message: unknown) => { deliver(message); });
  window.addEventListener('message', bridges);
});
afterEach(() => {
  window.removeEventListener('message', bridges);
  vi.restoreAllMocks();
  delete document.documentElement.dataset.tcBridgeCaps;
});

describe('SPA web fetch guard', () => {
  it.each([
    'http://127.0.0.1/',
    'http://localhost:11434/',
    'http://10.0.0.5/',
    'http://[::1]/',
    'http://intranet/',
    'http://nas.local/',
    'http://nas.local./',
    'http://a.localhost/',
    'http://metadata.google.internal/',
    'http://router.home/',
    'http://pc.lan/',
    'https://u:p@x.example/',
    `https://x.example/${'a'.repeat(2049 - 'https://x.example/'.length)}`,
  ])('rejects %s before anything reaches the extension', async url => {
    document.documentElement.dataset.tcBridgeCaps = HEAD_CAPS;
    expect((await fetchViaExtensionBridge(url)).success).toBe(false);
    expect(JSON.parse(await executeFetchUrl({ url }))).toHaveProperty('error');
    expect(bridgeFetches(post)).toHaveLength(0);
  });

  it('asks store 1.1.1 users to update and posts nothing', async () => {
    document.documentElement.dataset.tcBridgeCaps = STORE_1_1_1_CAPS;
    const url = 'https://nvd.nist.gov/vuln/detail/CVE-2024-3094';
    const result = await fetchViaExtensionBridge(url);
    expect(result).toMatchObject({ success: false, error: expect.stringContaining('1.1.3 or later') });
    expect(JSON.parse(await executeFetchUrl({ url })).error).toContain('1.1.3 or later');
    expect(bridgeFetches(post)).toHaveLength(0);
  });

  it('treats missing capabilities, as while approval refreshes, like an old extension', async () => {
    const result = await fetchViaExtensionBridge('https://nvd.nist.gov/vuln/detail/CVE-2024-3094');
    expect(result).toMatchObject({ success: false, error: expect.stringContaining('1.1.3 or later') });
    expect(bridgeFetches(post)).toHaveLength(0);
  });

  it.each([HEAD_CAPS, 'llm_streaming,fetch_url,fetch_url_public_v1'])('posts a public URL exactly once for the fetch_url tool with caps %s', async caps => {
    document.documentElement.dataset.tcBridgeCaps = caps;
    pingReplies = [caps];
    const url = 'https://nvd.nist.gov/vuln/detail/CVE-2024-3094';
    expect(JSON.parse(await executeFetchUrl({ url }))).toMatchObject({ title: 'Fixture', content: 'Fixture page', url });
    expect(bridgeFetches(post)).toHaveLength(1);
    expect(bridgeFetches(post)[0][0]).toMatchObject({ type: 'TC_FETCH_URL', url });
  });

  it('posts a public URL exactly once for the /fetch command path', async () => {
    document.documentElement.dataset.tcBridgeCaps = HEAD_CAPS;
    const url = 'https://nvd.nist.gov/vuln/detail/CVE-2024-3094';
    expect(await fetchViaExtensionBridge(url)).toMatchObject({ success: true, title: 'Fixture' });
    expect(bridgeFetches(post)).toHaveLength(1);
  });

  it('names the length bound, not the destination, when a public URL is too long', async () => {
    document.documentElement.dataset.tcBridgeCaps = HEAD_CAPS;
    const base = 'https://nvd.nist.gov/vuln/search?query=';
    const longest = base + 'a'.repeat(2048 - base.length);
    const tooLong = { success: false, error: enIntegrations['fetch.tooLong'] };
    expect(await fetchViaExtensionBridge(`${longest}a`)).toEqual(tooLong);
    expect(JSON.parse(await executeFetchUrl({ url: `${longest}a` })).error).toBe(tooLong.error);
    expect(await fetchViaExtensionBridge(`http://127.0.0.1/${'a'.repeat(2048)}`))
      .toEqual({ success: false, error: enIntegrations['fetch.privateTarget'] });
    // 719 characters as typed; the bound is on the href, where each space becomes %20.
    expect(await fetchViaExtensionBridge(`https://x.example/${' '.repeat(700)}a`)).toEqual(tooLong);
    expect(bridgeFetches(post)).toHaveLength(0);
    expect((await fetchViaExtensionBridge(longest)).success).toBe(true);
    expect(bridgeFetches(post)).toHaveLength(1);
  });

  it('shows every refusal in the analyst’s language', () => inGerman(async de => {
    document.documentElement.dataset.tcBridgeCaps = HEAD_CAPS;
    expect(await fetchViaExtensionBridge('http://127.0.0.1/')).toEqual({ success: false, error: de['fetch.privateTarget'] });
    expect(await fetchViaExtensionBridge(`https://x.example/${'a'.repeat(2048)}`)).toEqual({ success: false, error: de['fetch.tooLong'] });
    document.documentElement.dataset.tcBridgeCaps = STORE_1_1_1_CAPS;
    const url = 'https://nvd.nist.gov/vuln/detail/CVE-2024-3094';
    expect(await fetchViaExtensionBridge(url)).toEqual({ success: false, error: de['fetch.updateExtension'] });
    expect(JSON.parse(await executeFetchUrl({ url })).error).toBe(de['fetch.updateExtension']);
    expect(de['fetch.updateExtension']).toContain('1.1.3');
    expect(bridgeFetches(post)).toHaveLength(0);
  }));

  it('reports a bridge that never answers in the analyst’s language', () => inGerman(async de => {
    answerPingOnly();
    document.documentElement.dataset.tcBridgeCaps = HEAD_CAPS;
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    try {
      const pending = fetchViaExtensionBridge('https://nvd.nist.gov/vuln/detail/CVE-2024-3094');
      await vi.advanceTimersByTimeAsync(21_000);
      expect(await pending).toEqual({ success: false, error: de['fetch.bridgeTimeout'] });
      expect(bridgeFetches(post)).toHaveLength(1);
    } finally { vi.useRealTimers(); }
  }));

  it('loads the integrations namespace before refusing, as hosted builds do not bundle it', async () => {
    const reads: string[] = [];
    vi.spyOn(i18n.services.backendConnector.backend, 'read').mockImplementation((...args: unknown[]) => {
      const [language, namespace, callback] = args as [string, string, ((error: null, data: unknown) => void)?];
      reads.push(`${language}/${namespace}`);
      const data = namespace === 'integrations' ? enIntegrations : {};
      return new Promise(resolve => setTimeout(() => { callback?.(null, data); resolve(data); }));
    });
    i18n.removeResourceBundle('en', 'integrations');
    try {
      document.documentElement.dataset.tcBridgeCaps = HEAD_CAPS;
      expect(await fetchViaExtensionBridge('http://127.0.0.1/')).toEqual({ success: false, error: enIntegrations['fetch.privateTarget'] });
      expect(reads).toContain('en/integrations');

      reads.length = 0;
      i18n.removeResourceBundle('en', 'integrations');
      answerPingOnly();
      vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
      const pending = fetchViaExtensionBridge('https://nvd.nist.gov/vuln/detail/CVE-2024-3094');
      await vi.advanceTimersByTimeAsync(21_000);
      await vi.runAllTimersAsync(); // the mocked backend read answers on its own timer
      expect(await pending).toEqual({ success: false, error: enIntegrations['fetch.bridgeTimeout'] });
      expect(reads).toContain('en/integrations');
    } finally {
      vi.useRealTimers();
      i18n.addResourceBundle('en', 'integrations', enIntegrations, true, true);
    }
  });

  it('reads the capabilities at call time', async () => {
    const url = 'https://nvd.nist.gov/vuln/detail/CVE-2024-3094';
    document.documentElement.dataset.tcBridgeCaps = HEAD_CAPS;
    expect((await fetchViaExtensionBridge(url)).success).toBe(true);
    delete document.documentElement.dataset.tcBridgeCaps;
    expect((await fetchViaExtensionBridge(url)).success).toBe(false);
    expect(bridgeFetches(post)).toHaveLength(1);
  });
});

// Store 1.1.1 and a sideloaded 1.1.3 or 1.1.4: the bridge injected first owns the page listeners and relays
// TC_FETCH_URL, but the other one may still publish guarded capabilities on the page.
describe('SPA web fetch guard with two ThreatCaddy extensions installed', () => {
  const url = 'https://nvd.nist.gov/vuln/detail/CVE-2024-3094';
  const updateExtension = { success: false, error: enIntegrations['fetch.updateExtension'] };

  it('refuses when the bridge that answers is store 1.1.1, although the page shows guarded capabilities', async () => {
    document.documentElement.dataset.tcBridgeCaps = HEAD_CAPS;
    pingReplies = [STORE_1_1_1_CAPS];
    expect(await fetchViaExtensionBridge(url)).toEqual(updateExtension);
    expect(JSON.parse(await executeFetchUrl({ url })).error).toBe(updateExtension.error);
    expect(bridgeFetches(post)).toHaveLength(0);
  });

  it('asks the bridge at call time and fetches when it answers with guarded capabilities', async () => {
    document.documentElement.dataset.tcBridgeCaps = CAPS_1_1_4;
    pingReplies = [CAPS_1_1_4];
    expect(await fetchViaExtensionBridge(url)).toMatchObject({ success: true, title: 'Fixture' });
    expect(postedTypes(post)).toEqual(['TC_EXTENSION_PING', 'TC_EXTENSION_PING_END', 'TC_FETCH_URL']);
  });

  it('refuses when no bridge answers', async () => {
    document.documentElement.dataset.tcBridgeCaps = CAPS_1_1_4;
    pingReplies = [];
    expect(await fetchViaExtensionBridge(url)).toEqual(updateExtension);
    expect(bridgeFetches(post)).toHaveLength(0);
  });

  it.each([[[CAPS_1_1_4, STORE_1_1_1_CAPS]], [[STORE_1_1_1_CAPS, HEAD_CAPS]]])('refuses when any answering bridge is old: %j', async replies => {
    document.documentElement.dataset.tcBridgeCaps = CAPS_1_1_4;
    pingReplies = replies;
    expect(await fetchViaExtensionBridge(url)).toEqual(updateExtension);
    expect(bridgeFetches(post)).toHaveLength(0);
  });

  it('ignores readiness messages that do not come from this window', async () => {
    document.documentElement.dataset.tcBridgeCaps = CAPS_1_1_4;
    pingReplies = [];
    foreignReplies = [CAPS_1_1_4];
    expect(await fetchViaExtensionBridge(url)).toEqual(updateExtension);
    expect(bridgeFetches(post)).toHaveLength(0);
  });

  // F2S review: a long task right after the ping, such as a large render or parallel agents' work, made the
  // only, current bridge's reply arrive after a fixed 250 ms window, and the check told the analyst to reload.
  it('waits for the bridge’s answer however long the page is busy after the ping', async () => {
    document.documentElement.dataset.tcBridgeCaps = CAPS_1_1_4;
    pingReplies = [CAPS_1_1_4];
    const pending = fetchViaExtensionBridge(url);
    const until = performance.now() + 300;
    while (performance.now() < until) { /* a long task on the page's main thread */ }
    expect(await pending).toMatchObject({ success: true, title: 'Fixture' });
    expect(bridgeFetches(post)).toHaveLength(1);
  });

  it('waits for the answer of a bridge whose listener was added after the check began', async () => {
    document.documentElement.dataset.tcBridgeCaps = CAPS_1_1_4;
    pingReplies = [CAPS_1_1_4];
    window.removeEventListener('message', bridges);
    const pending = fetchViaExtensionBridge(url);
    window.addEventListener('message', bridges);
    expect(await pending).toMatchObject({ success: true, title: 'Fixture' });
  });

  // The check decides only on the answers to its own ping. A readiness message that arrives first, such as a
  // second extension re-signalling after injection, says nothing about the bridge that owns the page.
  it('refuses when its ping is not delivered in time, whatever else announces itself', async () => {
    document.documentElement.dataset.tcBridgeCaps = CAPS_1_1_4;
    pingReplies = [STORE_1_1_1_CAPS];
    post.mockImplementation((message: unknown) => {
      deliver(message, window, (message as { type?: string })?.type === 'TC_EXTENSION_PING' ? 60_000 : 0);
    });
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    try {
      deliver(ready(CAPS_1_1_4));
      const pending = fetchViaExtensionBridge(url);
      await vi.advanceTimersByTimeAsync(30_000);
      expect(await pending).toEqual(updateExtension);
      expect(bridgeFetches(post)).toHaveLength(0);
    } finally { vi.useRealTimers(); }
  });

  // Pings from other code (useLLM, AgentPanel, useCaddyAgent) carry no requestId, and another check carries its
  // own. Here the check's own ping reaches the page late, after a ping posted just before it was answered by a
  // guarded bridge; the bridge that answers the check's own ping is store 1.1.1.
  it.each([
    ['without a requestId', { type: 'TC_EXTENSION_PING' }],
    ['with another check’s requestId', { type: 'TC_EXTENSION_PING', requestId: 'another-check' }],
  ])('decides on the answers to its own ping, not to an earlier ping %s', async (_case, earlier) => {
    document.documentElement.dataset.tcBridgeCaps = CAPS_1_1_4;
    pingReplies = [CAPS_1_1_4];
    const ownerIsOld = (event: MessageEvent) => { if (event.data === earlier) pingReplies = [STORE_1_1_1_CAPS]; };
    window.addEventListener('message', ownerIsOld);
    post.mockImplementation((message: unknown) => {
      deliver(message, window, (message as { type?: string })?.type === 'TC_EXTENSION_PING' ? 50 : 0);
    });
    try {
      deliver(earlier);
      expect(await fetchViaExtensionBridge(url)).toEqual(updateExtension);
      expect(bridgeFetches(post)).toHaveLength(0);
    } finally { window.removeEventListener('message', ownerIsOld); }
  });

  // Another check's END marker, or one without a requestId, says nothing about this check's own answers.
  it.each([
    ['without a requestId', { type: 'TC_EXTENSION_PING_END' }],
    ['with another check’s requestId', { type: 'TC_EXTENSION_PING_END', requestId: 'another-check' }],
  ])('waits for its own END marker, not one %s', async (_case, foreignEnd) => {
    document.documentElement.dataset.tcBridgeCaps = CAPS_1_1_4;
    pingReplies = [STORE_1_1_1_CAPS];
    deliver(ready(CAPS_1_1_4));
    deliver(foreignEnd);
    expect(await fetchViaExtensionBridge(url)).toEqual(updateExtension);
    expect(bridgeFetches(post)).toHaveLength(0);
  });

  it('keeps the page capabilities as the first refusal, without asking the bridge', async () => {
    document.documentElement.dataset.tcBridgeCaps = STORE_1_1_1_CAPS;
    pingReplies = [CAPS_1_1_4];
    expect(await fetchViaExtensionBridge(url)).toEqual(updateExtension);
    expect(postedTypes(post)).toEqual([]);
  });

  // A single current extension updated without a page reload also stops answering the ping, so the
  // reload advice cannot depend on having two extensions.
  it('tells the analyst what to do in every case', () => {
    expect(enIntegrations['fetch.updateExtension']).toBe('Web fetch needs the ThreatCaddy extension 1.1.3 or later, approved for this app. '
      + 'Keep only the newest ThreatCaddy extension installed, then reload the page.');
  });
});
