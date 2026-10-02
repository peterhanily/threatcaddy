import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getEntityDraft, getFailedDrafts, flushEntityDrafts, hasPendingEntityDrafts, withEntityDraftBarrier, type EntityDraft, type DraftPatch } from '../lib/entity-drafts';
import { hasPendingChanges } from '../lib/pending-changes';

let sequence = 0;
const opened: EntityDraft[] = [];
const releases: (() => void)[] = [];
function setup(persist: (patch: DraftPatch) => void | Promise<void>) {
  const key = `test:${++sequence}`;
  const draft = getEntityDraft(key);
  opened.push(draft);
  const release = draft.attach(persist);
  releases.push(release);
  return { key, draft, release };
}

beforeEach(() => { vi.useFakeTimers(); });
afterEach(async () => {
  for (const draft of opened.splice(0)) {
    const release = draft.attach(() => {});
    await draft.retry();
    draft.discard(true);
    release();
  }
  for (const release of releases.splice(0)) release();
  await flushEntityDrafts();
  vi.useRealTimers();
});

describe('entity draft persistence', () => {
  it('retains all conflict versions after detach and requires explicit choices before saving', async () => {
    const persist = vi.fn();
    const { key, draft, release } = setup(persist);
    draft.queue({ title: 'Local title', content: 'Local body' });
    draft.recordConflict('title', { base: 'Title', local: 'Local title', remote: 'Remote title' });
    draft.recordConflict('content', { base: 'Body', local: 'Local body', remote: 'Remote body' });
    release();
    await vi.advanceTimersByTimeAsync(1_000);
    expect(getEntityDraft(key)).toBe(draft);
    expect(await draft.retry()).toBe(false);
    expect(persist).not.toHaveBeenCalled();
    expect(draft.getSnapshot().conflicts?.content).toEqual({ base: 'Body', local: 'Local body', remote: 'Remote body' });
    expect(draft.resolveConflict('title', 'remote')).toBe(true);
    expect(persist).not.toHaveBeenCalled();
    expect(draft.resolveConflict('content', 'local')).toBe(true);
    await draft.flush();
    expect(persist).toHaveBeenCalledExactlyOnceWith({ content: 'Local body' });
    expect(hasPendingChanges()).toBe(false);
  });

  it('requires confirmed discard, refuses it while saving, and clears retained recovery afterwards', async () => {
    let finish!: () => void;
    const { draft } = setup(() => new Promise<void>((resolve) => { finish = resolve; }));
    draft.queue({ title: 'Unsaved' });
    expect(draft.discard(false)).toBe(false);
    const saving = draft.flush();
    await Promise.resolve();
    expect(draft.discard(true)).toBe(false);
    draft.recordConflict('title', { base: 'Title', local: 'Unsaved', remote: 'Remote' });
    finish();
    await saving;
    expect(draft.discard(true)).toBe(true);
    expect(draft.getSnapshot()).toMatchObject({ patch: {}, status: 'idle' });
    expect(getFailedDrafts()).toEqual([]);
    expect(hasPendingChanges()).toBe(false);
  });

  it('drains prior writes before entering an external data replacement', async () => {
    const calls: string[] = [];
    const { draft } = setup(() => { calls.push('persist'); });
    draft.queue({ title: 'Before restore' });
    const result = await withEntityDraftBarrier(async () => { calls.push('restore'); return 42; });
    expect(result).toBe(42);
    expect(calls).toEqual(['persist', 'restore']);
    expect(hasPendingEntityDrafts()).toBe(false);
  });

  it('retains concurrent restore-time edits without automatically overwriting replacement data', async () => {
    const persist = vi.fn();
    const { draft } = setup(persist);
    const result = await withEntityDraftBarrier(async () => {
      draft.queue({ content: 'Edit attempted while restoring' });
      expect(await draft.retry()).toBe(false);
      return 'restore committed';
    });
    expect(result).toBe('restore committed');
    await vi.advanceTimersByTimeAsync(1_000);
    expect(persist).not.toHaveBeenCalled();
    expect(hasPendingEntityDrafts()).toBe(true);
    expect(draft.getSnapshot().error).toContain('review');
    expect(await draft.flush()).toBe(false);
    expect(await draft.retry()).toBe(true);
    expect(persist).toHaveBeenCalledExactlyOnceWith({ content: 'Edit attempted while restoring' });
  });

  it('aborts replacement if another edit arrives while the initial writes are draining', async () => {
    let finish!: () => void;
    const { draft } = setup(() => new Promise<void>((resolve) => { finish = resolve; }));
    draft.queue({ title: 'Original pending edit' });
    const operation = vi.fn().mockResolvedValue(undefined);
    const replacement = withEntityDraftBarrier(operation);
    // Attach the rejection assertion before resolving the pending write.
    const rejected = expect(replacement).rejects.toThrow('require review');
    await Promise.resolve();
    draft.queue({ title: 'Concurrent edit' });
    finish();
    await rejected;
    expect(operation).not.toHaveBeenCalled();
    expect(draft.getSnapshot().patch).toEqual({ title: 'Concurrent edit' });
    expect(hasPendingChanges()).toBe(true);
  });

  it('releases the barrier when replacement fails', async () => {
    await expect(withEntityDraftBarrier(async () => { throw new Error('Restore failed'); })).rejects.toThrow('Restore failed');
    const persist = vi.fn();
    const { draft } = setup(persist);
    draft.queue({ title: 'Ordinary editing resumes' });
    expect(await draft.flush()).toBe(true);
    expect(persist).toHaveBeenCalledOnce();
  });

  it('coalesces title and body changes instead of replacing pending fields', async () => {
    const persist = vi.fn();
    const { draft } = setup(persist);
    for (let i = 0; i < 20; i++) draft.queue({ title: `Title ${i}` });
    draft.queue({ content: 'Body' });
    expect(hasPendingChanges()).toBe(true);
    await vi.advanceTimersByTimeAsync(499);
    expect(persist).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(persist).toHaveBeenCalledExactlyOnceWith({ title: 'Title 19', content: 'Body' });
    expect(draft.getSnapshot()).toEqual({ patch: {}, status: 'saved' });
    expect(hasPendingChanges()).toBe(false);
  });

  it('serializes a newer edit behind an in-flight write and stays dirty until both settle', async () => {
    let finish!: () => void;
    const persist = vi.fn().mockImplementationOnce(() => new Promise<void>((resolve) => { finish = resolve; }));
    const { draft } = setup(persist);
    draft.queue({ title: 'Earlier title' });
    const saving = draft.flush();
    await Promise.resolve();
    draft.queue({ title: 'Latest title', content: 'New body' });
    await vi.advanceTimersByTimeAsync(500);
    expect(persist).toHaveBeenCalledTimes(1);
    expect(draft.getSnapshot().status).toBe('saving');
    expect(hasPendingChanges()).toBe(true);
    finish();
    await saving;
    expect(persist).toHaveBeenNthCalledWith(2, { title: 'Latest title', content: 'New body' });
    expect(hasPendingChanges()).toBe(false);
  });

  it('retains and exposes a failed draft after detaching, then retries the exact fields', async () => {
    const persist = vi.fn().mockRejectedValueOnce(new Error('Storage quota exceeded')).mockResolvedValue(undefined);
    const { key, draft, release } = setup(persist);
    draft.queue({ title: 'Recover me', content: 'Work in progress' });
    release();
    releases.pop();
    await draft.flush();
    expect(getEntityDraft(key)).toBe(draft);
    expect(draft.getSnapshot().status).toBe('error');
    expect(hasPendingChanges()).toBe(true);
    expect(getFailedDrafts()).toEqual([expect.objectContaining({ key, snapshot: expect.objectContaining({ patch: { title: 'Recover me', content: 'Work in progress' } }) })]);
    const reattach = draft.attach(persist);
    releases.push(reattach);
    expect(await draft.retry()).toBe(true);
    expect(persist).toHaveBeenLastCalledWith({ title: 'Recover me', content: 'Work in progress' });
    expect(getFailedDrafts()).toEqual([]);
    expect(hasPendingChanges()).toBe(false);
  });

  it('flushes detached editors without changing their entity or sharing patches', async () => {
    const firstSave = vi.fn();
    const secondSave = vi.fn();
    const first = setup(firstSave);
    const second = setup(secondSave);
    first.draft.queue({ title: 'First' });
    second.draft.queue({ content: 'Second' });
    first.release();
    releases.splice(releases.indexOf(first.release), 1);
    await first.draft.flush();
    expect(firstSave).toHaveBeenCalledExactlyOnceWith({ title: 'First' });
    expect(secondSave).not.toHaveBeenCalled();
    expect(hasPendingChanges()).toBe(true);
    await second.draft.flush();
    expect(secondSave).toHaveBeenCalledExactlyOnceWith({ content: 'Second' });
    expect(hasPendingChanges()).toBe(false);
  });

  it('starts a lifecycle flush without marking unresolved storage writes saved', async () => {
    let finish!: () => void;
    const { draft } = setup(() => new Promise<void>((resolve) => { finish = resolve; }));
    draft.queue({ content: 'Pending on hide' });
    window.dispatchEvent(new Event('pagehide'));
    await Promise.resolve();
    expect(draft.getSnapshot().status).toBe('saving');
    expect(hasPendingChanges()).toBe(true);
    finish();
    await draft.flush();
    expect(hasPendingChanges()).toBe(false);
  });
});
