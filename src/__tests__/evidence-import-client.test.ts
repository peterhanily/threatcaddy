import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { extractEvidenceFiles } from '../lib/evidence-import-client';
import { EVIDENCE_LIMITS } from '../lib/evidence-import-limits';

const workers = vi.hoisted(() => {
  const behavior = { postMessageError: false };
  const instances: Array<{
    postMessage: ReturnType<typeof vi.fn>; terminate: ReturnType<typeof vi.fn>;
    onmessage: ((event: MessageEvent) => void) | null;
    onerror: ((event: ErrorEvent) => void) | null;
    onmessageerror: (() => void) | null;
  }> = [];
  const construct = vi.fn(function () {
    const worker = { postMessage: vi.fn(() => { if (behavior.postMessageError) throw new Error('structured clone failed'); }), terminate: vi.fn(), onmessage: null, onerror: null, onmessageerror: null };
    instances.push(worker);
    return worker;
  });
  return { instances, construct, behavior };
});
vi.mock('../workers/evidence-import.worker?worker', () => ({ default: workers.construct }));
const file = () => new File(['Synthetic evidence'], 'report.txt');
const respond = (index: number, data: unknown) => workers.instances[index].onmessage?.({ data } as MessageEvent);
const tick = async () => { await Promise.resolve(); await Promise.resolve(); };

describe('isolated evidence import lifecycle', () => {
  beforeEach(() => { vi.useFakeTimers(); workers.instances.length = 0; workers.construct.mockClear(); workers.behavior.postMessageError = false; });
  afterEach(() => { vi.useRealTimers(); });

  it('stages the full batch, uses one worker at a time and returns no partial batch on a later failure', async () => {
    const promise = extractEvidenceFiles([file(), file()]);
    const rejection = expect(promise).rejects.toThrow('corrupt document');
    expect(workers.instances).toHaveLength(1);
    respond(0, { ok: true, drafts: [{ title: 'first staged draft' }] });
    await tick();
    expect(workers.instances[0].terminate).toHaveBeenCalledOnce();
    expect(workers.instances).toHaveLength(2);
    respond(1, { ok: false, error: 'corrupt document' });
    await rejection;
    expect(workers.instances[1].terminate).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('returns all drafts only after every document succeeds and cleans up workers', async () => {
    const promise = extractEvidenceFiles([file(), file()], { folderName: 'Synthetic' });
    expect(workers.instances[0].postMessage).toHaveBeenCalledWith({ file: expect.any(File), options: { folderName: 'Synthetic' } });
    respond(0, { ok: true, drafts: [{ title: 'one' }] });
    await tick();
    respond(1, { ok: true, drafts: [{ title: 'two' }] });
    await expect(promise).resolves.toEqual([{ title: 'one' }, { title: 'two' }]);
    expect(workers.instances.every(worker => worker.terminate.mock.calls.length === 1)).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('cancels an active worker and ignores its late result without starting another document', async () => {
    const controller = new AbortController();
    const promise = extractEvidenceFiles([file(), file()], {}, controller.signal);
    const rejection = expect(promise).rejects.toMatchObject({ name: 'AbortError' });
    const lateMessage = workers.instances[0].onmessage;
    if (!lateMessage) throw new Error('Expected a worker message handler');
    controller.abort();
    lateMessage({ data: { ok: true, drafts: [{ title: 'must be discarded' }] } } as MessageEvent);
    await rejection;
    expect(workers.instances).toHaveLength(1);
    expect(workers.instances[0].terminate).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('rejects a pre-cancelled request before creating a worker', async () => {
    const controller = new AbortController(); controller.abort();
    await expect(extractEvidenceFiles([file()], {}, controller.signal)).rejects.toMatchObject({ name: 'AbortError' });
    expect(workers.construct).not.toHaveBeenCalled();
  });

  it('terminates parsing at its document deadline and rejects late completion after sleep', async () => {
    const promise = extractEvidenceFiles([file()]);
    const rejection = expect(promise).rejects.toThrow('10 seconds');
    await vi.advanceTimersByTimeAsync(EVIDENCE_LIMITS.documentTimeoutMs);
    await rejection;
    expect(workers.instances[0].terminate).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
    const afterSleep = extractEvidenceFiles([file()]);
    const sleepRejection = expect(afterSleep).rejects.toThrow('10 seconds');
    vi.setSystemTime(Date.now() + EVIDENCE_LIMITS.documentTimeoutMs);
    respond(1, { ok: true, drafts: [] });
    await sleepRejection;
    expect(workers.instances[1].terminate).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('bounds the entire batch even when each document individually meets its deadline', async () => {
    const promise = extractEvidenceFiles(Array.from({ length: 8 }, file));
    const rejection = expect(promise).rejects.toThrow('60 seconds');
    for (let index = 0; index < 6; index++) {
      await vi.advanceTimersByTimeAsync(9000);
      respond(index, { ok: true, drafts: [] });
      await tick();
    }
    await vi.advanceTimersByTimeAsync(6000);
    await rejection;
    expect(workers.instances).toHaveLength(7);
    expect(workers.instances[6].terminate).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('validates file count, raw file size and aggregate input before creating any worker', async () => {
    await expect(extractEvidenceFiles(Array.from({ length: 21 }, file))).rejects.toThrow('20 files');
    await expect(extractEvidenceFiles([{ size: EVIDENCE_LIMITS.inputBytes + 1 } as File])).rejects.toThrow('25 MiB');
    await expect(extractEvidenceFiles(Array.from({ length: 3 }, () => ({ size: EVIDENCE_LIMITS.inputBytes } as File)))).rejects.toThrow('50 MiB');
    expect(workers.construct).not.toHaveBeenCalled();
  });

  it('fails closed when workers are unavailable rather than parsing on the UI thread', async () => {
    workers.construct.mockImplementationOnce(() => { throw new Error('workers unavailable'); });
    await expect(extractEvidenceFiles([file()])).rejects.toThrow('available Web Worker');
    expect(vi.getTimerCount()).toBe(0);
  });

  it.each(['error', 'messageerror', 'postMessage'] as const)('cleans up after worker %s failure', async failure => {
    workers.behavior.postMessageError = failure === 'postMessage';
    const promise = extractEvidenceFiles([file()]);
    const rejection = expect(promise).rejects.toThrow();
    if (failure === 'error') workers.instances[0].onerror?.({ preventDefault: vi.fn() } as unknown as ErrorEvent);
    else if (failure === 'messageerror') workers.instances[0].onmessageerror?.();
    await rejection;
    expect(workers.instances[0].terminate).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
  });
});
