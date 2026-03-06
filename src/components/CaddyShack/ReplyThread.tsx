import { useState, useEffect, useCallback } from 'react';
import { ArrowLeft } from 'lucide-react';
import { useToast } from '../../contexts/ToastContext';
import { fetchPost, addReaction, removeReaction, deletePost, editPost } from '../../lib/server-api';
import { PostCard } from './PostCard';
import { PostComposer } from './PostComposer';
import type { Post } from '../../types';

interface ReplyThreadProps {
  postId: string;
  currentUserId?: string;
  onBack: () => void;
  onUserClick?: (userId: string) => void;
}

export function ReplyThread({ postId, currentUserId, onBack, onUserClick }: ReplyThreadProps) {
  const { addToast } = useToast();
  const [post, setPost] = useState<Post | null>(null);
  const [loading, setLoading] = useState(true);
  const [replyTo, setReplyTo] = useState<{ id: string; authorName: string } | null>(null);

  const loadPost = useCallback(async () => {
    setLoading(true);
    try {
      const data = await fetchPost(postId);
      setPost(data);
    } catch (err) {
      console.error('Failed to load post:', err);
    } finally {
      setLoading(false);
    }
  }, [postId]);

  useEffect(() => {
    loadPost();
  }, [loadPost]);

  const handleReact = async (targetId: string, emoji: string) => {
    try {
      await addReaction(targetId, emoji);
      await loadPost();
    } catch { addToast('error', 'Failed to add reaction'); }
  };

  const handleRemoveReaction = async (targetId: string, emoji: string) => {
    try {
      await removeReaction(targetId, emoji);
      await loadPost();
    } catch { addToast('error', 'Failed to remove reaction'); }
  };

  const handleDelete = async (targetId: string) => {
    try {
      await deletePost(targetId);
      await loadPost();
    } catch { addToast('error', 'Failed to delete post'); }
  };

  const handleEdit = async (targetId: string, content: string) => {
    try {
      await editPost(targetId, { content });
      await loadPost();
    } catch { addToast('error', 'Failed to edit post'); }
  };

  const handlePin = async (targetId: string, pinned: boolean) => {
    try {
      await editPost(targetId, { pinned });
      await loadPost();
    } catch { addToast('error', 'Failed to update pin status'); }
  };

  const handleReplyToReply = (replyId: string) => {
    const reply = post?.replies?.find((r) => r.id === replyId);
    if (reply) {
      setReplyTo({ id: replyId, authorName: reply.authorDisplayName || 'Unknown' });
    }
  };

  if (loading) {
    return (
      <div className="flex-1 flex items-center justify-center text-[var(--text-tertiary)] text-sm">
        Loading thread...
      </div>
    );
  }

  if (!post) {
    return (
      <div className="flex-1 flex items-center justify-center text-[var(--text-tertiary)] text-sm">
        Post not found.
      </div>
    );
  }

  // Compute composer props based on reply target
  const composerParentId = postId; // Always the root post for flat threading
  const composerReplyToId = replyTo?.id || postId;
  const composerInitialContent = replyTo ? `@${replyTo.authorName} ` : '';
  const composerPlaceholder = replyTo
    ? `Reply to @${replyTo.authorName}...`
    : 'Write a reply...';

  return (
    <div className="flex-1 flex flex-col max-w-2xl mx-auto w-full p-4 gap-4">
      <button
        onClick={onBack}
        className="flex items-center gap-1.5 text-sm text-[var(--text-tertiary)] hover:text-[var(--text-primary)] w-fit transition-colors"
      >
        <ArrowLeft size={16} /> Back to CaddyShack
      </button>

      {/* Original post */}
      <div className="border border-[var(--border)] rounded-xl overflow-hidden bg-[var(--bg-secondary)]">
        <PostCard
          post={post}
          currentUserId={currentUserId}
          onReact={handleReact}
          onRemoveReaction={handleRemoveReaction}
          onDelete={handleDelete}
          onEdit={handleEdit}
          onPin={handlePin}
          onUserClick={onUserClick}
        />
      </div>

      {/* Reply composer */}
      <PostComposer
        key={composerReplyToId}
        parentId={composerParentId}
        replyToId={composerReplyToId}
        folderId={post.folderId}
        placeholder={composerPlaceholder}
        initialContent={composerInitialContent}
        onPostCreated={() => { setReplyTo(null); loadPost(); }}
      />

      {/* Replies — flat list */}
      {post.replies && post.replies.length > 0 && (
        <div className="border border-[var(--border)] rounded-xl overflow-hidden bg-[var(--bg-secondary)] divide-y divide-[var(--border)]">
          <div className="px-4 py-2 text-xs font-medium text-[var(--text-tertiary)] uppercase tracking-wider bg-[var(--bg-primary)]/50">
            {post.replies.length} {post.replies.length === 1 ? 'Reply' : 'Replies'}
          </div>
          {post.replies.map((reply) => (
            <PostCard
              key={reply.id}
              post={reply}
              currentUserId={currentUserId}
              onReply={handleReplyToReply}
              onReact={handleReact}
              onRemoveReaction={handleRemoveReaction}
              onDelete={handleDelete}
              onEdit={handleEdit}
              onPin={handlePin}
              onUserClick={onUserClick}
              compact
            />
          ))}
        </div>
      )}
    </div>
  );
}
