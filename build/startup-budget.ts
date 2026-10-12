import { gzipSync } from 'node:zlib';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import type { OutputBundle, OutputChunk } from 'rollup';
import type { Plugin } from 'vite';

export const STARTUP_BUDGET = { javascript: 2_000_000, javascriptGzip: 600_000, css: 250_000, cssGzip: 40_000 };
const heavyModules = {
  whiteboard: /\/node_modules\/@excalidraw\/excalidraw\//,
  graph: /\/node_modules\/(?:cytoscape|cytoscape-cose-bilkent)\//,
  map: /\/node_modules\/(?:leaflet|react-leaflet|@react-leaflet\/core)\//,
};

/** Static entry closure, not a filename heuristic. Dynamic feature imports are
 * tested separately in browsers; they must remain available offline. */
export function inspectStartupBundle(bundle: OutputBundle) {
  const chunks = Object.values(bundle).filter((item): item is OutputChunk => item.type === 'chunk');
  const entries = chunks.filter(item => item.isEntry).map(item => item.fileName);
  if (!entries.length) throw new Error('Startup budget requires a JavaScript entry');
  const scripts = new Set<string>();
  function visit(file: string) {
    if (scripts.has(file)) return;
    const chunk = bundle[file];
    if (!chunk || chunk.type !== 'chunk') throw new Error(`Unbundled startup import: ${file}`);
    scripts.add(file);
    for (const dependency of chunk.imports) visit(dependency);
  }
  for (const entry of entries) visit(entry);
  const deferred: Record<string, string[]> = {};
  for (const [feature, pattern] of Object.entries(heavyModules)) {
    deferred[feature] = chunks.filter(chunk => Object.entries(chunk.modules)
      .some(([id, module]) => module.renderedLength > 0 && pattern.test(id))).map(chunk => chunk.fileName).sort();
    if (!deferred[feature].length) throw new Error(`Missing packaged ${feature} feature`);
    if (deferred[feature].some(file => scripts.has(file))) throw new Error(`Heavy ${feature} code is in the startup graph`);
  }
  const styles = new Set<string>();
  let javascript = 0; let javascriptGzip = 0; let css = 0; let cssGzip = 0;
  for (const file of scripts) {
    const chunk = bundle[file] as OutputChunk & { viteMetadata?: { importedCss: Set<string> } };
    javascript += Buffer.byteLength(chunk.code);
    javascriptGzip += gzipSync(chunk.code).length;
    for (const style of chunk.viteMetadata?.importedCss ?? []) styles.add(style);
  }
  for (const file of styles) {
    const asset = bundle[file];
    if (!asset || asset.type !== 'asset') throw new Error(`Missing startup stylesheet: ${file}`);
    const bytes = typeof asset.source === 'string' ? Buffer.from(asset.source) : asset.source;
    css += bytes.length;
    cssGzip += gzipSync(bytes).length;
  }
  const sizes = { javascript, javascriptGzip, css, cssGzip };
  for (const key of Object.keys(STARTUP_BUDGET) as (keyof typeof STARTUP_BUDGET)[]) {
    if (sizes[key] > STARTUP_BUDGET[key]) throw new Error(`Startup ${key} exceeds budget: ${sizes[key]} > ${STARTUP_BUDGET[key]}`);
  }
  // Workbox must never silently omit a new oversized lazy feature.
  for (const chunk of chunks) {
    if (Buffer.byteLength(chunk.code) > 5 * 1024 * 1024) throw new Error(`Chunk exceeds offline precache limit: ${chunk.fileName}`);
  }
  return { budget: STARTUP_BUDGET, sizes, entries, scripts: [...scripts].sort(), styles: [...styles].sort(), deferred };
}

export function startupBudget(): Plugin {
  return {
    name: 'startup-dependency-budget', apply: 'build', enforce: 'post',
    async generateBundle(_options, bundle) {
      const report = inspectStartupBundle(bundle);
      // Test metadata is not emitted into dist or the published artifact.
      const directory = resolve('node_modules/.cache/threatcaddy');
      await mkdir(directory, { recursive: true });
      await writeFile(resolve(directory, 'startup-budget.json'), JSON.stringify(report, null, 2) + '\n');
      this.info(`Startup JS: ${report.sizes.javascript} bytes / ${report.sizes.javascriptGzip} gzip; heavy features deferred`);
    },
  };
}
