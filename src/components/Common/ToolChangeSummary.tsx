import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { liveQuery } from 'dexie';
import { summarizeToolChange, type ChangeField, type ToolChange } from '../../lib/tool-change-summary';
import { prepareIdentityLabels } from '../../lib/llm-tools-identities';

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
  const heading = change.kind === 'connects' ? t('toolChange.connects', { from: change.from, phrase: change.phrase, to: change.to })
    : change.kind === 'missing' ? t('toolChange.missing', { id: change.id }) : t(`toolChange.${change.kind}`, { name: change.name });
  const value = (field: ChangeField) => field.items
    ? field.items.map(item => (item.private ? `${item.text} (${t('toolChange.private')})` : item.text)).join(', ')
    : field.changed ? t('toolChange.changed') : field.from !== undefined ? `${field.from} → ${field.to}` : field.to;
  return (
    <div className={`text-xs ${className}`} data-testid="tool-change-summary">
      <p dir="auto" className="font-medium text-text-primary break-words">{heading}</p>
      {change.fields.length > 0 && (
        <ul className="mt-0.5 space-y-0.5 text-text-secondary">
          {change.fields.map(field => <li key={field.field} dir="auto" className="break-words"><span dir="ltr" className="font-mono">{field.field}</span>: {value(field)}</li>)}
        </ul>
      )}
    </div>
  );
}
