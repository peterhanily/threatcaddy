import type { OutputAsset, OutputBundle } from 'rollup';
import type { Plugin } from 'vite';

function text(asset: OutputAsset): string {
  return typeof asset.source === 'string' ? asset.source : new TextDecoder('utf-8', { fatal: true }).decode(asset.source);
}

function validateScriptText(code: string): void {
  // Follow the HTML script-content restriction: comment-open/comment-close
  // pairs are allowed, but a script opener inside them enters double-escaped
  // parsing. Preserve JavaScript bytes (including regex.source and tagged
  // template raw text) instead of blindly replacing text inside literals.
  // https://html.spec.whatwg.org/multipage/scripting.html#restrictions-for-contents-of-script-elements
  let comment = false;
  for (const match of code.matchAll(/<!--|-->|<\/?script[\t\n\f\r />]/gi)) {
    const token = match[0].toLowerCase();
    if (token.startsWith('</') || (comment && token.startsWith('<script'))) {
      throw new Error('Standalone script is not safe for direct HTML embedding.');
    }
    if (token === '<!--') comment = true;
    if (token === '-->') comment = false;
  }
  if (comment) throw new Error('Standalone script has an unbalanced HTML comment delimiter.');
}

function attributes(tag: string): Array<{ name: string; value?: string; source: string }> {
  const opening = /^<[a-z][\w:-]*\b([^>]*?)\/?>/i.exec(tag);
  if (!opening) throw new Error('Standalone HTML has an unsupported opening element.');
  let remaining = opening[1].trim();
  const seen = new Set<string>();
  const result: Array<{ name: string; value?: string; source: string }> = [];
  while (remaining) {
    // Generated Vite attributes are boolean or quoted. Refuse ambiguous or
    // duplicate attributes rather than leaving a second external reference.
    const match = /^([a-z_:][\w:.-]*)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'))?(?=\s|$)/i.exec(remaining);
    if (!match || seen.has(match[1].toLowerCase())) throw new Error('Standalone HTML has unsupported or duplicate attributes.');
    const name = match[1].toLowerCase();
    seen.add(name);
    result.push({ name, value: match[2] ?? match[3], source: match[0] });
    remaining = remaining.slice(match[0].length).trimStart();
  }
  return result;
}

/** Deliberately supports only this app's one-entry Vite build, not arbitrary
 * HTML or glob-selected assets. A changed output shape must fail the build
 * rather than produce a partially functional offline download. */
export function inlineStandaloneBundle(bundle: OutputBundle): void {
  const entries = Object.values(bundle);
  const htmlFiles = entries.filter((item): item is OutputAsset => item.type === 'asset' && item.fileName.endsWith('.html'));
  const styles = entries.filter((item): item is OutputAsset => item.type === 'asset' && item.fileName.endsWith('.css'));
  const scripts = entries.filter(item => item.type === 'chunk');
  if (htmlFiles.length !== 1 || scripts.length !== 1 || styles.length > 1 || entries.length !== 2 + styles.length) {
    throw new Error('Standalone build requires one HTML entry, one script and at most one stylesheet; no external emitted assets.');
  }
  const htmlFile = htmlFiles[0];
  const script = scripts[0];
  if (!script.isEntry || script.imports.length || script.dynamicImports.length || script.referencedFiles.length) {
    throw new Error('Standalone script must have no external imports or referenced assets.');
  }
  validateScriptText(script.code);
  if (script.code.includes('__VITE_PRELOAD__')) throw new Error('Standalone script contains an unfinished Vite preload marker.');
  const html = text(htmlFile);
  const edits: Array<{ start: number; end: number; replacement: string }> = [];
  const scriptTags = [...html.matchAll(/<script\b[^>]*\ssrc\s*=[^>]*>\s*<\/script\s*>/gi)];
  const allScriptSources = [...html.matchAll(/<script\b[^>]*\ssrc\s*=/gi)];
  if (scriptTags.length !== 1 || allScriptSources.length !== 1) {
    throw new Error('Standalone HTML must reference exactly one empty external script element.');
  }
  const scriptTag = scriptTags[0];
  const scriptAttrs = attributes(scriptTag[0]);
  const src = scriptAttrs.find(attr => attr.name === 'src')?.value;
  if ((src !== script.fileName && src !== `./${script.fileName}`) || scriptAttrs.find(attr => attr.name === 'type')?.value !== 'module') {
    throw new Error('Standalone HTML script reference does not match its emitted module.');
  }
  const scriptAttributes = scriptAttrs.filter(attr => attr.name !== 'src').map(attr => ` ${attr.source}`).join('');
  edits.push({ start: scriptTag.index, end: scriptTag.index + scriptTag[0].length, replacement: `<script${scriptAttributes}>${script.code}</script>` });

  let stylesheetCount = 0;
  for (const match of html.matchAll(/<link\b[^>]*>/gi)) {
    const linkAttrs = attributes(match[0]);
    const rel = linkAttrs.find(attr => attr.name === 'rel')?.value?.toLowerCase().split(/\s+/) ?? [];
    if (rel.includes('modulepreload')) throw new Error('Standalone HTML cannot depend on module preloads.');
    if (!rel.includes('stylesheet')) continue;
    const style = styles[0];
    const href = linkAttrs.find(attr => attr.name === 'href')?.value;
    if (!style || ++stylesheetCount !== 1 || (href !== style.fileName && href !== `./${style.fileName}`)) {
      throw new Error('Standalone stylesheet reference does not match its emitted asset.');
    }
    const css = text(style).replace(/^\s*@charset\s+["']UTF-8["'];/i, '');
    if (/<\/style[\s/>]/i.test(css)) throw new Error('Standalone CSS is not safe for direct HTML embedding.');
    const attrs = linkAttrs.filter(attr => attr.name !== 'rel' && attr.name !== 'href').map(attr => ` ${attr.source}`).join('');
    edits.push({ start: match.index, end: match.index + match[0].length, replacement: `<style${attrs}>${css}</style>` });
  }
  if (stylesheetCount !== styles.length) throw new Error('Standalone stylesheet was emitted but not referenced by HTML.');

  // Validate everything before changing/deleting any output. Offset-based
  // insertion preserves literal dollar signs and avoids rescanning script text.
  let output = html;
  for (const edit of edits.sort((a, b) => b.start - a.start)) {
    output = output.slice(0, edit.start) + edit.replacement + output.slice(edit.end);
  }
  htmlFile.source = output;
  delete bundle[script.fileName];
  for (const style of styles) delete bundle[style.fileName];
}

export function standaloneHtml(): Plugin {
  return {
    name: 'threatcaddy-standalone-html', enforce: 'post',
    // Run after Vite finalizes its internal preload markers.
    generateBundle: { order: 'post', handler(_options, bundle) { inlineStandaloneBundle(bundle); } },
  };
}
