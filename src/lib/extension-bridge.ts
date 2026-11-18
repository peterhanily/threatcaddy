/** What the app requires of the ThreatCaddy browser extension before it uses any of its features. */
import i18n from '../i18n';
import { postMessageOrigin } from './utils';

/** Where the in-app install links go. The Chrome Web Store still serves 1.1.1, which the app does not use. */
export const EXTENSION_RELEASES_URL = 'https://github.com/peterhanily/threatcaddy/releases/latest';
export const EXTENSION_INSTALL_STEPS_URL = 'https://github.com/peterhanily/threatcaddy/blob/main/extension/README.md#install--chrome';

/** Extension 1.1.3 and later answer only an app approved in their popup, and advertise one of these
 *  capabilities. Store 1.1.1 advertises neither: it has no app pairing, follows redirects and has no
 *  private-address filter, so the app sends it no AI request, integration request or web fetch. */
export const isPairedBridgeCaps = (caps: unknown) => Array.isArray(caps) && (caps.includes('clip_import_ack_v2') || caps.includes('fetch_url_public_v1'));

/** Posted after a ping's dispatch; no bridge handles it. */
const BRIDGE_PING_END = 'TC_EXTENSION_PING_END';
/** A safety net only: the check ends a few message hops after its ping is delivered, however busy the page. */
const BRIDGE_PING_TIMEOUT_MS = 5000;

/** Asked at call time. The page attribute is read first (the bridge deletes it while it refreshes app
 *  approval), but with two ThreatCaddy extensions installed it can come from one that does not relay the
 *  request. Only a bridge that owns the page's listeners answers a ping, so every reply must be paired. */
export async function hasPairedBridge(): Promise<boolean> {
  if (!isPairedBridgeCaps(document.documentElement.dataset.tcBridgeCaps?.split(','))) return false;
  const requestId = Math.random().toString(36).slice(2);
  const replies: unknown[] = [];
  const answered = await new Promise<boolean>(resolve => {
    const timeout = setTimeout(() => finish(false), BRIDGE_PING_TIMEOUT_MS);
    function finish(complete: boolean) {
      clearTimeout(timeout);
      window.removeEventListener('message', handler);
      resolve(complete);
    }
    function handler(event: MessageEvent) {
      if (event.source !== window || !event.data) return;
      const { type, requestId: id } = event.data;
      if (type === 'TC_EXTENSION_READY') replies.push(event.data.capabilities);
      // A bridge answers from its listener while the ping is dispatched, and posted messages arrive in order,
      // so a message posted after that dispatch arrives after every answer, however long the page was busy.
      else if (type === 'TC_EXTENSION_PING' && id === requestId) setTimeout(() => window.postMessage({ type: BRIDGE_PING_END, requestId }, postMessageOrigin()));
      else if (type === BRIDGE_PING_END && id === requestId) finish(true);
    }
    window.addEventListener('message', handler);
    window.postMessage({ type: 'TC_EXTENSION_PING', requestId }, postMessageOrigin());
  });
  return answered && replies.length > 0 && replies.every(isPairedBridgeCaps);
}

/** Shown when an extension feature finds no paired bridge. It names the version and where to get it. */
export async function extensionUpdateRequired(): Promise<string> {
  await i18n.loadNamespaces('common');
  return i18n.t('extension.updateRequired', { ns: 'common' });
}
