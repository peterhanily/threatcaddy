import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import type { Plugin } from 'vite';

export interface BootGuardMessages { framed: string; fileOnly: string; open: string }

const KEYS: Record<keyof BootGuardMessages, string> = {
  framed: 'bootGuard.framed',
  fileOnly: 'bootGuard.fileOnly',
  open: 'bootGuard.open',
};
const RTL = ['ar', 'fa', 'he'];
const CSP_META = /<meta\s+http-equiv="Content-Security-Policy"[^>]*>/i;

/** The notice text in every shipped language, read from common.json. */
export function bootGuardMessages(localesDir: string): Record<string, BootGuardMessages> {
  const messages: Record<string, BootGuardMessages> = {};
  const languages = readdirSync(localesDir, { withFileTypes: true }).filter(entry => entry.isDirectory()).map(entry => entry.name).sort();
  for (const language of languages) {
    const common = JSON.parse(readFileSync(join(localesDir, language, 'common.json'), 'utf8')) as Record<string, unknown>;
    const entry = {} as BootGuardMessages;
    for (const [name, key] of Object.entries(KEYS) as [keyof BootGuardMessages, string][]) {
      const value = common[key];
      if (typeof value !== 'string' || !value.trim()) throw new Error(`Boot guard message ${key} is missing for ${language}`);
      entry[name] = value;
    }
    messages[language] = entry;
  }
  if (!messages.en) throw new Error('Boot guard requires the English messages');
  return messages;
}

/** A classic script that runs before every other script on the page. When
 * the page is framed, or the standalone copy is not opened from a file, the
 * rest of the document, the app's styles and code included, becomes the text
 * of a hidden <plaintext> element: no later script runs, reads storage or
 * renders the app. (window.stop() would leave Chromium painting nothing and
 * WebKit loading forever.) A short notice links to ThreatCaddy in the top
 * window. The language follows the browser: the saved setting is in storage. */
export function bootGuardScript({ standalone, messages }: { standalone: boolean; messages: Record<string, BootGuardMessages> }): string {
  const json = (value: unknown) => JSON.stringify(value).replace(/</g, '\\u003c');
  return `(function () {
  var framed;
  try { framed = window.top !== window.self; } catch (error) { framed = true; }
  var misplaced = ${standalone} && location.protocol !== 'file:';
  if (!framed && !misplaced) return;
  document.documentElement.setAttribute('data-boot-blocked', '');
  document.write('<plaintext hidden>');
  var messages = ${json(messages)};
  var codes = Object.keys(messages);
  var match = function (tag) {
    tag = String(tag || '').toLowerCase().replace(/_/g, '-');
    if (tag === 'zh' || tag === 'zh-hans' || tag === 'zh-hans-cn') tag = 'zh-cn';
    for (var i = 0; i < codes.length; i++) if (codes[i].toLowerCase() === tag) return codes[i];
    if (/^[a-z]{2,3}-[a-z]{4}(?:-|$)/.test(tag)) return '';
    for (i = 0; i < codes.length; i++) if (codes[i].toLowerCase() === tag.split('-')[0]) return codes[i];
    return '';
  };
  var preferred = navigator.languages && navigator.languages.length ? navigator.languages : [navigator.language];
  var language = 'en';
  for (var i = 0; i < preferred.length; i++) if (match(preferred[i])) { language = match(preferred[i]); break; }
  var text = messages[language];
  var root = document.documentElement;
  root.lang = language;
  root.dir = ${json(RTL)}.indexOf(language) < 0 ? 'ltr' : 'rtl';
  document.title = 'ThreatCaddy';
  // The browser's own opaque colours, so neither the system scheme nor a
  // framing page's background can make the notice unreadable.
  root.style.colorScheme = 'light dark';
  var body = document.body;
  body.style.cssText = 'margin:0;min-height:100vh;box-sizing:border-box;padding:16px;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:12px;text-align:center;font:15px/1.5 system-ui,sans-serif;background:Canvas;color:CanvasText';
  var notice = body.appendChild(document.createElement('p'));
  notice.style.cssText = 'margin:0;max-width:32rem';
  notice.textContent = misplaced ? text.fileOnly : text.framed;
  var link = body.appendChild(document.createElement('a'));
  link.href = misplaced ? new URL('./', location.href).href : location.href;
  link.target = '_top';
  link.textContent = text.open;
})();`;
}

/** Inserts the guard directly after the page's Content-Security-Policy meta,
 * so that policy covers it and it runs before every other script. */
export function bootGuard({ standalone, localesDir }: { standalone: boolean; localesDir: string }): Plugin {
  return {
    name: 'threatcaddy-boot-guard',
    transformIndexHtml: {
      order: 'pre',
      handler(html) {
        const meta = CSP_META.exec(html);
        if (!meta) throw new Error('The boot guard must follow the Content-Security-Policy meta.');
        const end = meta.index + meta[0].length;
        const script = bootGuardScript({ standalone, messages: bootGuardMessages(localesDir) });
        return `${html.slice(0, end)}\n    <script>${script}</script>${html.slice(end)}`;
      },
    },
  };
}
