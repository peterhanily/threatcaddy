import { defineConfig, type Plugin } from 'vite'
import { readFileSync, readdirSync } from 'node:fs'
import { resolve, join } from 'node:path'
import { deflateRawSync } from 'node:zlib'
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

// Bundle non-English locale files into the standalone build so language switching
// works without HTTP requests (file:// protocol can't serve them).
// Each language is deflate-compressed and base64-encoded so it sits in the
// bundle as a compact string rather than a huge parsed object literal.
// pako.inflateRaw() decompresses lazily at runtime, only when the user
// actually switches to that language.
function loadCompressedLocales(): Record<string, string> {
  const localesDir = join(__dirname, 'public/locales');
  const result: Record<string, string> = {};
  for (const lang of readdirSync(localesDir)) {
    if (lang === 'en') continue;
    const langDir = join(localesDir, lang);
    const langData: Record<string, unknown> = {};
    for (const nsFile of readdirSync(langDir)) {
      if (!nsFile.endsWith('.json')) continue;
      const ns = nsFile.replace('.json', '');
      langData[ns] = JSON.parse(readFileSync(join(langDir, nsFile), 'utf-8'));
    }
    const compressed = deflateRawSync(Buffer.from(JSON.stringify(langData), 'utf-8'));
    result[lang] = compressed.toString('base64');
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
    __STANDALONE_LOCALES_GZ__: JSON.stringify(loadCompressedLocales()),
  },
  build: {
    outDir: 'dist-single',
  },
})
