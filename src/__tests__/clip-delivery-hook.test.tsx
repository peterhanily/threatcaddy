import { act, renderHook } from '@testing-library/react';
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import type { ClipImportMessage } from '../lib/clipBuffer';
import type { ClipImportResult } from '../lib/clip-protocol';

const mocks = vi.hoisted(() => ({ subscribe: vi.fn(), importClips: vi.fn(), adapt: vi.fn() }));
vi.mock('../lib/clipBuffer', () => ({ clipBuffer: { subscribe: mocks.subscribe } }));
vi.mock('../lib/clip-import', () => ({ importClipBatch: mocks.importClips }));
vi.mock('../lib/clip-protocol', () => ({ adaptLegacyClip: mocks.adapt }));
import { useClipDelivery } from '../hooks/useClipDelivery';

let consume: (message: ClipImportMessage) => Promise<void>;
let cleanup: ReturnType<typeof vi.fn>;
const message = (): ClipImportMessage => ({ type: 'THREATCADDY_IMPORT_CLIPS', protocol: 2,
  sourceId: 'fixture-source', attemptId: 'fixture-attempt', expectedWorkspaceId: 'default', clips: [{ id: 'ordinary-fixture' }] });
const committed: ClipImportResult = { id: 'ordinary-fixture', revision: 1, fingerprint: 'a'.repeat(64), status: 'imported', entityType: 'note', entityId: 'saved-note', folderId: 'saved-folder' };
const callbacks = () => ({ onBusy: vi.fn(), onFailed: vi.fn(), onRefreshFailed: vi.fn(),
  onCommitted: vi.fn<(results: ClipImportResult[], signal: AbortSignal) => Promise<void>>().mockResolvedValue(undefined) });

beforeEach(() => {
  vi.clearAllMocks();
  cleanup = vi.fn();
  mocks.subscribe.mockImplementation(handler => { consume = handler; return cleanup; });
  mocks.importClips.mockResolvedValue([committed]);
  mocks.adapt.mockImplementation(async value => value);
  vi.spyOn(window, 'postMessage').mockImplementation(() => {});
});
afterEach(() => { vi.restoreAllMocks(); });

describe('app clip delivery lifecycle', () => {
  it('acknowledges only the committed service result, before refreshing the UI', async () => {
    let resolve: (results: ClipImportResult[]) => void = () => {};
    mocks.importClips.mockReturnValue(new Promise<ClipImportResult[]>(done => { resolve = done; }));
    const options = callbacks();
    options.onCommitted.mockImplementation(async () => { expect(window.postMessage).toHaveBeenCalledTimes(1); });
    renderHook(() => useClipDelivery(options));
    let pending: Promise<void>;
    act(() => { pending = consume(message()); });
    expect(window.postMessage).not.toHaveBeenCalled();
    expect(options.onBusy).toHaveBeenCalledWith(true);
    await act(async () => { resolve([committed]); await pending; });
    expect(window.postMessage).toHaveBeenCalledWith(expect.objectContaining({ type: 'THREATCADDY_CLIP_IMPORT_RESULT', results: [committed], workspaceId: 'default' }), window.location.origin);
    expect(options.onBusy).toHaveBeenLastCalledWith(false);
  });

  it('preserves partial results and never relabels committed data after a UI refresh failure', async () => {
    const failed: ClipImportResult = { ...committed, id: 'failed-fixture', status: 'failed', error: 'Synthetic failure' };
    mocks.importClips.mockResolvedValue([committed, failed]);
    const options = callbacks();
    options.onCommitted.mockRejectedValue(new Error('Synthetic refresh failure'));
    renderHook(() => useClipDelivery(options));
    await act(() => consume(message()));
    expect(window.postMessage).toHaveBeenCalledTimes(1);
    expect(window.postMessage).toHaveBeenCalledWith(expect.objectContaining({ results: [committed, failed] }), window.location.origin);
    expect(options.onFailed).toHaveBeenCalledWith(1);
    expect(options.onCommitted).toHaveBeenCalledWith([committed], expect.any(AbortSignal));
    expect(options.onRefreshFailed).toHaveBeenCalledOnce();
  });

  it('uses current settings without resubscribing or aborting pending work on rerender', async () => {
    const first = { ...callbacks(), defaultConfidence: 'low' };
    const second = { ...callbacks(), defaultConfidence: 'high' };
    const { rerender } = renderHook(options => useClipDelivery(options), { initialProps: first });
    rerender(second);
    await act(() => consume(message()));
    expect(mocks.subscribe).toHaveBeenCalledTimes(1);
    expect(cleanup).not.toHaveBeenCalled();
    expect(mocks.importClips).toHaveBeenCalledWith(message().clips, expect.objectContaining({ defaultConfidence: 'high', workspaceId: 'default', sourceId: 'fixture-source' }));
    expect(first.onBusy).not.toHaveBeenCalled();
    expect(second.onBusy).toHaveBeenCalledWith(true);
  });

  it('aborts service work on unmount without hiding an already committed receipt', async () => {
    let resolve: (results: ClipImportResult[]) => void = () => {};
    mocks.importClips.mockReturnValue(new Promise<ClipImportResult[]>(done => { resolve = done; }));
    const options = callbacks();
    const { unmount } = renderHook(() => useClipDelivery(options));
    const pending = consume(message());
    const signal = mocks.importClips.mock.calls[0][1].signal as AbortSignal;
    unmount();
    expect(signal.aborted).toBe(true);
    expect(cleanup).toHaveBeenCalledOnce();
    await act(async () => { resolve([committed]); await pending; });
    expect(window.postMessage).toHaveBeenCalledWith(expect.objectContaining({ results: [committed] }), window.location.origin);
    expect(options.onCommitted).not.toHaveBeenCalled();
  });

  it('adapts legacy messages without giving legacy hop acknowledgements commit authority', async () => {
    const options = callbacks();
    renderHook(() => useClipDelivery(options));
    await act(() => consume({ type: 'BROWSERNOTES_IMPORT_CLIPS', clips: [{ id: 'ordinary-fixture' }] }));
    expect(mocks.adapt).toHaveBeenCalledOnce();
    expect(mocks.importClips).toHaveBeenCalledWith([{ id: 'ordinary-fixture' }], expect.objectContaining({ sourceId: 'legacy-extension' }));
    expect(options.onCommitted).toHaveBeenCalledWith([committed], expect.any(AbortSignal));
    expect(window.postMessage).not.toHaveBeenCalled();
  });

  it('does not claim success when the service throws before committing', async () => {
    mocks.importClips.mockRejectedValue(new Error('Rejected before writing'));
    const options = callbacks();
    renderHook(() => useClipDelivery(options));
    await expect(consume(message())).rejects.toThrow('Rejected before writing');
    expect(window.postMessage).not.toHaveBeenCalled();
    expect(options.onBusy).toHaveBeenLastCalledWith(false);
    expect(options.onFailed).toHaveBeenCalledWith(1);
    expect(options.onCommitted).not.toHaveBeenCalled();
  });

  it('cancels a deferred refresh continuation before workspace switching', async () => {
    let resolve: () => void = () => {};
    const refresh = new Promise<void>(done => { resolve = done; });
    const navigate = vi.fn();
    const options = callbacks();
    options.onCommitted.mockImplementation(async (_results, signal) => {
      await refresh;
      if (!signal.aborted) navigate();
    });
    renderHook(() => useClipDelivery(options));
    const pending = consume(message());
    await vi.waitFor(() => expect(options.onCommitted).toHaveBeenCalledOnce());
    act(() => { window.dispatchEvent(new Event('workspace-will-switch')); });
    await act(async () => { resolve(); await pending; });
    expect(cleanup).toHaveBeenCalledOnce();
    expect(navigate).not.toHaveBeenCalled();
    expect(window.postMessage).toHaveBeenCalledTimes(1);
  });
});
