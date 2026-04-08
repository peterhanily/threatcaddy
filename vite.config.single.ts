import { defineConfig, type Plugin } from 'vite'
import { readFileSync, readdirSync } from 'node:fs'
import { resolve, join } from 'node:path'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { viteSingleFile } from 'vite-plugin-singlefile'

function stripCSPForSingleFile(): Plugin {
  return {
    name: 'strip-csp-meta',
    transformIndexHtml(html) {
      return html
        .replace(/<meta\s+http-equiv="Content-Security-Policy"[^>]*\/?\s*>/i, '');
    },
  };
}

function inlineFaviconForSingleFile(): Plugin {
  return {
    name: 'inline-favicon',
    transformIndexHtml(html) {
      const svgPath = resolve(__dirname, 'public/logo.svg');
      const svgContent = readFileSync(svgPath, 'utf-8');
      const dataUri = `data:image/svg+xml;base64,${Buffer.from(svgContent).toString('base64')}`;
      return html
        .replace(/<link\s+rel="icon"[^>]*\/?\s*>/i, `<link rel="icon" type="image/svg+xml" href="${dataUri}" />`)
        .replace(/<link\s+rel="apple-touch-icon"[^>]*\/?\s*>/i, `<link rel="apple-touch-icon" href="${dataUri}" />`)
        .replace(/<link\s+rel="manifest"[^>]*\/?\s*>/i, '');
    },
  };
}

// Bundle all non-English locale files into the standalone build so language
// switching works without any HTTP requests (file:// protocol can't serve them).
function loadAllLocales(): Record<string, Record<string, unknown>> {
  const localesDir = join(__dirname, 'public/locales');
  const result: Record<string, Record<string, unknown>> = {};
  for (const lang of readdirSync(localesDir)) {
    if (lang === 'en') continue;
    result[lang] = {};
    const langDir = join(localesDir, lang);
    for (const nsFile of readdirSync(langDir)) {
      if (!nsFile.endsWith('.json')) continue;
      const ns = nsFile.replace('.json', '');
      result[lang][ns] = JSON.parse(readFileSync(join(langDir, nsFile), 'utf-8'));
    }
  }
  return result;
}

export default defineConfig({
  plugins: [react(), tailwindcss(), stripCSPForSingleFile(), inlineFaviconForSingleFile(), viteSingleFile()],
  base: './',
  worker: {
    format: 'es',
  },
  define: {
    __STANDALONE__: JSON.stringify(true),
    __BUILD_TIME__: JSON.stringify(Date.now()),
    __STANDALONE_LOCALES__: JSON.stringify(loadAllLocales()),
  },
  build: {
    outDir: 'dist-single',
  },
})
