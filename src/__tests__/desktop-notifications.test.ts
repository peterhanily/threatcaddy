import { afterEach, describe, expect, it, vi } from 'vitest';
import { DESKTOP_NOTIFICATION_FALLBACK, notifyDesktop } from '../lib/desktop-notifications';

afterEach(() => { vi.restoreAllMocks(); vi.useRealTimers(); delete document.documentElement.dataset.tcBridgeCaps; });
const payload = { title: 'Test alert', message: 'Harmless fixture', severity: 'warning' };
describe('desktop notification acknowledgement', () => {
  it('immediately falls back in-app when no acknowledged bridge is present', async () => {
    const fallback = vi.fn();
    window.addEventListener(DESKTOP_NOTIFICATION_FALLBACK, fallback, { once: true });
    expect(await notifyDesktop(payload)).toBe(false);
    expect(fallback).toHaveBeenCalledOnce();
  });
  it.each([true, false])('returns browser acceptance=%s and matches the request', async accepted => {
    document.documentElement.dataset.tcBridgeCaps = 'notification_ack';
    const post = vi.spyOn(window, 'postMessage').mockImplementation(() => {});
    const result = notifyDesktop(payload);
    const request = post.mock.calls[0][0];
    window.dispatchEvent(new MessageEvent('message', { source: window, origin: window.location.origin,
      data: { type: 'TC_NOTIFICATION_RESULT', requestId: request.requestId, success: accepted, accepted } }));
    expect(await result).toBe(accepted);
  });
  it('times out without claiming success and does not notify after cancellation', async () => {
    vi.useFakeTimers();
    document.documentElement.dataset.tcBridgeCaps = 'notification_ack';
    const post = vi.spyOn(window, 'postMessage').mockImplementation(() => {});
    const result = notifyDesktop(payload);
    await vi.advanceTimersByTimeAsync(3000);
    expect(await result).toBe(false);
    const cancelled = new AbortController(); cancelled.abort();
    post.mockClear();
    expect(await notifyDesktop(payload, cancelled.signal)).toBe(false);
    expect(post).not.toHaveBeenCalled();
  });
});
