// @vitest-environment node
/**
 * C-CSP-1: the standalone file drops the hosted CSP, whose connect-src and
 * script hosts do not apply to a file:// page, but keeps an image policy so
 * notes and chat cannot load remote images. Map tiles stay allowed.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { IndexHtmlTransformContext, Plugin, PluginOption } from 'vite';
import { describe, expect, it } from 'vitest';

const IMAGE_POLICY = '<meta http-equiv="Content-Security-Policy" content="img-src \'self\' data: blob: https://*.basemaps.cartocdn.com">';
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

describe('C-CSP-1 standalone image policy', () => {
  it('replaces the hosted CSP with an image-only policy inside <head>', async () => {
    const html = String(await (await standaloneTransform())(readFileSync(INDEX_HTML, 'utf8')));
    expect(html.split(IMAGE_POLICY)).toHaveLength(2);
    expect(html.match(/http-equiv="Content-Security-Policy"/g)).toHaveLength(1);
    expect(html).not.toMatch(/default-src|connect-src|script-src/);
    expect(html.indexOf(IMAGE_POLICY)).toBeLessThan(html.indexOf('</head>'));
    expect(html.indexOf(IMAGE_POLICY)).toBeGreaterThan(html.indexOf('<meta charset="UTF-8" />'));
  });

  it('fails the build if the hosted CSP it replaces is missing', async () => {
    const transform = await standaloneTransform();
    expect(() => transform('<head><meta charset="UTF-8" /></head>')).toThrow(/Content-Security-Policy/);
  });
});
