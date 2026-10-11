// @vitest-environment node
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { OutputBundle, OutputChunk } from 'rollup';
import { inspectDependencyProvenance } from '../../build/dependency-provenance';

const versions: Record<string, string> = { mermaid: '11.17.2', katex: '0.18.2', 'i18next-http-backend': '4.0.2' };
const readPackage = (directory: string) => { const name = directory.split('/').at(-1) ?? ''; return { name, version: versions[name] }; };
function fixture(): OutputBundle {
  return Object.fromEntries([
    ['math.js', 'katex/dist/katex.mjs'], ['diagram.js', 'mermaid/dist/mermaid.core.mjs'],
    ['locale.js', 'i18next-http-backend/esm/index.js'],
  ].map(([fileName, id]) => [fileName, { type: 'chunk', fileName,
    modules: { [`/private/fixture/node_modules/${id}`]: { renderedLength: 42 } } } as unknown as OutputChunk]));
}

describe('emitted dependency provenance', () => {
  it('records exact active package versions and chunks without machine-local paths', () => {
    const report = inspectDependencyProvenance(fixture(), { requireHttpBackend: true, readPackage });
    expect(report).toContainEqual({ name: 'katex', version: '0.18.2', modules: ['dist/katex.mjs'], chunks: ['math.js'] });
    expect(JSON.stringify(report)).not.toContain('/private/');
  });
  it('requires the HTTP backend only in hosted output', () => {
    const bundle = fixture(); delete bundle['locale.js'];
    expect(() => inspectDependencyProvenance(bundle, { requireHttpBackend: true, readPackage })).toThrow('Missing rendered dependency: i18next-http-backend');
    expect(inspectDependencyProvenance(bundle, { requireHttpBackend: false, readPackage })).toHaveLength(2);
  });
  it('does not count tree-shaken modules as active coverage', () => {
    const bundle = fixture(); Object.values((bundle['math.js'] as OutputChunk).modules)[0].renderedLength = 0;
    expect(() => inspectDependencyProvenance(bundle, { requireHttpBackend: true, readPackage })).toThrow('Missing rendered dependency: katex');
  });
  it.each(['dist/mermaid.esm.mjs', 'dist/mermaid.esm.min.mjs', 'dist/chunks/mermaid.esm/katex-legacy.mjs'])('refuses emitted prebundled fallback %s', file => {
    const bundle = fixture();
    (bundle['diagram.js'] as OutputChunk).modules[`/private/fixture/node_modules/mermaid/${file}`] = { renderedLength: 12 } as OutputChunk['modules'][string];
    expect(() => inspectDependencyProvenance(bundle, { requireHttpBackend: true, readPackage })).toThrow('prebundled Mermaid');
  });
  it('rejects a second active KaTeX dependency with a different version', () => {
    const bundle = fixture();
    (bundle['math.js'] as OutputChunk).modules['/private/fixture/nested/node_modules/katex/dist/katex.mjs'] = { renderedLength: 12 } as OutputChunk['modules'][string];
    expect(() => inspectDependencyProvenance(bundle, { requireHttpBackend: true,
      readPackage: directory => directory.includes('/nested/') ? { name: 'katex', version: '0.16.47' } : readPackage(directory) })).toThrow('Unexpected active katex');
  });
  it('resolves the installed Mermaid dependency to patched KaTeX with its public renderer and stylesheet', async () => {
    const require = createRequire(import.meta.url);
    const drawing = createRequire(require.resolve('@excalidraw/excalidraw'));
    const converter = createRequire(drawing.resolve('@excalidraw/mermaid-to-excalidraw'));
    const mermaidEntry = converter.resolve('mermaid');
    expect(mermaidEntry).toMatch(/mermaid\.core\.mjs$/);
    const mermaidRequire = createRequire(mermaidEntry);
    const katexEntry = mermaidRequire.resolve('katex');
    const root = resolve(dirname(katexEntry), '..');
    const manifest = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8'));
    expect(manifest.version).toBe('0.18.2');
    const katex = mermaidRequire('katex') as { renderToString: (input: string, options: Record<string, unknown>) => string };
    const math = katex.renderToString('x^2 + y^2 = z^2', { output: 'htmlAndMathml', throwOnError: true, displayMode: true });
    expect(math).toContain('<math'); expect(math).toContain('katex-html');
    const css = readFileSync(resolve(root, 'dist/katex.min.css'), 'utf8');
    expect(css).toContain('.katex'); expect(css).toContain('@font-face');
    expect(css).toContain('KaTeX_Main-Regular');
  });
});
