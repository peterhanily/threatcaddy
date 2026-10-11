import { useState, useEffect, useCallback, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { ArrowLeft } from 'lucide-react';
import { useToast } from '../../contexts/ToastContext';
import { fetchPostPage, addReaction, removeReaction, deletePost, editPost } from '../../lib/server-api';
import { PostCard } from './PostCard';
import { PostComposer } from './PostComposer';
import type { Post, Settings } from '../../types';

interface ReplyThreadProps {
  postId: string;
  currentUserId?: string;
  onBack: () => void;
  onUserClick?: (userId: string) => void;
  settings?: Settings;
}

export function ReplyThread(props: ReplyThreadProps) {
  // Keep the loaded post and reply draft owned by one root post. A prop change
  // must not render the previous post with a new composer's parentId.
  return <ReplyThreadContent key={props.postId} {...props} />;
}

function ReplyThreadContent({ postId, currentUserId, onBack, onUserClick, settings }: ReplyThreadProps) {
  const { t } = useTranslation('caddyshack');
  const { t: tt } = useTranslation('toast');
  const { t: tc } = useTranslation('common');
  const { addToast } = useToast();
  const [post, setPost] = useState<Post | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [replyTo, setReplyTo] = useState<{ id: string; authorName: string } | null>(null);
  const mounted = useRef(false);
  const requestVersion = useRef(0);
  const loadingMore = useRef(false);
  const [nextPageLoading, setNextPageLoading] = useState(false);

  const loadPost = useCallback(async () => {
    if (!mounted.current) return;
    const version = ++requestVersion.current;
    loadingMore.current = false;
    setNextPageLoading(false);
    setLoading(true);
    setLoadError(false);
    try {
      const data = await fetchPostPage(postId);
      if (mounted.current && version === requestVersion.current) setPost(data);
    } catch (err) {
      if (mounted.current && version === requestVersion.current) {
        if (err instanceof Error && 'status' in err && [401, 403, 404].includes(Number(err.status))) setPost(null);
        setLoadError(true);
        console.error('Failed to load post:', err);
      }
    } finally {
      if (mounted.current && version === requestVersion.current) setLoading(false);
    }
  }, [postId]);

  const loadMore = async () => {
    const cursor = post?.replyPage?.nextCursor;
    if (!mounted.current || loading || loadingMore.current || !post?.replyPage?.hasMore || !cursor) return;
    loadingMore.current = true;
    setNextPageLoading(true);
    setLoadError(false);
    const version = requestVersion.current;
    try {
      const data = await fetchPostPage(postId, cursor);
      if (!mounted.current || version !== requestVersion.current) return;
      setPost(previous => {
        if (!previous || !mounted.current || version !== requestVersion.current) return previous;
        // A server downgrade can return a complete legacy thread; that is not
        // another partial page and must not be appended to stale page contents.
        if (!data.replyPage) return data;
        const replies = new Map((previous.replies || []).map(reply => [reply.id, reply]));
        for (const reply of data.replies || []) replies.set(reply.id, reply);
        return { ...data, replies: [...replies.values()] };
      });
    } catch (err) {
      if (mounted.current && version === requestVersion.current) {
        if (err instanceof Error && 'status' in err && [401, 403, 404].includes(Number(err.status))) setPost(null);
        setLoadError(true);
        console.error('Failed to load replies:', err);
      }
    } finally {
      if (mounted.current && version === requestVersion.current) {
        loadingMore.current = false;
        setNextPageLoading(false);
      }
    }
  };

  useEffect(() => {
    mounted.current = true;
    void loadPost();
    return () => { mounted.current = false; };
  }, [loadPost]);

  const handleReact = async (targetId: string, emoji: string) => {
    try {
      await addReaction(targetId, emoji);
      await loadPost();
    } catch { addToast('error', tt('caddyshack.reactionAddFailed')); }
  };

  const handleRemoveReaction = async (targetId: string, emoji: string) => {
    try {
      await removeReaction(targetId, emoji);
      await loadPost();
    } catch { addToast('error', tt('caddyshack.reactionRemoveFailed')); }
  };

  const handleDelete = async (targetId: string) => {
    try {
      await deletePost(targetId);
      addToast('success', tt('caddyshack.postDeleted'));
      await loadPost();
    } catch { addToast('error', tt('caddyshack.postDeleteFailed')); }
  };

  const handleEdit = async (targetId: string, content: string) => {
    try {
      await editPost(targetId, { content });
      await loadPost();
    } catch { addToast('error', tt('caddyshack.editFailed')); }
  };

  const handlePin = async (targetId: string, pinned: boolean) => {
    try {
      await editPost(targetId, { pinned });
      await loadPost();
    } catch { addToast('error', tt('caddyshack.pinUpdateFailed')); }
  };

  const handleReplyToReply = (replyId: string) => {
    const reply = post?.replies?.find((r) => r.id === replyId);
    if (reply) {
      setReplyTo({ id: replyId, authorName: reply.authorDisplayName || 'Unknown' });
    }
  };

  if (loading && !post) {
    return (
      <div className="flex-1 flex items-center justify-center text-[var(--text-tertiary)] text-sm">
        {t('reply.loadingThread')}
      </div>
    );
  }

  if (!post) {
    return (
      <div className="flex-1 flex items-center justify-center text-[var(--text-tertiary)] text-sm">
        <span>{loadError ? tc('error.generic') : t('reply.postNotFound')}</span>
        {loadError && <button onClick={() => { void loadPost(); }} className="ms-2 underline">{tc('reload')}</button>}
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
        <ArrowLeft size={16} /> {t('reply.backToCaddyShack')}
      </button>

      {loadError && <div role="alert" className="flex items-center gap-2 text-sm text-red-400">
        <span>{tc('error.generic')}</span>
        <button onClick={() => { void loadPost(); }} className="underline">{tc('reload')}</button>
      </div>}

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
        settings={settings}
      />

      {/* Replies — flat list */}
      {post.replies && post.replies.length > 0 && (
        <div className="border border-[var(--border)] rounded-xl overflow-hidden bg-[var(--bg-secondary)] divide-y divide-[var(--border)]">
          <div className="px-4 py-2 text-xs font-medium text-[var(--text-tertiary)] uppercase tracking-wider bg-[var(--bg-primary)]/50">
            {(post.replyPage?.total ?? post.replies.length) === 1
              ? t('reply.replyCount', { count: post.replyPage?.total ?? post.replies.length })
              : t('reply.replyCountPlural', { count: post.replyPage?.total ?? post.replies.length })}
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
      {post.replyPage?.hasMore && <button onClick={() => { void loadMore(); }} disabled={loading || nextPageLoading}
        className="self-center rounded border border-border-default px-4 py-2 text-sm disabled:opacity-50">
        {nextPageLoading ? tc('loading') : tc('next')}
      </button>}
    </div>
  );
}
