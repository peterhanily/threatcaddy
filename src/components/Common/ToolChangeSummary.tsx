import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { summarizeToolChange, type ChangeField, type ToolChange } from '../../lib/tool-change-summary';

/** What a proposed write changes, named by what it touches (approval cards, agent and chat). */
export function ToolChangeSummary({ tool, input, className = '' }: { tool: string; input: Record<string, unknown>; className?: string }) {
  const { t } = useTranslation('common');
  const [change, setChange] = useState<ToolChange | null>(null);
  useEffect(() => {
    let current = true;
    summarizeToolChange(tool, input).then(result => { if (current) setChange(result); }).catch(() => { /* The card still shows the raw input. */ });
    return () => { current = false; };
  }, [tool, input]);
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
