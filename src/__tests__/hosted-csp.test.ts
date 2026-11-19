// @vitest-environment node
/**
 * SITE-2: the hosted policy allows exactly the page's own inline scripts,
 * never 'unsafe-inline', and no longer allows the retired catalog host.
 */
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { ConfigEnv, IndexHtmlTransformContext, Plugin, PluginOption, UserConfig } from 'vite';
import { describe, expect, it, vi } from 'vitest';
import { cspScriptHashes, inlineScriptHashes } from '../../build/csp-script-hashes';

vi.mock('vite-plugin-pwa', () => ({ VitePWA: () => ({ name: 'vite-plugin-pwa-under-test' }) }));
// The hosted config reads VITE_* values from .env files; this test needs none of them.
vi.mock('vite', async (importOriginal) => ({ ...(await importOriginal<typeof import('vite')>()), loadEnv: () => ({}) }));

const INDEX_HTML = resolve(__dirname, '../../index.html');
const CTX = { path: '/index.html', filename: INDEX_HTML } as IndexHtmlTransformContext;
type Handler = (html: string, ctx: IndexHtmlTransformContext) => string;

function handler(plugin: Plugin): { order: string; run: Handler } | undefined {
  const hook = plugin.transformIndexHtml;
  if (!hook) return undefined;
  if (typeof hook === 'function') return { order: 'normal', run: hook as unknown as Handler };
  return { order: hook.order ?? 'normal', run: hook.handler as unknown as Handler };
}

async function hostedPlugins(): Promise<Plugin[]> {
  const { default: config } = await import('../../vite.config');
  const resolved = await (config as (env: ConfigEnv) => UserConfig | Promise<UserConfig>)({ mode: 'production', command: 'build', isSsrBuild: false, isPreview: false });
  return ((resolved.plugins ?? []) as PluginOption[]).flat(Infinity as 1).filter(Boolean) as Plugin[];
}

/** The page's own index.html transforms, in Vite's pre, normal, post order. */
async function hostedHtml(): Promise<string> {
  const owned = new Set(['threatcaddy-boot-guard', 'explicit-deployment-policy', 'csp-inline-script-hashes']);
  const hooks = (await hostedPlugins()).filter(plugin => owned.has(plugin.name)).map(handler).filter(hook => hook !== undefined);
  expect(hooks).toHaveLength(owned.size);
  let html = readFileSync(INDEX_HTML, 'utf8');
  for (const order of ['pre', 'normal', 'post']) for (const hook of hooks.filter(entry => entry.order === order)) html = hook.run(html, CTX);
  return html;
}

function directives(html: string): Record<string, string[]> {
  const content = /http-equiv="Content-Security-Policy" content="([^"]*)"/.exec(html)?.[1] ?? '';
  return Object.fromEntries(content.split(';').map(part => part.trim()).filter(Boolean).map(part => part.split(/\s+/)).map(([name, ...sources]) => [name, sources]));
}

const sha256 = (code: string) => `'sha256-${createHash('sha256').update(code).digest('base64')}'`;

describe('hosted Content-Security-Policy', () => {
  it('allows each inline script of the built page by hash, and nothing else inline', async () => {
    const html = await hostedHtml();
    const scripts = [...html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script\b[^>]*>/gi)].filter(match => !match[1].trim()).map(match => match[2]);
    // The boot guard and the two theme snippets.
    expect(scripts).toHaveLength(3);
    const scriptSrc = directives(html)['script-src'];
    expect(scriptSrc).not.toContain("'unsafe-inline'");
    expect(scriptSrc.filter(source => source.startsWith("'sha256-")).sort()).toEqual(scripts.map(sha256).sort());
    expect(scriptSrc).toEqual(expect.arrayContaining(["'self'", 'blob:']));
    // The structured-data block never runs, so it needs no hash.
    const structured = /<script type="application\/ld\+json">([\s\S]*?)<\/script>/.exec(html)?.[1] ?? '';
    expect(structured).toContain('"@type": "WebApplication"');
    expect(scriptSrc).not.toContain(sha256(structured));
  });

  it('keeps cloud backup and local services reachable, and drops the retired catalog host', async () => {
    const connect = directives(await hostedHtml())['connect-src'];
    expect(connect).not.toContain('https://raw.githubusercontent.com');
    expect(connect).toEqual(expect.arrayContaining([
      'http://localhost:*', 'ws://localhost:*', 'http://127.0.0.1:*', 'ws://127.0.0.1:*',
      'https://*.s3.amazonaws.com', 'https://*.blob.core.windows.net', 'https://storage.googleapis.com',
    ]));
  });

  it('hashes the browser view of a script and skips external scripts and data blocks', () => {
    expect(inlineScriptHashes([
      '<script>a()\r\nb()</script>',
      '<script type="module">c()</script>',
      "<script type='text/javascript'>d()</script>",
      '<script src="./e.js"></script>',
      '<script type="application/ld+json">{}</script>',
      '<script id="notices" type="application/json">{}</script>',
    ].join(''))).toEqual([sha256('a()\nb()'), sha256('c()'), sha256('d()')]);
  });

  it("refuses a policy that allows 'unsafe-inline' or has no script-src", () => {
    const hook = handler(cspScriptHashes());
    expect(hook?.order).toBe('post');
    if (!hook) return;
    expect(() => hook.run('<meta http-equiv="Content-Security-Policy" content="script-src \'self\' \'unsafe-inline\';">', CTX)).toThrow(/unsafe-inline/);
    expect(() => hook.run('<meta http-equiv="Content-Security-Policy" content="default-src \'self\';">', CTX)).toThrow(/script-src/);
  });
});
