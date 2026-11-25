import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { liveQuery } from 'dexie';
import { summarizeToolChange, type ChangeField, type ToolChange } from '../../lib/tool-change-summary';
import { prepareIdentityLabels } from '../../lib/llm-tools-identities';
import { isolate } from '../Identities/identity-labels';
import { IsolatedText } from '../Identities/identity-ui';

/** What a proposed write changes, named by what it touches (approval cards, agent and chat). */
export function ToolChangeSummary({ tool, input, folderId, className = '' }: { tool: string; input: Record<string, unknown>; folderId?: string; className?: string }) {
  const { t } = useTranslation('common');
  const [change, setChange] = useState<ToolChange | null>(null);
  useEffect(() => {
    // Live: a rename or edit of what the call touches shows at once. The private-label strings load
    // first (outside the live query), as the tool loads them before it writes.
    let current = true;
    let subscription: { unsubscribe(): void } | undefined;
    void prepareIdentityLabels().then(() => {
      if (!current) return;
      subscription = liveQuery(() => summarizeToolChange(tool, input, folderId)).subscribe({
        next: result => setChange(result),
        error: () => { /* The card still shows the raw input. */ },
      });
    });
    return () => { current = false; subscription?.unsubscribe(); };
  }, [tool, input, folderId]);
  if (!change) return null;
  // The sentence reads in the interface's direction, each stored name and value isolated: a name written
  // right to left must not swap the two sides of "X reports to Y", or the two ends of an arrow.
  const heading = change.kind === 'connects' ? t('toolChange.connects', { from: isolate(change.from), phrase: change.phrase, to: isolate(change.to) })
    : change.kind === 'missing' ? t('toolChange.missing', { id: isolate(change.id) }) : t(`toolChange.${change.kind}`, { name: isolate(change.name) });
  const value = (field: ChangeField) => field.items
    ? field.items.map(item => (item.private ? `${isolate(item.text)} (${t('toolChange.private')})` : isolate(item.text))).join(', ')
    : field.changed ? t('toolChange.changed') : field.from !== undefined ? `${isolate(field.from)} → ${isolate(field.to ?? '')}` : isolate(field.to ?? '');
  return (
    <div className={`text-xs ${className}`} data-testid="tool-change-summary">
      <p className="font-medium text-text-primary break-words"><IsolatedText text={heading} /></p>
      {change.fields.length > 0 && (
        <ul className="mt-0.5 space-y-0.5 text-text-secondary">
          {change.fields.map(field => <li key={field.field} className="break-words"><span dir="ltr" className="font-mono">{field.field}</span>: <IsolatedText text={value(field)} /></li>)}
        </ul>
      )}
    </div>
  );
}
