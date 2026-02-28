import { describe, it, expect } from 'vitest';
import { renderMarkdown } from '../lib/markdown';
import type { WikiLinkTarget } from '../lib/markdown';

describe('renderMarkdown', () => {
  // ── Existing tests ──────────────────────────────────────────────

  it('renders basic markdown', () => {
    const html = renderMarkdown('# Hello\n\nWorld');
    expect(html).toContain('<h1>');
    expect(html).toContain('Hello');
    expect(html).toContain('<p>World</p>');
  });

  it('renders bold and italic', () => {
    const html = renderMarkdown('**bold** and _italic_');
    expect(html).toContain('<strong>bold</strong>');
    expect(html).toContain('<em>italic</em>');
  });

  it('renders code blocks with syntax highlighting', () => {
    const html = renderMarkdown('```js\nconst x = 1;\n```');
    expect(html).toContain('<pre>');
    expect(html).toContain('language-js');
    expect(html).toContain('hljs');
  });

  it('renders inline code', () => {
    const html = renderMarkdown('use `console.log`');
    expect(html).toContain('<code>console.log</code>');
  });

  it('renders links', () => {
    const html = renderMarkdown('[Google](https://google.com)');
    expect(html).toContain('href="https://google.com"');
    expect(html).toContain('Google');
  });

  it('renders lists', () => {
    const html = renderMarkdown('- item 1\n- item 2');
    expect(html).toContain('<ul>');
    expect(html).toContain('<li>');
    expect(html).toContain('item 1');
  });

  it('renders blockquotes', () => {
    const html = renderMarkdown('> This is a quote');
    expect(html).toContain('<blockquote>');
    expect(html).toContain('This is a quote');
  });

  it('sanitizes script tags (XSS prevention)', () => {
    const html = renderMarkdown('<script>alert("xss")</script>');
    expect(html).not.toContain('<script>');
  });

  it('sanitizes onerror handlers (XSS prevention)', () => {
    const html = renderMarkdown('<img src=x onerror="alert(1)">');
    expect(html).not.toContain('onerror');
  });

  it('sanitizes javascript: URIs (XSS prevention)', () => {
    const html = renderMarkdown('[click](javascript:alert(1))');
    expect(html).not.toContain('javascript:');
  });

  it('renders GFM tables', () => {
    const html = renderMarkdown('| A | B |\n|---|---|\n| 1 | 2 |');
    expect(html).toContain('<table>');
    expect(html).toContain('<th>');
    expect(html).toContain('<td>');
  });

  it('handles empty string', () => {
    const html = renderMarkdown('');
    expect(html).toBe('');
  });

  // ── Code blocks ─────────────────────────────────────────────────

  it('falls back to escaped text for unknown language', () => {
    const html = renderMarkdown('```unknownlang\n<div>hello</div>\n```');
    expect(html).toContain('<pre>');
    expect(html).toContain('class="hljs"');
    expect(html).not.toContain('language-unknownlang');
    // Angle brackets should be escaped since there is no hljs highlight pass
    expect(html).toContain('&lt;div&gt;');
    expect(html).toContain('&lt;/div&gt;');
  });

  it('renders python code blocks with syntax highlighting', () => {
    const html = renderMarkdown('```python\ndef greet(name):\n    return f"Hello {name}"\n```');
    expect(html).toContain('<pre>');
    expect(html).toContain('language-python');
    expect(html).toContain('hljs');
    // hljs wraps keywords in <span> elements
    expect(html).toContain('<span');
  });

  it('renders powershell code blocks via ps1 alias', () => {
    const html = renderMarkdown('```ps1\nGet-Process | Where-Object { $_.CPU -gt 10 }\n```');
    expect(html).toContain('<pre>');
    expect(html).toContain('language-ps1');
    expect(html).toContain('hljs');
    expect(html).toContain('<span');
  });

  // ── GFM features ────────────────────────────────────────────────

  it('renders task list checkboxes', () => {
    const html = renderMarkdown('- [x] done\n- [ ] todo');
    expect(html).toContain('<input');
    expect(html).toContain('type="checkbox"');
    // The checked item should have the checked attribute
    expect(html).toContain('checked');
    // The disabled attribute should be present (marked adds it by default)
    expect(html).toContain('disabled');
  });

  it('renders GFM line breaks (single newline becomes <br>)', () => {
    const html = renderMarkdown('line one\nline two');
    expect(html).toContain('<br>');
    expect(html).toContain('line one');
    expect(html).toContain('line two');
  });

  it('renders strikethrough with <del>', () => {
    const html = renderMarkdown('~~removed~~');
    expect(html).toContain('<del>');
    expect(html).toContain('removed');
    expect(html).toContain('</del>');
  });

  // ── Security ────────────────────────────────────────────────────

  it('strips style attributes (FORBID_ATTR)', () => {
    const html = renderMarkdown('<div style="color:red">styled</div>');
    expect(html).not.toContain('style=');
    expect(html).not.toContain('color:red');
    expect(html).toContain('styled');
  });

  it('strips onload handlers', () => {
    const html = renderMarkdown('<img src="pic.png" onload="alert(1)">');
    expect(html).not.toContain('onload');
  });

  it('removes non-checkbox input elements (DOMPurify hook)', () => {
    const html = renderMarkdown('<input type="text" value="injected">');
    expect(html).not.toContain('type="text"');
    expect(html).not.toContain('injected');
  });

  it('removes iframe tags', () => {
    const html = renderMarkdown('<iframe src="https://evil.com"></iframe>');
    expect(html).not.toContain('<iframe');
    expect(html).not.toContain('evil.com');
  });

  // ── Misc ────────────────────────────────────────────────────────

  it('renders ordered lists as <ol>', () => {
    const html = renderMarkdown('1. first\n2. second\n3. third');
    expect(html).toContain('<ol>');
    expect(html).toContain('<li>');
    expect(html).toContain('first');
    expect(html).toContain('second');
    expect(html).toContain('third');
  });

  it('renders images with <img> and src', () => {
    const html = renderMarkdown('![alt text](https://example.com/image.png)');
    expect(html).toContain('<img');
    expect(html).toContain('src="https://example.com/image.png"');
    expect(html).toContain('alt="alt text"');
  });

  it('renders nested formatting (bold inside link)', () => {
    const html = renderMarkdown('[**bold link**](https://example.com)');
    expect(html).toContain('<a');
    expect(html).toContain('href="https://example.com"');
    expect(html).toContain('<strong>bold link</strong>');
  });

  // ── Wiki-links ──────────────────────────────────────────────────

  describe('wiki-links', () => {
    const sampleNotes: WikiLinkTarget[] = [
      { id: 'note-1', title: 'IOC Analysis' },
      { id: 'note-2', title: 'Threat Report' },
      { id: 'note-3', title: 'Malware Sample' },
    ];

    it('resolved wiki-link contains data-note-id and wiki-link class', () => {
      const html = renderMarkdown('See [[IOC Analysis]] for details', sampleNotes);
      expect(html).toContain('data-note-id="note-1"');
      expect(html).toContain('class="wiki-link"');
      expect(html).toContain('data-note-link="true"');
      expect(html).toContain('>IOC Analysis</a>');
    });

    it('case-insensitive matching', () => {
      const html = renderMarkdown('See [[ioc analysis]] for details', sampleNotes);
      expect(html).toContain('data-note-id="note-1"');
      expect(html).toContain('class="wiki-link"');
    });

    it('broken link has wiki-link-broken class and no data-note-id', () => {
      const html = renderMarkdown('See [[Nonexistent Note]]', sampleNotes);
      expect(html).toContain('class="wiki-link-broken"');
      expect(html).toContain('data-note-link="broken"');
      expect(html).not.toContain('data-note-id');
      expect(html).toContain('>Nonexistent Note</span>');
    });

    it('multiple wiki-links in one line', () => {
      const html = renderMarkdown('See [[IOC Analysis]] and [[Threat Report]]', sampleNotes);
      expect(html).toContain('data-note-id="note-1"');
      expect(html).toContain('data-note-id="note-2"');
    });

    it('wiki-links inside code fences are not processed', () => {
      const html = renderMarkdown('```\n[[IOC Analysis]]\n```', sampleNotes);
      expect(html).not.toContain('data-note-id');
      expect(html).not.toContain('wiki-link');
    });

    it('wiki-links inside inline code are not processed', () => {
      const html = renderMarkdown('Use `[[IOC Analysis]]` syntax', sampleNotes);
      expect(html).not.toContain('data-note-id');
      expect(html).not.toContain('class="wiki-link"');
    });

    it('backward compatible — no notes array means [[...]] passes through unchanged', () => {
      const html = renderMarkdown('See [[IOC Analysis]] for details');
      expect(html).not.toContain('data-note-id');
      expect(html).not.toContain('wiki-link');
      expect(html).toContain('[[IOC Analysis]]');
    });
  });
});
