import { Marked } from 'marked';
import hljs from 'highlight.js/lib/core';
import DOMPurify from 'dompurify';

// Load highlight.js CSS on first use (removed from index.css to avoid blocking initial render)
let hljsCssLoaded = false;
function ensureHljsCss() {
  if (hljsCssLoaded) return;
  hljsCssLoaded = true;
  import('highlight.js/styles/github-dark.min.css');
}

// Register commonly used languages (security/threat intel + general dev)
// These are kept synchronous so highlighting works immediately when this chunk loads.
// The chunk itself is code-split and only loaded when markdown rendering is needed.
import javascript from 'highlight.js/lib/languages/javascript';
import typescript from 'highlight.js/lib/languages/typescript';
import python from 'highlight.js/lib/languages/python';
import bash from 'highlight.js/lib/languages/bash';
import shell from 'highlight.js/lib/languages/shell';
import json from 'highlight.js/lib/languages/json';
import xml from 'highlight.js/lib/languages/xml';
import yaml from 'highlight.js/lib/languages/yaml';
import sql from 'highlight.js/lib/languages/sql';
import css from 'highlight.js/lib/languages/css';
import markdown from 'highlight.js/lib/languages/markdown';
import powershell from 'highlight.js/lib/languages/powershell';
import ini from 'highlight.js/lib/languages/ini';
import plaintext from 'highlight.js/lib/languages/plaintext';
import diff from 'highlight.js/lib/languages/diff';
import c from 'highlight.js/lib/languages/c';
import cpp from 'highlight.js/lib/languages/cpp';
import csharp from 'highlight.js/lib/languages/csharp';
import java from 'highlight.js/lib/languages/java';
import go from 'highlight.js/lib/languages/go';
import rust from 'highlight.js/lib/languages/rust';
import ruby from 'highlight.js/lib/languages/ruby';
import php from 'highlight.js/lib/languages/php';

hljs.registerLanguage('javascript', javascript);
hljs.registerLanguage('js', javascript);
hljs.registerLanguage('typescript', typescript);
hljs.registerLanguage('ts', typescript);
hljs.registerLanguage('python', python);
hljs.registerLanguage('py', python);
hljs.registerLanguage('bash', bash);
hljs.registerLanguage('sh', bash);
hljs.registerLanguage('shell', shell);
hljs.registerLanguage('json', json);
hljs.registerLanguage('xml', xml);
hljs.registerLanguage('html', xml);
hljs.registerLanguage('yaml', yaml);
hljs.registerLanguage('yml', yaml);
hljs.registerLanguage('sql', sql);
hljs.registerLanguage('css', css);
hljs.registerLanguage('markdown', markdown);
hljs.registerLanguage('md', markdown);
hljs.registerLanguage('powershell', powershell);
hljs.registerLanguage('ps1', powershell);
hljs.registerLanguage('ini', ini);
hljs.registerLanguage('toml', ini);
hljs.registerLanguage('plaintext', plaintext);
hljs.registerLanguage('text', plaintext);
hljs.registerLanguage('diff', diff);
hljs.registerLanguage('c', c);
hljs.registerLanguage('cpp', cpp);
hljs.registerLanguage('csharp', csharp);
hljs.registerLanguage('cs', csharp);
hljs.registerLanguage('java', java);
hljs.registerLanguage('go', go);
hljs.registerLanguage('rust', rust);
hljs.registerLanguage('rs', rust);
hljs.registerLanguage('ruby', ruby);
hljs.registerLanguage('rb', ruby);
hljs.registerLanguage('php', php);

const marked = new Marked({
  gfm: true,
  breaks: true,
  renderer: {
    code({ text, lang }) {
      const safeLang = lang?.replace(/[^a-zA-Z0-9_-]/g, '') || '';
      if (safeLang && hljs.getLanguage(safeLang)) {
        const highlighted = hljs.highlight(text, { language: safeLang }).value;
        return `<pre><code class="hljs language-${safeLang}">${highlighted}</code></pre>`;
      }
      const escaped = text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
      return `<pre><code class="hljs">${escaped}</code></pre>`;
    },
  },
});

// Only allow checkbox inputs (for GFM task lists), remove all others
DOMPurify.addHook('afterSanitizeAttributes', (node) => {
  if (node.tagName === 'INPUT' && node.getAttribute('type') !== 'checkbox') {
    node.remove();
  }
});

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

export interface WikiLinkTarget {
  id: string;
  title: string;
}

/**
 * Replace [[title]] wiki-links with HTML anchors, skipping code fences and inline code.
 * Resolved links get a clickable anchor; unresolved get a dimmed span.
 */
export function preprocessWikiLinks(content: string, notes: WikiLinkTarget[]): string {
  // Build case-insensitive title → target map
  const titleMap = new Map<string, WikiLinkTarget>();
  for (const n of notes) {
    titleMap.set(n.title.toLowerCase(), n);
  }

  // Split on code fences and inline code to skip those regions
  // Match: fenced code (``` ... ```) or inline code (` ... `)
  const parts = content.split(/(```[\s\S]*?```|`[^`]+`)/);

  return parts.map((part, i) => {
    // Odd indices are code regions — pass through unchanged
    if (i % 2 === 1) return part;
    // Replace [[...]] in non-code regions
    return part.replace(/\[\[([^\]]+)\]\]/g, (_match, title: string) => {
      const target = titleMap.get(title.toLowerCase());
      if (target) {
        return `<a data-note-link="true" data-note-id="${escapeHtml(target.id)}" class="tclink">${escapeHtml(title)}</a>`;
      }
      return `<span data-note-link="broken" class="tclink-broken">${escapeHtml(title)}</span>`;
    });
  }).join('');
}

export function renderMarkdown(content: string, wikiLinkTargets?: WikiLinkTarget[]): string {
  // Load highlight.js CSS on first use (lazy-loaded to avoid blocking initial render)
  ensureHljsCss();
  const processed = wikiLinkTargets ? preprocessWikiLinks(content, wikiLinkTargets) : content;
  const raw = marked.parse(processed) as string;
  return DOMPurify.sanitize(raw, {
    ADD_TAGS: ['input'],
    ADD_ATTR: ['type', 'checked', 'disabled', 'class', 'data-note-link', 'data-note-id'],
    FORBID_ATTR: ['style', 'onerror', 'onload'],
  });
}
