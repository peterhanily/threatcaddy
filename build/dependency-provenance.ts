import { readFileSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import type { OutputBundle } from 'rollup';
import type { Plugin } from 'vite';

const expectedVersions: Record<string, string> = { katex: '0.18.2', 'i18next-http-backend': '4.0.2' };
type PackageInfo = { name: string; version: string };
type Provenance = { name: string; version: string; modules: string[]; chunks: string[] };

/** Inspect modules that Rollup actually rendered, not unused files that happen
 * to exist in a dependency tarball. Reports contain only package-relative IDs. */
export function inspectDependencyProvenance(bundle: OutputBundle, options: {
  requireHttpBackend: boolean;
  readPackage?: (directory: string) => PackageInfo;
}) {
  const readPackage = options.readPackage ?? (directory => JSON.parse(readFileSync(resolve(directory, 'package.json'), 'utf8')) as PackageInfo);
  const manifests = new Map<string, PackageInfo>();
  const packages = new Map<string, Provenance>();
  for (const chunk of Object.values(bundle)) {
    if (chunk.type !== 'chunk') continue;
    for (const [id, module] of Object.entries(chunk.modules)) {
      if (module.renderedLength <= 0) continue;
      const match = id.replaceAll('\\', '/').match(/^(.*\/node_modules\/(katex|mermaid|i18next-http-backend))\/(.+?)(?:\?.*)?$/);
      if (!match) continue;
      const [, directory, name, file] = match;
      // Mermaid also distributes a self-contained ESM build with a vendored
      // older KaTeX. Only its external-dependency core build is qualified here.
      if (name === 'mermaid' && /\.(?:m?js)$/.test(file)
        && file !== 'dist/mermaid.core.mjs' && !file.startsWith('dist/chunks/mermaid.core/')) {
        throw new Error('Unqualified prebundled Mermaid module was emitted');
      }
      let manifest = manifests.get(directory);
      if (!manifest) { manifest = readPackage(directory); manifests.set(directory, manifest); }
      if (manifest.name !== name || !/^\d+\.\d+\.\d+(?:-[\w.-]+)?$/.test(manifest.version)) throw new Error('Invalid dependency provenance');
      if (expectedVersions[name] && manifest.version !== expectedVersions[name]) throw new Error(`Unexpected active ${name} version: ${manifest.version}`);
      const prior = packages.get(name);
      if (prior && prior.version !== manifest.version) throw new Error(`Multiple active ${name} versions`);
      const entry = prior ?? { name, version: manifest.version, modules: [], chunks: [] };
      if (!entry.modules.includes(file)) entry.modules.push(file);
      if (!entry.chunks.includes(chunk.fileName)) entry.chunks.push(chunk.fileName);
      packages.set(name, entry);
    }
  }
  for (const name of ['katex', 'mermaid', ...(options.requireHttpBackend ? ['i18next-http-backend'] : [])]) {
    if (!packages.has(name)) throw new Error(`Missing rendered dependency: ${name}`);
  }
  return [...packages.values()].sort((a, b) => a.name.localeCompare(b.name))
    .map(entry => ({ ...entry, modules: entry.modules.sort(), chunks: entry.chunks.sort() }));
}

export function dependencyProvenance(target: 'hosted' | 'standalone'): Plugin {
  return {
    name: 'verified-dependency-provenance', apply: 'build', enforce: 'post',
    async generateBundle(_options, bundle) {
      const packages = inspectDependencyProvenance(bundle, { requireHttpBackend: target === 'hosted' });
      const directory = resolve('node_modules/.cache/threatcaddy');
      await mkdir(directory, { recursive: true });
      await writeFile(resolve(directory, `dependency-provenance-${target}.json`), JSON.stringify({ target, packages }, null, 2) + '\n');
    },
  };
}
