/**
 * A paired extension bridge for tests. The app uses the extension only when the bridge that owns the page
 * advertises 1.1.3+ pairing (src/lib/extension-bridge.ts): it reads the page attribute, then pings and
 * requires every answer to be paired.
 */

/** Extension 1.1.4's capabilities (extension/src/bridge.js:6). */
export const PAIRED_BRIDGE_CAPS = ['llm_streaming', 'fetch_url', 'fetch_url_public_v1', 'clip_import', 'clip_import_ack_v2', 'proxy_fetch', 'proxy_fetch_abort', 'notification_ack'];

const deliver = (data: unknown) => setTimeout(() => window.dispatchEvent(new MessageEvent('message', { source: window, data })), 0);

/** Publishes the capabilities on the page, as an approved bridge does. The test's afterEach removes them. */
export function publishBridgeCaps(caps: string[] = PAIRED_BRIDGE_CAPS): void {
  document.documentElement.dataset.tcBridgeCaps = caps.join(',');
}

/** For a postMessage mock: delivers the page's bridge ping and its end marker, as a browser does, and
 *  answers the ping as the bridge that owns the page. Returns whether the message was part of the check. */
export function answerBridgeCheck(message: unknown, caps: string[] = PAIRED_BRIDGE_CAPS): boolean {
  const type = (message as { type?: string } | null)?.type;
  if (type !== 'TC_EXTENSION_PING' && type !== 'TC_EXTENSION_PING_END') return false;
  deliver(message);
  if (type === 'TC_EXTENSION_PING') deliver({ type: 'TC_EXTENSION_READY', protocolVersion: 1, capabilities: caps });
  return true;
}
