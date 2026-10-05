import { describe, expect, it } from 'vitest';
import type { OutputAsset, OutputBundle, OutputChunk } from 'rollup';
import { inlineStandaloneBundle } from '../../build/standalone-html';

function asset(fileName: string, source: string | Uint8Array): OutputAsset {
  return { type: 'asset', fileName, source, names: [fileName], originalFileNames: [], name: fileName, originalFileName: null, needsCodeReference: false };
}
function bundle(html = '<head><script type="module" crossorigin src="./app.js"></script><link rel="stylesheet" crossorigin href="./app.css"></head>'): OutputBundle {
  return {
    'index.html': asset('index.html', html),
    'app.js': { type: 'chunk', fileName: 'app.js', isEntry: true, code: 'window.fixture = "$& café";', imports: [], dynamicImports: [], referencedFiles: [] } as unknown as OutputChunk,
    'app.css': asset('app.css', '@charset "UTF-8";body{color:navy}'),
  };
}

describe('strict standalone HTML assembly', () => {
  it('inlines exact emitted filenames, preserving literal code and element attributes', () => {
    const output = bundle();
    inlineStandaloneBundle(output);
    expect(Object.keys(output)).toEqual(['index.html']);
    expect((output['index.html'] as OutputAsset).source).toBe('<head><script type="module" crossorigin>window.fixture = "$& café";</script><style crossorigin>body{color:navy}</style></head>');
  });

  it('supports UTF-8 byte assets, quoted attributes and a stylesheet-free build', () => {
    const output = bundle("<script src='app.js' type='module'></script>");
    delete output['app.css'];
    output['index.html'] = asset('index.html', new TextEncoder().encode("<script src='app.js' type='module'></script>"));
    inlineStandaloneBundle(output);
    expect((output['index.html'] as OutputAsset).source).toContain('café');
    expect(Object.keys(output)).toEqual(['index.html']);
  });

  it.each([
    '<script type="module" src="other/app.js"></script><link rel="stylesheet" href="app.css">',
    '<script type="module" src="app.js">unexpected body</script><link rel="stylesheet" href="app.css">',
    '<script type="module" src="app.js"></script><script src="extra.js"></script><link rel="stylesheet" href="app.css">',
    '<script src="app.js"></script><link rel="stylesheet" href="app.css">',
    '<script type="module" src="app.js"></script><link rel="stylesheet" href="other.css">',
    '<script type="module" src="app.js"></script>',
    '<script type="module" src="app.js"></script><link rel="stylesheet" href="app.css"><link rel="modulepreload" href="other.js">',
    '<script type="module" src="app.js" src="duplicate.js"></script><link rel="stylesheet" href="app.css">',
    '<script type="module" type="text/plain" src="app.js"></script><link rel="stylesheet" href="app.css">',
    '<script type="module" src="app.js"></script><link rel="stylesheet" href="app.css" href="duplicate.css">',
    '<script type="module" src="app.js"></script><link rel="stylesheet" rel="alternate" href="app.css">',
    '<script type="module" src=app.js></script><link rel="stylesheet" href="app.css">',
  ])('rejects unsupported references before modifying the bundle: %s', html => {
    const output = bundle(html);
    const before = structuredClone(output);
    expect(() => inlineStandaloneBundle(output)).toThrow(/Standalone/);
    expect(output).toEqual(before);
  });

  it('rejects emitted sibling assets and unresolved imports', () => {
    const output = bundle();
    output['font.woff2'] = asset('font.woff2', new Uint8Array([0, 1]));
    expect(() => inlineStandaloneBundle(output)).toThrow(/no external emitted assets/);
    delete output['font.woff2'];
    (output['app.js'] as OutputChunk).dynamicImports = ['other.js'];
    expect(() => inlineStandaloneBundle(output)).toThrow(/external imports/);
  });

  it('does not confuse attribute-like text with actual source attributes', () => {
    const output = bundle('<script data-label=" src=\'ordinary-text\' " type="module" src="app.js"></script><link data-label=" href=\'ordinary-text\' " rel="stylesheet" href="app.css">');
    inlineStandaloneBundle(output);
    expect((output['index.html'] as OutputAsset).source).toContain('data-label=" src=\'ordinary-text\' " type="module">');
    expect((output['index.html'] as OutputAsset).source).toContain('<style data-label=" href=\'ordinary-text\' ">');
  });

  it('fails closed on unescaped raw-text delimiters and unfinished preload markers', () => {
    const output = bundle();
    for (const code of ['const closingTag = "</script>";', 'const text = "<!-- <ScRiPt >";']) {
      (output['app.js'] as OutputChunk).code = code;
      expect(() => inlineStandaloneBundle(output)).toThrow(/safe for direct HTML embedding/);
    }
    (output['app.js'] as OutputChunk).code = 'const text = "<!--";';
    expect(() => inlineStandaloneBundle(output)).toThrow(/unbalanced HTML comment/);
    (output['app.js'] as OutputChunk).code = 'const marker = "__VITE_PRELOAD__";';
    expect(() => inlineStandaloneBundle(output)).toThrow(/unfinished Vite preload marker/);
    (output['app.js'] as OutputChunk).code = 'window.fixture = true;';
    output['app.css'] = asset('app.css', 'body::after{content:"</style>"}');
    expect(() => inlineStandaloneBundle(output)).toThrow(/safe for direct HTML embedding/);
  });

  it('preserves balanced HTML comments in regexes, strings and tagged template raw text', () => {
    const output = bundle();
    const code = 'const pattern = /<!--.*?-->/; const text = "<!-- ordinary -->"; const raw = String.raw`<!-- \\n -->`;';
    (output['app.js'] as OutputChunk).code = code;
    inlineStandaloneBundle(output);
    const parsed = new DOMParser().parseFromString((output['index.html'] as OutputAsset).source as string, 'text/html');
    expect(parsed.querySelector('script')?.textContent).toBe(code);
    expect(parsed.querySelector('style')?.textContent).toBe('body{color:navy}');
  });
});
