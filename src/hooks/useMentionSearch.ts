import { useEffect, useMemo, useState } from 'react';
import { searchMentions, type MentionSuggestion } from '../lib/chat-mentions';

interface MentionSearch {
  type?: MentionSuggestion['type'];
  query: string;
  folderId?: string;
  scope: string;
}

/** Debounced local lookup, owned by this exact query, folder and composer. */
export function useMentionSearch({ type, query, folderId, scope }: MentionSearch): MentionSuggestion[] {
  const request = useMemo(() => ({ type, query, folderId, scope }), [type, query, folderId, scope]);
  const [completed, setCompleted] = useState<{ request: MentionSearch; items: MentionSuggestion[] } | null>(null);

  useEffect(() => {
    const type = request.type;
    if (!type) return;
    let active = true;
    const timer = setTimeout(() => {
      void searchMentions(type, request.query, request.folderId).then(
        items => { if (active) setCompleted({ request, items }); },
        () => { if (active) setCompleted({ request, items: [] }); },
      );
    }, 200);
    return () => { active = false; clearTimeout(timer); };
  }, [request]);

  // Hide the prior result during the render that changes ownership, before
  // effect cleanup runs. An already-started Dexie read cannot be aborted.
  return completed?.request === request && request.type ? completed.items : [];
}
