import { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { nanoid } from 'nanoid';
import { X, MessageSquare, Trash2, Search, Plus, CheckSquare, Square } from 'lucide-react';
import type { Task, Note, TimelineEvent, Priority, TaskStatus, Tag, Folder, IOCTarget, IOCAnalysis, IOCType, TaskComment, ChecklistItem, InvestigationMember } from '../../types';
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

function formatRelativeTime(t: (key: string, opts?: Record<string, number>) => string, ts: number): string {
  const diff = Date.now() - ts;
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return t('form.relativeTime.justNow');
  if (mins < 60) return t('form.relativeTime.minutesAgo', { count: mins });
  const hours = Math.floor(mins / 60);
  if (hours < 24) return t('form.relativeTime.hoursAgo', { count: hours });
  const days = Math.floor(hours / 24);
  return t('form.relativeTime.daysAgo', { count: days });
}

export function TaskForm({ task, folders, allTags, onCreateTag, onSave, onCancel, onUpdateTask, onDelete, allNotes = [], allTimelineEvents = [], defaultFolderId, investigationMembers }: TaskFormProps) {
  const { t } = useTranslation('tasks');
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
  const [titleError, setTitleError] = useState('');
  const [checklistItems, setChecklistItems] = useState<ChecklistItem[]>(task?.checklist || []);
  const [newChecklistText, setNewChecklistText] = useState('');

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
      setChecklistItems(task.checklist || []);
    }
  }, [task]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim()) {
      setTitleError(t('form.titleRequired'));
      return;
    }
    setTitleError('');
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
      checklist: checklistItems.length > 0 ? checklistItems : undefined,
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
      createdAt: new Date().getTime(),
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

  const inputClass = 'w-full bg-bg-deep border border-border-medium rounded-lg px-3 py-2 text-sm text-text-primary focus:outline-none focus:border-accent';
  const labelClass = 'block text-xs font-medium text-text-muted mb-1';

  return (
    <div className="flex gap-0">
      <form onSubmit={handleSubmit} className="space-y-4 flex-1 min-w-0">
        <div>
          <label className={labelClass} htmlFor="task-title">{t('form.titleLabel')}</label>
          <input
            id="task-title"
            autoFocus
            value={title}
            onChange={(e) => { setTitle(e.target.value); if (titleError) setTitleError(''); }}
            className={cn(inputClass, titleError && 'border-red-500')}
            placeholder={t('form.titlePlaceholder')}
            aria-required="true"
            aria-invalid={!!titleError}
            aria-describedby={titleError ? 'task-title-error' : undefined}
          />
          {titleError && (
            <p id="task-title-error" className="text-xs text-red-400 mt-1">{titleError}</p>
          )}
        </div>

        <div>
          <div className="flex items-center gap-2 mb-1">
            <label className="text-xs font-medium text-text-muted">{t('form.descriptionLabel')}</label>
            {isEditMode && onUpdateTask && (
              <button
                type="button"
                onClick={handleShieldClick}
                className={cn('p-1 rounded flex items-center gap-1', showIOCPanel ? 'bg-bg-active text-accent' : 'text-text-muted hover:text-text-secondary')}
                title={t('form.iocAnalysis')}
                aria-label={t('form.toggleIocAnalysis')}
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
            placeholder={t('form.descriptionPlaceholder')}
          />
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className={labelClass}>{t('form.priorityLabel')}</label>
            <select value={priority} onChange={(e) => setPriority(e.target.value as Priority)} className={inputClass}>
              <option value="none">{t('common:none')}</option>
              <option value="low">{t('priority.lowFull')}</option>
              <option value="medium">{t('priority.mediumFull')}</option>
              <option value="high">{t('priority.highFull')}</option>
            </select>
          </div>
          <div>
            <label className={labelClass}>{t('form.statusLabel')}</label>
            <select value={status} onChange={(e) => setStatus(e.target.value as TaskStatus)} className={inputClass}>
              <option value="todo">{t('status.todo')}</option>
              <option value="in-progress">{t('status.inProgress')}</option>
              <option value="done">{t('status.done')}</option>
            </select>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className={labelClass}>{t('form.classificationLabel')}</label>
            <select value={clsLevel} onChange={(e) => setClsLevel(e.target.value)} className={inputClass}>
              <option value="">{t('common:none')}</option>
              {getEffectiveClsLevels(taskFormSettings.tiClsLevels).map((v) => (
                <option key={v} value={v}>{v}</option>
              ))}
            </select>
          </div>
          <div>
            <label className={labelClass}>{t('form.dueDateLabel')}</label>
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
            <label className={labelClass}>{t('form.investigationLabel')}</label>
            <select value={folderId} onChange={(e) => setFolderId(e.target.value)} className={inputClass}>
              <option value="">{t('form.noInvestigation')}</option>
              {folders.map((f) => (
                <option key={f.id} value={f.id}>{f.name}</option>
              ))}
            </select>
          </div>
          {investigationMembers && investigationMembers.length > 0 && (
            <div>
              <label className={labelClass}>{t('form.assigneeLabel')}</label>
              <select value={assigneeId} onChange={(e) => setAssigneeId(e.target.value)} className={inputClass}>
                <option value="">{t('form.unassigned')}</option>
                {investigationMembers.map((m) => (
                  <option key={m.userId} value={m.userId}>{m.displayName}</option>
                ))}
              </select>
            </div>
          )}
        </div>

        <div>
          <label className={labelClass}>{t('form.tagsLabel')}</label>
          <TagInput
            selectedTags={tags}
            allTags={allTags}
            onChange={setTags}
            onCreateTag={onCreateTag}
          />
        </div>

        {/* Checklist */}
        <div>
          <label className="flex items-center gap-1.5 text-xs font-medium text-gray-400 mb-2">
            <CheckSquare size={12} />
            {t('form.checklistLabel')} {checklistItems.length > 0 && t('form.checklistProgress', { done: checklistItems.filter(c => c.done).length, total: checklistItems.length })}
          </label>

          {checklistItems.length > 0 && (
            <div className="space-y-1 mb-2">
              {checklistItems.map((item) => (
                <div key={item.id} className="flex items-center gap-2 bg-gray-800/50 rounded-lg px-3 py-1.5">
                  <button
                    type="button"
                    onClick={() => {
                      const updated = checklistItems.map(c => c.id === item.id ? { ...c, done: !c.done } : c);
                      setChecklistItems(updated);
                      if (isEditMode && task && onUpdateTask) onUpdateTask(task.id, { checklist: updated });
                    }}
                    className={cn('shrink-0', item.done ? 'text-green-400' : 'text-gray-500 hover:text-gray-300')}
                  >
                    {item.done ? <CheckSquare size={14} /> : <Square size={14} />}
                  </button>
                  <span className={cn('text-xs flex-1', item.done && 'line-through text-gray-500')}>{item.text}</span>
                  <button
                    type="button"
                    onClick={() => {
                      const updated = checklistItems.filter(c => c.id !== item.id);
                      setChecklistItems(updated);
                      if (isEditMode && task && onUpdateTask) onUpdateTask(task.id, { checklist: updated.length > 0 ? updated : undefined });
                    }}
                    className="p-0.5 rounded text-gray-600 hover:text-red-400 shrink-0"
                    title={t('form.removeItem')}
                    aria-label={t('form.removeChecklistItem')}
                  >
                    <X size={12} />
                  </button>
                </div>
              ))}
            </div>
          )}

          <div className="flex gap-2">
            <input
              value={newChecklistText}
              onChange={(e) => setNewChecklistText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey && newChecklistText.trim()) {
                  e.preventDefault();
                  const newItem: ChecklistItem = { id: nanoid(), text: newChecklistText.trim(), done: false };
                  const updated = [...checklistItems, newItem];
                  setChecklistItems(updated);
                  setNewChecklistText('');
                  if (isEditMode && task && onUpdateTask) onUpdateTask(task.id, { checklist: updated });
                }
              }}
              className="flex-1 bg-gray-800 border border-gray-700 rounded-lg px-3 py-1.5 text-xs text-gray-200 focus:outline-none focus:border-accent"
              placeholder={t('form.addChecklistPlaceholder')}
            />
            <button
              type="button"
              onClick={() => {
                if (!newChecklistText.trim()) return;
                const newItem: ChecklistItem = { id: nanoid(), text: newChecklistText.trim(), done: false };
                const updated = [...checklistItems, newItem];
                setChecklistItems(updated);
                setNewChecklistText('');
                if (isEditMode && task && onUpdateTask) onUpdateTask(task.id, { checklist: updated });
              }}
              disabled={!newChecklistText.trim()}
              className="px-2 py-1.5 rounded-lg bg-gray-700 hover:bg-gray-600 disabled:opacity-50 text-gray-200 transition-colors"
            >
              <Plus size={14} />
            </button>
          </div>
        </div>

        {/* Entity linking (edit mode only) */}
        {isEditMode && task && onUpdateTask && (
          <div>
            <label className="flex items-center gap-1.5 text-xs font-medium text-text-muted mb-1">
              {t('form.linkedEntities')}
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
            <label className="flex items-center gap-1.5 text-xs font-medium text-text-muted mb-2">
              <MessageSquare size={12} />
              {t('form.commentsLabel')} {comments.length > 0 && t('form.commentCount', { count: comments.length })}
            </label>

            {comments.length > 0 && (
              <div className="space-y-2 mb-3 max-h-48 overflow-y-auto">
                {comments.map((c) => (
                  <div key={c.id} className="flex items-start gap-2 bg-bg-deep/50 rounded-lg px-3 py-2">
                    <p className="text-xs text-text-secondary flex-1 whitespace-pre-wrap break-words">{c.text}</p>
                    <span className="text-[10px] text-text-muted shrink-0">{formatRelativeTime(t, c.createdAt)}</span>
                    <button
                      type="button"
                      onClick={() => handleDeleteComment(c.id)}
                      className="p-0.5 rounded text-text-muted hover:text-red-400 shrink-0"
                      title={t('form.deleteComment')}
                      aria-label={t('form.deleteComment')}
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
                className="flex-1 bg-bg-deep border border-border-medium rounded-lg px-3 py-1.5 text-xs text-text-primary focus:outline-none focus:border-accent"
                placeholder={t('form.addCommentPlaceholder')}
              />
              <button
                type="button"
                onClick={handleAddComment}
                disabled={!commentText.trim()}
                className="px-3 py-1.5 rounded-lg bg-bg-active hover:bg-bg-hover disabled:opacity-50 text-text-primary text-xs transition-colors"
              >
                {t('common:add')}
              </button>
            </div>
          </div>
        )}

        <div className={cn('flex gap-3 pt-2', isEditMode && onDelete ? 'justify-between' : 'justify-end')}>
          {isEditMode && onDelete && task && (
            <button
              type="button"
              onClick={() => setShowConfirmDelete(true)}
              className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-red-500 hover:text-red-400 hover:bg-bg-deep text-sm"
              title={t('item.deleteTask')}
              aria-label={t('item.deleteTask')}
            >
              <Trash2 size={16} />
            </button>
          )}
          <div className="flex gap-3">
            <button
              type="button"
              onClick={onCancel}
              className="px-4 py-2 rounded-lg bg-bg-active hover:bg-bg-hover text-text-primary text-sm transition-colors"
            >
              {t('common:cancel')}
            </button>
            <button
              type="submit"
              className="px-4 py-2 rounded-lg bg-accent hover:bg-accent-hover text-white text-sm font-medium transition-colors"
            >
              {task ? t('form.updateTask') : t('form.createTask')}
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
          title={t('form.confirmDeleteTitle')}
          message={t('form.confirmDeleteMessage')}
          confirmLabel={t('form.confirmDeleteLabel')}
          danger
        />
      )}
    </div>
  );
}
