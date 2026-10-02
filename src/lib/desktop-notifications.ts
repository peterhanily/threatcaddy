import { nanoid } from 'nanoid';
import { postMessageOrigin } from './utils';

export const DESKTOP_NOTIFICATION_FALLBACK = 'tc-desktop-notification-fallback';
export interface DesktopNotification { title: string; message: string; severity?: string }

/** Returns browser API acceptance, not a promise that the OS visibly displayed it. */
export async function notifyDesktop(payload: DesktopNotification, signal?: AbortSignal): Promise<boolean> {
  if (signal?.aborted) return false;
  const fallback = () => {
    if (!signal?.aborted) window.dispatchEvent(new CustomEvent(DESKTOP_NOTIFICATION_FALLBACK, { detail: payload }));
    return false;
  };
  if (!document.documentElement.dataset.tcBridgeCaps?.split(',').includes('notification_ack')) return fallback();
  return new Promise(resolve => {
    const requestId = nanoid();
    let settled = false;
    const finish = (accepted: boolean) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      window.removeEventListener('message', onMessage);
      signal?.removeEventListener('abort', onAbort);
      resolve(accepted || fallback());
    };
    const onAbort = () => finish(false);
    const onMessage = (event: MessageEvent) => {
      if (event.source !== window || (window.location.protocol !== 'file:' && event.origin !== window.location.origin)) return;
      if (event.data?.type !== 'TC_NOTIFICATION_RESULT' || event.data.requestId !== requestId) return;
      finish(event.data.success === true && event.data.accepted === true);
    };
    const timer = setTimeout(() => finish(false), 3000);
    window.addEventListener('message', onMessage);
    signal?.addEventListener('abort', onAbort, { once: true });
    try { window.postMessage({ type: 'TC_SEND_NOTIFICATION', requestId, payload }, postMessageOrigin()); }
    catch { finish(false); }
  });
}
