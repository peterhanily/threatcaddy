import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import i18n from '../i18n';
import deIntegrations from '../../public/locales/de/integrations.json';
import enIntegrations from '../../public/locales/en/integrations.json';
import { executeFetchUrl } from '../lib/llm-tools-analysis';
// The `/fetch` chat command calls the bridge through this re-export.
import { fetchViaExtensionBridge } from '../lib/llm-tools';

// Store 1.1.1 (66ec58f4 bridge.js:6) and the 1.1.3 source (bridge.js:6).
const STORE_1_1_1_CAPS = 'llm_streaming,fetch_url,clip_import,proxy_fetch';
const HEAD_CAPS = 'llm_streaming,fetch_url,clip_import,clip_import_ack_v2,proxy_fetch,proxy_fetch_abort,notification_ack';

function bridgeFetches(post: ReturnType<typeof vi.spyOn>) {
  return post.mock.calls.filter(([message]: unknown[]) => (message as { type?: string })?.type === 'TC_FETCH_URL');
}

async function inGerman(run: (de: Record<string, string>) => Promise<void>) {
  for (const [namespace, values] of Object.entries(i18n.getDataByLanguage('en') ?? {})) i18n.addResourceBundle('de', namespace, values, true, false);
  i18n.addResourceBundle('de', 'integrations', deIntegrations, true, true);
  await i18n.changeLanguage('de');
  try { await run(deIntegrations as Record<string, string>); } finally { await i18n.changeLanguage('en'); }
}

let post: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  post = vi.spyOn(window, 'postMessage').mockImplementation((message: unknown) => {
    const request = message as { type?: string; requestId?: string };
    if (request?.type !== 'TC_FETCH_URL') return;
    queueMicrotask(() => window.dispatchEvent(new MessageEvent('message', {
      source: window,
      data: { type: 'TC_FETCH_URL_RESULT', requestId: request.requestId, success: true, title: 'Fixture', content: 'Fixture page' },
    })));
  });
});
afterEach(() => {
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
    post.mockImplementation(() => {});
    document.documentElement.dataset.tcBridgeCaps = HEAD_CAPS;
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    try {
      const pending = fetchViaExtensionBridge('https://nvd.nist.gov/vuln/detail/CVE-2024-3094');
      await vi.advanceTimersByTimeAsync(20000);
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
      post.mockImplementation(() => {});
      vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
      const pending = fetchViaExtensionBridge('https://nvd.nist.gov/vuln/detail/CVE-2024-3094');
      await vi.advanceTimersByTimeAsync(20000);
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
