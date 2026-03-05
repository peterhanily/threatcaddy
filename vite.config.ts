import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { VitePWA } from 'vite-plugin-pwa'

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
    VitePWA({
      registerType: 'autoUpdate',
      manifest: false,
      injectRegister: 'auto',
      workbox: {
        globPatterns: ['**/*.{js,css,ico,woff,woff2}'],
        globIgnores: ['**/excalidraw-*', '**/locales/**'],
        navigateFallback: null,
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
        ],
      },
    }),
  ],
  base: './',
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
