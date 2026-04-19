import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Share2 } from 'lucide-react';
import type { Task } from '../../types';
import { PRIORITY_COLORS } from '../../types';
import { renderMarkdown } from '../../lib/markdown';
import { formatFullDate, isOverdue, cn } from '../../lib/utils';
import { ExecDetailNav } from './ExecDetailNav';

interface ExecTaskViewProps {
  task: Task;
  onBack: () => void;
  onShare?: () => void;
  currentIndex?: number;
  totalCount?: number;
  onNavigate?: (direction: 'prev' | 'next') => void;
}

const STATUS_BADGE: Record<string, { labelKey: string; bg: string; text: string }> = {
  'todo':        { labelKey: 'tasks.todo',       bg: 'bg-text-muted/20', text: 'text-text-muted' },
  'in-progress': { labelKey: 'tasks.inProgress', bg: 'bg-accent-amber/20', text: 'text-accent-amber' },
  'done':        { labelKey: 'tasks.done',        bg: 'bg-accent-green/20', text: 'text-accent-green' },
};

export function ExecTaskView({ task, onShare, currentIndex, totalCount, onNavigate }: ExecTaskViewProps) {
  const { t } = useTranslation('exec');
  const descHtml = useMemo(
    () => task.description ? renderMarkdown(task.description) : null,
    [task.description],
  );

  const statusInfo = STATUS_BADGE[task.status] ?? STATUS_BADGE['todo'];
  const overdue = isOverdue(task.dueDate);

  return (
    <div className="flex flex-col gap-3">
      {onShare && (
        <div className="flex justify-end">
          <button onClick={onShare} className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-accent bg-accent/10 active:bg-accent/20 text-xs font-medium">
            <Share2 size={14} />
            {t('detail.share')}
          </button>
        </div>
      )}

      <h2 className="text-lg font-bold text-text-primary">{task.title || t('tasks.untitled')}</h2>

      <div className="flex flex-wrap gap-2">
        <span className={cn('text-xs font-semibold px-2 py-0.5 rounded-full', statusInfo.bg, statusInfo.text)}>{t(statusInfo.labelKey)}</span>
        {task.priority !== 'none' && (
          <span className="text-xs font-semibold px-2 py-0.5 rounded-full" style={{ backgroundColor: PRIORITY_COLORS[task.priority] + '33', color: PRIORITY_COLORS[task.priority] }}>
            {t('tasks.priority', { level: task.priority.charAt(0).toUpperCase() + task.priority.slice(1) })}
          </span>
        )}
        {task.clsLevel && <span className="text-xs font-semibold text-accent-amber bg-accent-amber/10 px-2 py-0.5 rounded-full">{task.clsLevel}</span>}
      </div>

      <div className="flex flex-wrap gap-x-4 gap-y-1 text-[10px] text-text-muted">
        <span>{t('tasks.created', { date: formatFullDate(task.createdAt) })}</span>
        <span>{t('tasks.updated', { date: formatFullDate(task.updatedAt) })}</span>
        {task.completedAt && <span>{t('tasks.completed', { date: formatFullDate(task.completedAt) })}</span>}
        {task.dueDate && (
          <span className={overdue ? 'text-red-400 font-semibold' : ''}>
            {t('tasks.due', { date: task.dueDate })}{overdue ? ` ${t('tasks.overdue')}` : ''}
          </span>
        )}
      </div>

      {task.tags.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {task.tags.map((tag) => (
            <span key={tag} className="text-[10px] bg-accent/10 text-accent px-2 py-0.5 rounded-full">#{tag}</span>
          ))}
        </div>
      )}

      {descHtml && (
        <div className="bg-bg-raised rounded-xl p-4 markdown-preview" dangerouslySetInnerHTML={{ __html: descHtml }} />
      )}

      {task.comments && task.comments.length > 0 && (
        <div className="bg-bg-raised rounded-xl p-4">
          <h3 className="text-sm font-semibold text-text-primary mb-2">{t('tasks.comments', { count: task.comments.length })}</h3>
          <div className="flex flex-col gap-2">
            {task.comments.map((comment) => (
              <div key={comment.id} className="border-l-2 border-border-subtle ps-3">
                <p className="text-xs text-text-secondary">{comment.text}</p>
                <p className="text-[10px] text-text-muted mt-0.5">{formatFullDate(comment.createdAt)}</p>
              </div>
            ))}
          </div>
        </div>
      )}

      {onNavigate && totalCount != null && currentIndex != null && (
        <ExecDetailNav currentIndex={currentIndex} totalCount={totalCount} onPrev={() => onNavigate('prev')} onNext={() => onNavigate('next')} />
      )}
    </div>
  );
}
