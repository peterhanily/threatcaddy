import { defineConfig, loadEnv, type Plugin } from 'vite'
import { existsSync } from 'node:fs'
import { resolve } from 'node:path'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { VitePWA } from 'vite-plugin-pwa'
import { applyDeploymentPolicy, type DeploymentPolicy } from './src/lib/deployment-policy'

function deploymentPolicy(policy: DeploymentPolicy): Plugin {
  return {
    name: 'explicit-deployment-policy',
    transformIndexHtml(html, ctx) {
      return applyDeploymentPolicy(html, { ...policy, analyticsToken: ctx.server ? undefined : policy.analyticsToken })
    },
  }
}

/** Excalidraw always appends a public CDN fallback for relative font URIs.
 * Its absolute-URL path is local-only, and is available even before the
 * editor module initializes EXCALIDRAW_ASSET_PATH. */
function selfHostedFontAssets(): Plugin {
  let base = './';
  return {
    name: 'self-hosted-font-assets',
    enforce: 'pre',
    configResolved(config) { base = config.base; },
    transform(source, id) {
      if (!id.includes('/@excalidraw/excalidraw/') || !/\.js(?:\?|$)/.test(id)) return null;
      const code = source.replace(/(['"])(\.?\/fonts\/[^'"\n]+\.woff2)\1/g, (_match, _quote: string, uri: string) => {
        const path = resolve(__dirname, 'public', uri.replace(/^\.?\//, ''));
        if (!existsSync(path)) throw new Error(`Missing packaged font: ${uri}`);
        return `new URL(${JSON.stringify(uri)},new URL(${JSON.stringify(base)},window.location.href)).href`;
      });
      return { code, map: null };
    },
  };
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), 'VITE_');
  return {
  plugins: [
    selfHostedFontAssets(),
    react(),
    tailwindcss(),
    deploymentPolicy({ analyticsToken: env.VITE_CF_ANALYTICS_TOKEN, connectOrigins: env.VITE_CONNECT_ORIGINS }),
    VitePWA({
      registerType: 'autoUpdate',
      manifest: false,
      injectRegister: 'auto',
      workbox: {
        // Cache the built module graph and English fallback together. Manual
        // chunking shares dependencies between nominally lazy features; a
        // filename exclusion can otherwise break even a basic offline reload.
        // Preserve all packaged font subsets, including Xiaolai CJK, so first
        // use of a script offline does not depend on a previously warmed CDN.
        globPatterns: ['index.html', 'logo.svg', 'manifest.json', 'locales/en/*.json', 'assets/**/*.{js,css}', 'fonts/**/*.woff2', 'licenses/*.txt', '*.{ico,js}'],
        navigateFallback: 'index.html',
        navigateFallbackDenylist: [/\/(?:api|ws)(?:\/|$)/],
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
            // English fallback is precached; other locales are cached on use.
            urlPattern: /\/locales\/[^/]+\/[^/]+\.json$/,
            handler: 'CacheFirst',
            options: {
              cacheName: 'i18n-locales',
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
      },
    }),
  ],
  base: './',
  worker: {
    format: 'es',
  },
  build: {
    rollupOptions: {
      output: {
        manualChunks: {
          excalidraw: ['@excalidraw/excalidraw'],
          cytoscape: ['cytoscape', 'cytoscape-cose-bilkent'],
          leaflet: ['leaflet', 'react-leaflet'],
          markdown: ['marked', 'dompurify'],
          compression: ['pako'],
        },
      },
    },
  },
  }
})
