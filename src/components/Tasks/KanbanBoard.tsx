import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { Task, TaskStatus } from '../../types';
import { TaskItem } from './TaskItem';
import { cn } from '../../lib/utils';
import { useIsMobile } from '../../hooks/useIsMobile';

interface KanbanBoardProps {
  getTasksByStatus: (status: TaskStatus) => Task[];
  onToggleComplete: (id: string) => void;
  onSelect: (id: string) => void;
  onDelete: (id: string) => void;
  onUpdateTask: (id: string, updates: Partial<Task>) => void;
}

const COLUMNS: { status: TaskStatus; labelKey: string; color: string }[] = [
  { status: 'todo', labelKey: 'status.todo', color: '#6b7280' },
  { status: 'in-progress', labelKey: 'status.inProgress', color: '#eab308' },
  { status: 'done', labelKey: 'status.done', color: '#22c55e' },
];

export function KanbanBoard({ getTasksByStatus, onToggleComplete, onSelect, onDelete, onUpdateTask }: KanbanBoardProps) {
  const { t } = useTranslation('tasks');
  const isMobile = useIsMobile();
  const [draggedTaskId, setDraggedTaskId] = useState<string | null>(null);
  const [dragOverColumn, setDragOverColumn] = useState<TaskStatus | null>(null);

  const handleDragStart = (taskId: string) => (e: React.DragEvent) => {
    setDraggedTaskId(taskId);
    e.dataTransfer.effectAllowed = 'move';
  };

  const handleDragOver = (status: TaskStatus) => (e: React.DragEvent) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    setDragOverColumn(status);
  };

  const handleDragLeave = () => {
    setDragOverColumn(null);
  };

  const handleDrop = (status: TaskStatus) => (e: React.DragEvent) => {
    e.preventDefault();
    if (draggedTaskId) {
      onUpdateTask(draggedTaskId, { status });
    }
    setDraggedTaskId(null);
    setDragOverColumn(null);
  };

  return (
    <div className="flex flex-col md:flex-row gap-4 h-full overflow-x-auto pb-4" role="region" aria-label={t('kanban.boardLabel')}>
      {COLUMNS.map(({ status, labelKey, color }) => {
        const tasks = getTasksByStatus(status);
        const label = t(labelKey);
        return (
          <div
            key={status}
            className={cn(
              'flex-1 min-w-0 md:min-w-64 flex flex-col rounded-xl border transition-colors',
              dragOverColumn === status
                ? 'border-accent bg-accent/5'
                : 'border-gray-800 bg-gray-900/50'
            )}
            onDragOver={handleDragOver(status)}
            onDragLeave={handleDragLeave}
            onDrop={handleDrop(status)}
            role="group"
            aria-label={t('kanban.columnLabel', { label, count: tasks.length })}
          >
            <div className="flex items-center gap-2 px-4 py-3 border-b border-gray-800">
              <span className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: color }} aria-hidden="true" />
              <span className="text-sm font-medium text-gray-300">{label}</span>
              <span className="text-xs text-gray-500 ml-auto">{tasks.length}</span>
            </div>
            <div className="flex-1 overflow-y-auto p-2 space-y-1.5">
              {tasks.map((task) => (
                <div key={task.id}>
                  <TaskItem
                    task={task}
                    onToggleComplete={onToggleComplete}
                    onSelect={onSelect}
                    onDelete={onDelete}
                    draggable={!isMobile}
                    onDragStart={!isMobile ? handleDragStart(task.id) : undefined}
                  />
                  {isMobile && (
                    <select
                      value={task.status}
                      onChange={(e) => onUpdateTask(task.id, { status: e.target.value as TaskStatus })}
                      className="mt-1 w-full bg-gray-800 border border-gray-700 rounded px-2 py-1 text-xs text-gray-300 focus:outline-none focus:border-accent"
                      aria-label={t('kanban.changeStatus', { title: task.title })}
                    >
                      {COLUMNS.map((col) => (
                        <option key={col.status} value={col.status}>{t(col.labelKey)}</option>
                      ))}
                    </select>
                  )}
                </div>
              ))}
              {tasks.length === 0 && (
                <p className="text-xs text-gray-600 text-center py-8">{isMobile ? t('kanban.noTasks') : t('kanban.dropHere')}</p>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
