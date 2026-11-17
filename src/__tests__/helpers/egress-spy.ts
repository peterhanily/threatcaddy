/**
 * Records every way an AI tool call can leave the page: extension postMessage
 * requests (TC_FETCH_URL, TC_PROXY_FETCH, ...) and direct fetch(). TC_FETCH_URL
 * is answered with a fixed page so fetch_url completes without a network.
 */
import { vi } from 'vitest';

/** The capabilities the extension bridge advertises at HEAD (extension/src/bridge.js). */
export const HEAD_BRIDGE_CAPS = ['llm_streaming', 'fetch_url', 'clip_import', 'clip_import_ack_v2', 'proxy_fetch', 'proxy_fetch_abort', 'notification_ack'];

export interface EgressSpy {
  /** Every message the page posted, in order. */
  posts: Array<Record<string, unknown>>;
  /** URLs passed to fetch(). */
  fetches: string[];
  /** URLs the page asked the extension to open. */
  fetchUrlPosts(): string[];
  restore(): void;
}

export function installEgressSpy(caps: string[] = HEAD_BRIDGE_CAPS): EgressSpy {
  const posts: Array<Record<string, unknown>> = [];
  const fetches: string[] = [];
  const postSpy = vi.spyOn(window, 'postMessage').mockImplementation((message: unknown) => {
    const data = (message && typeof message === 'object' ? message : { value: message }) as Record<string, unknown>;
    posts.push(data);
    if (data.type === 'TC_FETCH_URL') {
      setTimeout(() => window.dispatchEvent(new MessageEvent('message', {
        source: window,
        data: { type: 'TC_FETCH_URL_RESULT', requestId: data.requestId, success: true, title: 'Fixture page', content: 'Fixture page content' },
      })), 0);
    }
  });
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
    fetches.push(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url);
    return new Response('{}', { status: 200, headers: { 'Content-Type': 'application/json' } });
  }));
  const previousCaps = document.documentElement.dataset.tcBridgeCaps;
  document.documentElement.dataset.tcBridgeCaps = caps.join(',');
  return {
    posts,
    fetches,
    fetchUrlPosts: () => posts.filter(post => post.type === 'TC_FETCH_URL').map(post => String(post.url)),
    restore() {
      postSpy.mockRestore();
      vi.unstubAllGlobals();
      if (previousCaps === undefined) delete document.documentElement.dataset.tcBridgeCaps;
      else document.documentElement.dataset.tcBridgeCaps = previousCaps;
    },
  };
}
