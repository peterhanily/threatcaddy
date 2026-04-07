import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Share2 } from 'lucide-react';
import type { StandaloneIOC } from '../../types';
import { IOC_TYPE_LABELS, CONFIDENCE_LEVELS, IOC_STATUS_LABELS, IOC_STATUS_COLORS } from '../../types';
import { renderMarkdown } from '../../lib/markdown';
import { formatFullDate } from '../../lib/utils';
import { ExecDetailNav } from './ExecDetailNav';

interface ExecIOCViewProps {
  ioc: StandaloneIOC;
  allIOCs: StandaloneIOC[];
  onBack: () => void;
  onShare?: () => void;
  currentIndex?: number;
  totalCount?: number;
  onNavigate?: (direction: 'prev' | 'next') => void;
}

export function ExecIOCView({ ioc, allIOCs, onShare, currentIndex, totalCount, onNavigate }: ExecIOCViewProps) {
  const { t } = useTranslation('exec');
  const typeInfo = (IOC_TYPE_LABELS as Record<string, { label: string; color: string }>)[ioc.type] || { label: ioc.type, color: '#6b7280' };
  const confInfo = (CONFIDENCE_LEVELS as Record<string, { label: string; color: string }>)[ioc.confidence] || { label: ioc.confidence, color: '#6b7280' };
  const statusLabel = ioc.iocStatus ? IOC_STATUS_LABELS[ioc.iocStatus as keyof typeof IOC_STATUS_LABELS] : null;
  const statusColor = ioc.iocStatus ? IOC_STATUS_COLORS[ioc.iocStatus as keyof typeof IOC_STATUS_COLORS] : null;

  const notesHtml = useMemo(
    () => ioc.analystNotes ? renderMarkdown(ioc.analystNotes) : null,
    [ioc.analystNotes],
  );

  const resolvedRelationships = useMemo(() => {
    if (!ioc.relationships?.length) return [];
    return ioc.relationships.map((rel) => {
      const target = allIOCs.find((i) => i.id === rel.targetIOCId);
      return { ...rel, targetValue: target?.value, targetType: target?.type };
    }).filter((r) => r.targetValue);
  }, [ioc.relationships, allIOCs]);

  return (
    <div className="flex flex-col gap-3">
      {/* Share button */}
      {onShare && (
        <div className="flex justify-end">
          <button onClick={onShare} className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-accent bg-accent/10 active:bg-accent/20 text-xs font-medium">
            <Share2 size={14} />
            Share
          </button>
        </div>
      )}

      {/* IOC value */}
      <h2 className="text-lg font-bold text-text-primary font-mono break-all">{ioc.value}</h2>

      {/* Badges */}
      <div className="flex flex-wrap gap-2">
        <span className="text-xs font-semibold px-2 py-0.5 rounded-full" style={{ backgroundColor: (typeInfo?.color ?? '#6b7280') + '33', color: typeInfo?.color }}>
          {typeInfo?.label ?? ioc.type}
        </span>
        <span className="text-xs font-semibold px-2 py-0.5 rounded-full" style={{ backgroundColor: (confInfo?.color ?? '#6b7280') + '33', color: confInfo?.color }}>
          {confInfo?.label ?? ioc.confidence}
        </span>
        {statusLabel && statusColor && (
          <span className="text-xs font-semibold px-2 py-0.5 rounded-full" style={{ backgroundColor: statusColor + '33', color: statusColor }}>
            {statusLabel}
          </span>
        )}
        {ioc.clsLevel && <span className="text-xs font-semibold text-accent-amber bg-accent-amber/10 px-2 py-0.5 rounded-full">{ioc.clsLevel}</span>}
      </div>

      {/* Metadata */}
      <div className="flex flex-wrap gap-x-4 gap-y-1 text-[10px] text-text-muted">
        <span>{t('iocs.created', { date: formatFullDate(ioc.createdAt) })}</span>
        <span>{t('iocs.updated', { date: formatFullDate(ioc.updatedAt) })}</span>
        {ioc.attribution && <span>{t('iocs.attribution', { value: ioc.attribution })}</span>}
        {ioc.iocSubtype && <span>{t('iocs.subtype', { value: ioc.iocSubtype })}</span>}
      </div>

      {/* Tags */}
      {ioc.tags.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {ioc.tags.map((tag) => (
            <span key={tag} className="text-[10px] bg-accent/10 text-accent px-2 py-0.5 rounded-full">#{tag}</span>
          ))}
        </div>
      )}

      {/* Analyst notes */}
      {notesHtml && (
        <div>
          <h3 className="text-sm font-semibold text-text-primary mb-2">{t('iocs.analystNotes')}</h3>
          <div className="bg-bg-raised rounded-xl p-4 markdown-preview" dangerouslySetInnerHTML={{ __html: notesHtml }} />
        </div>
      )}

      {/* Relationships */}
      {resolvedRelationships.length > 0 && (
        <div className="bg-bg-raised rounded-xl p-4">
          <h3 className="text-sm font-semibold text-text-primary mb-2">{t('iocs.relationships', { count: resolvedRelationships.length })}</h3>
          <div className="flex flex-col gap-2">
            {resolvedRelationships.map((rel, i) => {
              const targetTypeInfo = rel.targetType ? IOC_TYPE_LABELS[rel.targetType] : null;
              return (
                <div key={i} className="flex items-center gap-2 text-xs">
                  <span className="text-text-muted">{rel.relationshipType || 'related-to'}</span>
                  {targetTypeInfo && (
                    <span className="text-[9px] font-bold px-1.5 py-0.5 rounded" style={{ backgroundColor: targetTypeInfo.color + '22', color: targetTypeInfo.color }}>{targetTypeInfo.label}</span>
                  )}
                  <span className="font-mono text-text-primary truncate">{rel.targetValue}</span>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Comments */}
      {ioc.comments && ioc.comments.length > 0 && (
        <div className="bg-bg-raised rounded-xl p-4">
          <h3 className="text-sm font-semibold text-text-primary mb-2">{t('iocs.comments', { count: ioc.comments.length })}</h3>
          <div className="flex flex-col gap-2">
            {ioc.comments.map((comment) => (
              <div key={comment.id} className="border-l-2 border-border-subtle pl-3">
                <p className="text-xs text-text-secondary">{comment.content}</p>
                <p className="text-[10px] text-text-muted mt-0.5">{formatFullDate(comment.createdAt)}</p>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Linked entities summary */}
      {((ioc.linkedNoteIds?.length ?? 0) + (ioc.linkedTaskIds?.length ?? 0) + (ioc.linkedTimelineEventIds?.length ?? 0)) > 0 && (
        <div className="flex flex-wrap gap-3 text-[10px] text-text-muted">
          {(ioc.linkedNoteIds?.length ?? 0) > 0 && <span>{ioc.linkedNoteIds!.length} linked note{ioc.linkedNoteIds!.length !== 1 ? 's' : ''}</span>}
          {(ioc.linkedTaskIds?.length ?? 0) > 0 && <span>{ioc.linkedTaskIds!.length} linked task{ioc.linkedTaskIds!.length !== 1 ? 's' : ''}</span>}
          {(ioc.linkedTimelineEventIds?.length ?? 0) > 0 && <span>{ioc.linkedTimelineEventIds!.length} linked event{ioc.linkedTimelineEventIds!.length !== 1 ? 's' : ''}</span>}
        </div>
      )}

      {/* Prev/Next navigation */}
      {onNavigate && totalCount != null && currentIndex != null && (
        <ExecDetailNav
          currentIndex={currentIndex}
          totalCount={totalCount}
          onPrev={() => onNavigate('prev')}
          onNext={() => onNavigate('next')}
        />
      )}
    </div>
  );
}
