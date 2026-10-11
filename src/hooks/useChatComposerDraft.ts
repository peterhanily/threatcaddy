import { useCallback, useState, useSyncExternalStore, type SetStateAction } from 'react';
import { getComposerDraft, getComposerDrafts, subscribeComposerDrafts, setComposerText, commitComposerText, isComposerSubmitting } from '../lib/chat-composer-drafts';

export function useChatComposerDraft(scope: string) {
  const drafts = useSyncExternalStore(subscribeComposerDrafts, getComposerDrafts);
  const draft = drafts.get(scope) ?? getComposerDraft(scope);
  const [error, setError] = useState<'length' | 'total' | null>(null);
  const setText = useCallback((next: SetStateAction<string>) => {
    const text = typeof next === 'function' ? next(getComposerDraft(scope).text) : next;
    setError(setComposerText(scope, text));
  }, [scope]);
  const commit = useCallback(() => commitComposerText(scope, draft.revision), [scope, draft.revision]);
  return { text: draft.text, setText, commit, error, submitting: isComposerSubmitting(scope) };
}
