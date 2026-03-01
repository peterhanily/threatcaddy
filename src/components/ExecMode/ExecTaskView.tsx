import { useMemo } from 'react';
import { ArrowLeft } from 'lucide-react';
import type { Task } from '../../types';
import { PRIORITY_COLORS } from '../../types';
import { renderMarkdown } from '../../lib/markdown';
import { formatFullDate, isOverdue, cn } from '../../lib/utils';

interface ExecTaskViewProps {
  task: Task;
  onBack: () => void;
}

const STATUS_BADGE: Record<string, { label: string; bg: string; text: string }> = {
  'todo':        { label: 'To Do',       bg: 'bg-text-muted/20', text: 'text-text-muted' },
  'in-progress': { label: 'In Progress', bg: 'bg-accent-amber/20', text: 'text-accent-amber' },
  'done':        { label: 'Done',        bg: 'bg-accent-green/20', text: 'text-accent-green' },
};

export function ExecTaskView({ task, onBack }: ExecTaskViewProps) {
  const descHtml = useMemo(
    () => task.description ? renderMarkdown(task.description) : null,
    [task.description],
  );

  const statusInfo = STATUS_BADGE[task.status] ?? STATUS_BADGE['todo'];
  const overdue = isOverdue(task.dueDate);

  return (
    <div className="flex flex-col gap-3">
      <button onClick={onBack} className="flex items-center gap-2 text-text-secondary active:text-text-primary -ml-1">
        <ArrowLeft size={18} />
        <span className="text-sm">Back</span>
      </button>

      <h2 className="text-lg font-bold text-text-primary">{task.title || 'Untitled'}</h2>

      <div className="flex flex-wrap gap-2">
        <span className={cn('text-xs font-semibold px-2 py-0.5 rounded-full', statusInfo.bg, statusInfo.text)}>{statusInfo.label}</span>
        {task.priority !== 'none' && (
          <span className="text-xs font-semibold px-2 py-0.5 rounded-full" style={{ backgroundColor: PRIORITY_COLORS[task.priority] + '33', color: PRIORITY_COLORS[task.priority] }}>
            {task.priority.charAt(0).toUpperCase() + task.priority.slice(1)} Priority
          </span>
        )}
        {task.clsLevel && <span className="text-xs font-semibold text-accent-amber bg-accent-amber/10 px-2 py-0.5 rounded-full">{task.clsLevel}</span>}
      </div>

      <div className="flex flex-wrap gap-x-4 gap-y-1 text-[10px] text-text-muted">
        <span>Created {formatFullDate(task.createdAt)}</span>
        <span>Updated {formatFullDate(task.updatedAt)}</span>
        {task.completedAt && <span>Completed {formatFullDate(task.completedAt)}</span>}
        {task.dueDate && (
          <span className={overdue ? 'text-red-400 font-semibold' : ''}>
            Due {task.dueDate}{overdue ? ' (OVERDUE)' : ''}
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
          <h3 className="text-sm font-semibold text-text-primary mb-2">Comments ({task.comments.length})</h3>
          <div className="flex flex-col gap-2">
            {task.comments.map((comment) => (
              <div key={comment.id} className="border-l-2 border-border-subtle pl-3">
                <p className="text-xs text-text-secondary">{comment.text}</p>
                <p className="text-[10px] text-text-muted mt-0.5">{formatFullDate(comment.createdAt)}</p>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
