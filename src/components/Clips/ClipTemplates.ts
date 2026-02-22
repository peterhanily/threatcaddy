export interface ClipTemplate {
  name: string;
  icon: string;
  content: string;
}

export const CLIP_TEMPLATES: ClipTemplate[] = [
  {
    name: 'Article',
    icon: '📰',
    content: `# Article Title

**Source:** [Link](url)
**Author:**
**Date:**

## Summary

## Key Points

-
-
-

## Quotes

>

## Notes

`,
  },
  {
    name: 'Bookmark',
    icon: '🔗',
    content: `# Bookmark

**URL:** [Link](url)
**Category:**
**Tags:**

## Description

## Why it's useful

`,
  },
  {
    name: 'Code Snippet',
    icon: '💻',
    content: `# Code Snippet

**Language:**
**Source:**

## Code

\`\`\`
// Paste code here
\`\`\`

## Explanation

## Usage

\`\`\`
// Example usage
\`\`\`
`,
  },
  {
    name: 'Quote',
    icon: '💬',
    content: `# Quote

> "Quote text here"

**— Author**

**Source:**
**Context:**

## Reflection

`,
  },
  {
    name: 'Meeting Notes',
    icon: '📋',
    content: `# Meeting Notes

**Date:** ${new Date().toLocaleDateString()}
**Attendees:**

## Agenda

1.
2.
3.

## Discussion

## Action Items

- [ ]
- [ ]
- [ ]

## Next Meeting

`,
  },
];
