import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

function cloudflareAnalytics(): Plugin {
  return {
    name: 'cloudflare-analytics',
    transformIndexHtml(html, ctx) {
      if (ctx.server) return html // skip in dev
      return html.replace(
        '</body>',
        `<!-- Cloudflare Web Analytics --><script defer src='https://static.cloudflareinsights.com/beacon.min.js' data-cf-beacon='{"token": "c5101e61909f40b193f1aeb7366ac7a8"}'></script><!-- End Cloudflare Web Analytics -->\n</body>`
      )
    },
  }
}

export default defineConfig({
  plugins: [react(), tailwindcss(), cloudflareAnalytics()],
  base: './',
})
