import { afterEach, describe, expect, it, vi } from 'vitest';
import { FILE_OPEN_LIMITS, FileOpenQueue, fileOpenQueue, formatBytes, installFileHandler } from '../lib/file-handler';
import type { FileOpenDetail, FileOpenIssue } from '../lib/file-handler';

const file = (name = 'fictional.md', text = '# Fictional investigation') => new File([text], name, { lastModified: 1700000000000 });
const source = (value = file()) => ({ name: value.name, getFile: vi.fn(async () => value) });
const subscriptions: (() => void)[] = [];
const subscribe = (queue: FileOpenQueue, consume = vi.fn<(detail: FileOpenDetail) => Promise<void>>(async () => {}), report = vi.fn<(issues: FileOpenIssue[]) => void>()) => {
  subscriptions.push(queue.subscribe(consume, report));
  return { consume, report };
};
afterEach(() => {
  for (const unsubscribe of subscriptions.splice(0)) unsubscribe();
  delete window.launchQueue;
  vi.useRealTimers(); vi.restoreAllMocks();
});

describe('opened local files', () => {
  it.each([[0, '0 B'], [512, '512 B'], [1024, '1.0 KB'], [2560, '2.5 KB'], [3670016, '3.5 MB']])('formats %d bytes', (bytes, text) => {
    expect(formatBytes(bytes)).toBe(text);
  });
  it('does nothing without the optional LaunchQueue API, and installs once per queue', () => {
    installFileHandler();
    const setConsumer = vi.fn(); window.launchQueue = { setConsumer };
    installFileHandler(); installFileHandler();
    expect(setConsumer).toHaveBeenCalledOnce();
  });
  it('retains launch handles before App readiness, without reading their contents', async () => {
    const setConsumer = vi.fn(); window.launchQueue = { setConsumer }; installFileHandler();
    const handle = source();
    setConsumer.mock.calls[0][0]({ files: [handle] });
    await Promise.resolve();
    expect(handle.getFile).not.toHaveBeenCalled();
    const { consume } = subscribe(fileOpenQueue);
    await vi.waitFor(() => expect(consume).toHaveBeenCalledOnce());
    expect(consume).toHaveBeenCalledWith({ name: 'fictional.md', content: '# Fictional investigation', size: 25, lastModified: 1700000000000 }, expect.any(AbortSignal));
  });
  it('does not lose or duplicate a file during StrictMode ownership replacement', async () => {
    const queue = new FileOpenQueue(); const handle = source(); queue.enqueue(handle);
    const first = vi.fn(); const stop = queue.subscribe(first, vi.fn()); stop();
    const { consume } = subscribe(queue);
    stop(); // An old cleanup cannot remove the newer owner.
    await vi.waitFor(() => expect(consume).toHaveBeenCalledOnce());
    expect(first).not.toHaveBeenCalled(); expect(handle.getFile).toHaveBeenCalledOnce();
  });
  it('retains an in-flight handle through a lock without delivering to the stale owner', async () => {
    const queue = new FileOpenQueue(); let release!: (value: File) => void;
    const deferred = new Promise<File>(resolve => { release = resolve; });
    const handle = { getFile: vi.fn().mockReturnValueOnce(deferred).mockResolvedValue(file()) };
    const old = vi.fn(); const stop = queue.subscribe(old, vi.fn()); queue.enqueue(handle);
    await vi.waitFor(() => expect(handle.getFile).toHaveBeenCalledOnce());
    stop(); release(file()); await Promise.resolve();
    expect(old).not.toHaveBeenCalled();
    const { consume } = subscribe(queue);
    await vi.waitFor(() => expect(consume).toHaveBeenCalledOnce());
    expect(handle.getFile).toHaveBeenCalledTimes(2);
  });
  it('serializes imports and counts in-flight work against capacity without eviction', async () => {
    const queue = new FileOpenQueue(); let finish!: () => void;
    const committed = new Promise<void>(resolve => { finish = resolve; });
    const consume = vi.fn().mockReturnValueOnce(committed).mockResolvedValue(undefined);
    const { report } = subscribe(queue, consume);
    const handles = Array.from({ length: 20 }, (_, i) => source(file(`file-${i}.md`)));
    for (const handle of handles) expect(queue.enqueue(handle)).toBe(true);
    await vi.waitFor(() => expect(consume).toHaveBeenCalledOnce());
    const refused = source(); expect(queue.enqueue(refused)).toBe(false);
    expect(handles[1].getFile).not.toHaveBeenCalled(); expect(refused.getFile).not.toHaveBeenCalled();
    finish(); await vi.waitFor(() => expect(consume).toHaveBeenCalledTimes(20));
    expect(report).toHaveBeenCalledWith([{ kind: 'capacity', count: 1 }]);
  });
  it('aggregates locked overflow and rejects size/type before reading', async () => {
    const queue = new FileOpenQueue();
    queue.enqueue(source(new File([new Uint8Array(FILE_OPEN_LIMITS.bytes + 1)], 'large.md')));
    queue.enqueue(source(file('unsupported.pdf')));
    for (let i = 2; i < 20; i++) queue.enqueue(source());
    expect(queue.enqueue(source())).toBe(false); expect(queue.enqueue(source())).toBe(false);
    const reader = vi.spyOn(FileReader.prototype, 'readAsText');
    const { consume, report } = subscribe(queue);
    await vi.waitFor(() => expect(consume).toHaveBeenCalledTimes(18));
    expect(reader).toHaveBeenCalledTimes(18);
    expect(report).toHaveBeenCalledWith([{ kind: 'capacity', count: 2 }]);
    expect(report).toHaveBeenCalledWith([{ kind: 'size', name: 'large.md', count: 1 }]);
    expect(report).toHaveBeenCalledWith([{ kind: 'type', name: 'unsupported.pdf', count: 1 }]);
  });
  it('reports read/import failures and continues with valid siblings, not false success', async () => {
    const queue = new FileOpenQueue();
    queue.enqueue({ name: 'unreadable.md', getFile: vi.fn().mockRejectedValue(new Error('Synthetic read failure')) });
    queue.enqueue(source(file('write-fails.md'))); queue.enqueue(source(file('valid.md')));
    const consume = vi.fn().mockRejectedValueOnce(new Error('Synthetic quota failure')).mockResolvedValue(undefined);
    const { report } = subscribe(queue, consume);
    await vi.waitFor(() => expect(consume).toHaveBeenCalledTimes(2));
    expect(report).toHaveBeenCalledWith([{ kind: 'read', name: 'unreadable.md', count: 1 }]);
    expect(report).toHaveBeenCalledWith([{ kind: 'import', name: 'write-fails.md', count: 1 }]);
    expect(consume.mock.calls[1][0].name).toBe('valid.md');
  });
  it('does not replay an acknowledged commit when its owner locks immediately afterwards', async () => {
    const queue = new FileOpenQueue(); let stop = () => {};
    const committed = vi.fn(async () => { stop(); });
    stop = queue.subscribe(committed, vi.fn()); queue.enqueue(source());
    await vi.waitFor(() => expect(committed).toHaveBeenCalledOnce());
    const { consume } = subscribe(queue); await Promise.resolve(); await Promise.resolve();
    expect(consume).not.toHaveBeenCalled();
  });
  it('retries an explicitly aborted write only after a new unlocked owner subscribes', async () => {
    const queue = new FileOpenQueue(); let stop = () => {};
    stop = queue.subscribe(async (_detail, signal) => { stop(); signal.throwIfAborted(); }, vi.fn());
    const handle = source(); queue.enqueue(handle);
    await vi.waitFor(() => expect(handle.getFile).toHaveBeenCalledOnce());
    // The first FileReader needs a turn to deliver the aborted write.
    await new Promise(resolve => setTimeout(resolve, 20));
    const { consume } = subscribe(queue);
    await vi.waitFor(() => expect(consume).toHaveBeenCalledOnce());
    expect(handle.getFile).toHaveBeenCalledTimes(2);
  });
  it('bounds a stalled getFile and recovers without an unhandled late rejection', async () => {
    vi.useFakeTimers(); const queue = new FileOpenQueue(); let fail!: (error: Error) => void;
    const pending = new Promise<File>((_resolve, reject) => { fail = reject; });
    const { report } = subscribe(queue);
    queue.enqueue({ name: 'stalled.md', getFile: () => pending });
    await vi.advanceTimersByTimeAsync(30001);
    expect(report).toHaveBeenCalledWith([{ kind: 'read', name: 'stalled.md', count: 1 }]);
    fail(new Error('Late synthetic failure')); await Promise.resolve();
  });
});
