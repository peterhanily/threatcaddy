import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { localeCacheName, workboxOptions } from '../../build/pwa-workbox';
import { purgeStaleLocaleCaches } from '../lib/locale-cache';

function fakeCaches(names: string[]) {
  const store = new Set(names);
  const storage = {
    keys: vi.fn(async () => [...store]),
    delete: vi.fn(async (name: string) => store.delete(name)),
  } as unknown as CacheStorage;
  return { store, storage };
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.resetModules();
});

describe('hosted service worker navigation', () => {
  const options = workboxOptions('i18n-locales-0123456789abcdef');
  const denied = (path: string) => (options.navigateFallbackDenylist ?? []).some(pattern => pattern.test(path));

  it('serves the privacy policy as its own document instead of the app shell', () => {
    expect(options.globPatterns).toContain('privacy.html');
    expect(denied('/privacy.html')).toBe(true);
  });

  it('still answers app navigations and keeps the API out of the fallback', () => {
    expect(denied('/')).toBe(false);
    expect(denied('/?view=notes')).toBe(false);
    expect(denied('/api/auth/login')).toBe(true);
    expect(denied('/ws')).toBe(true);
  });
});

describe('hosted locale caching', () => {
  it('caches non-English locales under the given translation-versioned name', () => {
    const name = 'i18n-locales-0123456789abcdef';
    const url = 'https://threatcaddy.com/locales/de/investigations.json';
    const route = workboxOptions(name).runtimeCaching?.find(entry => entry.urlPattern instanceof RegExp && entry.urlPattern.test(url));
    expect(route?.handler).toBe('CacheFirst');
    expect(route?.options?.cacheName).toBe(name);
  });

  it('changes the cache name exactly when a shipped translation changes', () => {
    const dir = mkdtempSync(join(tmpdir(), 'tc-locales-'));
    try {
      for (const language of ['en', 'de']) mkdirSync(join(dir, language));
      writeFileSync(join(dir, 'en', 'investigations.json'), '{"detail":{"syncedToServerDesc":"Keep a separate backup."}}');
      writeFileSync(join(dir, 'de', 'investigations.json'), '{"detail":{"syncedToServerDesc":"Gesichert"}}');
      const first = localeCacheName(dir);
      expect(first).toMatch(/^i18n-locales-[0-9a-f]{16}$/);
      expect(localeCacheName(dir)).toBe(first);
      writeFileSync(join(dir, 'de', 'investigations.json'), '{"detail":{"syncedToServerDesc":"Separate Sicherung behalten."}}');
      expect(localeCacheName(dir)).not.toBe(first);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
    expect(localeCacheName(resolve(__dirname, '../../public/locales'))).toMatch(/^i18n-locales-[0-9a-f]{16}$/);
  });

  it('ignores stray non-translation files such as .DS_Store', () => {
    const dir = mkdtempSync(join(tmpdir(), 'tc-locales-'));
    try {
      mkdirSync(join(dir, 'de'));
      writeFileSync(join(dir, 'de', 'common.json'), '{"ok":"OK"}');
      const clean = localeCacheName(dir);
      writeFileSync(join(dir, '.DS_Store'), 'finder');
      writeFileSync(join(dir, 'de', '.DS_Store'), 'finder');
      expect(localeCacheName(dir)).toBe(clean);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('deletes locale caches from other builds, including the old unversioned cache', async () => {
    const { store, storage } = fakeCaches(['i18n-locales', 'i18n-locales-aaaaaaaaaaaaaaaa', 'i18n-locales-0123456789abcdef', 'workbox-precache-v2-https://threatcaddy.com/', 'lazy-chunks']);
    await purgeStaleLocaleCaches('i18n-locales-0123456789abcdef', storage);
    expect([...store]).toEqual(['i18n-locales-0123456789abcdef', 'workbox-precache-v2-https://threatcaddy.com/', 'lazy-chunks']);
    await expect(purgeStaleLocaleCaches('i18n-locales-0123456789abcdef', undefined)).resolves.toBeUndefined();
  });

  it('purges stale locale caches when the hosted app starts', async () => {
    const { store, storage } = fakeCaches(['i18n-locales', 'i18n-locales-0123456789abcdef', 'lazy-chunks']);
    vi.stubGlobal('caches', storage);
    vi.stubGlobal('__LOCALE_CACHE__', 'i18n-locales-0123456789abcdef');
    vi.resetModules();
    await import('../i18n');
    await vi.waitFor(() => expect([...store]).toEqual(['i18n-locales-0123456789abcdef', 'lazy-chunks']));
  });
});
