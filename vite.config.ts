import { defineConfig, loadEnv, type Plugin } from 'vite'
import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { VitePWA } from 'vite-plugin-pwa'
import { applyDeploymentPolicy, type DeploymentPolicy } from './src/lib/deployment-policy'
import { startupBudget } from './build/startup-budget'
import { dependencyProvenance } from './build/dependency-provenance'
import { localeCacheName, workboxOptions } from './build/pwa-workbox'
import { bootGuard } from './build/boot-guard'
import { cspScriptHashes } from './build/csp-script-hashes'

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
  const localeCache = localeCacheName(resolve(__dirname, 'public/locales'));
  return {
  plugins: [
    selfHostedFontAssets(),
    react(),
    tailwindcss(),
    bootGuard({ standalone: false, localesDir: resolve(__dirname, 'public/locales') }),
    deploymentPolicy({ analyticsToken: env.VITE_CF_ANALYTICS_TOKEN, connectOrigins: env.VITE_CONNECT_ORIGINS }),
    cspScriptHashes(),
    startupBudget(),
    dependencyProvenance('hosted'),
    VitePWA({
      registerType: 'autoUpdate',
      manifest: false,
      injectRegister: 'auto',
      workbox: workboxOptions(localeCache),
    }),
  ],
  // The page deletes locale caches written under any other name.
  define: {
    __LOCALE_CACHE__: JSON.stringify(localeCache),
    __APP_VERSION__: JSON.stringify(JSON.parse(readFileSync(resolve(__dirname, 'package.json'), 'utf-8')).version),
  },
  base: './',
  worker: {
    format: 'es',
  },
  // Preserve the natural dynamic-import graph. Package-wide manual chunks
  // pulled shared React dependencies into the lazy editor and made the whole
  // editor eager; they also collapsed its independently lazy diagram modules.
  }
})
