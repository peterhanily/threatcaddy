import { createHash } from 'node:crypto';
import type { Plugin } from 'vite';

const SCRIPT = /<script\b([^>]*)>([\s\S]*?)<\/script\b[^>]*>/gi;
const SCRIPT_SRC = /(<meta\s+http-equiv="Content-Security-Policy"\s+content="[^"]*?\bscript-src\b)([^;"]*)/i;

/** CSP hash sources for every inline script the browser would run. Data
 * blocks such as the ld+json description never run, so need none. The parser
 * turns CRLF into LF before the browser hashes a script. */
export function inlineScriptHashes(html: string): string[] {
  const hashes = new Set<string>();
  for (const [, attributes, code] of html.matchAll(SCRIPT)) {
    if (/\ssrc\s*=/i.test(attributes)) continue;
    const type = /\stype\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i.exec(attributes);
    const value = (type?.[1] ?? type?.[2] ?? type?.[3] ?? '').trim().toLowerCase();
    if (value && value !== 'module' && !/^(?:text|application)\/(?:x-)?(?:java|ecma)script$/.test(value)) continue;
    hashes.add(`'sha256-${createHash('sha256').update(code.replace(/\r\n?/g, '\n'), 'utf8').digest('base64')}'`);
  }
  return [...hashes];
}

/** Allows exactly the page's own inline scripts, computed from the final HTML
 * so the policy cannot drift from them. Injected markup, inline handlers and
 * javascript: URLs stay blocked. */
export function cspScriptHashes(): Plugin {
  return {
    name: 'csp-inline-script-hashes',
    transformIndexHtml: {
      order: 'post',
      handler(html) {
        const directive = SCRIPT_SRC.exec(html);
        if (!directive) throw new Error('The hosted Content-Security-Policy needs a script-src directive.');
        if (directive[2].includes("'unsafe-inline'")) throw new Error("The hosted script-src must not allow 'unsafe-inline'.");
        const hashes = inlineScriptHashes(html);
        return html.replace(SCRIPT_SRC, (_match, start: string, sources: string) => `${start}${sources} ${hashes.join(' ')}`);
      },
    },
  };
}
