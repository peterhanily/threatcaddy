import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { VitePWA } from 'vite-plugin-pwa'
import { rename, mkdir } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { resolve } from 'node:path'

/**
 * Post-build: move non-English locales and Excalidraw CJK fonts to dist/optional/.
 * This keeps the main deploy lean (~22MB → ~6MB) while preserving the files
 * for users who download a language pack.
 *
 * The i18n HTTP backend gracefully falls back to English when a locale 404s.
 */
function stripOptionalAssets(): Plugin {
  return {
    name: 'strip-optional-assets',
    apply: 'build',
    async closeBundle() {
      const distDir = resolve('dist')
      const optDir = resolve(distDir, 'optional')

      // Move non-English locale directories
      const localesDir = resolve(distDir, 'locales')
      if (existsSync(localesDir)) {
        const optLocales = resolve(optDir, 'locales')
        await mkdir(optLocales, { recursive: true })

        const { readdir } = await import('node:fs/promises')
        const langs = await readdir(localesDir)
        for (const lang of langs) {
          if (lang === 'en') continue
          const src = resolve(localesDir, lang)
          const dest = resolve(optLocales, lang)
          await rename(src, dest).catch(() => {})
        }
      }

      // Move Excalidraw CJK font (Xiaolai = 16MB)
      const xiaolaiDir = resolve(distDir, 'fonts', 'Xiaolai')
      if (existsSync(xiaolaiDir)) {
        const optFonts = resolve(optDir, 'fonts')
        await mkdir(optFonts, { recursive: true })
        await rename(xiaolaiDir, resolve(optFonts, 'Xiaolai')).catch(() => {})
      }
    },
  }
}

function cloudflareAnalytics(): Plugin {
  return {
    name: 'cloudflare-analytics',
    transformIndexHtml(html, ctx) {
      if (ctx.server) return html // skip in dev
      return html.replace(
        '</body>',
        `<!-- Cloudflare Web Analytics --><script defer src='https://static.cloudflareinsights.com/beacon.min.js' data-cf-beacon='{"token": "beb9b5eaaaaf4808a367502ada8fd179"}'></script><!-- End Cloudflare Web Analytics -->\n</body>`
      )
    },
  }
}

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    cloudflareAnalytics(),
    stripOptionalAssets(),
    VitePWA({
      registerType: 'autoUpdate',
      manifest: false,
      injectRegister: 'auto',
      workbox: {
        // Only precache the critical-path assets needed for first render.
        // Heavy lazy-loaded chunks (mermaid, cytoscape, leaflet, katex, etc.)
        // are cached at runtime on first use via runtimeCaching below.
        globPatterns: ['assets/**/*.{js,css}', '*.{ico,js}'],
        globIgnores: [
          '**/excalidraw-*',           // Whiteboard editor (1.1MB)
          '**/locales/**',             // i18n locale files (cached separately)
          'chunk-reload-guard.js',
          '**/flowchart-elk-*',        // Mermaid flowchart-elk (1.4MB)
          '**/subset-*',              // Mermaid shared subset (1.7MB)
          '**/sequenceDiagram-*',      // Mermaid sequence (82KB)
          '**/ganttDiagram-*',         // Mermaid gantt (59KB)
          '**/c4Diagram-*',            // Mermaid C4 (67KB)
          '**/createText-*',           // Mermaid text (59KB)
          '**/cytoscape-*',            // Graph library (507KB)
          '**/leaflet-*',             // Map library (163KB)
          '**/katex-*',               // Math rendering (255KB)
          '**/WhiteboardEditor-*',     // Whiteboard CSS (142KB)
          '**/search.worker-*',        // Search web worker (260KB)
          '**/SettingsPanel-*',        // Settings (lazy, 195KB)
          '**/IOCStatsView-*',         // IOC stats (lazy, 85KB)
          '**/TimelineView-*',         // Timeline (lazy, 73KB)
          '**/ChatView-*',             // Chat (lazy, 68KB)
        ],
        navigateFallback: null,
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
            // Cache locale JSON files after first fetch
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
})
