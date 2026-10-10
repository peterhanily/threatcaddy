import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const deliver = (data: unknown, source: MessageEventSource | null = window, origin = window.location.origin) => {
  window.dispatchEvent(new MessageEvent('message', { data, source, origin }));
};
const legacy = (count = 1) => ({ type: 'THREATCADDY_IMPORT_CLIPS', clips: Array.from({ length: count }, (_, index) => ({ id: String(index), content: 'Ordinary fixture' })) });
const modern = () => ({ ...legacy(), protocol: 2, sourceId: 'extension-fixture', attemptId: 'attempt-fixture', expectedWorkspaceId: 'default',
  clips: [{ id: 'clip-fixture', revision: 1, fingerprint: 'a'.repeat(64), content: 'Ordinary fixture' }] });
let channel: typeof import('../lib/clipBuffer')['clipBuffer'];
let listeners: EventListenerOrEventListenerObject[];
let unsubscribe: (() => void) | undefined;

beforeEach(async () => {
  vi.resetModules();
  listeners = [];
  const add = window.addEventListener.bind(window);
  vi.spyOn(window, 'addEventListener').mockImplementation((type, handler, options) => {
    if (type === 'message') listeners.push(handler);
    add(type, handler, options);
  });
  vi.spyOn(window, 'postMessage').mockImplementation(() => {});
  channel = (await import('../lib/clipBuffer')).clipBuffer;
  channel.startListening();
});
afterEach(() => {
  unsubscribe?.(); unsubscribe = undefined;
  for (const listener of listeners) window.removeEventListener('message', listener);
  vi.restoreAllMocks();
});

describe('bounded clip delivery channel', () => {
  it('reports the actual workspace before unlock without claiming readiness', () => {
    deliver({ type: 'TC_CLIP_IMPORT_PROBE', protocol: 2, requestId: 'probe' });
    expect(window.postMessage).toHaveBeenLastCalledWith(expect.objectContaining({ type: 'TC_CLIP_IMPORT_READY', workspaceId: 'default', ready: false }), window.location.origin);
  });

  it('does not buffer v2 while locked and accepts explicit retry after unlock', async () => {
    deliver(modern());
    expect(window.postMessage).toHaveBeenCalledWith(expect.objectContaining({ type: 'THREATCADDY_CLIP_IMPORT_RESULT', results: [expect.objectContaining({ status: 'failed' })] }), window.location.origin);
    const consume = vi.fn(async () => {});
    unsubscribe = channel.subscribe(consume);
    await Promise.resolve();
    expect(consume).not.toHaveBeenCalled();
    deliver(modern());
    await vi.waitFor(() => expect(consume).toHaveBeenCalledTimes(1));
  });

  it('replays legacy messages only once, including after a later re-lock', async () => {
    deliver(legacy());
    const consume = vi.fn(async () => {});
    unsubscribe = channel.subscribe(consume);
    await vi.waitFor(() => expect(consume).toHaveBeenCalledTimes(1));
    unsubscribe();
    deliver(legacy());
    const reopened = vi.fn(async () => {});
    unsubscribe = channel.subscribe(reopened);
    await vi.waitFor(() => expect(reopened).toHaveBeenCalledTimes(1));
    expect(consume).toHaveBeenCalledTimes(1);
    expect(window.postMessage).not.toHaveBeenCalled();
  });

  it('rejects another v2 batch while a commit is pending and recovers on error', async () => {
    let reject: (error: Error) => void = () => {};
    const pending = new Promise<void>((_, rejectPromise) => { reject = rejectPromise; });
    const consume = vi.fn(() => pending);
    unsubscribe = channel.subscribe(consume);
    deliver(modern()); deliver(modern());
    await vi.waitFor(() => expect(consume).toHaveBeenCalledTimes(1));
    expect(window.postMessage).toHaveBeenCalledWith(expect.objectContaining({ results: [expect.objectContaining({ status: 'failed', error: expect.stringContaining('running') })] }), window.location.origin);
    reject(new Error('Synthetic quota failure'));
    await vi.waitFor(() => expect(window.postMessage).toHaveBeenCalledWith(expect.objectContaining({ results: [expect.objectContaining({ status: 'failed', error: expect.stringContaining('retained') })] }), window.location.origin));
    unsubscribe();
    unsubscribe = channel.subscribe(async () => {});
    deliver({ type: 'TC_CLIP_IMPORT_PROBE', protocol: 2, requestId: 'probe' });
    expect(window.postMessage).toHaveBeenLastCalledWith(expect.objectContaining({ ready: true }), window.location.origin);
  });

  it('rejects foreign origins/windows, unsupported versions and oversized batches', async () => {
    const consume = vi.fn(async () => {});
    unsubscribe = channel.subscribe(consume);
    deliver(modern(), null);
    deliver(modern(), window, 'https://unrelated.invalid');
    deliver({ ...modern(), protocol: 3 });
    deliver({ ...modern(), clips: Array.from({ length: 21 }, () => modern().clips[0]) });
    await Promise.resolve();
    expect(consume).not.toHaveBeenCalled();
    expect(window.postMessage).toHaveBeenCalledTimes(1);
  });

  it('bounds locked legacy capture without discarding previously queued messages', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    deliver(legacy(100));
    deliver(legacy());
    const consume = vi.fn(async () => {});
    unsubscribe = channel.subscribe(consume);
    await vi.waitFor(() => expect(consume).toHaveBeenCalledTimes(1));
    expect(consume).toHaveBeenCalledWith(legacy(100));
    expect(console.warn).toHaveBeenCalledTimes(1);
  });

  it('does not let stale cleanup remove a newer subscriber', () => {
    const oldCleanup = channel.subscribe(async () => {});
    unsubscribe = channel.subscribe(async () => {});
    oldCleanup();
    deliver({ type: 'TC_CLIP_IMPORT_PROBE', protocol: 2, requestId: 'probe' });
    expect(window.postMessage).toHaveBeenLastCalledWith(expect.objectContaining({ ready: true }), window.location.origin);
  });

  it('retains legacy work when strict-mode mounting changes the owner before dispatch', async () => {
    deliver(legacy());
    const initial = vi.fn(async () => {});
    const cleanup = channel.subscribe(initial);
    cleanup();
    const current = vi.fn(async () => {});
    unsubscribe = channel.subscribe(current);
    await vi.waitFor(() => expect(current).toHaveBeenCalledWith(legacy()));
    expect(initial).not.toHaveBeenCalled();
    expect(window.postMessage).not.toHaveBeenCalled();
  });
});
