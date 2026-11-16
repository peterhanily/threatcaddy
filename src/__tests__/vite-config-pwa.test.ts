// @vitest-environment node
import { resolve } from 'node:path';
import type { ConfigEnv, UserConfig } from 'vite';
import { describe, expect, it, vi } from 'vitest';
import { localeCacheName, workboxOptions } from '../../build/pwa-workbox';

const pwa = vi.hoisted(() => ({ options: [] as Array<{ workbox?: unknown }> }));

vi.mock('vite-plugin-pwa', () => ({
  VitePWA: (options: { workbox?: unknown }) => {
    pwa.options.push(options);
    return { name: 'vite-plugin-pwa-under-test' };
  },
}));
// The hosted config reads VITE_* values from .env files; this test needs none of them.
vi.mock('vite', async (importOriginal) => ({ ...(await importOriginal<typeof import('vite')>()), loadEnv: () => ({}) }));

describe('hosted vite config', () => {
  it('wires the translation-versioned locale cache and privacy page into the build', async () => {
    const { default: config } = await import('../../vite.config');
    const resolved = await (config as (env: ConfigEnv) => UserConfig | Promise<UserConfig>)({ mode: 'production', command: 'build', isSsrBuild: false, isPreview: false });
    const localeCache = localeCacheName(resolve(__dirname, '../../public/locales'));

    // The page purges every locale cache except the one the service worker writes.
    expect(resolved.define?.__LOCALE_CACHE__).toBe(JSON.stringify(localeCache));
    expect(pwa.options).toHaveLength(1);
    expect(pwa.options[0].workbox).toEqual(workboxOptions(localeCache));
  });
});
