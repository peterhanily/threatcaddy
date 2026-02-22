import { Marked } from 'marked';
import hljs from 'highlight.js';

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

export function renderMarkdown(content: string): string {
  return marked.parse(content) as string;
}
