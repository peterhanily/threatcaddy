import { useState, useEffect, useMemo } from 'react';
import { ListChecks, LayoutGrid, Plus, Filter, ArrowUpDown } from 'lucide-react';
import type { Task, Note, TimelineEvent, TaskStatus, TaskViewMode, Tag, Folder, InvestigationMember } from '../../types';
import { TaskItem } from './TaskItem';
import { TaskForm } from './TaskForm';
import { KanbanBoard } from './KanbanBoard';
import { Modal } from '../Common/Modal';
import { cn } from '../../lib/utils';
import { Virtuoso } from 'react-virtuoso';

interface TaskListProps {
  tasks: Task[];
  allTags: Tag[];
  folders: Folder[];
  onCreateTag: (name: string) => Promise<Tag>;
  onToggleComplete: (id: string) => void;
  onUpdateTask: (id: string, updates: Partial<Task>) => void;
  onDeleteTask: (id: string) => void;
  onTrashTask?: (id: string) => void;
  onRestoreTask?: (id: string) => void;
  onToggleArchiveTask?: (id: string) => void;
  onCreateTask: (data: Partial<Task>) => void;
  viewMode: TaskViewMode;
  onViewModeChange: (mode: TaskViewMode) => void;
  getTasksByStatus: (status: TaskStatus) => Task[];
  allNotes?: Note[];
  allTimelineEvents?: TimelineEvent[];
  scopeLabel?: string;
  selectedFolderId?: string;
  openNewForm?: boolean;
  onNewFormOpened?: () => void;
  members?: InvestigationMember[];
  currentUserId?: string;
}

export function TaskListView({
  tasks,
  allTags,
  folders,
  onCreateTag,
  onToggleComplete,
  onUpdateTask,
  onDeleteTask,
  onTrashTask,
  onRestoreTask,
  onToggleArchiveTask,
  onCreateTask,
  viewMode,
  onViewModeChange,
  getTasksByStatus,
  allNotes,
  allTimelineEvents,
  scopeLabel,
  selectedFolderId,
  openNewForm,
  onNewFormOpened,
  members,
  currentUserId,
}: TaskListProps) {
  const [editingTask, setEditingTask] = useState<Task | null>(null);
  const [showNewTask, setShowNewTask] = useState(false);

  // Open creation form when triggered externally (e.g. from header "+ New" dropdown)
  useEffect(() => {
    if (!openNewForm) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- intentional: syncing external prop to local modal state
    setShowNewTask(true);
    onNewFormOpened?.();
  }, [openNewForm, onNewFormOpened]);
  const [statusFilter, setStatusFilter] = useState<TaskStatus | ''>('');
  const [assigneeFilter, setAssigneeFilter] = useState<string>('');
  const [sortBy, setSortBy] = useState<'order' | 'dueDate' | 'priority' | 'updatedAt'>('order');

  const filteredTasks = useMemo(() => {
    const filtered = tasks.filter((t) => {
      if (statusFilter && t.status !== statusFilter) return false;
      if (assigneeFilter === '__me__' && t.assigneeId !== currentUserId) return false;
      if (assigneeFilter && assigneeFilter !== '__me__' && t.assigneeId !== assigneeFilter) return false;
      return true;
    });

    if (sortBy === 'order') return filtered;

    return [...filtered].sort((a, b) => {
      if (sortBy === 'dueDate') {
        if (!a.dueDate && !b.dueDate) return 0;
        if (!a.dueDate) return 1;
        if (!b.dueDate) return -1;
        return new Date(a.dueDate).getTime() - new Date(b.dueDate).getTime();
      }
      if (sortBy === 'priority') {
        const order = { high: 0, medium: 1, low: 2, none: 3 };
        return (order[a.priority] ?? 3) - (order[b.priority] ?? 3);
      }
      if (sortBy === 'updatedAt') {
        return b.updatedAt - a.updatedAt;
      }
      return 0;
    });
  }, [tasks, statusFilter, assigneeFilter, currentUserId, sortBy]);

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
      <div className="flex items-center gap-1.5 px-3 py-2 border-b border-gray-800 shrink-0">
        <span className="text-sm font-medium text-gray-300 hidden sm:inline">
          {scopeLabel ? `Tasks \u2014 ${scopeLabel} (${tasks.length})` : `Tasks (${tasks.length})`}
        </span>
        <span className="text-sm font-medium text-gray-300 sm:hidden">{tasks.length}</span>

        <div className="flex items-center gap-0.5 ml-1">
          <button
            onClick={() => onViewModeChange('list')}
            className={cn('p-1 rounded', viewMode === 'list' ? 'bg-gray-700 text-gray-200' : 'text-gray-500 hover:text-gray-300')}
            title="List view"
            aria-label="List view"
          >
            <ListChecks size={16} />
          </button>
          <button
            onClick={() => onViewModeChange('kanban')}
            className={cn('p-1 rounded', viewMode === 'kanban' ? 'bg-gray-700 text-gray-200' : 'text-gray-500 hover:text-gray-300')}
            title="Kanban view"
            aria-label="Kanban view"
          >
            <LayoutGrid size={16} />
          </button>
        </div>

        {viewMode === 'list' && (
          <div className="flex items-center gap-1 ml-1">
            <Filter size={14} className="text-gray-500 hidden sm:block" />
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value as TaskStatus | '')}
              className="bg-gray-800 border border-gray-700 rounded px-1.5 py-1 text-xs text-gray-300 focus:outline-none"
              aria-label="Filter by status"
            >
              <option value="">All</option>
              <option value="todo">To Do</option>
              <option value="in-progress">In Progress</option>
              <option value="done">Done</option>
            </select>
            <ArrowUpDown size={14} className="text-gray-500 hidden sm:block ml-1" />
            <select
              value={sortBy}
              onChange={(e) => setSortBy(e.target.value as typeof sortBy)}
              className="bg-gray-800 border border-gray-700 rounded px-1.5 py-1 text-xs text-gray-300 focus:outline-none"
              aria-label="Sort by"
            >
              <option value="order">Default</option>
              <option value="dueDate">Due Date</option>
              <option value="priority">Priority</option>
              <option value="updatedAt">Last Updated</option>
            </select>
            {members && members.length > 0 && (
              <select
                value={assigneeFilter}
                onChange={(e) => setAssigneeFilter(e.target.value)}
                className="bg-gray-800 border border-gray-700 rounded px-1.5 py-1 text-xs text-gray-300 focus:outline-none"
                aria-label="Filter by assignee"
              >
                <option value="">All assignees</option>
                {currentUserId && <option value="__me__">Assigned to me</option>}
                {members.map((m) => (
                  <option key={m.userId} value={m.userId}>{m.displayName}</option>
                ))}
              </select>
            )}
          </div>
        )}

        <button
          onClick={() => setShowNewTask(true)}
          className="ml-auto flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-accent hover:bg-accent-hover text-white text-sm font-medium transition-colors"
          aria-label="New task"
        >
          <Plus size={14} />
          <span className="hidden sm:inline">New Task</span>
        </button>
      </div>

      {/* Content */}
      <div className={cn('flex-1 p-4', viewMode === 'list' ? 'overflow-hidden' : 'overflow-y-auto')}>
        {viewMode === 'list' ? (
          <div className="max-w-3xl mx-auto h-full">
            {filteredTasks.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-16 text-gray-600">
                <ListChecks size={32} className="mb-2" />
                <p className="text-sm">No tasks yet</p>
                <p className="text-xs mt-1">Click "New Task" or press Ctrl+Shift+T</p>
              </div>
            ) : (
              <Virtuoso
                data={filteredTasks}
                itemContent={(_index, task) => (
                  <div className="pb-1.5">
                    <TaskItem
                      task={task}
                      onToggleComplete={onToggleComplete}
                      onSelect={handleSelect}
                      onDelete={onDeleteTask}
                      onTrash={onTrashTask}
                      onRestore={onRestoreTask}
                      onToggleArchive={onToggleArchiveTask}
                      members={members}
                    />
                  </div>
                )}
              />
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
            onUpdateTask={(id, updates) => {
              onUpdateTask(id, updates);
              setEditingTask((prev) => prev && prev.id === id ? { ...prev, ...updates } : prev);
            }}
            onDelete={(id) => { onDeleteTask(id); setEditingTask(null); }}
            allNotes={allNotes}
            allTimelineEvents={allTimelineEvents}
            investigationMembers={members}
          />
        )}
      </Modal>

      {/* New Task Modal */}
      <Modal open={showNewTask} onClose={() => setShowNewTask(false)} title="Create Task" wide>
        <TaskForm
          folders={folders}
          allTags={allTags}
          onCreateTag={onCreateTag}
          onSave={handleSaveNew}
          onCancel={() => setShowNewTask(false)}
          defaultFolderId={selectedFolderId}
          investigationMembers={members}
        />
      </Modal>

    </div>
  );
}
