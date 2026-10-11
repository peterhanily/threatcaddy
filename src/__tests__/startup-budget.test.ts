// @vitest-environment node
import { describe, expect, it } from 'vitest';
import type { OutputBundle, OutputChunk } from 'rollup';
import { inspectStartupBundle, STARTUP_BUDGET } from '../../build/startup-budget';

function chunk(fileName: string, module: string, imports: string[] = [], entry = false): OutputChunk {
  return { type: 'chunk', fileName, isEntry: entry, code: 'export const fixture = 1;', imports,
    modules: { [module]: { renderedLength: 24 } } } as unknown as OutputChunk;
}
function fixture(): OutputBundle {
  return {
    'main.js': chunk('main.js', '/project/src/main.ts', ['shared.js'], true),
    'shared.js': chunk('shared.js', '/project/node_modules/react/index.js'),
    'whiteboard.js': chunk('whiteboard.js', '/project/node_modules/@excalidraw/excalidraw/index.js', ['shared.js']),
    'graph.js': chunk('graph.js', '/project/node_modules/cytoscape/index.js', ['shared.js']),
    'map.js': chunk('map.js', '/project/node_modules/leaflet/index.js', ['shared.js']),
  };
}

describe('production startup dependency budget', () => {
  it('follows static transitive imports without pulling lazy consumers back into startup', () => {
    const report = inspectStartupBundle(fixture());
    expect(report.scripts).toEqual(['main.js', 'shared.js']);
    expect(report.deferred).toEqual({ whiteboard: ['whiteboard.js'], graph: ['graph.js'], map: ['map.js'] });
    expect(report.sizes.javascript).toBe(Buffer.byteLength('export const fixture = 1;') * 2);
  });
  it.each(['whiteboard', 'graph', 'map'])('rejects eagerly imported %s regardless of hashed filename', feature => {
    const bundle = fixture();
    (bundle['shared.js'] as OutputChunk).imports.push(feature + '.js');
    expect(() => inspectStartupBundle(bundle)).toThrow(`Heavy ${feature} code is in the startup graph`);
  });
  it('rejects missing entry/imports/features and oversized offline chunks', () => {
    expect(() => inspectStartupBundle({})).toThrow('entry');
    const missing = fixture(); delete missing['shared.js'];
    expect(() => inspectStartupBundle(missing)).toThrow('Unbundled startup import');
    const absent = fixture(); delete absent['map.js'];
    expect(() => inspectStartupBundle(absent)).toThrow('Missing packaged map feature');
    const large = fixture(); (large['whiteboard.js'] as OutputChunk).code = ' '.repeat(5 * 1024 * 1024 + 1);
    expect(() => inspectStartupBundle(large)).toThrow('offline precache limit');
  });
  it('enforces aggregate raw startup bytes even if individual files are small or compressible', () => {
    const bundle = fixture();
    (bundle['main.js'] as OutputChunk).code = ' '.repeat(STARTUP_BUDGET.javascript / 2 + 1);
    (bundle['shared.js'] as OutputChunk).code = ' '.repeat(STARTUP_BUDGET.javascript / 2 + 1);
    expect(() => inspectStartupBundle(bundle)).toThrow('Startup javascript exceeds budget');
  });
  it('counts shared stylesheet bytes only once and refuses missing CSS', () => {
    const bundle = fixture();
    for (const file of ['main.js', 'shared.js']) Object.assign(bundle[file], { viteMetadata: { importedCss: new Set(['main.css']) } });
    bundle['main.css'] = { type: 'asset', fileName: 'main.css', name: undefined, originalFileName: null,
      names: [], originalFileNames: [], source: 'body { color: red; }', needsCodeReference: false };
    expect(inspectStartupBundle(bundle).sizes.css).toBe(20);
    delete bundle['main.css'];
    expect(() => inspectStartupBundle(bundle)).toThrow('Missing startup stylesheet');
  });
});
