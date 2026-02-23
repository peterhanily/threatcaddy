import { Marked } from 'marked';
import hljs from 'highlight.js';
import DOMPurify from 'dompurify';

const marked = new Marked({
  gfm: true,
  breaks: true,
  renderer: {
    code({ text, lang }) {
      if (lang && hljs.getLanguage(lang)) {
        const highlighted = hljs.highlight(text, { language: lang }).value;
        return `<pre><code class="hljs language-${lang}">${highlighted}</code></pre>`;
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

export function renderMarkdown(content: string): string {
  const raw = marked.parse(content) as string;
  return DOMPurify.sanitize(raw, {
    ADD_TAGS: ['input'],
    ADD_ATTR: ['type', 'checked', 'disabled', 'class'],
    FORBID_ATTR: ['style', 'onerror', 'onload'],
  });
}
