import { afterEach, describe, expect, it, vi } from 'vitest';
import { awaitLocalFile, readLocalFile } from '../lib/local-file-read';

function holdReader() {
  const readers: FileReader[] = [];
  vi.spyOn(FileReader.prototype, 'readAsText').mockImplementation(function (this: FileReader) {
    Object.defineProperty(this, 'readyState', { value: FileReader.LOADING, configurable: true }); readers.push(this);
  });
  const abort = vi.spyOn(FileReader.prototype, 'abort').mockImplementation(function (this: FileReader) {
    Object.defineProperty(this, 'readyState', { value: FileReader.DONE, configurable: true });
  });
  return { readers, abort };
}
afterEach(() => { vi.restoreAllMocks(); vi.useRealTimers(); });

describe('bounded cancellable local-file reads', () => {
  it('reads actual Unicode text and preserves actual file bytes as a data URL', async () => {
    const signal = new AbortController().signal;
    expect(await readLocalFile(new File(['Fictional café 文'], 'note.txt'), 'text', signal)).toBe('Fictional café 文');
    expect(await readLocalFile(new File([new Uint8Array([0, 1, 254, 255])], 'fixture.png', { type: 'image/png' }), 'dataURL', signal)).toBe('data:image/png;base64,AAH+/w==');
  });

  it('does not begin reading an already-cancelled operation', async () => {
    const read = vi.spyOn(FileReader.prototype, 'readAsText');
    const controller = new AbortController(); controller.abort();
    await expect(readLocalFile(new File(['body'], 'note.txt'), 'text', controller.signal)).rejects.toMatchObject({ name: 'AbortError' });
    expect(read).not.toHaveBeenCalled();
  });

  it('aborts the reader and removes all callbacks/listeners on cancellation', async () => {
    const { readers, abort } = holdReader();
    const controller = new AbortController(); const remove = vi.spyOn(controller.signal, 'removeEventListener');
    const pending = readLocalFile(new File(['body'], 'note.txt'), 'text', controller.signal);
    const rejection = expect(pending).rejects.toMatchObject({ name: 'AbortError' });
    const reader = readers[0]; const late = reader.onload;
    controller.abort(); await rejection;
    expect(abort).toHaveBeenCalledOnce();
    expect([reader.onload, reader.onerror, reader.onabort]).toEqual([null, null, null]);
    expect(remove).toHaveBeenCalledWith('abort', expect.any(Function));
    Object.defineProperty(reader, 'result', { value: 'Late body', configurable: true });
    late?.call(reader, new ProgressEvent('load') as ProgressEvent<FileReader>);
    expect(abort).toHaveBeenCalledOnce();
  });

  it('times out a stalled reader, aborts it, and leaves no timer or callbacks', async () => {
    vi.useFakeTimers(); const { readers, abort } = holdReader();
    const pending = readLocalFile(new File(['body'], 'note.txt'), 'text', new AbortController().signal);
    const rejection = expect(pending).rejects.toThrow('timed out');
    await vi.advanceTimersByTimeAsync(30_000); await rejection;
    expect(abort).toHaveBeenCalledOnce();
    expect([readers[0].onload, readers[0].onerror, readers[0].onabort]).toEqual([null, null, null]);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('cleans up when starting the native reader throws', async () => {
    vi.useFakeTimers();
    const controller = new AbortController(); const remove = vi.spyOn(controller.signal, 'removeEventListener');
    vi.spyOn(FileReader.prototype, 'readAsText').mockImplementation(() => { throw new Error('Synthetic unreadable file'); });
    await expect(readLocalFile(new File(['body'], 'note.txt'), 'text', controller.signal)).rejects.toThrow('Synthetic unreadable file');
    expect(vi.getTimerCount()).toBe(0);
    expect(remove).toHaveBeenCalledWith('abort', expect.any(Function));
  });

  it('bounds promise-based reads and handles late underlying resolution after abort', async () => {
    vi.useFakeTimers(); const controller = new AbortController();
    let finish: (text: string) => void = () => {};
    const operation = new Promise<string>(resolve => { finish = resolve; });
    const pending = awaitLocalFile(operation, controller.signal, 10);
    const rejection = expect(pending).rejects.toMatchObject({ name: 'AbortError' });
    controller.abort(); await rejection; finish('Late body'); await Promise.resolve();
    expect(vi.getTimerCount()).toBe(0);
    const timed = awaitLocalFile(new Promise<string>(() => {}), new AbortController().signal, 10);
    const timeout = expect(timed).rejects.toThrow('timed out');
    await vi.advanceTimersByTimeAsync(10); await timeout;
    expect(vi.getTimerCount()).toBe(0);
  });
});
