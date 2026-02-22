import { useState } from 'react';
import { ListChecks, LayoutGrid, Plus, Filter } from 'lucide-react';
import type { Task, TaskStatus, TaskViewMode, Tag, Folder } from '../../types';
import { TaskItem } from './TaskItem';
import { TaskForm } from './TaskForm';
import { KanbanBoard } from './KanbanBoard';
import { Modal } from '../Common/Modal';
import { cn } from '../../lib/utils';

interface TaskListProps {
  tasks: Task[];
  allTags: Tag[];
  folders: Folder[];
  onCreateTag: (name: string) => Promise<Tag>;
  onToggleComplete: (id: string) => void;
  onUpdateTask: (id: string, updates: Partial<Task>) => void;
  onDeleteTask: (id: string) => void;
  onCreateTask: (data: Partial<Task>) => void;
  viewMode: TaskViewMode;
  onViewModeChange: (mode: TaskViewMode) => void;
  getTasksByStatus: (status: TaskStatus) => Task[];
}

export function TaskListView({
  tasks,
  allTags,
  folders,
  onCreateTag,
  onToggleComplete,
  onUpdateTask,
  onDeleteTask,
  onCreateTask,
  viewMode,
  onViewModeChange,
  getTasksByStatus,
}: TaskListProps) {
  const [editingTask, setEditingTask] = useState<Task | null>(null);
  const [showNewTask, setShowNewTask] = useState(false);
  const [statusFilter, setStatusFilter] = useState<TaskStatus | ''>('');

  const filteredTasks = statusFilter
    ? tasks.filter((t) => t.status === statusFilter)
    : tasks;

  const handleSelect = (id: string) => {
    const task = tasks.find((t) => t.id === id);
    if (task) setEditingTask(task);
  };

  const handleSaveEdit = (data: Partial<Task>) => {
    if (editingTask) {
      onUpdateTask(editingTask.id, data);
      setEditingTask(null);
    }
  };

  const handleSaveNew = (data: Partial<Task>) => {
    onCreateTask(data);
    setShowNewTask(false);
  };

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      {/* Toolbar */}
      <div className="flex items-center gap-2 px-4 py-2 border-b border-gray-800 shrink-0">
        <span className="text-sm font-medium text-gray-300">Tasks ({tasks.length})</span>

        <div className="flex items-center gap-1 ml-2">
          <button
            onClick={() => onViewModeChange('list')}
            className={cn('p-1.5 rounded', viewMode === 'list' ? 'bg-gray-700 text-gray-200' : 'text-gray-500 hover:text-gray-300')}
            title="List view"
          >
            <ListChecks size={16} />
          </button>
          <button
            onClick={() => onViewModeChange('kanban')}
            className={cn('p-1.5 rounded', viewMode === 'kanban' ? 'bg-gray-700 text-gray-200' : 'text-gray-500 hover:text-gray-300')}
            title="Kanban view"
          >
            <LayoutGrid size={16} />
          </button>
        </div>

        {viewMode === 'list' && (
          <div className="flex items-center gap-1 ml-2">
            <Filter size={14} className="text-gray-500" />
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value as TaskStatus | '')}
              className="bg-gray-800 border border-gray-700 rounded px-2 py-1 text-xs text-gray-300 focus:outline-none"
            >
              <option value="">All</option>
              <option value="todo">Todo</option>
              <option value="in-progress">In Progress</option>
              <option value="done">Done</option>
            </select>
          </div>
        )}

        <button
          onClick={() => setShowNewTask(true)}
          className="ml-auto flex items-center gap-1 px-3 py-1.5 rounded-lg bg-accent hover:bg-accent-hover text-white text-sm font-medium transition-colors"
        >
          <Plus size={14} />
          New Task
        </button>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-4">
        {viewMode === 'list' ? (
          <div className="space-y-1.5 max-w-3xl mx-auto">
            {filteredTasks.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-16 text-gray-600">
                <ListChecks size={32} className="mb-2" />
                <p className="text-sm">No tasks yet</p>
                <p className="text-xs mt-1">Click "New Task" or press Ctrl+Shift+T</p>
              </div>
            ) : (
              filteredTasks.map((task) => (
                <TaskItem
                  key={task.id}
                  task={task}
                  onToggleComplete={onToggleComplete}
                  onSelect={handleSelect}
                  onDelete={onDeleteTask}
                />
              ))
            )}
          </div>
        ) : (
          <KanbanBoard
            getTasksByStatus={getTasksByStatus}
            onToggleComplete={onToggleComplete}
            onSelect={handleSelect}
            onDelete={onDeleteTask}
            onUpdateTask={onUpdateTask}
          />
        )}
      </div>

      {/* Edit Task Modal */}
      <Modal open={editingTask !== null} onClose={() => setEditingTask(null)} title="Edit Task" wide>
        {editingTask && (
          <TaskForm
            task={editingTask}
            folders={folders}
            allTags={allTags}
            onCreateTag={onCreateTag}
            onSave={handleSaveEdit}
            onCancel={() => setEditingTask(null)}
          />
        )}
      </Modal>

      {/* New Task Modal */}
      <Modal open={showNewTask} onClose={() => setShowNewTask(false)} title="New Task" wide>
        <TaskForm
          folders={folders}
          allTags={allTags}
          onCreateTag={onCreateTag}
          onSave={handleSaveNew}
          onCancel={() => setShowNewTask(false)}
        />
      </Modal>
    </div>
  );
}
