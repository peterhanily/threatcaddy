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
    transformIndexHtml: {
      order: 'pre',
      handler(html) {
        return html
          .replace(/<meta\s+http-equiv="Content-Security-Policy"[^>]*\/?\s*>/i, '')
          // The hosted stale-chunk guard is unnecessary for a monolithic file.
          .replace(/<script\s+src="\.\/chunk-reload-guard\.js"[^>]*>\s*<\/script>/i, '');
      },
    },
  };
}

/** Excalidraw ships font URI strings rather than Vite asset imports. Replace
 * those known packaged assets at build time so file:// never needs sibling
 * files, an HTTP origin, a CDN, or a platform-installed CJK fallback font. */
function standaloneAssets(): Plugin {
  return {
    name: 'standalone-self-contained-assets',
    enforce: 'pre',
    transform(source, id) {
      if (id.includes('/src/') && /\.[jt]sx?(?:\?|$)/.test(id)) {
        source = source.replace(/(['"])([^'"\n]+\?worker)\1/g, '$1$2&inline$1');
      }
      if (id.includes('/@excalidraw/excalidraw/') && /\.(?:js|css)(?:\?|$)/.test(id)) {
        source = source.replace(/(['"])(\.?\/fonts\/[^'"\n]+\.woff2)\1/g, (_match, quote: string, uri: string) => {
          const path = resolve(__dirname, 'public', uri.replace(/^\.?\//, ''));
          const encoded = readFileSync(path).toString('base64');
          return `${quote}data:font/woff2;base64,${encoded}${quote}`;
        });
      }
      return { code: source, map: null };
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

function standaloneNotices(): Plugin {
  return {
    name: 'standalone-third-party-notices',
    transformIndexHtml() {
      const directory = resolve(__dirname, 'public/licenses');
      const notices = Object.fromEntries(readdirSync(directory).filter(name => name.endsWith('.txt')).sort()
        .map(name => [name, readFileSync(join(directory, name), 'utf-8')]));
      if (!notices['excalidraw-fonts.txt']) throw new Error('Standalone font distribution requires its bundled notices');
      return [{ tag: 'script', attrs: { id: 'standalone-third-party-notices', type: 'application/json' },
        children: JSON.stringify(notices).replace(/</g, '\\u003c'), injectTo: 'body' }];
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
  plugins: [standaloneAssets(), react(), tailwindcss(), stripCSPForSingleFile(), inlineFaviconForSingleFile(), standaloneNotices(), viteSingleFile()],
  base: './',
  worker: {
    // Chromium file:// documents cannot start blob module workers. A bundled
    // classic worker keeps regex isolation without an HTTP origin or imports.
    format: 'iife',
    rollupOptions: { output: { inlineDynamicImports: true } },
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
