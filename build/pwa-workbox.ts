import { createHash } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { VitePWAOptions } from 'vite-plugin-pwa';
import { LOCALE_CACHE_PREFIX } from '../src/lib/locale-cache';

/** Name the locale runtime cache after the content of every shipped
 * translation. The name is stable while translations are unchanged. */
export function localeCacheName(localesDir: string): string {
  const hash = createHash('sha256');
  for (const language of readdirSync(localesDir).sort()) {
    for (const file of readdirSync(join(localesDir, language)).sort()) {
      hash.update(`${language}/${file}\0`).update(readFileSync(join(localesDir, language, file))).update('\0');
    }
  }
  return `${LOCALE_CACHE_PREFIX}-${hash.digest('hex').slice(0, 16)}`;
}

export function workboxOptions(localeCache: string): NonNullable<VitePWAOptions['workbox']> {
  return {
    // Cache the built module graph and English fallback together. Manual
    // chunking shares dependencies between nominally lazy features; a
    // filename exclusion can otherwise break even a basic offline reload.
    // Preserve all packaged font subsets, including Xiaolai CJK, so first
    // use of a script offline does not depend on a previously warmed CDN.
    globPatterns: ['index.html', 'privacy.html', 'logo.svg', 'manifest.json', 'locales/en/*.json', 'assets/**/*.{js,css}', 'fonts/**/*.woff2', 'licenses/*.txt', '*.{ico,js}'],
    navigateFallback: 'index.html',
    // Static pages such as the privacy policy are documents of their own,
    // never routes of the app shell.
    navigateFallbackDenylist: [/\/(?:api|ws)(?:\/|$)/, /\.html$/],
    skipWaiting: true,
    clientsClaim: true,
    maximumFileSizeToCacheInBytes: 5 * 1024 * 1024,
    runtimeCaching: [
      {
        urlPattern: /^.*\/api\/.*/,
        handler: 'NetworkOnly',
      },
      {
        urlPattern: /^.*\/ws.*/,
        handler: 'NetworkOnly',
      },
      {
        // English fallback is precached; other locales are cached on use,
        // under a name that changes whenever any translation changes.
        urlPattern: /\/locales\/[^/]+\/[^/]+\.json$/,
        handler: 'CacheFirst',
        options: {
          cacheName: localeCache,
          expiration: {
            maxEntries: 600,
            maxAgeSeconds: 30 * 24 * 60 * 60,
          },
        },
      },
      {
        // Cache lazy-loaded JS/CSS chunks on first use — StaleWhileRevalidate
        // serves from cache instantly on repeat visits while fetching updates
        urlPattern: /\/assets\/.*\.(js|css)$/,
        handler: 'StaleWhileRevalidate',
        options: {
          cacheName: 'lazy-chunks',
          expiration: {
            maxEntries: 200,
            maxAgeSeconds: 7 * 24 * 60 * 60, // 7 days
          },
        },
      },
    ],
  };
}
