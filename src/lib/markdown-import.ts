// --- Result types ---

export interface MarkdownNote {
  title: string;
  content: string;
  tags: string[];
}

export interface MarkdownImportResult {
  notes: MarkdownNote[];
}

// --- Frontmatter parsing ---

function parseFrontmatter(text: string): { tags: string[]; body: string } {
  // Check if the text starts with a YAML frontmatter block (--- at the very start)
  const frontmatterRegex = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/;
  const match = text.match(frontmatterRegex);

  if (!match) return { tags: [], body: text };

  const yaml = match[1];
  const body = text.slice(match[0].length);
  const tags: string[] = [];

  // Simple YAML tag parsing: look for "tags: [tag1, tag2]" or "tags:\n  - tag1\n  - tag2"
  const inlineMatch = yaml.match(/^tags:\s*\[([^\]]*)\]/m);
  if (inlineMatch) {
    const raw = inlineMatch[1];
    tags.push(
      ...raw
        .split(',')
        .map((t) => t.trim().replace(/^['"]|['"]$/g, ''))
        .filter(Boolean),
    );
  } else {
    // Check for list style
    const listMatch = yaml.match(/^tags:\s*\n((?:\s+-\s+.+\n?)*)/m);
    if (listMatch) {
      const lines = listMatch[1].split('\n');
      for (const line of lines) {
        const itemMatch = line.match(/^\s+-\s+(.+)/);
        if (itemMatch) {
          tags.push(itemMatch[1].trim().replace(/^['"]|['"]$/g, ''));
        }
      }
    }
  }

  return { tags, body };
}

// --- Title extraction ---

function extractTitle(content: string): { title: string; body: string } {
  const lines = content.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue; // skip blank lines

    const headingMatch = line.match(/^#\s+(.+)/);
    if (headingMatch) {
      const title = headingMatch[1].trim();
      const body = [...lines.slice(0, i), ...lines.slice(i + 1)].join('\n').trim();
      return { title, body };
    }
    break; // first non-empty line is not a heading
  }

  return { title: 'Untitled', body: content.trim() };
}

// --- Section splitting ---

function splitSections(text: string): string[] {
  // Split on horizontal rules (--- on its own line, with optional whitespace)
  // But only lines that are exactly "---" (with optional whitespace), not frontmatter delimiters
  const lines = text.split('\n');
  const sections: string[] = [];
  let current: string[] = [];

  for (const line of lines) {
    // A horizontal rule is a line with 3 or more dashes/asterisks/underscores and nothing else
    if (/^\s*---\s*$/.test(line) || /^\s*\*\*\*\s*$/.test(line) || /^\s*___\s*$/.test(line)) {
      const section = current.join('\n').trim();
      if (section) sections.push(section);
      current = [];
    } else {
      current.push(line);
    }
  }

  const last = current.join('\n').trim();
  if (last) sections.push(last);

  return sections;
}

// --- Main import function ---

export function parseMarkdown(text: string, defaultTitle?: string): MarkdownImportResult {
  if (!text || !text.trim()) {
    return { notes: [] };
  }

  // Parse frontmatter (only from the very beginning of the file)
  const { tags: frontmatterTags, body } = parseFrontmatter(text);

  // Split body into sections
  const sections = splitSections(body);

  if (sections.length === 0) {
    return { notes: [] };
  }

  const notes: MarkdownNote[] = [];

  for (const section of sections) {
    if (!section.trim()) continue;

    const { title, body: noteBody } = extractTitle(section);
    const finalTitle = title === 'Untitled' && defaultTitle && sections.length === 1
      ? defaultTitle
      : title;

    notes.push({
      title: finalTitle,
      content: noteBody,
      tags: [...frontmatterTags],
    });
  }

  return { notes };
}
