import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { viteSingleFile } from 'vite-plugin-singlefile'

function stripCSPForSingleFile(): Plugin {
  return {
    name: 'strip-csp-meta',
    transformIndexHtml(html) {
      return html.replace(/<meta\s+http-equiv="Content-Security-Policy"[^>]*\/?\s*>/i, '');
    },
  };
}

export default defineConfig({
  plugins: [react(), tailwindcss(), stripCSPForSingleFile(), viteSingleFile()],
  base: './',
  build: {
    outDir: 'dist-single',
  },
})
