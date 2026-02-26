import React, { useState } from 'react';
import { Circle, CheckCircle2, Calendar, Trash2, GripVertical, Shield, MessageSquare } from 'lucide-react';
import type { Task, Priority } from '../../types';
import { PRIORITY_COLORS } from '../../types';
import { ConfirmDialog } from '../Common/ConfirmDialog';
import { ClsBadge } from '../Common/ClsBadge';
import { isOverdue, cn } from '../../lib/utils';

interface TaskItemProps {
  task: Task;
  onToggleComplete: (id: string) => void;
  onSelect: (id: string) => void;
  onDelete: (id: string) => void;
  active?: boolean;
  draggable?: boolean;
  onDragStart?: (e: React.DragEvent) => void;
}

const priorityLabels: Record<Priority, string> = {
  none: '',
  low: 'Low',
  medium: 'Med',
  high: 'High',
};

export const TaskItem = React.memo(function TaskItem({ task, onToggleComplete, onSelect, onDelete, active, draggable, onDragStart }: TaskItemProps) {
  const [showConfirmDelete, setShowConfirmDelete] = useState(false);
  const overdue = isOverdue(task.dueDate) && !task.completed;

  return (
    <div
      className={cn(
        'flex items-center gap-2 px-3 py-2 rounded-lg border transition-colors group',
        active
          ? 'bg-accent/10 border-accent/30'
          : 'bg-gray-800/50 border-gray-800 hover:bg-gray-800 hover:border-gray-700',
        overdue && 'border-red-500/30'
      )}
      draggable={draggable}
      onDragStart={onDragStart}
    >
      {draggable && (
        <GripVertical size={14} className="text-gray-600 cursor-grab shrink-0" />
      )}

      <button
        onClick={(e) => { e.stopPropagation(); onToggleComplete(task.id); }}
        className={cn('shrink-0', task.completed ? 'text-green-400' : 'text-gray-500 hover:text-gray-300')}
        title={task.completed ? 'Mark incomplete' : 'Mark complete'}
      >
        {task.completed ? <CheckCircle2 size={18} /> : <Circle size={18} />}
      </button>

      <button
        onClick={() => onSelect(task.id)}
        className="flex-1 text-left min-w-0"
      >
        <span className={cn('text-sm', task.completed ? 'text-gray-500 line-through' : 'text-gray-200')}>
          {task.title || 'Untitled task'}
        </span>
      </button>

      <div className="flex items-center gap-2 shrink-0">
        {(task.iocAnalysis?.iocs.filter((i) => !i.dismissed).length ?? 0) > 0 && (
          <span className="flex items-center gap-0.5 text-[10px] text-accent bg-accent/10 px-1.5 py-0.5 rounded">
            <Shield size={10} />
            {task.iocAnalysis?.iocs.filter((i) => !i.dismissed).length}
          </span>
        )}
        {(task.comments?.length ?? 0) > 0 && (
          <span className="flex items-center gap-0.5 text-[10px] text-gray-400 bg-gray-700/50 px-1.5 py-0.5 rounded">
            <MessageSquare size={10} />
            {task.comments?.length}
          </span>
        )}
        {task.priority !== 'none' && (
          <span
            className="text-[10px] font-medium px-1.5 py-0.5 rounded"
            style={{ backgroundColor: PRIORITY_COLORS[task.priority] + '20', color: PRIORITY_COLORS[task.priority] }}
          >
            {priorityLabels[task.priority]}
          </span>
        )}
        {task.clsLevel && <ClsBadge level={task.clsLevel} />}
        {task.dueDate && (
          <span className={cn('flex items-center gap-1 text-[10px]', overdue ? 'text-red-400' : 'text-gray-500')}>
            <Calendar size={10} />
            {new Date(task.dueDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
          </span>
        )}
        {task.tags.slice(0, 2).map((tag) => (
          <span key={tag} className="text-[10px] text-accent/70 bg-accent/10 px-1.5 rounded-full">
            {tag}
          </span>
        ))}
        <button
          onClick={(e) => { e.stopPropagation(); setShowConfirmDelete(true); }}
          className="opacity-0 group-hover:opacity-100 p-1 rounded hover:bg-gray-700 text-gray-500 hover:text-red-400"
          title="Delete task"
        >
          <Trash2 size={12} />
        </button>
      </div>

      <ConfirmDialog
        open={showConfirmDelete}
        onClose={() => setShowConfirmDelete(false)}
        onConfirm={() => onDelete(task.id)}
        title="Delete Task"
        message="This task will be permanently deleted. This cannot be undone."
        confirmLabel="Delete Task"
        danger
      />
    </div>
  );
});
