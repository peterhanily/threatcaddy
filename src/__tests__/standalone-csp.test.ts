// @vitest-environment node
/**
 * C-CSP-1 / ARTIFACTS-1: the standalone file drops the hosted CSP, whose
 * connect-src and script hosts do not apply to a file:// page. It keeps an
 * image and media policy so notes and chat cannot load remote images, audio or
 * video (map tiles stay allowed), runs only its own inline code, blob: and
 * data: workers and WebAssembly, and refuses frames, plugins, form posts and
 * <base> changes. connect-src stays open: analysts connect it to team servers,
 * local or remote AI endpoints, integrations and cloud storage they choose.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { IndexHtmlTransformContext, Plugin, PluginOption } from 'vite';
import { describe, expect, it } from 'vitest';

const STANDALONE_POLICY = '<meta http-equiv="Content-Security-Policy" content="img-src \'self\' data: blob: https://*.basemaps.cartocdn.com; media-src \'self\' data: blob:; script-src \'unsafe-inline\' \'wasm-unsafe-eval\' blob:; worker-src blob: data:; object-src \'none\'; base-uri \'none\'; form-action \'none\'; frame-src \'none\'">';
const INDEX_HTML = resolve(__dirname, '../../index.html');

/** The transform the standalone build applies to index.html (it uses no plugin context). */
async function standaloneTransform(): Promise<(html: string) => unknown> {
  const { default: config } = await import('../../vite.config.single');
  const plugins = ((config.plugins ?? []) as PluginOption[]).flat(Infinity as 1) as Plugin[];
  const hook = plugins.find(item => item && item.name === 'strip-csp-meta')?.transformIndexHtml;
  if (!hook || typeof hook === 'function') throw new Error('The standalone CSP transform is missing');
  const handler = hook.handler as unknown as (html: string, ctx: IndexHtmlTransformContext) => unknown;
  return html => handler(html, { path: '/index.html', filename: INDEX_HTML } as IndexHtmlTransformContext);
}

describe('C-CSP-1 standalone policy', () => {
  it('replaces the hosted CSP with an image and media policy inside <head>', async () => {
    const html = String(await (await standaloneTransform())(readFileSync(INDEX_HTML, 'utf8')));
    expect(html.split(STANDALONE_POLICY)).toHaveLength(2);
    expect(html.match(/http-equiv="Content-Security-Policy"/g)).toHaveLength(1);
    // connection-policy.ts treats a policy without connect-src or default-src as open.
    expect(html).not.toMatch(/default-src|connect-src/);
    expect(html.indexOf(STANDALONE_POLICY)).toBeLessThan(html.indexOf('</head>'));
    expect(html.indexOf(STANDALONE_POLICY)).toBeGreaterThan(html.indexOf('<meta charset="UTF-8" />'));
  });

  it('limits remote media, scripts, workers, frames, plugins, forms and base URLs, but not connections', async () => {
    const html = String(await (await standaloneTransform())(readFileSync(INDEX_HTML, 'utf8')));
    const content = html.match(/http-equiv="Content-Security-Policy" content="([^"]*)"/)?.[1] ?? '';
    const directives = Object.fromEntries(content.split(';').map(part => part.trim().split(/\s+/)).map(([name, ...sources]) => [name, sources]));
    expect(directives).toEqual({
      'img-src': ["'self'", 'data:', 'blob:', 'https://*.basemaps.cartocdn.com'],
      'media-src': ["'self'", 'data:', 'blob:'],
      'script-src': ["'unsafe-inline'", "'wasm-unsafe-eval'", 'blob:'],
      'worker-src': ['blob:', 'data:'],
      'object-src': ["'none'"],
      'base-uri': ["'none'"],
      'form-action': ["'none'"],
      'frame-src': ["'none'"],
    });
  });

  it('fails the build if the hosted CSP it replaces is missing', async () => {
    const transform = await standaloneTransform();
    expect(() => transform('<head><meta charset="UTF-8" /></head>')).toThrow(/Content-Security-Policy/);
  });

  it('runs the boot guard first, directly after the standalone policy (SITE-1)', async () => {
    const { default: config } = await import('../../vite.config.single');
    const plugins = ((config.plugins ?? []) as PluginOption[]).flat(Infinity as 1) as Plugin[];
    const names = plugins.map(plugin => plugin?.name);
    expect(names.indexOf('threatcaddy-boot-guard')).toBeGreaterThan(names.indexOf('strip-csp-meta'));
    let html = readFileSync(INDEX_HTML, 'utf8');
    for (const name of ['strip-csp-meta', 'threatcaddy-boot-guard']) {
      const hook = plugins.find(plugin => plugin?.name === name)?.transformIndexHtml;
      if (!hook || typeof hook === 'function') throw new Error(`Missing ordered transform ${name}`);
      html = (hook.handler as unknown as (html: string, ctx: IndexHtmlTransformContext) => string)(html, { path: '/index.html', filename: INDEX_HTML } as IndexHtmlTransformContext);
    }
    const end = html.indexOf(STANDALONE_POLICY) + STANDALONE_POLICY.length;
    expect(html.indexOf(STANDALONE_POLICY)).toBeGreaterThan(0);
    expect(html.slice(end, html.indexOf('<script')).trim()).toBe('');
    expect(html.slice(html.indexOf('<script'))).toMatch(/^<script>\(function \(\) \{\n {2}var framed;/);
    expect(html).toContain('var misplaced = true &&');
  });
});
