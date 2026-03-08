import { describe, it, expect } from 'vitest';
import { parseMarkdown } from '../lib/markdown-import';

// ── Single note import ──────────────────────────────────────────────

describe('single note import', () => {
  it('parses a simple markdown note with heading', () => {
    const result = parseMarkdown('# My Note\n\nSome content here');
    expect(result.notes).toHaveLength(1);
    expect(result.notes[0].title).toBe('My Note');
    expect(result.notes[0].content).toBe('Some content here');
  });

  it('uses entire content as body when no heading', () => {
    const result = parseMarkdown('No heading here\nJust text');
    expect(result.notes).toHaveLength(1);
    expect(result.notes[0].title).toBe('Untitled');
    expect(result.notes[0].content).toContain('No heading here');
  });

  it('uses defaultTitle when no heading and single note', () => {
    const result = parseMarkdown('Just some content', 'my-file.md');
    expect(result.notes).toHaveLength(1);
    expect(result.notes[0].title).toBe('my-file.md');
  });

  it('preserves multi-line content after heading', () => {
    const result = parseMarkdown('# Title\n\nLine 1\nLine 2\nLine 3');
    expect(result.notes[0].content).toBe('Line 1\nLine 2\nLine 3');
  });
});

// ── Multi-note split ────────────────────────────────────────────────

describe('multi-note split on ---', () => {
  it('splits multiple notes on horizontal rule', () => {
    const md = `# Note One

Content one

---

# Note Two

Content two`;
    const result = parseMarkdown(md);
    expect(result.notes).toHaveLength(2);
    expect(result.notes[0].title).toBe('Note One');
    expect(result.notes[1].title).toBe('Note Two');
  });

  it('handles three notes separated by ---', () => {
    const md = `# A

Content A

---

# B

Content B

---

# C

Content C`;
    const result = parseMarkdown(md);
    expect(result.notes).toHaveLength(3);
    expect(result.notes[2].title).toBe('C');
  });

  it('uses Untitled for sections without headings in multi-note', () => {
    const md = `# First Note

Content

---

No heading here`;
    const result = parseMarkdown(md);
    expect(result.notes).toHaveLength(2);
    expect(result.notes[1].title).toBe('Untitled');
  });

  it('skips empty sections between separators', () => {
    const md = `# Note One

Content

---

---

# Note Two

Content two`;
    const result = parseMarkdown(md);
    expect(result.notes).toHaveLength(2);
  });
});

// ── Title extraction ────────────────────────────────────────────────

describe('title extraction', () => {
  it('extracts title from first # heading', () => {
    const result = parseMarkdown('# My Title\n\nBody text');
    expect(result.notes[0].title).toBe('My Title');
  });

  it('ignores ## and deeper headings for title', () => {
    const result = parseMarkdown('## Sub Heading\n\nBody');
    expect(result.notes[0].title).toBe('Untitled');
    expect(result.notes[0].content).toContain('## Sub Heading');
  });

  it('handles heading with extra whitespace', () => {
    const result = parseMarkdown('#   Spaced Title  \n\nBody');
    expect(result.notes[0].title).toBe('Spaced Title');
  });

  it('skips leading blank lines to find heading', () => {
    const result = parseMarkdown('\n\n# Late Title\n\nBody');
    expect(result.notes[0].title).toBe('Late Title');
  });
});

// ── Frontmatter tag parsing ─────────────────────────────────────────

describe('frontmatter tag parsing', () => {
  it('extracts inline tags from YAML frontmatter', () => {
    const md = `---
tags: [malware, apt29]
---

# Note Title

Content here`;
    const result = parseMarkdown(md);
    expect(result.notes).toHaveLength(1);
    expect(result.notes[0].tags).toEqual(['malware', 'apt29']);
    expect(result.notes[0].title).toBe('Note Title');
  });

  it('extracts list-style tags from YAML frontmatter', () => {
    const md = `---
tags:
  - phishing
  - credential-theft
---

# Title

Body`;
    const result = parseMarkdown(md);
    expect(result.notes[0].tags).toEqual(['phishing', 'credential-theft']);
  });

  it('handles quoted tags in inline format', () => {
    const md = `---
tags: ['tag one', "tag two"]
---

Content`;
    const result = parseMarkdown(md);
    expect(result.notes[0].tags).toEqual(['tag one', 'tag two']);
  });

  it('applies frontmatter tags to all split notes', () => {
    const md = `---
tags: [shared-tag]
---

# Note A

Content A

---

# Note B

Content B`;
    const result = parseMarkdown(md);
    expect(result.notes).toHaveLength(2);
    expect(result.notes[0].tags).toEqual(['shared-tag']);
    expect(result.notes[1].tags).toEqual(['shared-tag']);
  });

  it('returns empty tags when no frontmatter', () => {
    const result = parseMarkdown('# Title\n\nContent');
    expect(result.notes[0].tags).toEqual([]);
  });
});

// ── Edge cases ──────────────────────────────────────────────────────

describe('edge cases', () => {
  it('returns empty notes for empty string', () => {
    const result = parseMarkdown('');
    expect(result.notes).toHaveLength(0);
  });

  it('returns empty notes for whitespace-only string', () => {
    const result = parseMarkdown('   \n\n  \t  ');
    expect(result.notes).toHaveLength(0);
  });

  it('handles Windows-style line endings', () => {
    const result = parseMarkdown('# Title\r\n\r\nContent\r\nMore');
    expect(result.notes).toHaveLength(1);
    expect(result.notes[0].title).toBe('Title');
  });

  it('handles frontmatter with no tags field', () => {
    const md = `---
author: analyst
---

# Title

Content`;
    const result = parseMarkdown(md);
    expect(result.notes[0].tags).toEqual([]);
    expect(result.notes[0].title).toBe('Title');
  });
});
