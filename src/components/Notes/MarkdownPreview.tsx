import { useMemo, useCallback } from 'react';
import { renderMarkdown } from '../../lib/markdown';
import type { WikiLinkTarget } from '../../lib/markdown';
import { extractIOCs, refangToDefanged } from '../../lib/ioc-extractor';
import type { Note } from '../../types';

const NETWORK_IOC_TYPES = new Set(['url', 'domain', 'ipv4', 'ipv6', 'email']);

interface MarkdownPreviewProps {
  content: string;
  defanged?: boolean;
  allNotes?: Note[];
  onNavigateToNote?: (noteId: string) => void;
}

export function MarkdownPreview({ content, defanged, allNotes, onNavigateToNote }: MarkdownPreviewProps) {
  const wikiLinkTargets = useMemo<WikiLinkTarget[] | undefined>(() => {
    if (!allNotes) return undefined;
    return allNotes
      .filter((n) => !n.trashed)
      .map((n) => ({ id: n.id, title: n.title }));
  }, [allNotes]);

  const html = useMemo(() => {
    let src = content;
    if (defanged) {
      const iocs = extractIOCs(content);
      const networkValues = iocs
        .filter((i) => NETWORK_IOC_TYPES.has(i.type))
        .map((i) => i.value);
      networkValues.sort((a, b) => b.length - a.length);
      let defangedContent = content;
      for (const value of networkValues) {
        defangedContent = defangedContent.replaceAll(value, refangToDefanged(value));
      }
      src = defangedContent;
    }
    return renderMarkdown(src, wikiLinkTargets);
  }, [content, defanged, wikiLinkTargets]);

  const handleClick = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    if (!onNavigateToNote) return;
    const target = (e.target as HTMLElement).closest('a[data-note-link="true"]');
    if (!target) return;
    e.preventDefault();
    const noteId = target.getAttribute('data-note-id');
    if (noteId) onNavigateToNote(noteId);
  }, [onNavigateToNote]);

  return (
    <div
      className="markdown-preview text-gray-200 prose-invert"
      dangerouslySetInnerHTML={{ __html: html }}
      onClick={handleClick}
    />
  );
}
