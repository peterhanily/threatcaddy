import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent, type RefObject } from 'react';
import { looseText, sameText } from '../../lib/identity-model';
import { MENTION_START, type FolderIndex } from '../../lib/identity-match';
import { getCaretCoordinates } from './slashCommands';
import type { LinkCandidate } from './LinkAutocompleteMenu';

/** How far back from the cursor an `@` is looked for, and how many names are offered. */
const MAX_QUERY = 60;
const MAX_ITEMS = 20;
/** Keys that move the cursor without typing: the menu closes rather than insert at a stale place. */
const CARET_KEYS = new Set(['ArrowLeft', 'ArrowRight', 'Home', 'End', 'PageUp', 'PageDown']);

/** Whether the cursor is in inline code or a code fence, where `@` suggests nothing. */
function inCode(value: string, cursor: number): boolean {
  const before = value.slice(0, cursor);
  return (before.match(/```/g)?.length ?? 0) % 2 === 1 || (before.replace(/```/g, '').match(/`/g)?.length ?? 0) % 2 === 1;
}

/**
 * `@` in the note editor suggests the identities of the note's investigation and inserts
 * `@Name`, which the preview shows as a link (owner decision 1: only the text is stored).
 */
export function useMentionAutocomplete({ textareaRef, content, folder, onContentChange }: {
  textareaRef: RefObject<HTMLTextAreaElement | null>;
  content: string;
  folder: FolderIndex | undefined;
  onContentChange: (value: string) => void;
}) {
  const menuRef = useRef<HTMLDivElement>(null);
  const [trigger, setTrigger] = useState<{ at: number; query: string; position: { top: number; left: number } } | null>(null);
  const [activeIndex, setActiveIndex] = useState(0);
  // After a mention is inserted, the cursor goes after it as soon as the new text is on screen,
  // before the next keystroke (a timer could fire after typing has already continued).
  const pendingCursor = useRef<number | null>(null);
  useLayoutEffect(() => {
    const textarea = textareaRef.current;
    const cursor = pendingCursor.current;
    if (!textarea || cursor === null || textarea.value.length < cursor) return;
    pendingCursor.current = null;
    textarea.setSelectionRange(cursor, cursor);
    textarea.focus();
  });

  const items = useMemo<LinkCandidate[]>(() => {
    if (!trigger || !folder) return [];
    const wanted = looseText(trigger.query);
    const scored = folder.identities.flatMap(identity => {
      const names = [identity.name, ...identity.aliases].map(looseText);
      if (wanted && !names.some(name => name.includes(wanted))) return [];
      return [{ identity, prefix: !wanted || names.some(name => name.startsWith(wanted)) }];
    });
    // Only the name is stored, so a name two identities share is offered once (it links to both).
    const seen = new Set<string>();
    return scored.sort((a, b) => Number(b.prefix) - Number(a.prefix))
      .filter(({ identity }) => !seen.has(sameText(identity.name)) && !!seen.add(sameText(identity.name)))
      .slice(0, MAX_ITEMS).map(({ identity }) => ({ id: identity.id, title: identity.name }));
  }, [trigger, folder]);

  const detect = useCallback((value: string, cursor: number) => {
    if (!folder?.identities.length || inCode(value, cursor)) { setTrigger(null); return; }
    for (let at = cursor - 1; at >= Math.max(0, cursor - 1 - MAX_QUERY); at--) {
      const character = value[at];
      if (character === '\n') break;
      if (character !== '@') continue;
      if (at > 0 && !MENTION_START.test(value[at - 1])) break;
      const query = value.slice(at + 1, cursor);
      if (/\s{2}/.test(query)) break;
      setTrigger({ at, query, position: textareaRef.current ? getCaretCoordinates(textareaRef.current, at) : { top: 0, left: 0 } });
      setActiveIndex(0);
      return;
    }
    setTrigger(null);
  }, [folder, textareaRef]);

  const select = useCallback((item: LinkCandidate) => {
    const textarea = textareaRef.current;
    if (!textarea || !trigger) return;
    // The cursor must still be after the same "@", or the insert would land in the wrong place.
    const cursor = textarea.selectionStart;
    if (content[trigger.at] !== '@' || cursor <= trigger.at || /\n/.test(content.slice(trigger.at, cursor))) { setTrigger(null); return; }
    // A handle stored with its "@" ("@ghost_ledger") is inserted once, not as "@@ghost_ledger".
    const insert = `${item.title.startsWith('@') ? '' : '@'}${item.title} `;
    onContentChange(content.slice(0, trigger.at) + insert + content.slice(cursor));
    pendingCursor.current = trigger.at + insert.length;
    setTrigger(null);
  }, [content, onContentChange, textareaRef, trigger]);

  // A click outside the menu closes it.
  const open = !!trigger && items.length > 0;
  useEffect(() => {
    if (!open) return;
    const handler = (event: MouseEvent) => { if (!menuRef.current?.contains(event.target as Node)) setTrigger(null); };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  /** Handles the menu's keys; returns whether the key was used. */
  const handleKeyDown = useCallback((event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (!trigger || items.length === 0) return false;
    // Enter that finishes an input-method composition (Japanese, Chinese, Korean…) is not a choice.
    if (event.nativeEvent.isComposing) return false;
    if (CARET_KEYS.has(event.key)) { setTrigger(null); return false; }
    if (event.key === 'ArrowDown') setActiveIndex(index => Math.min(index + 1, items.length - 1));
    else if (event.key === 'ArrowUp') setActiveIndex(index => Math.max(index - 1, 0));
    else if (event.key === 'Enter' || event.key === 'Tab') select(items[Math.min(activeIndex, items.length - 1)]);
    else if (event.key === 'Escape') setTrigger(null);
    else return false;
    event.preventDefault();
    return true;
  }, [trigger, items, activeIndex, select]);

  return { open, items, activeIndex, position: trigger?.position ?? { top: 0, left: 0 },
    menuRef, detect, select, handleKeyDown, close: () => setTrigger(null) };
}
