import { useState } from 'react';
import type { Task, TaskStatus } from '../../types';
import { TaskItem } from './TaskItem';
import { cn } from '../../lib/utils';

interface KanbanBoardProps {
  getTasksByStatus: (status: TaskStatus) => Task[];
  onToggleComplete: (id: string) => void;
  onSelect: (id: string) => void;
  onDelete: (id: string) => void;
  onUpdateTask: (id: string, updates: Partial<Task>) => void;
}

const COLUMNS: { status: TaskStatus; label: string; color: string }[] = [
  { status: 'todo', label: 'Todo', color: '#6b7280' },
  { status: 'in-progress', label: 'In Progress', color: '#eab308' },
  { status: 'done', label: 'Done', color: '#22c55e' },
];

export function KanbanBoard({ getTasksByStatus, onToggleComplete, onSelect, onDelete, onUpdateTask }: KanbanBoardProps) {
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
    <div className="flex gap-4 h-full overflow-x-auto pb-4">
      {COLUMNS.map(({ status, label, color }) => {
        const tasks = getTasksByStatus(status);
        return (
          <div
            key={status}
            className={cn(
              'flex-1 min-w-64 flex flex-col rounded-xl border transition-colors',
              dragOverColumn === status
                ? 'border-accent bg-accent/5'
                : 'border-gray-800 bg-gray-900/50'
            )}
            onDragOver={handleDragOver(status)}
            onDragLeave={handleDragLeave}
            onDrop={handleDrop(status)}
          >
            <div className="flex items-center gap-2 px-4 py-3 border-b border-gray-800">
              <span className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: color }} />
              <span className="text-sm font-medium text-gray-300">{label}</span>
              <span className="text-xs text-gray-500 ml-auto">{tasks.length}</span>
            </div>
            <div className="flex-1 overflow-y-auto p-2 space-y-1.5">
              {tasks.map((task) => (
                <TaskItem
                  key={task.id}
                  task={task}
                  onToggleComplete={onToggleComplete}
                  onSelect={onSelect}
                  onDelete={onDelete}
                  draggable
                  onDragStart={handleDragStart(task.id)}
                />
              ))}
              {tasks.length === 0 && (
                <p className="text-xs text-gray-600 text-center py-8">Drop tasks here</p>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
