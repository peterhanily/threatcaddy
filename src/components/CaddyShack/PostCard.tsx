import { useState } from 'react';
import { MessageCircle, Smile, Pin, Trash2, Edit3, MoreHorizontal } from 'lucide-react';
import type { Post } from '../../types';
import { MediaGrid } from './MediaGrid';

const QUICK_EMOJIS = ['👍', '❤️', '🔥', '👀', '🎯', '✅'];

interface PostCardProps {
  post: Post;
  currentUserId?: string;
  onReply?: (postId: string) => void;
  onReact?: (postId: string, emoji: string) => void;
  onRemoveReaction?: (postId: string, emoji: string) => void;
  onDelete?: (postId: string) => void;
  onEdit?: (postId: string, content: string) => void;
  onPin?: (postId: string, pinned: boolean) => void;
  onClick?: (postId: string) => void;
  compact?: boolean;
}

export function PostCard({
  post,
  currentUserId,
  onReply,
  onReact,
  onRemoveReaction,
  onDelete,
  onEdit,
  onPin,
  onClick,
  compact,
}: PostCardProps) {
  const [showEmojis, setShowEmojis] = useState(false);
  const [showMenu, setShowMenu] = useState(false);
  const [editing, setEditing] = useState(false);
  const [editContent, setEditContent] = useState(post.content);

  const isAuthor = currentUserId === post.authorId;
  const timeAgo = formatTimeAgo(post.createdAt);

  const handleReaction = (emoji: string) => {
    const reaction = post.reactions?.[emoji];
    if (reaction?.userIds.includes(currentUserId || '')) {
      onRemoveReaction?.(post.id, emoji);
    } else {
      onReact?.(post.id, emoji);
    }
    setShowEmojis(false);
  };

  const handleSaveEdit = () => {
    if (editContent.trim() && editContent !== post.content) {
      onEdit?.(post.id, editContent);
    }
    setEditing(false);
  };

  return (
    <div
      className={`group px-4 ${compact ? 'py-2.5' : 'py-3.5'} hover:bg-[var(--bg-tertiary)]/30 transition-colors ${onClick ? 'cursor-pointer' : ''}`}
      onClick={() => !editing && onClick?.(post.id)}
    >
      {/* Reply-to label */}
      {post.replyToAuthorName && (
        <div className="text-xs text-[var(--text-tertiary)] mb-1.5 ml-12">
          Replying to <span className="text-blue-400">@{post.replyToAuthorName}</span>
        </div>
      )}

      <div className="flex gap-3">
        {/* Avatar */}
        <div className={`${compact ? 'w-7 h-7 text-xs' : 'w-9 h-9 text-sm'} rounded-full bg-blue-600 flex items-center justify-center text-white font-medium shrink-0`}>
          {post.authorDisplayName?.[0]?.toUpperCase() || '?'}
        </div>

        {/* Content area */}
        <div className="flex-1 min-w-0">
          {/* Header: name · time · pin · menu */}
          <div className="flex items-center gap-1.5">
            <span className="font-semibold text-[13px] text-[var(--text-primary)] truncate">
              {post.authorDisplayName || 'Unknown'}
            </span>
            <span className="text-[var(--text-tertiary)] text-xs shrink-0">·</span>
            <span className="text-xs text-[var(--text-tertiary)] shrink-0">{timeAgo}</span>
            {post.pinned && (
              <Pin size={12} className="text-yellow-500 shrink-0" />
            )}
            <div className="flex-1" />
            {isAuthor && (
              <div className="relative">
                <button
                  onClick={(e) => { e.stopPropagation(); setShowMenu(!showMenu); }}
                  className="p-1 rounded-full hover:bg-[var(--bg-tertiary)] text-[var(--text-tertiary)] opacity-0 group-hover:opacity-100 focus:opacity-100 transition-opacity"
                >
                  <MoreHorizontal size={15} />
                </button>
                {showMenu && (
                  <div className="absolute right-0 top-7 z-50 bg-[var(--bg-primary)] border border-[var(--border)] rounded-xl shadow-lg py-1.5 min-w-[150px]">
                    <button
                      onClick={(e) => { e.stopPropagation(); setEditing(true); setShowMenu(false); }}
                      className="w-full px-3 py-2 text-left text-sm hover:bg-[var(--bg-secondary)] flex items-center gap-2.5 text-[var(--text-secondary)]"
                    >
                      <Edit3 size={14} /> Edit
                    </button>
                    <button
                      onClick={(e) => { e.stopPropagation(); onPin?.(post.id, !post.pinned); setShowMenu(false); }}
                      className="w-full px-3 py-2 text-left text-sm hover:bg-[var(--bg-secondary)] flex items-center gap-2.5 text-[var(--text-secondary)]"
                    >
                      <Pin size={14} /> {post.pinned ? 'Unpin' : 'Pin'}
                    </button>
                    <button
                      onClick={(e) => { e.stopPropagation(); onDelete?.(post.id); setShowMenu(false); }}
                      className="w-full px-3 py-2 text-left text-sm hover:bg-[var(--bg-secondary)] text-red-400 flex items-center gap-2.5"
                    >
                      <Trash2 size={14} /> Delete
                    </button>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Content */}
          {editing ? (
            <div className="mt-1" onClick={(e) => e.stopPropagation()}>
              <textarea
                value={editContent}
                onChange={(e) => setEditContent(e.target.value)}
                className="w-full bg-[var(--bg-primary)] border border-[var(--border)] rounded-lg p-2.5 text-sm resize-none focus:ring-1 focus:ring-blue-500 focus:border-blue-500 outline-none"
                rows={3}
                autoFocus
              />
              <div className="flex gap-2 mt-2">
                <button onClick={handleSaveEdit} className="px-3 py-1.5 bg-blue-600 hover:bg-blue-500 text-white rounded-lg text-sm font-medium transition-colors">Save</button>
                <button onClick={() => { setEditing(false); setEditContent(post.content); }} className="px-3 py-1.5 text-[var(--text-secondary)] hover:bg-[var(--bg-tertiary)] rounded-lg text-sm transition-colors">Cancel</button>
              </div>
            </div>
          ) : (
            <div className="text-[14px] text-[var(--text-secondary)] whitespace-pre-wrap break-words leading-relaxed mt-0.5">
              {post.content}
            </div>
          )}

          {/* Attachments */}
          {post.attachments && post.attachments.length > 0 && (
            <div className="mt-2.5">
              <MediaGrid attachments={post.attachments} />
            </div>
          )}

          {/* Reactions */}
          {post.reactions && Object.keys(post.reactions).length > 0 && (
            <div className="flex gap-1.5 flex-wrap mt-2.5">
              {Object.entries(post.reactions).map(([emoji, data]) => (
                <button
                  key={emoji}
                  onClick={(e) => { e.stopPropagation(); handleReaction(emoji); }}
                  className={`px-2 py-0.5 rounded-full text-xs border transition-colors ${
                    data.userIds.includes(currentUserId || '')
                      ? 'border-blue-500/40 bg-blue-500/10 text-blue-400'
                      : 'border-[var(--border)] hover:bg-[var(--bg-tertiary)] text-[var(--text-secondary)]'
                  }`}
                >
                  {emoji} {data.count}
                </button>
              ))}
            </div>
          )}

          {/* Actions */}
          <div className="flex items-center gap-6 mt-2" onClick={(e) => e.stopPropagation()}>
            {onReply && (
              <button
                onClick={() => onReply(post.id)}
                className="flex items-center gap-1.5 text-xs text-[var(--text-tertiary)] hover:text-blue-400 transition-colors"
              >
                <MessageCircle size={15} />
                <span>{post.replyCount || ''}</span>
              </button>
            )}

            <div className="relative">
              <button
                onClick={() => setShowEmojis(!showEmojis)}
                className="flex items-center gap-1.5 text-xs text-[var(--text-tertiary)] hover:text-yellow-400 transition-colors"
              >
                <Smile size={15} />
              </button>
              {showEmojis && (
                <div className="absolute bottom-7 left-0 z-50 bg-[var(--bg-primary)] border border-[var(--border)] rounded-xl shadow-lg p-1.5 flex gap-0.5">
                  {QUICK_EMOJIS.map((emoji) => (
                    <button
                      key={emoji}
                      onClick={() => handleReaction(emoji)}
                      className="p-1.5 hover:bg-[var(--bg-secondary)] rounded-lg text-base leading-none transition-colors"
                    >
                      {emoji}
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function formatTimeAgo(dateStr: string): string {
  const date = new Date(dateStr);
  const now = Date.now();
  const diff = now - date.getTime();
  const minutes = Math.floor(diff / 60000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d`;
  return date.toLocaleDateString();
}
