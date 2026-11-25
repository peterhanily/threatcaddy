import { useMemo, useCallback } from 'react';
import { renderMarkdown } from '../../lib/markdown';
import type { WikiLinkTarget } from '../../lib/markdown';
import { extractIOCs, refangToDefanged } from '../../lib/ioc-extractor';
import type { Note, IOCEntry } from '../../types';
import { useIdentityLinks } from '../Identities/identity-links';
import { sameText } from '../../lib/identity-model';

const NETWORK_IOC_TYPES = new Set(['url', 'domain', 'ipv4', 'ipv6', 'email']);

interface MarkdownPreviewProps {
  content: string;
  defanged?: boolean;
  allNotes?: Note[];
  onNavigateToNote?: (noteId: string) => void;
  /** Pre-extracted IOCs — avoids redundant extraction when available */
  iocs?: IOCEntry[];
  /** The note's investigation: `@Name` mentions of its identities become links. */
  folderId?: string;
}

export function MarkdownPreview({ content, defanged, allNotes, onNavigateToNote, iocs: preExtractedIOCs, folderId }: MarkdownPreviewProps) {
  const identityLinks = useIdentityLinks();
  const identityFolder = identityLinks?.folder(folderId);
  const wikiLinkTargets = useMemo<WikiLinkTarget[] | undefined>(() => {
    if (!allNotes) return undefined;
    return allNotes
      .filter((n) => !n.trashed)
      .map((n) => ({ id: n.id, title: n.title }));
  }, [allNotes]);

  const html = useMemo(() => {
    let src = content;
    if (defanged) {
      // Use pre-extracted IOCs if available, otherwise extract (cached)
      const iocs = preExtractedIOCs ?? extractIOCs(content);
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
    return renderMarkdown(src, wikiLinkTargets, { identities: identityFolder });
  }, [content, defanged, wikiLinkTargets, preExtractedIOCs, identityFolder]);

  const handleClick = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    const mention = (e.target as HTMLElement).closest('a[data-identity-link="true"]');
    if (mention) {
      e.preventDefault();
      const identity = identityFolder?.identities.find((item) => item.id === mention.getAttribute('data-identity-id'));
      // A name more than one identity holds opens the list filtered to it, so a person chooses.
      const name = (mention.textContent ?? '').replace(/^@/, '');
      // A handle stored with its "@" ("@ghost_ledger") is keyed with it, as findMentions looks it up.
      const holders = identityFolder?.names.get(sameText(name)) ?? identityFolder?.names.get(sameText(`@${name}`));
      const ambiguous = (holders?.length ?? 0) > 1;
      if (identity) identityLinks?.open(identity, ambiguous ? name : undefined);
      return;
    }
    if (!onNavigateToNote) return;
    const target = (e.target as HTMLElement).closest('a[data-note-link="true"]');
    if (!target) return;
    e.preventDefault();
    const noteId = target.getAttribute('data-note-id');
    if (noteId) onNavigateToNote(noteId);
  }, [onNavigateToNote, identityFolder, identityLinks]);

  return (
    <div
      className="markdown-preview text-gray-200 prose-invert"
      dangerouslySetInnerHTML={{ __html: html }}
      onClick={handleClick}
    />
  );
}
