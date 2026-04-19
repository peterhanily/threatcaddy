import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { nanoid } from 'nanoid';
import { MessageSquare, X, Pencil, Check } from 'lucide-react';
import type { EntityComment } from '../../types';
import { useAuth } from '../../contexts/AuthContext';

interface EntityCommentsProps {
  comments: EntityComment[];
  onUpdate: (comments: EntityComment[]) => void;
}

function formatRelativeTime(ts: number, t: (key: string, opts?: Record<string, unknown>) => string): string {
  const diff = Date.now() - ts;
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return t('comments.justNow');
  if (mins < 60) return t('comments.minutesAgo', { count: mins });
  const hours = Math.floor(mins / 60);
  if (hours < 24) return t('comments.hoursAgo', { count: hours });
  const days = Math.floor(hours / 24);
  return t('comments.daysAgo', { count: days });
}

export function EntityComments({ comments, onUpdate }: EntityCommentsProps) {
  const { t } = useTranslation('common');
  const auth = useAuth();
  const [commentText, setCommentText] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editText, setEditText] = useState('');

  const handleAdd = () => {
    if (!commentText.trim()) return;
    const newComment: EntityComment = {
      id: nanoid(),
      userId: auth.user?.id,
      userName: auth.user?.displayName,
      content: commentText.trim(),
      createdAt: Date.now(),
    };
    onUpdate([...comments, newComment]);
    setCommentText('');
  };

  const handleDelete = (commentId: string) => {
    onUpdate(comments.filter((c) => c.id !== commentId));
  };

  const handleStartEdit = (comment: EntityComment) => {
    setEditingId(comment.id);
    setEditText(comment.content);
  };

  const handleSaveEdit = () => {
    if (!editingId || !editText.trim()) return;
    onUpdate(
      comments.map((c) =>
        c.id === editingId
          ? { ...c, content: editText.trim(), updatedAt: Date.now() }
          : c
      )
    );
    setEditingId(null);
    setEditText('');
  };

  const canModify = (comment: EntityComment) => {
    // Allow edit/delete if no userId (local-only) or if current user matches
    return !comment.userId || comment.userId === auth.user?.id;
  };

  return (
    <div>
      <label className="flex items-center gap-1.5 text-xs font-medium text-gray-400 mb-2">
        <MessageSquare size={12} />
        {t('comments.label')} {comments.length > 0 && `(${comments.length})`}
      </label>

      {comments.length > 0 && (
        <div className="space-y-2 mb-3 max-h-48 overflow-y-auto">
          {comments.map((c) => (
            <div key={c.id} className="flex items-start gap-2 bg-gray-800/50 rounded-lg px-3 py-2">
              {editingId === c.id ? (
                <div className="flex-1 flex gap-1.5">
                  <input
                    type="text"
                    maxLength={2000}
                    value={editText}
                    onChange={(e) => setEditText(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') { e.preventDefault(); handleSaveEdit(); }
                      if (e.key === 'Escape') { setEditingId(null); setEditText(''); }
                    }}
                    className="flex-1 bg-gray-700 border border-gray-600 rounded px-2 py-1 text-xs text-gray-200 focus:outline-none focus:border-accent"
                    autoFocus
                  />
                  <button
                    type="button"
                    onClick={handleSaveEdit}
                    className="p-0.5 rounded text-green-400 hover:text-green-300 shrink-0"
                    title={t('comments.saveEdit')}
                    aria-label={t('comments.saveEdit')}
                  >
                    <Check size={12} />
                  </button>
                  <button
                    type="button"
                    onClick={() => { setEditingId(null); setEditText(''); }}
                    className="p-0.5 rounded text-gray-500 hover:text-gray-300 shrink-0"
                    title={t('comments.cancelEdit')}
                    aria-label={t('comments.cancelEdit')}
                  >
                    <X size={12} />
                  </button>
                </div>
              ) : (
                <>
                  <div className="flex-1 min-w-0">
                    {c.userName && (
                      <span className="text-[10px] text-accent font-medium me-1.5">{c.userName}</span>
                    )}
                    <p className="text-xs text-gray-300 whitespace-pre-wrap break-words">{c.content}</p>
                  </div>
                  <span className="text-[10px] text-gray-500 shrink-0">
                    {formatRelativeTime(c.createdAt, t)}
                    {c.updatedAt && ` (${t('comments.edited')})`}
                  </span>
                  {canModify(c) && (
                    <>
                      <button
                        type="button"
                        onClick={() => handleStartEdit(c)}
                        className="p-0.5 rounded text-gray-600 hover:text-gray-400 shrink-0"
                        title={t('comments.editComment')}
                        aria-label={t('comments.editComment')}
                      >
                        <Pencil size={12} />
                      </button>
                      <button
                        type="button"
                        onClick={() => handleDelete(c.id)}
                        className="p-0.5 rounded text-gray-600 hover:text-red-400 shrink-0"
                        title={t('comments.deleteComment')}
                        aria-label={t('comments.deleteComment')}
                      >
                        <X size={12} />
                      </button>
                    </>
                  )}
                </>
              )}
            </div>
          ))}
        </div>
      )}

      <div className="flex gap-2">
        <input
          type="text"
          maxLength={2000}
          value={commentText}
          onChange={(e) => setCommentText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              handleAdd();
            }
          }}
          className="flex-1 bg-gray-800 border border-gray-700 rounded-lg px-3 py-1.5 text-xs text-gray-200 focus:outline-none focus:border-accent"
          placeholder={t('comments.addPlaceholder')}
        />
        <button
          type="button"
          onClick={handleAdd}
          disabled={!commentText.trim()}
          className="px-3 py-1.5 rounded-lg bg-gray-700 hover:bg-gray-600 disabled:opacity-50 text-gray-200 text-xs transition-colors"
        >
          {t('add')}
        </button>
      </div>
    </div>
  );
}
