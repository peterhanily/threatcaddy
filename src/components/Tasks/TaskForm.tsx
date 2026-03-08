import { useState, useEffect } from 'react';
import { nanoid } from 'nanoid';
import { X, MessageSquare, Trash2, Search } from 'lucide-react';
import type { Task, Note, TimelineEvent, Priority, TaskStatus, Tag, Folder, IOCTarget, IOCAnalysis, IOCType, TaskComment, InvestigationMember } from '../../types';
import { TagInput } from '../Common/TagInput';
import { ConfirmDialog } from '../Common/ConfirmDialog';
import { IOCPanel } from '../Analysis/IOCPanel';
import { EntityLinker } from '../Common/EntityLinker';
import { extractIOCs, mergeIOCAnalysis } from '../../lib/ioc-extractor';
import { getEffectiveClsLevels } from '../../lib/classification';
import { useSettings } from '../../hooks/useSettings';
import { useAutoIOCExtraction } from '../../hooks/useAutoIOCExtraction';
import { cn } from '../../lib/utils';

interface TaskFormProps {
  task?: Task;
  folders: Folder[];
  allTags: Tag[];
  onCreateTag: (name: string) => Promise<Tag>;
  onSave: (data: Partial<Task>) => void;
  onCancel: () => void;
  onUpdateTask?: (id: string, updates: Partial<Task>) => void;
  onDelete?: (id: string) => void;
  allNotes?: Note[];
  allTimelineEvents?: TimelineEvent[];
  defaultFolderId?: string;
  investigationMembers?: InvestigationMember[];
}

function formatRelativeTime(ts: number): string {
  const diff = Date.now() - ts;
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

export function TaskForm({ task, folders, allTags, onCreateTag, onSave, onCancel, onUpdateTask, onDelete, allNotes = [], allTimelineEvents = [], defaultFolderId, investigationMembers }: TaskFormProps) {
  const { settings: taskFormSettings } = useSettings();
  const [title, setTitle] = useState(task?.title || '');
  const [description, setDescription] = useState(task?.description || '');
  const [priority, setPriority] = useState<Priority>(task?.priority || 'none');
  const [status, setStatus] = useState<TaskStatus>(task?.status || 'todo');
  const [dueDate, setDueDate] = useState(task?.dueDate || '');
  const [folderId, setFolderId] = useState(task?.folderId || defaultFolderId || '');
  const [tags, setTags] = useState<string[]>(task?.tags || []);
  const [clsLevel, setClsLevel] = useState(task?.clsLevel || '');
  const [assigneeId, setAssigneeId] = useState(task?.assigneeId || '');
  const [showIOCPanel, setShowIOCPanel] = useState(false);
  const [showConfirmDelete, setShowConfirmDelete] = useState(false);
  const [commentText, setCommentText] = useState('');

  const isEditMode = !!task;
  const iocCount = task?.iocAnalysis?.iocs.filter((i) => !i.dismissed).length ?? 0;
  const comments = task?.comments ?? [];

  // Auto-extract IOCs on description changes (edit mode only)
  useAutoIOCExtraction({
    entityId: task?.id,
    content: description,
    existingAnalysis: task?.iocAnalysis,
    onUpdate: (id, updates) => onUpdateTask?.(id, updates),
    enabled: isEditMode && !!onUpdateTask && taskFormSettings.tiAutoExtractEnabled !== false,
    enabledTypes: taskFormSettings.tiEnabledIOCTypes,
    defaultConfidence: taskFormSettings.tiDefaultConfidence,
    debounceMs: taskFormSettings.tiAutoExtractDebounceMs,
  });

  useEffect(() => {
    if (task) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setTitle(task.title);
      setDescription(task.description || '');
      setPriority(task.priority);
      setStatus(task.status);
      setDueDate(task.dueDate || '');
      setFolderId(task.folderId || '');
      setTags(task.tags);
      setClsLevel(task.clsLevel || '');
      setAssigneeId(task.assigneeId || '');
    }
  }, [task]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim()) return;
    onSave({
      title: title.trim(),
      description: description.trim() || undefined,
      priority,
      status,
      dueDate: dueDate || undefined,
      folderId: folderId || undefined,
      tags,
      clsLevel: clsLevel || undefined,
      assigneeId: assigneeId || undefined,
    });
  };

  const handleShieldClick = () => {
    if (!isEditMode || !task || !onUpdateTask) return;
    if (!showIOCPanel) {
      const fresh = extractIOCs(description);
      const merged = mergeIOCAnalysis(task.iocAnalysis, fresh);
      const iocTypes = [...new Set(merged.iocs.filter((i) => !i.dismissed).map((i) => i.type))];
      onUpdateTask(task.id, { iocAnalysis: merged, iocTypes });
    }
    setShowIOCPanel(!showIOCPanel);
  };

  const handleIOCUpdate = (id: string, updates: { iocAnalysis?: IOCAnalysis; iocTypes?: IOCType[] }) => {
    if (onUpdateTask) onUpdateTask(id, updates);
  };

  const handleAddComment = () => {
    if (!commentText.trim() || !task || !onUpdateTask) return;
    const newComment: TaskComment = {
      id: nanoid(),
      text: commentText.trim(),
      createdAt: Date.now(),
    };
    onUpdateTask(task.id, { comments: [...comments, newComment] });
    setCommentText('');
  };

  const handleDeleteComment = (commentId: string) => {
    if (!task || !onUpdateTask) return;
    onUpdateTask(task.id, { comments: comments.filter((c) => c.id !== commentId) });
  };

  const iocTarget: IOCTarget | null = task ? {
    id: task.id,
    title,
    content: description,
    clsLevel: task.clsLevel,
    iocAnalysis: task.iocAnalysis,
    iocTypes: task.iocTypes,
  } : null;

  const inputClass = 'w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-gray-200 focus:outline-none focus:border-accent';
  const labelClass = 'block text-xs font-medium text-gray-400 mb-1';

  return (
    <div className="flex gap-0">
      <form onSubmit={handleSubmit} className="space-y-4 flex-1 min-w-0">
        <div>
          <label className={labelClass}>Title</label>
          <input
            autoFocus
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            className={inputClass}
            placeholder="Task title..."
          />
        </div>

        <div>
          <div className="flex items-center gap-2 mb-1">
            <label className="text-xs font-medium text-gray-400">Description (markdown)</label>
            {isEditMode && onUpdateTask && (
              <button
                type="button"
                onClick={handleShieldClick}
                className={cn('p-1 rounded flex items-center gap-1', showIOCPanel ? 'bg-gray-700 text-accent' : 'text-gray-500 hover:text-gray-300')}
                title="IOC Analysis"
                aria-label="Toggle IOC analysis"
              >
                <Search size={14} />
                {iocCount > 0 && (
                  <span className="text-[10px] bg-accent/20 text-accent px-1 rounded-full">{iocCount}</span>
                )}
              </button>
            )}
          </div>
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            className={`${inputClass} h-24 resize-none note-editor`}
            placeholder="Optional description..."
          />
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className={labelClass}>Priority</label>
            <select value={priority} onChange={(e) => setPriority(e.target.value as Priority)} className={inputClass}>
              <option value="none">None</option>
              <option value="low">Low</option>
              <option value="medium">Medium</option>
              <option value="high">High</option>
            </select>
          </div>
          <div>
            <label className={labelClass}>Status</label>
            <select value={status} onChange={(e) => setStatus(e.target.value as TaskStatus)} className={inputClass}>
              <option value="todo">Todo</option>
              <option value="in-progress">In Progress</option>
              <option value="done">Done</option>
            </select>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className={labelClass}>Classification</label>
            <select value={clsLevel} onChange={(e) => setClsLevel(e.target.value)} className={inputClass}>
              <option value="">None</option>
              {getEffectiveClsLevels(taskFormSettings.tiClsLevels).map((v) => (
                <option key={v} value={v}>{v}</option>
              ))}
            </select>
          </div>
          <div>
            <label className={labelClass}>Due Date</label>
            <input
              type="date"
              value={dueDate}
              onChange={(e) => setDueDate(e.target.value)}
              className={inputClass}
            />
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className={labelClass}>Investigation</label>
            <select value={folderId} onChange={(e) => setFolderId(e.target.value)} className={inputClass}>
              <option value="">No investigation</option>
              {folders.map((f) => (
                <option key={f.id} value={f.id}>{f.name}</option>
              ))}
            </select>
          </div>
          {investigationMembers && investigationMembers.length > 0 && (
            <div>
              <label className={labelClass}>Assignee</label>
              <select value={assigneeId} onChange={(e) => setAssigneeId(e.target.value)} className={inputClass}>
                <option value="">Unassigned</option>
                {investigationMembers.map((m) => (
                  <option key={m.userId} value={m.userId}>{m.displayName}</option>
                ))}
              </select>
            </div>
          )}
        </div>

        <div>
          <label className={labelClass}>Tags</label>
          <TagInput
            selectedTags={tags}
            allTags={allTags}
            onChange={setTags}
            onCreateTag={onCreateTag}
          />
        </div>

        {/* Entity linking (edit mode only) */}
        {isEditMode && task && onUpdateTask && (
          <div>
            <label className="flex items-center gap-1.5 text-xs font-medium text-gray-400 mb-1">
              Linked Entities
            </label>
            <EntityLinker
              currentEntityId={task.id}
              linkedNoteIds={task.linkedNoteIds || []}
              linkedTaskIds={task.linkedTaskIds || []}
              linkedTimelineEventIds={task.linkedTimelineEventIds || []}
              allNotes={allNotes}
              allTasks={[]}
              allTimelineEvents={allTimelineEvents}
              onUpdateLinks={(links) => onUpdateTask(task.id, links)}
            />
          </div>
        )}

        {/* Comments section (edit mode only) */}
        {isEditMode && onUpdateTask && (
          <div>
            <label className="flex items-center gap-1.5 text-xs font-medium text-gray-400 mb-2">
              <MessageSquare size={12} />
              Comments {comments.length > 0 && `(${comments.length})`}
            </label>

            {comments.length > 0 && (
              <div className="space-y-2 mb-3 max-h-48 overflow-y-auto">
                {comments.map((c) => (
                  <div key={c.id} className="flex items-start gap-2 bg-gray-800/50 rounded-lg px-3 py-2">
                    <p className="text-xs text-gray-300 flex-1 whitespace-pre-wrap break-words">{c.text}</p>
                    <span className="text-[10px] text-gray-500 shrink-0">{formatRelativeTime(c.createdAt)}</span>
                    <button
                      type="button"
                      onClick={() => handleDeleteComment(c.id)}
                      className="p-0.5 rounded text-gray-600 hover:text-red-400 shrink-0"
                      title="Delete comment"
                      aria-label="Delete comment"
                    >
                      <X size={12} />
                    </button>
                  </div>
                ))}
              </div>
            )}

            <div className="flex gap-2">
              <input
                value={commentText}
                onChange={(e) => setCommentText(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleAddComment(); } }}
                className="flex-1 bg-gray-800 border border-gray-700 rounded-lg px-3 py-1.5 text-xs text-gray-200 focus:outline-none focus:border-accent"
                placeholder="Add a comment..."
              />
              <button
                type="button"
                onClick={handleAddComment}
                disabled={!commentText.trim()}
                className="px-3 py-1.5 rounded-lg bg-gray-700 hover:bg-gray-600 disabled:opacity-40 text-gray-200 text-xs transition-colors"
              >
                Add
              </button>
            </div>
          </div>
        )}

        <div className={cn('flex gap-3 pt-2', isEditMode && onDelete ? 'justify-between' : 'justify-end')}>
          {isEditMode && onDelete && task && (
            <button
              type="button"
              onClick={() => setShowConfirmDelete(true)}
              className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-red-500 hover:text-red-400 hover:bg-gray-800 text-sm"
              title="Delete task"
              aria-label="Delete task"
            >
              <Trash2 size={16} />
            </button>
          )}
          <div className="flex gap-3">
            <button
              type="button"
              onClick={onCancel}
              className="px-4 py-2 rounded-lg bg-gray-700 hover:bg-gray-600 text-gray-200 text-sm transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              className="px-4 py-2 rounded-lg bg-accent hover:bg-accent-hover text-white text-sm font-medium transition-colors"
            >
              {task ? 'Update Task' : 'Create Task'}
            </button>
          </div>
        </div>
      </form>

      {/* IOC Panel side panel */}
      {showIOCPanel && iocTarget && (
        <IOCPanel
          item={iocTarget}
          onUpdate={handleIOCUpdate}
          onClose={() => setShowIOCPanel(false)}
          attributionActors={taskFormSettings.attributionActors}
          threatIntelConfig={{
            clsLevels: taskFormSettings.tiClsLevels,
            iocSubtypes: taskFormSettings.tiIocSubtypes,
            relationshipTypes: taskFormSettings.tiRelationshipTypes,
            iocStatuses: taskFormSettings.tiIocStatuses,
          }}
          tiExportConfig={{
            defaultClsLevel: taskFormSettings.tiDefaultClsLevel,
            defaultReportSource: taskFormSettings.tiDefaultReportSource,
          }}
        />
      )}

      {task && onDelete && (
        <ConfirmDialog
          open={showConfirmDelete}
          onClose={() => setShowConfirmDelete(false)}
          onConfirm={() => onDelete(task.id)}
          title="Delete Task"
          message="This task will be permanently deleted. This cannot be undone."
          confirmLabel="Delete Task"
          danger
        />
      )}
    </div>
  );
}
