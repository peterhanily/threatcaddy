/**
 * SITE-1 / ARTIFACTS-2 / SITE-6: before any other script, the page refuses to
 * run framed, and the standalone copy refuses to run unless opened from a file.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { IndexHtmlTransformContext, Plugin } from 'vite';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { bootGuard, bootGuardMessages, bootGuardScript } from '../../build/boot-guard';
import { SUPPORTED_LANGUAGES } from '../i18n';

const LOCALES = resolve(__dirname, '../../public/locales');
const INDEX_HTML = readFileSync(resolve(__dirname, '../../index.html'), 'utf8');
const CTX = { path: '/index.html', filename: resolve(__dirname, '../../index.html') } as IndexHtmlTransformContext;

function transform(plugin: Plugin | undefined, html: string): string {
  const hook = plugin?.transformIndexHtml;
  if (!hook || typeof hook === 'function') throw new Error('Expected an ordered index.html transform');
  return (hook.handler as unknown as (html: string, ctx: IndexHtmlTransformContext) => string)(html, CTX);
}

interface Run { write: ReturnType<typeof vi.fn>; document: Document }
function run({ standalone, href, framed = false, topThrows = false, languages = ['en-US'] }: {
  standalone: boolean; href: string; framed?: boolean; topThrows?: boolean; languages?: string[];
}): Run {
  const document = window.document.implementation.createHTMLDocument('');
  document.body.remove(); // The guard runs in <head>, before the parser reaches <body>.
  // As the parser does: <plaintext> closes <head>, opens <body> and swallows the rest.
  const write = vi.fn((markup: string) => {
    const body = document.createElement('body');
    body.innerHTML = markup;
    document.documentElement.append(body);
  });
  document.write = write;
  const self = {} as Record<string, unknown>;
  self.self = self;
  if (topThrows) Object.defineProperty(self, 'top', { get: () => { throw new Error('Fictional cross-origin access'); } });
  else self.top = framed ? {} : self;
  const location = { href, protocol: new URL(href).protocol };
  const script = bootGuardScript({ standalone, messages: bootGuardMessages(LOCALES) });
  new Function('window', 'document', 'location', 'navigator', script)(self, document, location, { languages, language: languages[0] });
  return { write, document };
}

afterEach(() => { vi.restoreAllMocks(); });

describe('boot guard messages', () => {
  it('are translated for every shipped language', () => {
    const messages = bootGuardMessages(LOCALES);
    expect(Object.keys(messages).sort()).toEqual(SUPPORTED_LANGUAGES.map(language => language.code).sort());
    for (const [language, entry] of Object.entries(messages)) {
      if (language !== 'en') expect(entry, language).not.toEqual(messages.en);
    }
    expect(messages.en).toEqual({
      framed: 'For your safety, ThreatCaddy does not run inside another website.',
      fileOnly: 'This offline copy of ThreatCaddy runs only when you open the file saved on your computer.',
      open: 'Open ThreatCaddy',
    });
  });
});

describe('boot guard behaviour', () => {
  it('leaves an ordinary hosted page and an opened standalone file alone', () => {
    for (const result of [run({ standalone: false, href: 'https://threatcaddy.example/' }), run({ standalone: true, href: 'file:///fictional/ThreatCaddy.html' })]) {
      expect(result.write).not.toHaveBeenCalled();
      expect(result.document.body).toBeNull();
      expect(result.document.documentElement.hasAttribute('data-boot-blocked')).toBe(false);
    }
  });

  it('stops a framed page and offers to open it in the top window', () => {
    const { write, document } = run({ standalone: false, href: 'https://threatcaddy.example/#share=fictional', framed: true });
    expect(write).toHaveBeenCalledExactlyOnceWith('<plaintext hidden>');
    expect(document.body?.firstElementChild?.outerHTML).toBe('<plaintext hidden=""></plaintext>');
    expect(document.documentElement.hasAttribute('data-boot-blocked')).toBe(true);
    expect(document.body?.querySelector('p')?.textContent).toBe('For your safety, ThreatCaddy does not run inside another website.');
    const link = document.body?.querySelector('a');
    expect(link?.textContent).toBe('Open ThreatCaddy');
    expect(link?.getAttribute('href')).toBe('https://threatcaddy.example/#share=fictional');
    expect(link?.getAttribute('target')).toBe('_top');
  });

  it('paints the notice in the browser\'s own light or dark colours, not the framing page\'s', () => {
    const { document } = run({ standalone: false, href: 'https://threatcaddy.example/', framed: true });
    // The page's colour scheme sets the canvas; jsdom cannot parse the system
    // colours on <body>, so e2e/boot-guard.spec.ts measures those in browsers.
    expect(document.documentElement.style.colorScheme).toBe('light dark');
  });

  it('treats an unreadable top window as framed', () => {
    expect(run({ standalone: true, href: 'file:///fictional/ThreatCaddy.html', topThrows: true }).write).toHaveBeenCalledOnce();
  });

  it('stops a standalone copy served over HTTP(S), framed or not, and links to the app beside it', () => {
    for (const framed of [false, true]) {
      const { write, document } = run({ standalone: true, href: 'https://threatcaddy.example/threatcaddy-standalone.html#share=fictional', framed });
      expect(write).toHaveBeenCalledExactlyOnceWith('<plaintext hidden>');
      expect(document.body?.querySelector('p')?.textContent).toBe('This offline copy of ThreatCaddy runs only when you open the file saved on your computer.');
      expect(document.body?.querySelector('a')?.getAttribute('href')).toBe('https://threatcaddy.example/');
      expect(document.body?.querySelector('a')?.getAttribute('target')).toBe('_top');
    }
    expect(run({ standalone: true, href: 'http://intranet.example/tools/ThreatCaddy.html' }).document.querySelector('a')?.getAttribute('href')).toBe('http://intranet.example/tools/');
  });

  it('speaks the first supported browser language without mapping other scripts or dialects', () => {
    const messages = bootGuardMessages(LOCALES);
    const shown = (languages: string[]) => {
      const { document } = run({ standalone: false, href: 'https://threatcaddy.example/', framed: true, languages });
      return [document.documentElement.lang, document.documentElement.dir, document.querySelector('a')?.textContent];
    };
    expect(shown(['zh-TW', 'de-AT', 'fr'])).toEqual(['de', 'ltr', messages.de.open]);
    expect(shown(['zh-Hans'])).toEqual(['zh-CN', 'ltr', messages['zh-CN'].open]);
    expect(shown(['PT-br'])).toEqual(['pt-BR', 'ltr', messages['pt-BR'].open]);
    expect(shown(['he-IL'])).toEqual(['he', 'rtl', messages.he.open]);
    expect(shown(['pt-PT', 'sr-Latn'])).toEqual(['en', 'ltr', 'Open ThreatCaddy']);
  });
});

describe('boot guard placement', () => {
  it('runs first in the hosted page, directly after its Content-Security-Policy', () => {
    const html = transform(bootGuard({ standalone: false, localesDir: LOCALES }), INDEX_HTML);
    const meta = /<meta\s+http-equiv="Content-Security-Policy"[^>]*>/i.exec(html);
    const firstScript = html.indexOf('<script');
    expect(meta && html.slice(meta.index + meta[0].length, firstScript).trim()).toBe('');
    expect(html.slice(firstScript)).toMatch(/^<script>\(function \(\) \{\n {2}var framed;/);
    expect(html).toContain('var misplaced = false &&');
  });

  it('refuses a page without a Content-Security-Policy to follow', () => {
    expect(() => transform(bootGuard({ standalone: true, localesDir: LOCALES }), '<head><meta charset="UTF-8" /></head>')).toThrow(/Content-Security-Policy/);
  });
});

describe('bundle fallback', () => {
  afterEach(() => {
    document.documentElement.removeAttribute('data-boot-blocked');
    vi.resetModules();
  });

  it('ends the bundle before any module runs when the guard blocked the page', async () => {
    document.documentElement.setAttribute('data-boot-blocked', '');
    await expect(import('../lib/boot-blocked')).rejects.toThrow(/did not start/);
  });

  it('lets an ordinary page start', async () => {
    await expect(import('../lib/boot-blocked')).resolves.toBeDefined();
  });

  it('is the first module the app entry imports', () => {
    const entry = readFileSync(resolve(__dirname, '../main.tsx'), 'utf8');
    const imports = [...entry.matchAll(/^import\s[^\n]*$/gm)].map(([statement]) => statement);
    expect(imports[0]).toMatch(/^import '\.\/lib\/boot-blocked';?$/);
  });
});
