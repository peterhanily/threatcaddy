import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { clearCatalogCache, fetchCatalog, getCachedCatalog } from '../lib/integration-catalog';
import type { CatalogEntry } from '../types/integration-types';

const CACHE_KEY = 'threatcaddy-integration-catalog';
const entry: CatalogEntry = {
  id: 'community-fixture', name: 'Fictional community entry', description: 'Test catalog entry',
  author: 'Test', category: 'utility', tags: ['test'], icon: 'test', color: '#123456',
  version: '1.0.0', downloads: 0, templateUrl: 'https://example.test/template.json', sha256: '', updatedAt: '2026-10-05',
};

function cache(entries: unknown = [entry], fetchedAt = Date.now()) {
  localStorage.setItem(CACHE_KEY, JSON.stringify({ entries, fetchedAt }));
}

describe('optional integration catalog', () => {
  const request = vi.fn<typeof fetch>();
  beforeEach(() => {
    localStorage.removeItem(CACHE_KEY);
    request.mockReset();
    vi.stubGlobal('fetch', request);
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(true);
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('reports HTTP 404 distinctly instead of pretending an empty catalog loaded', async () => {
    request.mockResolvedValue(new Response('Not Found', { status: 404 }));
    expect(await fetchCatalog()).toEqual({ entries: [], source: 'unavailable', error: 'not-found' });
    expect(getCachedCatalog()).toBeNull();
  });

  it('keeps an expired validated cache available on network failure without marking it current', async () => {
    cache([entry], Date.now() - 24 * 60 * 60 * 1_000);
    request.mockRejectedValue(new TypeError('Network unavailable'));
    expect(getCachedCatalog()).toBeNull();
    expect(await fetchCatalog()).toEqual({ entries: [entry], source: 'cache', error: 'network' });
  });

  it('uses the saved fallback offline without making a request', async () => {
    cache();
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false);
    expect(await fetchCatalog()).toEqual({ entries: [entry], source: 'cache', error: 'offline' });
    expect(request).not.toHaveBeenCalled();
    clearCatalogCache();
    expect(await fetchCatalog()).toEqual({ entries: [], source: 'unavailable', error: 'offline' });
  });

  it('recovers on retry and replaces the cache only after a valid successful response', async () => {
    cache();
    const current = { ...entry, version: '2.0.0' };
    request.mockResolvedValueOnce(new Response('', { status: 404 }));
    request.mockResolvedValueOnce(new Response(JSON.stringify({ entries: [current] })));
    expect((await fetchCatalog()).source).toBe('cache');
    expect(await fetchCatalog()).toEqual({ entries: [current], source: 'network' });
    expect(getCachedCatalog()).toEqual([current]);
    expect(request).toHaveBeenLastCalledWith(expect.stringContaining('peterhanily/threatcaddy-integrations'), expect.objectContaining({ credentials: 'omit', referrerPolicy: 'no-referrer' }));
  });

  it.each([{}, { entries: null }, { entries: [{ ...entry, tags: null }] }, { entries: [{ ...entry, templateUrl: 'javascript:alert(1)' }] }, { entries: [{ ...entry, sha256: 'wrong' }] }])('rejects malformed responses and preserves the previous catalog: %j', async (body) => {
    cache();
    request.mockResolvedValue(new Response(JSON.stringify(body)));
    expect(await fetchCatalog()).toEqual({ entries: [entry], source: 'cache', error: 'invalid' });
    expect(getCachedCatalog()).toEqual([entry]);
  });

  it('treats a valid empty response as success and invalid JSON as a failure', async () => {
    request.mockResolvedValueOnce(new Response('{'));
    request.mockResolvedValueOnce(new Response(JSON.stringify({ entries: [] })));
    expect((await fetchCatalog()).error).toBe('invalid');
    expect(await fetchCatalog()).toEqual({ entries: [], source: 'network' });
    expect(getCachedCatalog()).toEqual([]);
  });

  it('rejects malformed or future-dated cache values', () => {
    for (const value of ['null', '{}', '{', JSON.stringify({ entries: {}, fetchedAt: Date.now() })]) {
      localStorage.setItem(CACHE_KEY, value);
      expect(getCachedCatalog({ allowExpired: true })).toBeNull();
    }
    cache([entry], Date.now() + 24 * 60 * 60 * 1_000);
    expect(getCachedCatalog()).toBeNull();
  });

  it('does not turn successful network results into failures when localStorage is unavailable', async () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('Quota'); });
    request.mockResolvedValue(new Response(JSON.stringify({ entries: [entry] })));
    expect(await fetchCatalog()).toEqual({ entries: [entry], source: 'network' });
    vi.spyOn(Storage.prototype, 'removeItem').mockImplementation(() => { throw new Error('Disabled'); });
    expect(() => clearCatalogCache()).not.toThrow();
  });

  it('clears the timeout after failures and aborts a stalled request', async () => {
    vi.useFakeTimers();
    request.mockRejectedValueOnce(new TypeError('Network unavailable'));
    await fetchCatalog();
    expect(vi.getTimerCount()).toBe(0);
    request.mockImplementationOnce((_url, options) => new Promise((_resolve, reject) => {
      options?.signal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')));
    }));
    const pending = fetchCatalog();
    await vi.advanceTimersByTimeAsync(15_000);
    expect(await pending).toEqual({ entries: [], source: 'unavailable', error: 'network' });
    expect(vi.getTimerCount()).toBe(0);
  });
});
