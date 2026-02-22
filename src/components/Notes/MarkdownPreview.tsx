import { useMemo } from 'react';
import { renderMarkdown } from '../../lib/markdown';

interface MarkdownPreviewProps {
  content: string;
}

export function MarkdownPreview({ content }: MarkdownPreviewProps) {
  const html = useMemo(() => renderMarkdown(content), [content]);

  return (
    <div
      className="markdown-preview text-gray-200 prose-invert"
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}
