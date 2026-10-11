import { act, renderHook } from '@testing-library/react';
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { IMAGE_ATTACHMENT_LIMITS, useImageAttachments } from '../hooks/useImageAttachments';
import { COMPOSER_LIMITS, discardAllComposerDrafts, reserveComposerImages, releaseComposerImages, getComposerDraft } from '../lib/chat-composer-drafts';
import { hasPendingChanges } from '../lib/pending-changes';

const file = (name = 'fixture.png', bytes = 4, type = 'image/png') => new File([new Uint8Array(bytes).fill(90)], name, { type });
function holdReaders() {
  const pending: { reader: FileReader; load: FileReader['onload'] }[] = [];
  vi.spyOn(FileReader.prototype, 'readAsDataURL').mockImplementation(function (this: FileReader) {
    Object.defineProperty(this, 'readyState', { value: FileReader.LOADING, configurable: true });
    pending.push({ reader: this, load: this.onload });
  });
  const abort = vi.spyOn(FileReader.prototype, 'abort').mockImplementation(function (this: FileReader) {
    Object.defineProperty(this, 'readyState', { value: FileReader.DONE, configurable: true });
  });
  const complete = (index: number) => {
    const item = pending[index];
    Object.defineProperty(item.reader, 'result', { value: 'data:image/png;base64,WlpaWg==', configurable: true });
    Object.defineProperty(item.reader, 'readyState', { value: FileReader.DONE, configurable: true });
    item.load?.call(item.reader, new ProgressEvent('load') as ProgressEvent<FileReader>);
  };
  return { pending, complete, abort };
}
beforeEach(() => discardAllComposerDrafts());
afterEach(() => { discardAllComposerDrafts(); vi.restoreAllMocks(); });

describe('atomic bounded image drafts', () => {
  it('accepts a real 1 MiB File without argument spreading or byte loss', async () => {
    const error = vi.fn(); const { result } = renderHook(() => useImageAttachments('thread-a', error));
    await act(async () => { await result.current.attach([file('large.png', 1024 * 1024)]); });
    expect(error).not.toHaveBeenCalled(); expect(result.current.images).toHaveLength(1);
    const decoded = atob(result.current.images[0].data);
    expect(decoded.length).toBe(1024 * 1024);
    expect(decoded[0]).toBe('Z'); expect(decoded[decoded.length - 1]).toBe('Z');
    expect(result.current.reading).toBe(false);
  });

  it('accepts four files and rejects a fifth without reading or changing earlier attachments', async () => {
    const error = vi.fn(); const read = vi.spyOn(FileReader.prototype, 'readAsDataURL');
    const { result } = renderHook(() => useImageAttachments('thread-a', error));
    await act(async () => { await result.current.attach(['a', 'b', 'c', 'd'].map(name => file(`${name}.png`))); });
    const accepted = result.current.images;
    await act(async () => { await result.current.attach([file('fifth.png')]); });
    expect(error).toHaveBeenLastCalledWith('count'); expect(read).toHaveBeenCalledTimes(4);
    expect(result.current.images).toEqual(accepted);
  });

  it('accepts exact 5 MiB files up to 10 MiB and rejects another byte before reading', async () => {
    const error = vi.fn(); const read = vi.spyOn(FileReader.prototype, 'readAsDataURL');
    const { result } = renderHook(() => useImageAttachments('thread-a', error));
    await act(async () => { await result.current.attach([file('a.png', IMAGE_ATTACHMENT_LIMITS.fileBytes), file('b.png', IMAGE_ATTACHMENT_LIMITS.fileBytes)]); });
    expect(result.current.images).toHaveLength(2); expect(error).not.toHaveBeenCalled();
    await act(async () => { await result.current.attach([file('extra.png', 1)]); });
    expect(error).toHaveBeenLastCalledWith('total'); expect(read).toHaveBeenCalledTimes(2);
    expect(result.current.images).toHaveLength(2);
  });

  it.each([
    [IMAGE_ATTACHMENT_LIMITS.fileBytes + 1, 'image/png', 'size'],
    [4, 'text/plain', 'type'], [0, 'image/png', 'read'],
  ])('rejects invalid file bounds/type without committing any image (%s, %s)', async (bytes, type, code) => {
    const error = vi.fn(); const read = vi.spyOn(FileReader.prototype, 'readAsDataURL');
    const { result } = renderHook(() => useImageAttachments('thread-a', error));
    await act(async () => { await result.current.attach([file('invalid', bytes, type)]); });
    expect(error).toHaveBeenLastCalledWith(code); expect(read).not.toHaveBeenCalled();
    expect(result.current.images).toEqual([]); expect(result.current.reading).toBe(false);
  });

  it('retains earlier images and commits none of a batch whose later read fails', async () => {
    const error = vi.fn(); const { result } = renderHook(() => useImageAttachments('thread-a', error));
    await act(async () => { await result.current.attach([file('earlier.png')]); });
    const accepted = result.current.images;
    const original = FileReader.prototype.readAsDataURL;
    vi.spyOn(FileReader.prototype, 'readAsDataURL').mockImplementation(function (this: FileReader, blob) {
      if (blob instanceof File && blob.name === 'fails.png') throw new Error('Synthetic read failure');
      original.call(this, blob);
    });
    await act(async () => { await result.current.attach([file('first.png'), file('fails.png')]); });
    expect(error).toHaveBeenLastCalledWith('read'); expect(result.current.images).toEqual(accepted);
  });

  it.each(['workspace', 'thread', 'unmount', 'clear'])('cancels pending image reads on %s and rejects late results', async reason => {
    const held = holdReaders(); const error = vi.fn();
    const { result, rerender, unmount } = renderHook(({ scope }) => useImageAttachments(scope, error), { initialProps: { scope: 'thread-a' } });
    let work: Promise<void> = Promise.resolve();
    act(() => { work = result.current.attach([file()]); });
    expect(result.current.reading).toBe(true);
    act(() => {
      if (reason === 'workspace') window.dispatchEvent(new Event('workspace-will-switch'));
      if (reason === 'thread') rerender({ scope: 'thread-b' });
      if (reason === 'unmount') unmount();
      if (reason === 'clear') result.current.clear();
    });
    await act(async () => {
      await work;
      held.complete(0);
    });
    expect(held.abort).toHaveBeenCalledOnce(); expect(error).not.toHaveBeenCalled();
    expect(result.current.images).toEqual([]);
    if (reason !== 'unmount') expect(result.current.reading).toBe(false);
  });

  it('does not carry accepted images into another thread', async () => {
    const { result, rerender } = renderHook(({ scope }) => useImageAttachments(scope, vi.fn()), { initialProps: { scope: 'thread-a' } });
    await act(async () => { await result.current.attach([file('thread-a.png')]); });
    expect(result.current.images).toHaveLength(1);
    rerender({ scope: 'thread-b' });
    expect(result.current.images).toEqual([]);
    rerender({ scope: 'thread-a' });
    expect(result.current.images.map(image => image.name)).toEqual(['thread-a.png']);
  });

  it('rejects a second concurrent batch and preserves the first', async () => {
    const held = holdReaders(); const error = vi.fn();
    const { result } = renderHook(() => useImageAttachments('thread-a', error));
    let first: Promise<void> = Promise.resolve();
    act(() => { first = result.current.attach([file('first.png')]); });
    await act(async () => { await result.current.attach([file('second.png')]); });
    expect(error).toHaveBeenLastCalledWith('busy'); expect(held.pending).toHaveLength(1);
    await act(async () => { held.complete(0); await first; });
    expect(result.current.images.map(image => image.name)).toEqual(['first.png']);
  });

  it('preserves accepted drafts and their unload warning after unmount and remount', async () => {
    const first = renderHook(() => useImageAttachments('thread-a', vi.fn()));
    await act(async () => { await first.result.current.attach([file()]); });
    first.unmount(); expect(hasPendingChanges()).toBe(true);
    const second = renderHook(() => useImageAttachments('thread-a', vi.fn()), { reactStrictMode: true });
    expect(second.result.current.images).toHaveLength(1);
    act(() => second.result.current.clear());
    expect(hasPendingChanges()).toBe(false);
  });

  it('reserves global capacity before reads and releases it after cancellation', async () => {
    const owners = [Symbol('first'), Symbol('second')];
    expect(reserveComposerImages(owners[0], 'other-a', 2, COMPOSER_LIMITS.imageBytes, vi.fn())).toBeNull();
    expect(reserveComposerImages(owners[1], 'other-b', 2, COMPOSER_LIMITS.imageBytes, vi.fn())).toBeNull();
    const error = vi.fn(); const read = vi.spyOn(FileReader.prototype, 'readAsDataURL');
    const { result } = renderHook(() => useImageAttachments('thread-a', error));
    await act(async () => { await result.current.attach([file()]); });
    expect(error).toHaveBeenLastCalledWith('global'); expect(read).not.toHaveBeenCalled();
    releaseComposerImages(owners[0]); releaseComposerImages(owners[1]);
    await act(async () => { await result.current.attach([file()]); });
    expect(result.current.images).toHaveLength(1);
  });

  it('enforces the global sixteen-image count independently of byte size', () => {
    for (let i = 0; i < 4; i++) expect(reserveComposerImages(Symbol(), `thread-${i}`, 4, 16, vi.fn())).toBeNull();
    expect(reserveComposerImages(Symbol(), 'one-more-thread', 1, 4, vi.fn())).toBe('global');
  });

  it('keeps old acknowledgement setters scoped to their originating thread', async () => {
    const { result, rerender } = renderHook(({ scope }) => useImageAttachments(scope, vi.fn()), { initialProps: { scope: 'thread-a' } });
    await act(async () => { await result.current.attach([file('a.png')]); });
    const acknowledgeA = result.current.setImages;
    rerender({ scope: 'thread-b' });
    await act(async () => { await result.current.attach([file('b.png')]); });
    act(() => acknowledgeA([]));
    expect(result.current.images.map(image => image.name)).toEqual(['b.png']);
    expect(getComposerDraft('thread-a').images).toEqual([]);
  });
});
