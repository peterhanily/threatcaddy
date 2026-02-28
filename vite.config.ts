import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

function cloudflareAnalytics(): Plugin {
  return {
    name: 'cloudflare-analytics',
    transformIndexHtml(html, ctx) {
      if (ctx.server) return html // skip in dev
      const token = process.env.VITE_CF_ANALYTICS_TOKEN
      if (!token) return html // only inject when explicitly configured
      return html.replace(
        '</body>',
        `<!-- Cloudflare Web Analytics --><script defer src='https://static.cloudflareinsights.com/beacon.min.js' data-cf-beacon='{"token": "${token}"}'></script><!-- End Cloudflare Web Analytics -->\n</body>`
      )
    },
  }
}

export default defineConfig({
  plugins: [react(), tailwindcss(), cloudflareAnalytics()],
  base: './',
  build: {
    rollupOptions: {
      output: {
        manualChunks: {
          excalidraw: ['@excalidraw/excalidraw'],
          cytoscape: ['cytoscape', 'cytoscape-cose-bilkent'],
        },
      },
    },
  },
})
