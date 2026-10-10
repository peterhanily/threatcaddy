import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { BackupDestination } from '../types';
import { cloudPut, multiCloudPut } from '../lib/cloud-sync';

const mocked = vi.hoisted(() => ({ validate: vi.fn(), build: vi.fn(), fetch: vi.fn() }));
vi.mock('../lib/cloud-providers', () => ({ CLOUD_PROVIDERS: { oci: {
  validateUrl: mocked.validate, buildObjectUrl: mocked.build, extraHeaders: () => ({}),
} } }));
const first: BackupDestination = { id: 'first', label: 'First', provider: 'oci', enabled: true, url: 'https://first.example.test/' };
const second: BackupDestination = { ...first, id: 'second', label: 'Second', url: 'https://second.example.test/' };
beforeEach(() => {
  vi.resetAllMocks();
  vi.stubGlobal('fetch', mocked.fetch);
  mocked.validate.mockReturnValue({ valid: true });
  mocked.build.mockImplementation((url: string) => url);
  mocked.fetch.mockResolvedValue({ ok: true, status: 200 });
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

describe('per-destination cloud receipts', () => {
  it('preserves the destination identity when URL preparation fails', async () => {
    mocked.build.mockImplementation(() => { throw new Error('Cannot prepare object URL'); });
    expect(await cloudPut(first, 'backup.json', '{}')).toEqual({ destinationId: 'first', label: 'First', ok: false, status: 0,
      error: 'Cannot prepare object URL' });
    expect(mocked.fetch).not.toHaveBeenCalled();
  });

  it('preserves each destination identity even for a rejected validator', async () => {
    mocked.validate.mockImplementation(() => { throw new Error('Cannot validate destination'); });
    expect(await multiCloudPut([first, second], 'backup.json', '{}')).toEqual([
      { destinationId: 'first', label: 'First', ok: false, status: 0, error: 'Cannot validate destination' },
      { destinationId: 'second', label: 'Second', ok: false, status: 0, error: 'Cannot validate destination' },
    ]);
  });

  it('cleans up its deadline after a rejected fetch', async () => {
    vi.useFakeTimers();
    mocked.fetch.mockRejectedValue(new Error('Network unavailable'));
    expect((await cloudPut(first, 'backup.json', '{}')).ok).toBe(false);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('counts completion order and never labels a failed destination uploaded', async () => {
    let finishFirst: (value: { ok: boolean; status: number }) => void = () => {};
    mocked.fetch.mockImplementation((url: string) => url === first.url
      ? new Promise((resolve) => { finishFirst = resolve; })
      : Promise.resolve({ ok: false, status: 503, statusText: 'Unavailable' }));
    const progress = vi.fn();
    const pending = multiCloudPut([first, second], 'backup.json', '{}', 'application/json', progress);
    await vi.waitFor(() => expect(progress).toHaveBeenCalledWith('Failed to upload to Second (1/2)'));
    finishFirst({ ok: true, status: 200 });
    const results = await pending;
    expect(progress).toHaveBeenLastCalledWith('Uploaded to First (2/2)');
    expect(results.map(({ destinationId }) => destinationId)).toEqual(['first', 'second']);
  });
});
