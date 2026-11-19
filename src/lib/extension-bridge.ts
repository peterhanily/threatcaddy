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

/** The capabilities a bridge published on the page. */
const publishedCaps = () => document.documentElement.dataset.tcBridgeCaps?.split(',').filter(Boolean) ?? [];

/** An extension older than 1.1.3 published its capabilities here: store 1.1.1 does so on every page. */
export const outdatedBridgePublished = () => { const caps = publishedCaps(); return caps.length > 0 && !isPairedBridgeCaps(caps); };

/** What a TC_EXTENSION_READY announcement means for the UI. With two ThreatCaddy extensions installed, the one
 *  that does not own the page announces itself too, so the capabilities published on the page count as well.
 *  Every request checks again when it is made. */
export const announcedBridge = (caps: unknown): 'paired' | 'outdated' =>
  isPairedBridgeCaps(caps) || isPairedBridgeCaps(publishedCaps()) ? 'paired' : 'outdated';

/** Posted after a ping's dispatch; no bridge handles it. */
const BRIDGE_PING_END = 'TC_EXTENSION_PING_END';
/** A safety net only: the check ends a few message hops after its ping is delivered, however busy the page. */
const BRIDGE_PING_TIMEOUT_MS = 5000;

/** 'silent': paired capabilities are on the page but no bridge answered, as in a tab left open while its
 *  extension was updated or reloaded. 'unpaired': anything else that is not a paired bridge. */
export type BridgeCheck = 'paired' | 'unpaired' | 'silent';

/** Asked at call time. The page attribute is read first (the bridge deletes it while it refreshes app
 *  approval), but with two ThreatCaddy extensions installed it can come from one that does not relay the
 *  request. Only a bridge that owns the page's listeners answers a ping, so every reply must be paired. */
export async function checkPairedBridge(): Promise<BridgeCheck> {
  if (!isPairedBridgeCaps(publishedCaps())) return 'unpaired';
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
  if (!replies.every(isPairedBridgeCaps)) return 'unpaired';
  return answered && replies.length > 0 ? 'paired' : 'silent';
}

export const hasPairedBridge = async () => await checkPairedBridge() === 'paired';

/** Shown when an extension feature finds no paired bridge. It names the version and where to get it, or asks
 *  for a page reload when the bridge on the page stopped answering. */
export async function extensionRefusal(check: Exclude<BridgeCheck, 'paired'> = 'unpaired'): Promise<string> {
  await i18n.loadNamespaces('common');
  return i18n.t(check === 'silent' ? 'extension.reloadRequired' : 'extension.updateRequired', { ns: 'common' });
}
