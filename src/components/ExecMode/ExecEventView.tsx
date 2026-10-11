import { lazy, Suspense, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Share2 } from 'lucide-react';
import type { TimelineEvent } from '../../types';
import { TIMELINE_EVENT_TYPE_LABELS, CONFIDENCE_LEVELS } from '../../types';
import { renderMarkdown } from '../../lib/markdown';
import { formatFullDate } from '../../lib/utils';
import { ExecDetailNav } from './ExecDetailNav';

const LazyExecEventMap = lazy(() => import('./ExecEventMap').then(module => ({ default: module.ExecEventMap })));

interface ExecEventViewProps {
  event: TimelineEvent;
  onBack: () => void;
  onShare?: () => void;
  currentIndex?: number;
  totalCount?: number;
  onNavigate?: (direction: 'prev' | 'next') => void;
}

export function ExecEventView({ event, onShare, currentIndex, totalCount, onNavigate }: ExecEventViewProps) {
  const { t } = useTranslation('exec');
  const typeInfo = TIMELINE_EVENT_TYPE_LABELS[event.eventType] ?? { label: event.eventType, color: '#6b7280', icon: '📌' };
  const confInfo = (CONFIDENCE_LEVELS as Record<string, { label: string; color: string }>)[event.confidence] || { label: event.confidence, color: '#6b7280' };

  const descHtml = useMemo(
    () => event.description ? renderMarkdown(event.description) : null,
    [event.description],
  );

  return (
    <div className="flex flex-col gap-3">
      {onShare && (
        <div className="flex justify-end">
          <button onClick={onShare} className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-accent bg-accent/10 active:bg-accent/20 text-xs font-medium">
            <Share2 size={14} />
            Share
          </button>
        </div>
      )}

      <h2 className="text-lg font-bold text-text-primary">{event.title || t('events.untitled')}</h2>

      <div className="flex flex-wrap gap-2">
        <span className="text-xs font-semibold px-2 py-0.5 rounded-full" style={{ backgroundColor: (typeInfo?.color ?? '#6b7280') + '33', color: typeInfo?.color ?? '#6b7280' }}>
          {typeInfo?.label ?? event.eventType}
        </span>
        <span className="text-xs font-semibold px-2 py-0.5 rounded-full" style={{ backgroundColor: (confInfo?.color ?? '#6b7280') + '33', color: confInfo?.color ?? '#6b7280' }}>
          {confInfo?.label ?? event.confidence}
        </span>
        {event.clsLevel && <span className="text-xs font-semibold text-accent-amber bg-accent-amber/10 px-2 py-0.5 rounded-full">{event.clsLevel}</span>}
      </div>

      <div className="flex flex-wrap gap-x-4 gap-y-1 text-[10px] text-text-muted">
        <span>{t('events.timestamp', { date: formatFullDate(event.timestamp) })}</span>
        {event.timestampEnd && <span>{t('events.end', { date: formatFullDate(event.timestampEnd) })}</span>}
        {event.source && <span>{t('events.source', { source: event.source })}</span>}
      </div>

      {event.actor && <p className="text-xs text-text-secondary"><span className="font-semibold">{t('events.actor')}</span> {event.actor}</p>}

      {event.assets.length > 0 && (
        <p className="text-xs text-text-secondary"><span className="font-semibold">{t('events.assets')}</span> {event.assets.join(', ')}</p>
      )}

      {event.mitreAttackIds.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {event.mitreAttackIds.map((id) => (
            <span key={id} className="text-[10px] font-mono bg-red-500/10 text-red-400 px-2 py-0.5 rounded-full">{id}</span>
          ))}
        </div>
      )}

      {event.tags.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {event.tags.map((tag) => (
            <span key={tag} className="text-[10px] bg-accent/10 text-accent px-2 py-0.5 rounded-full">#{tag}</span>
          ))}
        </div>
      )}

      {descHtml && (
        <div className="bg-bg-raised rounded-xl p-4 markdown-preview" dangerouslySetInnerHTML={{ __html: descHtml }} />
      )}

      {event.latitude != null && event.longitude != null && (
        <div className="rounded-xl overflow-hidden border border-border-subtle" style={{ height: 200 }}>
          <Suspense fallback={<div role="status" className="h-full flex items-center justify-center text-text-muted text-xs">{t('common:loading')}</div>}>
            <LazyExecEventMap latitude={event.latitude} longitude={event.longitude} color={typeInfo?.color ?? '#6b7280'} />
          </Suspense>
        </div>
      )}

      {onNavigate && totalCount != null && currentIndex != null && (
        <ExecDetailNav currentIndex={currentIndex} totalCount={totalCount} onPrev={() => onNavigate('prev')} onNext={() => onNavigate('next')} />
      )}
    </div>
  );
}
